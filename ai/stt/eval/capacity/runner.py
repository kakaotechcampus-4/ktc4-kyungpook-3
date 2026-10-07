"""서버 처리 용량 측정의 시나리오 실행(#154). 운영 경로로 회의를 전사하며 걸린 시간과 자원을 남긴다.

전사는 운영과 같이 stt.batch.run(chunk, 말 필터 켬)으로만 한다. 평가 도구의 캐시는 쓰지 않는다.
적중하면 처음 잰 시간이 그대로 적혀 가짜로 빨라진다. 모델 로드는 1초 무음 한 번으로 따로 재서 회의 처리
시간에 섞지 않는다.

시나리오 여섯. 결과는 --out-dir 에 JSON 으로 쓰고, 시작할 때 자기 pid 를 --pids-file 에 덧붙인다. 서버
기록기(sampler)가 그 프로세스를 따라가고 메모리가 넘치면 멈춘다.
  seq      한 프로세스에서 같은 회의를 차례로. 워커 1개의 대기열과 같다. 대기 시간은 그 실행의 시작에서
           첫 실행의 시작을 뺀 값이다. --save-lines 면 실행마다 회의록 줄을 lines-<label>-<i>.json 으로 남긴다
  prep     모델 없이 준비 단계(트랙 읽기, 자르기, 말 필터, 묶음)만. 준비 단계와 실행 단계의 메모리를 가른다
  golden   예열한 백엔드로 golden.score 를 불러 CER 까지
  threads  한 프로세스의 스레드 둘이 예열한 백엔드 하나를 같이 쓴다. 봇이 회의 둘을 동시에 처리하는 경우
  botlag   asyncio 루프에서 tick 마다 깨는 코루틴이 얼마나 늦는지. 처음엔 일 없이, 다음엔 봇처럼
           asyncio.to_thread 로 전사하는 동안(capture/discord_adapter.py 의 process_session 호출)
  multi    같은 회의 N 개를 한 프로세스의 스레드 N 개가 백엔드 하나로 동시에. 회의 N 개가 같이 끝난 경우

전사하는 시나리오는 --backend local|elice 와 --workers(회의마다 동시 호출 수, 기본 local 1, elice 6)를 받는다.
elice 는 유료라 --spend-file 장부와 --cap-krw 상한을 꼭 준다. 호출마다 비용을 먼저 예약하고 상한을 넘을 호출은
보내지 않는다(MeteredBackend). 결과에는 backend 와 workers 를 남기고, elice 의 model 은 elice/whisper-large-v3,
beam 은 비우고, load_s 는 0 이다.

CPU 초는 getrusage(RUSAGE_SELF) 앞뒤 차라 프로세스 전체다. threads 에서는 회의마다 값에 다른 회의의 CPU 가
섞인다. 최대 메모리도 프로세스 평생 값이라 키 이름에 lifetime 을 붙였다. 회의별 메모리는 서버 기록기로 본다.

사용 (서버의 /home/ubuntu/capacity/code/ai 안에서. 순서는 night.sh):
  python -m stt.eval.capacity.runner env --out-dir RUN
  python -m stt.eval.capacity.runner seq --tracks-dir DATA/two-person --label two --repeat 3 --out-dir RUN --pids-file RUN/pids
  python -m stt.eval.capacity.runner prep --tracks-dir DATA/long-60 --label long-60 --out-dir RUN --pids-file RUN/pids
  python -m stt.eval.capacity.runner golden --session DATA/m01 --model small --tag m01 --out-dir RUN
  python -m stt.eval.capacity.runner threads --tracks-dir DATA/m01 --tracks-dir DATA/m02 --out-dir RUN
  python -m stt.eval.capacity.runner botlag --tracks-dir DATA/m01 --out-dir RUN
  python -m stt.eval.capacity.runner multi --tracks-dir DATA/m01 --n 3 --backend elice \
      --spend-file RUN/elice_spend.jsonl --cap-krw 1500 --out-dir RUN        (Elice 순서는 night3.sh)
"""

from __future__ import annotations

import argparse
import asyncio
import fcntl
import json
import os
import platform
import resource
import socket
import statistics
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

import numpy as np

from stt import batch as B
from stt.backend import SttError, SttResult
from stt.elice import WHISPER_KRW_PER_SEC
from stt.eval import golden
from stt.eval.sysinfo import peak_rss_bytes
from stt.speech_gate import SpeechGate

