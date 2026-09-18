"""전사 방식 비교표를 한 번에 만든다. 설정마다 새 프로세스를 띄워 메모리(최대 RSS)를 따로 잰다.

골든셋 정렬본(회의 조건)과 FLEURS(모델 순위)를 같이 돌리고 결과 JSON 을 한 디렉토리에 모은 뒤
markdown 표로 뽑는다. 로컬은 무과금이고 Elice 는 --elice --yes 를 줘야 돈다.

사용 (ai/ 안에서):
  .venv/bin/python -m stt.eval.matrix run --golden "<m01-aligned>" "<m02-aligned>" --fleurs "<fleurs_ko>" --out results/
  .venv/bin/python -m stt.eval.matrix run ... --only local            # 유료 제외
  .venv/bin/python -m stt.eval.matrix report --out results/           # 표만 다시
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

LOCAL_MODELS = ["small", "medium", "large-v3-turbo", "large-v3"]
FLEURS_MODELS = ["base", "small", "medium", "large-v3-turbo", "large-v3"]


def golden_configs(elice: bool) -> list[dict]:
    """(설명, golden.py score 인자) 목록. 순서가 실행 순서다. 중요한 것부터."""
    cfgs: list[dict] = []
    T = "large-v3-turbo"
    for mode in ("chunk", "clip", "track", "whole"):
        cfgs.append(dict(name=f"local {T} {mode}", backend="local", model=T, mode=mode))
    # turbo 변형: 필터 없이, 빠른 빔, 하이패스, 턴마다 묶음, 클립 단위 줄
    cfgs += [
        dict(name=f"local {T} chunk 필터 없음", backend="local", model=T, mode="chunk", extra=["--no-gate"], tag="nogate"),
        dict(name=f"local {T} chunk beam1", backend="local", model=T, mode="chunk", extra=["--beam", "1"], tag="beam1"),
        dict(name=f"local {T} chunk 100Hz 하이패스", backend="local", model=T, mode="chunk", extra=["--preprocess", "highpass"], tag="highpass"),
        dict(name=f"local {T} chunk 턴마다 묶음", backend="local", model=T, mode="chunk", extra=["--no-pack-turns"], tag="perturn"),
        # 문맥 옵션 ablation: 트랙 통째에서 cond 와 hst 를 따로 켜고 끈다
        dict(name=f"local {T} track cond=on hst=1", backend="local", model=T, mode="track", extra=["--cond", "on", "--hst", "1"], tag="cond-on"),
        dict(name=f"local {T} track cond=off hst=off", backend="local", model=T, mode="track", extra=["--hst", "0"], tag="hst-off"),
        dict(name=f"local {T} track cond=on hst=off", backend="local", model=T, mode="track", extra=["--cond", "on", "--hst", "0"], tag="plain"),
    ]
    for m in ("small", "medium", "large-v3"):
        for mode in ("chunk", "clip", "track", "whole"):
            cfgs.append(dict(name=f"local {m} {mode}", backend="local", model=m, mode=mode))
    if elice:
        cfgs += [
            dict(name="elice chunk (워커 3 기본)", backend="elice", model="", mode="chunk"),
            dict(name="elice clip", backend="elice", model="", mode="clip"),
            dict(name="elice whole", backend="elice", model="", mode="whole"),
            dict(name="elice chunk 턴마다 묶음", backend="elice", model="", mode="chunk", extra=["--no-pack-turns"], tag="perturn"),
            dict(name="elice chunk 워커 6", backend="elice", model="", mode="chunk", extra=["--workers", "6"], tag="w6"),
            dict(name="elice chunk 워커 9", backend="elice", model="", mode="chunk", extra=["--workers", "9"], tag="w9"),
        ]
    return cfgs


def _run(cmd: list[str], log: Path) -> tuple[int, float]:
    t0 = time.monotonic()
    with log.open("a", encoding="utf-8") as f:
        f.write(f"\n$ {' '.join(cmd)}\n")
        f.flush()
        rc = subprocess.call(cmd, stdout=f, stderr=subprocess.STDOUT, cwd=Path(__file__).resolve().parents[2])
    return rc, time.monotonic() - t0


def run_all(goldens: list[Path], fleurs: Path | None, out: Path, elice: bool, only: str | None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    log = out / "matrix.log"
    py = sys.executable
    done = {p.name for p in out.rglob("*.json")}
    for g in goldens:
        for c in golden_configs(elice):
            if only and c["backend"] != only:
                continue
            tag = c.get("tag", "")
            stem = f"score_{c['mode']}_{c['backend']}{'' if c['backend'] == 'elice' else '-' + c['model']}{'-' + tag if tag else ''}.json"
            if stem in done and (out / g.name / stem).exists():
                print(f"[skip] {g.name} {c['name']}", flush=True)
                continue
            cmd = [py, "-m", "stt.eval.golden", "score", "--session", str(g), "--mode", c["mode"], "--backend", c["backend"],
                   "--out-dir", str(out / g.name), "--tag", tag, *c.get("extra", [])]
            if c["backend"] == "local":
                cmd += ["--model", c["model"]]
            else:
                cmd += ["--yes"]
            print(f"[run ] {g.name} {c['name']} ...", end="", flush=True)
            rc, dt = _run(cmd, log)
            print(f" rc={rc} {dt:.0f}s", flush=True)
    if fleurs is not None:
        # 모델 순위는 말 필터 없이 잰다. 필터는 turbo 한 줄만 켜서 거른 수를 본다
        for m in FLEURS_MODELS if only != "elice" else []:
            stem = f"fleurs_local-{m}-nogate.json"
            if (out / "fleurs" / stem).exists():
                print(f"[skip] fleurs {m}", flush=True)
                continue
            print(f"[run ] fleurs local {m} ...", end="", flush=True)
            rc, dt = _run([py, "-m", "stt.eval.fleurs", "--root", str(fleurs), "--backend", "local", "--model", m,
                           "--no-gate", "--tag", "nogate", "--out-dir", str(out / "fleurs")], log)
            print(f" rc={rc} {dt:.0f}s", flush=True)
        if not (out / "fleurs" / "fleurs_local-large-v3-turbo-gate.json").exists() and only != "elice":
            print("[run ] fleurs local large-v3-turbo 말 필터 켬 ...", end="", flush=True)
            rc, dt = _run([py, "-m", "stt.eval.fleurs", "--root", str(fleurs), "--backend", "local", "--model", "large-v3-turbo",
                           "--tag", "gate", "--out-dir", str(out / "fleurs")], log)
            print(f" rc={rc} {dt:.0f}s", flush=True)
        if elice and not (out / "fleurs" / "fleurs_elice-nogate.json").exists():
            print("[run ] fleurs elice ...", end="", flush=True)
            rc, dt = _run([py, "-m", "stt.eval.fleurs", "--root", str(fleurs), "--backend", "elice", "--yes",
                           "--no-gate", "--tag", "nogate", "--out-dir", str(out / "fleurs")], log)
            print(f" rc={rc} {dt:.0f}s", flush=True)
    report(out)


def _fmt(v, nd=2, suf=""):
    if v is None:
        return "-"
    if isinstance(v, float):
        return f"{v:.{nd}f}{suf}"
    return f"{v}{suf}"


def report(out: Path) -> None:
    lines = ["# 전사 방식 비교표", ""]
    for gdir in sorted(p for p in out.iterdir() if p.is_dir() and p.name != "fleurs"):
        rows = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(gdir.glob("score_*.json"))]
        if not rows:
            continue
        lines += [f"## {gdir.name}", "",
                  "| 백엔드 | 모드 | 변형 | CER | 삽입률 | 유실 | 순서편집 | 시작오차 | 호출 | 보낸 초 | 원 | 원/회의시간 | 벽시계 | p50 | p95 | 20초 초과 | RTF p95 | CPU초 | CPU/발화초 | RSS GB | 무음 자리 단어 |",
                  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        rows.sort(key=lambda r: (r["backend"], r["mode"], r.get("tag", "")))
        for r in rows:
            lines.append("| " + " | ".join([
                r["backend"], r["mode"], r.get("tag", "") or "기본", f"{r['cer'] * 100:.2f}%",
                f"{r['insertion_rate'] * 100:.1f}%", r["lost_utterances"], str(r["order_edits"]),
                _fmt(r["start_abs_err_mean_s"]), str(r["calls"]), _fmt(r["audio_sent_s"], 0), _fmt(r["krw"], 1),
                _fmt(r.get("krw_per_meeting_hour"), 0), _fmt(r["wall_s"], 0), _fmt(r["transcribe_p50_s"]),
                _fmt(r["transcribe_p95_s"]), str(r.get("calls_over_20s", 0)), _fmt(r.get("rtf_p95"), 2),
                _fmt(r["cpu_s"], 0), _fmt(r.get("cpu_s_per_speech_s")), _fmt(r["peak_rss_gb"]),
                str(r["hallucinated_words"])]) + " |")
        lines.append("")
    fdir = out / "fleurs"
    if fdir.exists():
        rows = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(fdir.glob("fleurs_*.json"))]
        if rows:
            lines += ["## FLEURS 한국어 (모델 순위)", "",
                      "| 백엔드 | 변형 | CER | 클립 중앙 CER | 삽입률 | 거름 | 벽시계 | RTF | p50 | p95 | CPU/발화초 | RSS GB | 원 |",
                      "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
            for r in rows:
                lines.append("| " + " | ".join([
                    r["backend"], {"nogate": "필터 없음", "gate": "필터 켬", "trimgate": "필터 켬"}.get(r.get("tag", ""), r.get("tag", "") or "필터 켬"),
                    f"{r['cer'] * 100:.2f}%", f"{r['cer_median_clip'] * 100:.2f}%",
                    f"{r['insertion_rate'] * 100:.1f}%", str(r["gated"]), _fmt(r["wall_s"], 0), _fmt(r["rtf_wall"], 3),
                    _fmt(r["transcribe_p50_s"]), _fmt(r["transcribe_p95_s"]), _fmt(r["cpu_s_per_speech_s"]),
                    _fmt(r["peak_rss_gb"]), _fmt(r["krw"], 1)]) + " |")
            lines.append("")
    (out / "matrix.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"표: {out / 'matrix.md'}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--golden", type=Path, nargs="*", default=[])
    r.add_argument("--fleurs", type=Path, default=None)
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--elice", action="store_true")
    r.add_argument("--only", choices=["local", "elice"], default=None)
    p = sub.add_parser("report")
    p.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    if a.cmd == "run":
        run_all([g.expanduser() for g in a.golden], a.fleurs.expanduser() if a.fleurs else None, a.out.expanduser(),
                a.elice, a.only)
    else:
        report(a.out.expanduser())
    return 0


if __name__ == "__main__":
    sys.exit(main())
