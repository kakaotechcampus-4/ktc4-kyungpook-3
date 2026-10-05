"""서버 처리 용량 측정의 시나리오 실행(#154). 운영 경로로 회의를 전사하며 걸린 시간과 자원을 남긴다.

전사는 운영과 같이 stt.batch.run(chunk, 말 필터 켬, 워커 1)으로만 한다. 평가 도구의 캐시는 쓰지 않는다.
적중하면 처음 잰 시간이 그대로 적혀 가짜로 빨라진다. 모델 로드는 1초 무음 한 번으로 따로 재서 회의 처리
시간에 섞지 않는다.

시나리오 다섯. 결과는 --out-dir 에 JSON 으로 쓰고, 시작할 때 자기 pid 를 --pids-file 에 덧붙인다. 서버
기록기(sampler)가 그 프로세스를 따라가고 메모리가 넘치면 멈춘다.
  seq      한 프로세스에서 같은 회의를 차례로. 워커 1개의 대기열과 같다. 대기 시간은 그 실행의 시작에서
           첫 실행의 시작을 뺀 값이다. --save-lines 면 실행마다 회의록 줄을 lines-<label>-<i>.json 으로 남긴다
  prep     모델 없이 준비 단계(트랙 읽기, 자르기, 말 필터, 묶음)만. 준비 단계와 실행 단계의 메모리를 가른다
  golden   예열한 백엔드로 golden.score 를 불러 CER 까지
  threads  한 프로세스의 스레드 둘이 예열한 백엔드 하나를 같이 쓴다. 봇이 회의 둘을 동시에 처리하는 경우
  botlag   asyncio 루프에서 tick 마다 깨는 코루틴이 얼마나 늦는지. 처음엔 일 없이, 다음엔 봇처럼
           asyncio.to_thread 로 전사하는 동안(capture/discord_adapter.py 의 process_session 호출)

CPU 초는 getrusage(RUSAGE_SELF) 앞뒤 차라 프로세스 전체다. threads 에서는 회의마다 값에 다른 회의의 CPU 가
섞인다. 최대 메모리도 프로세스 평생 값이라 키 이름에 lifetime 을 붙였다. 회의별 메모리는 서버 기록기로 본다.

사용 (서버의 /home/ubuntu/capacity/code/ai 안에서. 순서는 night.sh):
  python -m stt.eval.capacity.runner env --out-dir RUN
  python -m stt.eval.capacity.runner seq --tracks-dir DATA/two-person --label two --repeat 3 --out-dir RUN --pids-file RUN/pids
  python -m stt.eval.capacity.runner prep --tracks-dir DATA/long-60 --label long-60 --out-dir RUN --pids-file RUN/pids
  python -m stt.eval.capacity.runner golden --session DATA/m01 --model small --tag m01 --out-dir RUN
  python -m stt.eval.capacity.runner threads --tracks-dir DATA/m01 --tracks-dir DATA/m02 --out-dir RUN
  python -m stt.eval.capacity.runner botlag --tracks-dir DATA/m01 --out-dir RUN
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import resource
import socket
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import numpy as np

from stt import batch as B
from stt.backend import SttResult
from stt.eval import golden
from stt.eval.sysinfo import peak_rss_bytes
from stt.speech_gate import SpeechGate

SR = 16_000
DEFAULT_MODEL = "large-v3-turbo"   # 운영 기본(capture/recorder.py backend_from_env)과 같다
# 결과 파일에 남기는 환경 변수는 이 다섯뿐이다. 서버 .env 에는 봇 토큰과 API 키가 같이 있다
ENV_KEYS = ("MM_STT_BACKEND", "MM_STT_MODEL", "MM_PIPELINE_MODE", "MM_EXTRACT_PATH", "PM_AGENT_LLM")
AI_DIR = Path(__file__).resolve().parents[3]


# ─────────────────────────────────────────────────────────────── 환경과 예열
def _pkg_version(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def _git_commit(repo_dir: Path | None) -> str | None:
    try:
        p = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo_dir, capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return p.stdout.strip() or None


def env_info(repo_dir: Path | None) -> dict:
    """실행 환경. 나중에 다른 실행과 숫자를 견줄 때 조건이 같았는지 본다.

    버전은 패키지 정보에서 읽는다. ctranslate2 를 import 하면 버전 하나 보려고 모델 라이브러리를 올린다.
    cpu_threads 는 LocalStt 가 WhisperModel 에 넘기지 않아 faster-whisper 기본값이다.
    """
    return {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": _git_commit(repo_dir),
        "host": socket.gethostname(),
        "cpu_count": os.cpu_count(),
        "python": platform.python_version(),
        "faster_whisper": _pkg_version("faster-whisper"),
        "ctranslate2": _pkg_version("ctranslate2"),
        "env": {k: os.environ.get(k) for k in ENV_KEYS},
        "cpu_threads": "기본값",
        "nice": os.nice(0),
    }


def warm_backend(kind: str, model: str, *, beam: int = 5, factory=B.make_backend) -> tuple[object, dict]:
    """운영과 같은 chunk 백엔드를 만들고 모델을 올린 뒤 1초 무음을 한 번 전사한다.

    모델 로드(load_s)와 첫 디코딩(first_decode_s)을 따로 잰다. 1초 무음도 30초 창 하나를 디코딩해서,
    합치면 서버에서 로드가 실제보다 몇 초 길게 보인다. 운영 봇도 같은 설정이면 객체 하나를 계속 쓴다.
    """
    backend = factory(kind, model, "chunk", beam=beam)
    load_s = None
    if hasattr(backend, "_load"):        # 로컬 백엔드는 첫 호출 때 모델을 올린다. 여기서 먼저 올린다
        t0 = time.monotonic()
        backend._load()
        load_s = time.monotonic() - t0
    t0 = time.monotonic()
    backend.transcribe(np.zeros(SR, dtype=np.float32), SR)
    return backend, {"load_s": load_s, "first_decode_s": time.monotonic() - t0}


# ─────────────────────────────────────────────────────────────── 한 회의
def _cpu_s(ru) -> float:
    return ru.ru_utime + ru.ru_stime


def _write(out_dir: Path, name: str, data: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def _segments(lines) -> list[dict]:
    """회의록 줄을 추출 비교(judge_diff)가 읽는 모양으로. 빈 줄은 뺀다."""
    return [{"speaker": ln.speaker_id, "start": ln.start_ms / 1000, "end": ln.end_ms / 1000, "text": ln.text,
             "seq": ln.seq} for ln in lines if ln.text]


def measure_run(label: str, tracks: list[B.Track], backend, *, out_dir: Path, gate_factory=SpeechGate,
                lines_out: list | None = None) -> dict:
    """회의 하나를 전사하고 시각, 걸린 시간, CPU 초, 호출별 시간과 길이를 out_dir/<label>.json 에 쓴다.

    말 필터는 회의마다 새로 만든다. 봇과 워커도 회의마다 gate_factory() 를 부른다(capture/worker.py _speech_gate).
    lines_out 을 주면 회의록 줄을 거기에 붙인다.
    """
    if not tracks:
        raise ValueError(f"{label}: 트랙이 없다. 데이터 폴더에 wav 가 있는지 확인한다")
    ru0 = resource.getrusage(resource.RUSAGE_SELF)
    started_at, t0 = time.time(), time.monotonic()
    lines, stats = B.run(tracks, backend, mode="chunk", gate=gate_factory(), workers=1)
    wall_s, ended_at = time.monotonic() - t0, time.time()
    ru1 = resource.getrusage(resource.RUSAGE_SELF)
    if lines_out is not None:
        lines_out.extend(lines)
    out = {
        "label": label, "started_at": started_at, "ended_at": ended_at,
        "wall_s": round(wall_s, 3), "cpu_s": round(_cpu_s(ru1) - _cpu_s(ru0), 2),
        "lines": len(lines), "stats": stats.summary(),
        "calls": [{"transcribe_s": round(t, 3), "len_s": round(n, 2)}
                  for t, n in zip(stats.transcribe_s, stats.call_len_s)],
        "peak_rss_lifetime_bytes": peak_rss_bytes(ru1),
    }
    _write(out_dir, label, out)
    return out


# ─────────────────────────────────────────────────────────────── 시나리오
def run_seq(tracks_dir: Path, label: str, *, repeat: int, backend, out_dir: Path, gate_factory=SpeechGate,
            save_lines: bool = False, model: str | None = None) -> dict:
    """같은 회의를 repeat 번 차례로. 회의 repeat 개가 같이 끝나 워커 1개 앞에 줄 선 경우와 같다.

    save_lines 면 실행마다 회의록 줄을 golden --save-lines 와 같은 모양으로 lines-<label>-<i>.json 에 쓴다.
    전사 문장이라 원자료 폴더에만 둔다.
    """
    tracks = B.discover(tracks_dir)
    runs: list[dict] = []
    for i in range(1, repeat + 1):
        lines: list | None = [] if save_lines else None
        r = measure_run(f"{label}-{i}", tracks, backend, out_dir=out_dir, gate_factory=gate_factory, lines_out=lines)
        r["wait_s"] = round(r["started_at"] - runs[0]["started_at"], 3) if runs else 0.0
        if save_lines:
            _write(out_dir, f"lines-{label}-{i}", {"session": label, "model": model, "segments": _segments(lines)})
            r["lines_file"] = str(out_dir / f"lines-{label}-{i}.json")
        runs.append(r)
    return {"scenario": "seq", "tracks_dir": str(tracks_dir), "label": label, "repeat": repeat, "runs": runs}


class EmptyStt:
    """전사하지 않고 빈 결과를 바로 돌려준다. prep 이 준비 단계만 재는 데 쓴다."""
    name = "prep/empty"

    def transcribe(self, samples, sample_rate):
        return SttResult(text="")


def run_prep(tracks_dir: Path, label: str, *, out_dir: Path, gate_factory=SpeechGate) -> dict:
    """모델 없이 운영과 같은 B.run 을 돌려 준비 단계(트랙 읽기, 자르기, 말 필터, 묶음)의 시간과 메모리만 잰다.

    프로세스에 전사 모델이 없으니 평생 최대 메모리가 곧 준비 단계 값이다. 실행 단계 메모리는 같은 회의의 seq
    결과와의 차로 본다. 그 차에는 모델과 디코딩 말고도 결과를 기다리며 붙잡은 묶음(HOLD_PCM_MB 까지)이
    들어간다. 빈 결과가 바로 와서 prep 은 묶음을 거의 붙잡지 않는다.
    """
    run = measure_run(f"prep-{label}-run", B.discover(tracks_dir), EmptyStt(), out_dir=out_dir,
                      gate_factory=gate_factory)
    return {"scenario": "prep", "tracks_dir": str(tracks_dir), "label": label, "run": run}


def run_golden(session: Path, *, model: str, tag: str, backend, out_dir: Path, beam: int = 5,
               save_lines: bool = False) -> dict:
    """정렬본을 CER 까지. score 의 wall_s·cpu_s 는 전사 구간이고, 바깥의 wall_s·cpu_s 는 채점까지 포함한다.

    score 는 결과 파일 이름에 회의 이름을 넣지 않는다. 같은 out_dir 에 m01·m02 를 쓰려면 tag 로 가른다.
    """
    ru0 = resource.getrusage(resource.RUSAGE_SELF)
    started_at, t0 = time.time(), time.monotonic()
    lines: list = []
    score = golden.score(session, "chunk", "local", model, True, 1, True, backend=backend, tag=tag, out_dir=out_dir,
                         beam=beam, lines_out=lines)
    wall_s, ended_at = time.monotonic() - t0, time.time()
    ru1 = resource.getrusage(resource.RUSAGE_SELF)
    lines_file = None
    if save_lines:     # 추출 비교(judge_diff)가 읽는다. 전사 문장이라 원자료 폴더에만 둔다
        name = f"lines-{session.name}-{model}"
        _write(out_dir, name, {"session": session.name, "model": model, "segments": _segments(lines)})
        lines_file = str(out_dir / f"{name}.json")
    return {"scenario": "golden", "session": session.name, "model": model, "tag": tag, "beam": beam,
            "lines_file": lines_file,
            "started_at": started_at, "ended_at": ended_at,
            "wall_s": round(wall_s, 3), "cpu_s": round(_cpu_s(ru1) - _cpu_s(ru0), 2), "score": score}


def run_threads(tracks_dirs: list[Path], *, backend, out_dir: Path, gate_factory=SpeechGate) -> dict:
    """한 프로세스의 스레드 여럿이 백엔드 하나로 회의를 하나씩 동시에 전사한다.

    회의마다의 cpu_s 에는 다른 회의의 CPU 가 섞이므로 프로세스 전체 cpu_s 를 따로 남긴다.
    """
    ru0 = resource.getrusage(resource.RUSAGE_SELF)
    started_at, t0 = time.time(), time.monotonic()
    with ThreadPoolExecutor(max_workers=len(tracks_dirs)) as ex:
        futures = [ex.submit(measure_run, f"threads-{i}-{d.name}", B.discover(d), backend,
                             out_dir=out_dir, gate_factory=gate_factory)
                   for i, d in enumerate(tracks_dirs, 1)]
        runs = [f.result() for f in futures]   # 한 회의가 죽으면 여기서 예외가 나 실패로 끝난다
    wall_s, ended_at = time.monotonic() - t0, time.time()
    ru1 = resource.getrusage(resource.RUSAGE_SELF)
    return {"scenario": "threads", "tracks_dirs": [str(d) for d in tracks_dirs],
            "started_at": started_at, "ended_at": ended_at,
            "wall_s": round(wall_s, 3), "cpu_s": round(_cpu_s(ru1) - _cpu_s(ru0), 2), "runs": runs}


def _lag_summary(lags_ms: list[float]) -> dict:
    """p95 는 BatchStats.summary 와 같은 방식(가장 가까운 순위)이다. 두 표의 숫자를 같은 뜻으로 읽는다."""
    xs = sorted(lags_ms)
    if not xs:
        return {"n": 0, "p50_ms": None, "p95_ms": None, "max_ms": None}
    p95 = xs[min(len(xs) - 1, int(round((len(xs) - 1) * 0.95)))]
    return {"n": len(xs), "p50_ms": round(statistics.median(xs), 2), "p95_ms": round(p95, 2),
            "max_ms": round(xs[-1], 2)}


async def run_botlag(tracks_dir: Path, *, backend, out_dir: Path, tick_ms: float = 50, baseline_s: float = 30,
                     gate_factory=SpeechGate) -> dict:
    """봇 방식에서 전사가 이벤트 루프를 얼마나 밀어내는지.

    tick_ms 마다 깨는 코루틴이 예정보다 몇 ms 늦게 깼는지 모은다. 처음 baseline_s 는 일 없이, 그다음은
    asyncio.to_thread 로 전사하는 동안이다. 전사 스레드가 GIL 을 쥐는 만큼 루프가 밀리고, 봇에서는 다른 방의
    음성 패킷과 디스코드 신호 처리가 그만큼 늦는다. 두 구간에 걸친 표본은 깬 시점의 구간에 넣는다.
    """
    tick_s = tick_ms / 1000
    lags: dict[str, list[float]] = {"idle": [], "busy": []}
    phase = "idle"

    async def ticker() -> None:
        loop = asyncio.get_running_loop()
        while True:
            t0 = loop.time()
            await asyncio.sleep(tick_s)
            lags[phase].append((loop.time() - t0 - tick_s) * 1000)

    task = asyncio.create_task(ticker())
    try:
        await asyncio.sleep(baseline_s)
        phase = "busy"
        run = await asyncio.to_thread(measure_run, f"botlag-{tracks_dir.name}-run", B.discover(tracks_dir), backend,
                                      out_dir=out_dir, gate_factory=gate_factory)
    finally:
        task.cancel()
    return {"scenario": "botlag", "tracks_dir": str(tracks_dir), "tick_ms": tick_ms, "baseline_s": baseline_s,
            "idle": _lag_summary(lags["idle"]), "busy": _lag_summary(lags["busy"]), "run": run}


# ─────────────────────────────────────────────────────────────── 실행
def _append_pid(path: Path | None) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(f"{os.getpid()}\n")


def main(argv: list[str] | None = None) -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--out-dir", type=Path, required=True, help="결과 JSON 을 쓸 폴더")
    common.add_argument("--pids-file", type=Path, default=None, help="시작할 때 자기 pid 를 덧붙인다. 서버 기록기가 읽는다")
    common.add_argument("--beam", type=int, default=5, help="빔 크기. 운영 chunk 는 5, 작은 모델 비교(S4)는 1")
    ap = argparse.ArgumentParser(description="서버 처리 용량 측정 시나리오")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("env", parents=[common], help="실행 환경만 env.json 으로")
    s = sub.add_parser("seq", parents=[common], help="같은 회의를 차례로. 워커 1개 대기열")
    s.add_argument("--tracks-dir", type=Path, required=True)
    s.add_argument("--label", required=True)
    s.add_argument("--repeat", type=int, default=1)
    s.add_argument("--model", default=DEFAULT_MODEL)
    s.add_argument("--save-lines", action="store_true", help="실행마다 회의록 줄을 lines-<label>-<i>.json 으로 남긴다")
    pr = sub.add_parser("prep", parents=[common], help="모델 없이 준비 단계만. 준비와 실행의 메모리를 가른다")
    pr.add_argument("--tracks-dir", type=Path, required=True)
    pr.add_argument("--label", required=True)
    g = sub.add_parser("golden", parents=[common], help="정렬본을 CER 까지")
    g.add_argument("--session", type=Path, required=True)
    g.add_argument("--model", default=DEFAULT_MODEL)
    g.add_argument("--tag", default="")
    g.add_argument("--save-lines", action="store_true", help="회의록 줄을 lines-<회의>-<모델>.json 으로 남긴다")
    t = sub.add_parser("threads", parents=[common], help="한 프로세스의 두 스레드가 백엔드 하나로 동시에")
    t.add_argument("--tracks-dir", type=Path, action="append", required=True)
    t.add_argument("--model", default=DEFAULT_MODEL)
    b = sub.add_parser("botlag", parents=[common], help="전사 중 asyncio 루프 지연")
    b.add_argument("--tracks-dir", type=Path, required=True)
    b.add_argument("--model", default=DEFAULT_MODEL)
    b.add_argument("--tick-ms", type=float, default=50)
    b.add_argument("--baseline-s", type=float, default=30)
    args = ap.parse_args(argv)

    _append_pid(args.pids_file)
    env = env_info(AI_DIR)
    if args.cmd == "env":
        _write(args.out_dir, "env", env)
        return 0
    if args.cmd == "prep":      # 모델을 올리지 않으므로 예열도 없다. 보고서가 읽는 모델 칸은 비운다
        name = f"prep-{args.label}"
        _write(args.out_dir, name, {**run_prep(args.tracks_dir, args.label, out_dir=args.out_dir), "model": None,
                                    "beam": None, "load_s": None, "first_decode_s": None, "env": env})
        print(f"[capacity] {name} 끝. 결과 {args.out_dir / (name + '.json')}", flush=True)
        return 0

    backend, timing = warm_backend("local", args.model, beam=args.beam)
    if args.cmd == "seq":
        name = f"seq-{args.label}"
        result = run_seq(args.tracks_dir, args.label, repeat=args.repeat, backend=backend, out_dir=args.out_dir,
                         save_lines=args.save_lines, model=args.model)
    elif args.cmd == "golden":
        name = f"golden-{args.session.name}-{args.model}" + (f"-{args.tag}" if args.tag else "")
        result = run_golden(args.session, model=args.model, tag=args.tag, backend=backend, out_dir=args.out_dir,
                            beam=args.beam, save_lines=args.save_lines)
    elif args.cmd == "threads":
        name = "threads"
        result = run_threads(args.tracks_dir, backend=backend, out_dir=args.out_dir)
    else:
        name = f"botlag-{args.tracks_dir.name}"
        result = asyncio.run(run_botlag(args.tracks_dir, backend=backend, out_dir=args.out_dir,
                                        tick_ms=args.tick_ms, baseline_s=args.baseline_s))
    load_s, first_s = timing["load_s"], timing["first_decode_s"]
    _write(args.out_dir, name, {**result, "model": args.model, "beam": args.beam,
                                "load_s": None if load_s is None else round(load_s, 2),
                                "first_decode_s": round(first_s, 2), "env": env})
    print(f"[capacity] {name} 끝. 모델 로드 {load_s}초 · 첫 디코딩 {first_s:.1f}초 · 결과 "
          f"{args.out_dir / (name + '.json')}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