SR = 16_000
DEFAULT_MODEL = "large-v3-turbo"   # 운영 기본(capture/recorder.py backend_from_env)과 같다
ELICE_MODEL = "elice/whisper-large-v3"   # 결과의 model 칸. 파일 이름에는 / 가 없는 "elice" 를 쓴다
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


def warm_backend(kind: str, model: str, *, beam: int = 5, factory=None) -> tuple[object, dict]:
    """운영과 같은 chunk 백엔드를 만들고 모델을 올린 뒤 1초 무음을 한 번 전사한다.

    모델 로드(load_s)와 첫 디코딩(first_decode_s)을 따로 잰다. 1초 무음도 30초 창 하나를 디코딩해서,
    합치면 서버에서 로드가 실제보다 몇 초 길게 보인다. 운영 봇도 같은 설정이면 객체 하나를 계속 쓴다.
    elice 는 올릴 모델이 없어 load_s 가 0 이고, first_decode_s 는 유료 호출 한 번의 왕복이다.
    factory 는 부를 때 정한다. 정의할 때 묶으면 테스트가 B.make_backend 를 바꿔도 진짜 백엔드가 만들어진다.
    예열이 SttError 로 실패하면 B._call 과 같은 횟수와 대기로 다시 보낸다. 서버리스가 식어 첫 호출이 한 번 잘리면
    시나리오 전체가 끝나기 때문이다. first_decode_s 는 성공한 호출의 시간이고, 실패한 호출의 왕복은 warm_failed_s
    에 남긴다. 식은 서버가 얼마나 걸리는지가 거기 있다. 상한 거절(CapReached)은 다시 보내도 같아서 바로 올린다.
    """
    backend = (factory or B.make_backend)(kind, model, "chunk", beam=beam)
    load_s = 0.0 if kind == "elice" else None
    if hasattr(backend, "_load"):        # 로컬 백엔드는 첫 호출 때 모델을 올린다. 여기서 먼저 올린다
        t0 = time.monotonic()
        backend._load()
        load_s = time.monotonic() - t0
    failed_s: list[float] = []
    for attempt in range(B.RETRIES + 1):
        t0 = time.monotonic()
        try:
            backend.transcribe(np.zeros(SR, dtype=np.float32), SR)
            break
        except CapReached:
            raise
        except SttError:
            failed_s.append(round(time.monotonic() - t0, 2))
            if attempt == B.RETRIES:
                raise
            time.sleep(B.RETRY_WAIT_S * (attempt + 1))
    return backend, {"load_s": load_s, "first_decode_s": time.monotonic() - t0, "warm_failed_s": failed_s}


# ─────────────────────────────────────────────────────────────── 비용 장부
def spent_krw(path: Path) -> float:
    """장부에 예약된 금액의 합. 장부가 없으면 0."""
    if not path.exists():
        return 0.0
    return sum(json.loads(ln)["krw"] for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip())


class CapReached(SttError):
    """비용 상한에 걸려 보내지 않은 호출. SttError 라 B.run 에서는 다른 실패처럼 한 줄의 실패로 남는다."""


class MeteredBackend:
    """유료 백엔드를 감싸 호출마다 비용을 장부(JSONL)에 먼저 예약한다. 예약 뒤 합이 상한을 넘으면 보내지 않는다.

    예약은 max(오디오 초, min_bill_s) × WHISPER_KRW_PER_SEC 이다. 새 엔드포인트의 과금 단위를 확인하지 못해,
    호출당 최소 과금이 있어도 실제 청구가 장부보다 크지 않게 min_bill_s 로 보수 계산할 수 있다. 실패하거나 시간이
    넘친 호출도 과금됐을 수 있어 예약을 그대로 둔다. B.run 의 재시도는 호출마다 따로 예약된다. 장부 한 줄은
    {"ts", "label", "audio_s", "billed_s", "krw"} 다.
    거절은 장부에 쓰지 않고 refused 로만 센다. B.run 은 거절도 재시도하므로 묶음 하나가 RETRIES + 1 번 센다.
    """

    def __init__(self, inner, spend_file: Path, cap_krw: float, *, label: str, min_bill_s: float = 0.0):
        self.inner, self.spend_file, self.cap_krw, self.label = inner, spend_file, cap_krw, label
        self.min_bill_s = min_bill_s
        self.name = getattr(inner, "name", type(inner).__name__)
        self.refused = 0
        self._lock = threading.Lock()    # 워커 스레드 여럿이 refused 를 같이 센다

    def _reserve(self, audio_s: float) -> None:
        """읽고 더하고 쓰기를 flock 하나로 묶는다. 워커 스레드 여럿과 프로세스 둘(workers2)이 같은 장부를 쓴다.

        flock 은 연 파일마다 걸린다. 호출마다 새로 열어서 같은 프로세스의 스레드끼리도 서로 막는다.
        """
        billed_s = max(audio_s, self.min_bill_s)
        krw = round(billed_s * WHISPER_KRW_PER_SEC, 4)
        self.spend_file.parent.mkdir(parents=True, exist_ok=True)
        with self.spend_file.open("a+", encoding="utf-8") as f:
            fcntl.flock(f, fcntl.LOCK_EX)    # 파일을 닫으면 풀린다
            f.seek(0)
            spent = sum(json.loads(ln)["krw"] for ln in f.read().splitlines() if ln.strip())
            if spent + krw > self.cap_krw:
                with self._lock:
                    self.refused += 1
                raise CapReached(f"비용 상한 {self.cap_krw}원: 예약 {spent:.1f}원에 {krw:.1f}원을 더하면 넘는다")
            f.write(json.dumps({"ts": time.time(), "label": self.label, "audio_s": round(audio_s, 3),
                                "billed_s": round(billed_s, 3), "krw": krw}) + "\n")

    def transcribe(self, samples, sample_rate):
        self._reserve(len(samples) / sample_rate)   # 잠금은 예약까지만. 호출 중에 쥐면 동시 호출이 줄을 선다
        return self.inner.transcribe(samples, sample_rate)


# ─────────────────────────────────────────────────────────────── 한 회의
def _cpu_s(ru) -> float:
    return ru.ru_utime + ru.ru_stime


def _write(out_dir: Path, name: str, data: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def _segments(lines) -> list[dict]:
    """회의록 줄을 9/29 채점(real929)이 읽는 모양으로. 빈 줄은 뺀다.

    timing 이 "chunk" 인 줄은 단어 시각이 없어 묶음 전체를 덮는다. 시작 시각으로 자리를 보는 지표는 그 줄을 가려낸다.
    """
    return [{"speaker": ln.speaker_id, "start": ln.start_ms / 1000, "end": ln.end_ms / 1000, "text": ln.text,
             "seq": ln.seq, "timing": ln.timing} for ln in lines if ln.text]


def measure_run(label: str, tracks: list[B.Track], backend, *, out_dir: Path, gate_factory=SpeechGate,
                lines_out: list | None = None, workers: int = 1, pack_turns: bool = True) -> dict:
    """회의 하나를 전사하고 시각, 걸린 시간, CPU 초, 호출별 시간과 길이를 out_dir/<label>.json 에 쓴다.

    말 필터는 회의마다 새로 만든다. 봇과 워커도 회의마다 gate_factory() 를 부른다(capture/worker.py _speech_gate).
    lines_out 을 주면 회의록 줄을 거기에 붙인다. workers 는 이 회의의 동시 호출 수다(B.default_workers).
    """
    if not tracks:
        raise ValueError(f"{label}: 트랙이 없다. 데이터 폴더에 wav 가 있는지 확인한다")
    ru0 = resource.getrusage(resource.RUSAGE_SELF)
    started_at, t0 = time.time(), time.monotonic()
    lines, stats = B.run(tracks, backend, mode="chunk", gate=gate_factory(), workers=workers, pack_turns=pack_turns)
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
            save_lines: bool = False, model: str | None = None, workers: int = 1, pack_turns: bool = True) -> dict:
    """같은 회의를 repeat 번 차례로. 회의 repeat 개가 같이 끝나 워커 1개 앞에 줄 선 경우와 같다.

    save_lines 면 실행마다 회의록 줄을 golden --save-lines 와 같은 모양으로 lines-<label>-<i>.json 에 쓴다.
    전사 문장이라 원자료 폴더에만 둔다.
    """
    tracks = B.discover(tracks_dir)
    runs: list[dict] = []
    for i in range(1, repeat + 1):
        lines: list | None = [] if save_lines else None
        r = measure_run(f"{label}-{i}", tracks, backend, out_dir=out_dir, gate_factory=gate_factory, lines_out=lines,
                        workers=workers, pack_turns=pack_turns)
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


def _file_model(kind: str, model: str) -> str:
    """파일 이름에 넣는 모델. elice 모델 이름의 / 는 경로가 되므로 "elice" 로 쓴다."""
    return "elice" if kind == "elice" else model


def run_golden(session: Path, *, model: str, tag: str, backend, out_dir: Path, beam: int | None = 5,
               save_lines: bool = False, kind: str = "local", workers: int = 1, pack_turns: bool = True) -> dict:
    """정렬본을 CER 까지. score 의 wall_s·cpu_s 는 전사 구간이고, 바깥의 wall_s·cpu_s 는 채점까지 포함한다.

    score 는 결과 파일 이름에 회의 이름을 넣지 않는다. 같은 out_dir 에 m01·m02 를 쓰려면 tag 로 가른다.
    kind 가 elice 면 score 가 비용을 Elice 단가로 센다.
    """
    ru0 = resource.getrusage(resource.RUSAGE_SELF)
    started_at, t0 = time.time(), time.monotonic()
    lines: list = []
    score = golden.score(session, "chunk", kind, model, True, workers, True, backend=backend, tag=tag,
                         out_dir=out_dir, beam=beam, lines_out=lines, pack_turns=pack_turns)
    wall_s, ended_at = time.monotonic() - t0, time.time()
    ru1 = resource.getrusage(resource.RUSAGE_SELF)
    lines_file = None
    if save_lines:     # 9/29 채점(real929)이 읽는다. 전사 문장이라 원자료 폴더에만 둔다
        name = f"lines-{session.name}-{_file_model(kind, model)}" + ("" if pack_turns else "-turn")   # 비교 실행이 덮어쓰지 않게
        _write(out_dir, name, {"session": session.name, "model": model, "segments": _segments(lines)})
        lines_file = str(out_dir / f"{name}.json")
    return {"scenario": "golden", "session": session.name, "model": model, "tag": tag, "beam": beam,
            "lines_file": lines_file,
            "started_at": started_at, "ended_at": ended_at,
            "wall_s": round(wall_s, 3), "cpu_s": round(_cpu_s(ru1) - _cpu_s(ru0), 2), "score": score}


def run_threads(tracks_dirs: list[Path], *, backend, out_dir: Path, gate_factory=SpeechGate, workers: int = 1) -> dict:
    """한 프로세스의 스레드 여럿이 백엔드 하나로 회의를 하나씩 동시에 전사한다.

    회의마다의 cpu_s 에는 다른 회의의 CPU 가 섞이므로 프로세스 전체 cpu_s 를 따로 남긴다.
    """
    ru0 = resource.getrusage(resource.RUSAGE_SELF)
    started_at, t0 = time.time(), time.monotonic()
    with ThreadPoolExecutor(max_workers=len(tracks_dirs)) as ex:
        futures = [ex.submit(measure_run, f"threads-{i}-{d.name}", B.discover(d), backend,
                             out_dir=out_dir, gate_factory=gate_factory, workers=workers)
                   for i, d in enumerate(tracks_dirs, 1)]
        runs = [f.result() for f in futures]   # 한 회의가 죽으면 여기서 예외가 나 실패로 끝난다
    wall_s, ended_at = time.monotonic() - t0, time.time()
    ru1 = resource.getrusage(resource.RUSAGE_SELF)
    return {"scenario": "threads", "tracks_dirs": [str(d) for d in tracks_dirs],
            "started_at": started_at, "ended_at": ended_at,
            "wall_s": round(wall_s, 3), "cpu_s": round(_cpu_s(ru1) - _cpu_s(ru0), 2), "runs": runs}


def run_multi(tracks_dir: Path, n: int, *, label: str, backend, out_dir: Path, gate_factory=SpeechGate,
              workers: int = 1) -> dict:
    """같은 회의 n 개를 한 프로세스의 스레드 n 개가 백엔드 하나로 동시에 전사한다. 회의가 n 개 같이 끝난 경우다.

    회의마다 workers 개씩 동시에 부르므로 API 에는 최대 n × workers 개가 한꺼번에 간다. 회의별 결과에
    end_s(공통 시작부터 그 회의가 끝날 때까지)를 붙인다. 마지막 회의록이 언제 나오는지 본다.
    회의별 파일은 multi-<label>-<i>.json 이다. label 에 n 이 들어가야 같은 폴더의 다른 n 과 겹치지 않는다.
    """
    ru0 = resource.getrusage(resource.RUSAGE_SELF)
    started_at, t0 = time.time(), time.monotonic()
    with ThreadPoolExecutor(max_workers=n) as ex:
        futures = [ex.submit(measure_run, f"multi-{label}-{i}", B.discover(tracks_dir), backend,
                             out_dir=out_dir, gate_factory=gate_factory, workers=workers)
                   for i in range(1, n + 1)]
        runs = [f.result() for f in futures]
    wall_s, ended_at = time.monotonic() - t0, time.time()
    ru1 = resource.getrusage(resource.RUSAGE_SELF)
    for r in runs:
        r["end_s"] = round(r["ended_at"] - started_at, 3)
    return {"scenario": "multi", "tracks_dir": str(tracks_dir), "n": n,
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
                     gate_factory=SpeechGate, workers: int = 1) -> dict:
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
                                      out_dir=out_dir, gate_factory=gate_factory, workers=workers)
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


def _result_name(args) -> str:
    """결과 파일 이름. elice 모델 이름의 / 가 들어가지 않게 golden 은 _file_model 을 쓴다."""
    if args.cmd == "seq":
        return f"seq-{args.label}"
    if args.cmd == "golden":
        return f"golden-{args.session.name}-{_file_model(args.backend, args.model)}" + (f"-{args.tag}" if args.tag else "")
    if args.cmd == "threads":
        return "threads"
    if args.cmd == "botlag":
        return f"botlag-{args.tracks_dir.name}"
    return f"multi-{args.label or args.n}"


def main(argv: list[str] | None = None) -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--out-dir", type=Path, required=True, help="결과 JSON 을 쓸 폴더")
    common.add_argument("--pids-file", type=Path, default=None, help="시작할 때 자기 pid 를 덧붙인다. 서버 기록기가 읽는다")
    common.add_argument("--beam", type=int, default=5, help="빔 크기. 운영 chunk 는 5, 작은 모델 비교(S4)는 1")
    tx = argparse.ArgumentParser(add_help=False)       # 전사하는 시나리오만
    tx.add_argument("--backend", choices=["local", "elice"], default="local")
    tx.add_argument("--workers", type=int, default=None, help="회의마다 동시 호출 수. 기본: elice 6, local 1")
    tx.add_argument("--no-pack-turns", dest="pack_turns", action="store_false",
                    help="턴마다 묶음 하나(seq, golden). 단어 시각이 없는 백엔드에서 묶음 한 줄이 다른 턴을 덮지 않게")
    tx.add_argument("--spend-file", type=Path, default=None,
                    help="elice 호출마다 비용을 예약하는 장부(JSONL). 여러 프로세스가 같이 쓴다")
    tx.add_argument("--cap-krw", type=float, default=None, help="장부 합의 상한(원). 넘을 호출은 보내지 않는다")
    tx.add_argument("--min-bill-s", type=float, default=0.0,
                    help="장부에 호출마다 적는 최소 초. 과금 단위를 모를 때 보수 계산한다(예: 60)")
    ap = argparse.ArgumentParser(description="서버 처리 용량 측정 시나리오")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("env", parents=[common], help="실행 환경만 env.json 으로")
    s = sub.add_parser("seq", parents=[common, tx], help="같은 회의를 차례로. 워커 1개 대기열")
    s.add_argument("--tracks-dir", type=Path, required=True)
    s.add_argument("--label", required=True)
    s.add_argument("--repeat", type=int, default=1)
    s.add_argument("--model", default=DEFAULT_MODEL)
    s.add_argument("--save-lines", action="store_true", help="실행마다 회의록 줄을 lines-<label>-<i>.json 으로 남긴다")
    pr = sub.add_parser("prep", parents=[common], help="모델 없이 준비 단계만. 준비와 실행의 메모리를 가른다")
    pr.add_argument("--tracks-dir", type=Path, required=True)
    pr.add_argument("--label", required=True)
    g = sub.add_parser("golden", parents=[common, tx], help="정렬본을 CER 까지")
    g.add_argument("--session", type=Path, required=True)
    g.add_argument("--model", default=DEFAULT_MODEL)
    g.add_argument("--tag", default="")
    g.add_argument("--save-lines", action="store_true", help="회의록 줄을 lines-<회의>-<모델>.json 으로 남긴다")
    t = sub.add_parser("threads", parents=[common, tx], help="한 프로세스의 두 스레드가 백엔드 하나로 동시에")
    t.add_argument("--tracks-dir", type=Path, action="append", required=True)
    t.add_argument("--model", default=DEFAULT_MODEL)
    b = sub.add_parser("botlag", parents=[common, tx], help="전사 중 asyncio 루프 지연")
    b.add_argument("--tracks-dir", type=Path, required=True)
    b.add_argument("--model", default=DEFAULT_MODEL)
    b.add_argument("--tick-ms", type=float, default=50)
    b.add_argument("--baseline-s", type=float, default=30)
    mu = sub.add_parser("multi", parents=[common, tx], help="같은 회의 N 개를 한 프로세스의 스레드 N 개가 동시에")
    mu.add_argument("--tracks-dir", type=Path, required=True)
    mu.add_argument("--n", type=int, required=True)
    mu.add_argument("--label", default=None, help="결과 파일 multi-<label>.json. 없으면 n")
    mu.add_argument("--model", default=DEFAULT_MODEL)
    args = ap.parse_args(argv)
    if (getattr(args, "spend_file", None) is None) != (getattr(args, "cap_krw", None) is None):
        ap.error("--spend-file 과 --cap-krw 는 같이 준다. 상한 없는 장부는 비용을 막지 못한다")
    if getattr(args, "backend", None) == "elice" and args.spend_file is None:
        ap.error("--backend elice 는 --spend-file 과 --cap-krw 를 준다. 장부가 없으면 상한 없이 유료 호출이 나간다")

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

    elice = args.backend == "elice"
    model, beam = (ELICE_MODEL, None) if elice else (args.model, args.beam)
    workers = args.workers if args.workers is not None else B.default_workers(args.backend)
    name = _result_name(args)

    def metered(*a, **kw):     # 예열 호출도 과금되므로 예열 전에 감싼다. 장부가 상한이면 예열에서 바로 멈춘다
        return MeteredBackend(B.make_backend(*a, **kw), args.spend_file, args.cap_krw, label=name,
                              min_bill_s=args.min_bill_s)

    factory = metered if elice else B.make_backend   # 로컬은 돈이 들지 않는다
    backend, timing = warm_backend(args.backend, args.model, beam=args.beam, factory=factory)
    kw = {"backend": backend, "out_dir": args.out_dir, "workers": workers}
    if args.cmd == "seq":
        result = run_seq(args.tracks_dir, args.label, repeat=args.repeat, save_lines=args.save_lines, model=model,
                         pack_turns=args.pack_turns, **kw)
    elif args.cmd == "golden":
        result = run_golden(args.session, model=model, tag=args.tag, beam=beam, save_lines=args.save_lines,
                            kind=args.backend, pack_turns=args.pack_turns, **kw)
    elif args.cmd == "threads":
        result = run_threads(args.tracks_dir, **kw)
    elif args.cmd == "botlag":
        result = asyncio.run(run_botlag(args.tracks_dir, tick_ms=args.tick_ms, baseline_s=args.baseline_s, **kw))
    else:
        result = run_multi(args.tracks_dir, args.n, label=args.label or str(args.n), **kw)
    load_s, first_s = timing["load_s"], timing["first_decode_s"]
    _write(args.out_dir, name, {**result, "backend": args.backend, "workers": workers, "pack_turns": args.pack_turns,
                                "model": model, "beam": beam,
                                "load_s": None if load_s is None else round(load_s, 2),
                                "first_decode_s": round(first_s, 2), "warm_failed_s": timing["warm_failed_s"],
                                "refused": getattr(backend, "refused", None), "env": env})
    print(f"[capacity] {name} 끝. 모델 로드 {load_s}초 · 첫 디코딩 {first_s:.1f}초 · 결과 "
          f"{args.out_dir / (name + '.json')}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
