"""서버 처리 용량 측정(#154)의 보고서. night.sh 가 남긴 원자료 폴더에서 표와 숫자 요약을 만든다.

원자료(1초 표본 전체, 채점 결과의 화자별 전사)는 레포 밖에 두고, 레포 안 결과 폴더에는 두 파일만 쓴다.
  summary.json  숫자만. 영문 키, 소수 둘째 자리. 글자 값(모델 이름, 데이터 폴더 이름)은 뺀다
  tables.md     시나리오 표, 회의별 표, 정확도·동시 처리·봇 루프 지연 표, 용량 계산 표(식과 함께)

원자료 폴더:
  events.jsonl   시나리오마다 시작·끝 시각과 rc. 서버 기록과 BE 응답을 이 구간으로 자른다
  sampler.jsonl  1초 서버 기록(stt/eval/capacity/sampler.py). 멈춤 장치가 켜지면 시각 없는 guard_stop 줄이 섞인다
  probe.jsonl    1초 BE /health 응답(stt/eval/capacity/probe.py)
  *.json         시나리오 결과(runner.py). 파일 이름과 구간 이름이 달라서(seq-long-60.json 은 seq-long60 구간)
                 시작 시각이 든 구간에 붙인다

사용 (ai/ 안에서):
  python -m stt.eval.capacity.report --run-dir <원자료 폴더> --out-dir stt/eval/results/<날짜>-server-capacity
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path

from stt.eval.capacity.runner import DEFAULT_MODEL, _lag_summary

MIB = 1024 * 1024
IDLE = "idle"           # night.sh 의 구간 이름. 아무것도 안 할 때
LONG = "seq-long60"     # 60분 합성 회의를 워커 1개로
# t3.medium. 크레딧 1 은 vCPU 1개를 1분 100% 쓴 양이다. 기준 20%/vCPU × 2 라 시간당 24 를 적립하고, 잔고 상한은
# 24시간 적립분 576 이다. unlimited 에서 기준을 넘겨 쓴 몫은 vCPU시간당 $0.05(리눅스)
EARN_PER_HOUR = 24
MAX_BALANCE = 576
USD_PER_VCPU_HOUR = 0.05
QUEUE_N = (1, 2, 3, 5)
# 데이터 폴더 이름 → 종류. 정렬본은 목소리만 진짜고 시간축이 합성이다. 반복 합성은 정확도 근거로 쓰지 않는다
DATA_KIND = {"two-person": "실녹음", "m01": "정렬본", "m02": "정렬본", "long-60": "반복 합성"}


# ─────────────────────────────────────────────────────────────── 읽기
def _jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def windows(events: list[dict]) -> dict[str, tuple]:
    """{시나리오: (시작, 끝, rc)}. night.sh 의 순서를 지킨다."""
    out: dict[str, tuple] = {}
    for e in events:
        if e["event"] == "start":
            out[e["scenario"]] = (e["ts"], None, None)
        else:
            out[e["scenario"]] = (out[e["scenario"]][0], e["ts"], e.get("rc"))
    return out


def _started_at(d: dict) -> float:
    """시나리오 결과의 시작 시각. seq 는 첫 실행, botlag 는 일 없는 30초가 지나고 전사를 시작한 때다."""
    if "started_at" in d:
        return d["started_at"]
    return d["runs"][0]["started_at"] if d["scenario"] == "seq" else d["run"]["started_at"]


def load_run(run_dir) -> dict:
    """원자료 묶음. results 는 {구간 이름: 시나리오 결과}. 결과 파일이 없는 구간(idle, 멈춤 장치에 꺼진 workers2)은 없다.

    score_*.json 은 읽지 않는다. 화자별 전사 문장이 들어 있다. 쓰는 숫자는 golden 결과 안의 score 에 다 있다.
    """
    run_dir = Path(run_dir)
    samples, guards = [], []
    for row in _jsonl(run_dir / "sampler.jsonl"):
        if row.get("event") == "guard_stop":
            # 멈춤 줄에는 시각이 없다. 기록기는 표본을 쓰고 곧바로 이 줄을 쓰므로 바로 앞 표본의 시각을 준다
            guards.append({**row, "ts": samples[-1]["ts"] if samples else None})
        else:
            samples.append(row)
    win = windows(_jsonl(run_dir / "events.jsonl"))
    results = {}
    for p in sorted(run_dir.glob("*.json")):
        if p.name.startswith("score_"):
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        if "scenario" not in d:        # 실행 하나의 파일(two-1.json 등)과 env.json
            continue
        t = _started_at(d)
        name = next((n for n, (a, b, _) in win.items() if a <= t <= b), None)
        if name:
            results[name] = d
    results = {n: results[n] for n in win if n in results}     # night.sh 순서로
    env, commit = run_dir / "env.json", run_dir / "COMMIT"
    return {"windows": win, "samples": samples, "guards": guards, "probes": _jsonl(run_dir / "probe.jsonl"),
            "results": results,
            "env": json.loads(env.read_text(encoding="utf-8")) if env.exists() else None,
            "commit": commit.read_text().strip() if commit.exists() else None}


# ─────────────────────────────────────────────────────────────── 구간별 서버 지표
def _between(rows: list[dict], a: float, b: float) -> list[dict]:
    return [r for r in rows if a <= r["ts"] <= b]


def _mean(xs: list[float]) -> float | None:
    return statistics.fmean(xs) if xs else None


def scenario_metrics(run: dict, name: str) -> dict:
    """한 구간의 서버 지표.

    메모리는 서버 전체 MemTotal-MemAvailable 이다. 스왑은 두 기준으로 적는다. 구간 첫 표본 대비는 그 시나리오가
    늘린 양이고(앞 시나리오가 남긴 스왑이 그대로 있다), 기록 시작 대비는 멈춤 장치가 보는 값이다. PSS 는 표본마다
    따라간 프로세스의 합이고, 끝나는 중이라 읽지 못한 프로세스(None)는 0 으로 둔다. 바쁜 vCPU 에는 steal 이 들어 있다.
    BE 응답은 실패(제한 시간 등)도 걸린 ms 로 넣고, 200 이 아닌 것을 실패로 센다. p95 는 runner 의 봇 루프 지연과 같은
    가까운 순위 방식이다.
    """
    a, b, rc = run["windows"][name]
    ss = _between(run["samples"], a, b)
    pp = _between(run["probes"], a, b)
    swap = [s["swap_used"] for s in ss]
    pss = [sum(v["pss"] for v in s["procs"].values() if v) / MIB for s in ss if s["procs"]]
    busy = [s["busy_vcpus"] for s in ss if s["busy_vcpus"] is not None]
    steal = [s["cpu_steal_pct"] for s in ss if s["cpu_steal_pct"] is not None]
    be = _lag_summary([p["ms"] for p in pp])
    return {
        "minutes": (b - a) / 60, "rc": rc, "samples": len(ss),
        "mem_used_max_mib": max(((s["mem_total"] - s["mem_available"]) / MIB for s in ss), default=None),
        "swap_growth_max_mib": (max(swap) - swap[0]) / MIB if ss else None,
        "swap_over_start_max_mib": max(((s["swap_used"] - s["swap_base"]) / MIB for s in ss), default=None),
        "pss_sum_max_mib": max(pss, default=None),
        "busy_vcpus_mean": _mean(busy), "steal_mean_pct": _mean(steal), "steal_max_pct": max(steal, default=None),
        "be_n": be["n"], "be_p50_ms": be["p50_ms"], "be_p95_ms": be["p95_ms"], "be_max_ms": be["max_ms"],
        "be_failures": sum(1 for p in pp if p.get("status") != 200),
        "guard_stop": any(a <= g["ts"] <= b for g in run["guards"] if g["ts"] is not None),
    }


# ─────────────────────────────────────────────────────────────── 회의별 지표
def _run_row(r: dict) -> dict:
    """measure_run 결과 하나. 회의 길이는 트랙 길이 합 ÷ 트랙 수다(트랙마다 회의 처음부터 끝까지 담는다).

    RTF 는 둘이다. 말 기준(걸린 시간 ÷ 말한 시간)은 말 비율이 다른 회의끼리 견줄 때, 회의 길이 기준(걸린 시간 ÷
    회의 길이)은 "회의 1시간이면 전사가 몇 분" 을 셀 때 쓴다. 회의 길이 기준은 그 회의의 말 비율을 물려받는다.
    """
    st = r["stats"]
    meeting = st["track_s"] / st["tracks"]
    return {"wall_s": r["wall_s"], "cpu_s": r["cpu_s"], "speech_s": st["speech_s"], "meeting_s": meeting,
            "tracks": st["tracks"], "speech_ratio": st["speech_s"] / meeting,
            "rtf_speech": r["wall_s"] / st["speech_s"], "rtf_meeting": r["wall_s"] / meeting,
            "calls": st["calls"], "call_p95_s": st["transcribe_p95_s"], "calls_over_20s": st["calls_over_20s"],
            "failed": st["failed"], "retries": st["retries"], "gated": st["gated"], "wait_s": r.get("wait_s"),
            "peak_rss_mib": r["peak_rss_lifetime_bytes"] / MIB}


def run_metrics(run: dict) -> dict:
    """시나리오 결과 JSON 에서 {구간 이름: 지표}. kind 는 seq·golden·threads·botlag.

    golden 은 score 에서 숫자만 고른다. cer_by_speaker 는 실명이 키라 쓰지 않는다. threads 의 회의별 CPU 초는 다른
    회의의 CPU 가 섞여 있어 쓰지 않고 프로세스 전체 값만 둔다. 끝 시각은 두 회의의 공통 시작에서 잰다.
    sequential_wall_s 는 같은 회의를 golden 에서 하나씩 돌린 전사 시간의 합이다(같은 모델·빔이 다 있을 때만).
    """
    out = {}
    for name, d in run["results"].items():
        kind = d["scenario"]
        base = {"kind": kind, "model": d["model"], "beam": d["beam"], "load_s": d["load_s"],
                "first_decode_s": d["first_decode_s"]}
        if kind == "seq":
            out[name] = {**base, "data": Path(d["tracks_dir"]).name,
                         "runs": {r["label"]: _run_row(r) for r in d["runs"]}}
        elif kind == "golden":
            s = d["score"]
            lost, n = (int(x) for x in s["lost_utterances"].split("/"))
            meeting = s["track_s"] / s["tracks"]
            out[name] = {**base, "data": d["session"], "cer_pct": s["cer"] * 100, "lost": lost, "utterances": n,
                         "wall_s": s["wall_s"], "cpu_s": s["cpu_s"], "speech_s": s["speech_s"],
                         "peak_rss_gb": s["peak_rss_gb"], "meeting_s": meeting, "speech_ratio": s["speech_s"] / meeting,
                         "rtf_speech": s["wall_s"] / s["speech_s"], "rtf_meeting": s["wall_s"] / meeting,
                         "calls": s["calls"], "call_p95_s": s["transcribe_p95_s"],
                         "calls_over_20s": s["calls_over_20s"], "failed": s["failed"], "retries": s["retries"],
                         "gated": s["gated"], "insertion_pct": s["insertion_rate"] * 100,
                         "order_edits": s["order_edits"], "start_err_max_s": s["start_abs_err_max_s"]}
        elif kind == "threads":
            names = [Path(x).name for x in d["tracks_dirs"]]
            alone = {g["session"]: g["score"]["wall_s"] for g in run["results"].values()
                     if g["scenario"] == "golden" and g["model"] == d["model"] and g["beam"] == d["beam"]}
            out[name] = {**base, "data": "+".join(names), "wall_s": d["wall_s"], "cpu_s": d["cpu_s"],
                         "runs": {r["label"]: {"data": m, "end_s": r["ended_at"] - d["started_at"]}
                                  for r, m in zip(d["runs"], names)},
                         "sequential_wall_s": sum(alone[m] for m in names) if all(m in alone for m in names) else None}
        elif kind == "botlag":
            out[name] = {**base, "data": Path(d["tracks_dir"]).name, "idle": d["idle"], "busy": d["busy"],
                         "runs": {d["run"]["label"]: _run_row(d["run"])}}
    return out


# ─────────────────────────────────────────────────────────────── 용량 계산
def credits_net(samples: list[dict]) -> float:
    """기록 전체의 크레딧 순소모. 표본의 바쁜 vCPU 는 앞 표본부터 그 표본까지의 평균이라 그 사이 초를 곱해 더한다.

    CloudWatch 의 CPUCreditBalance 가 같은 시간에 줄어든 양과 견주어 아래 크레딧 식을 확인하는 데 쓴다.
    """
    used = sum(b["busy_vcpus"] * (b["ts"] - a["ts"]) / 60
               for a, b in zip(samples, samples[1:]) if b["busy_vcpus"] is not None)
    hours = (samples[-1]["ts"] - samples[0]["ts"]) / 3600
    return used - EARN_PER_HOUR * hours


def _c(value, formula: str) -> dict:
    return {"value": value, "formula": formula}


def capacity(run: dict) -> dict:
    """계산값. {키: {"value", "formula"}}. 시간은 긴 회의(seq-long60, 워커 1개)의 실측에서 센다.

    회의 N개가 같이 끝나 워커 1개 앞에 줄 서면, 워커가 모델을 한 번 올리고 차례로 전사하므로 마지막 결과까지
    N × (회의 길이 기준 RTF × 60분) + 모델 로드다. 첫 디코딩은 30초 창 하나를 디코딩하는 보통 호출 하나의 값이라
    따로 더하지 않는다. 긴 회의는 62.4분이라 60분 회의는 RTF 로 환산한다.

    크레딧. 서버 전체 바쁜 vCPU 가 b 면 시간당 60·b 크레딧을 쓴다. 바쁨은 BE·DB·봇·기록기까지 서버 전체라 상시
    부하가 이미 들어 있다. 하루에 T 시간 전사하고 나머지는 상시 상태면 하루 소모는 60·b_전사·T + 60·b_상시·(24−T).
    unlimited 는 24시간 평균 사용률이 기준 이하면 추가 요금이 없고, 그 조건은 하루 소모 ≤ 하루 적립 24×24 = 576 이다.
    그래서 T = (576 − 1440·b_상시) ÷ (60·(b_전사 − b_상시)). 잔고 576 은 한 번 쓰면 이후 남는 적립으로 다시 채워야 해서
    매일 쓸 수 있는 몫이 아니다. 그 한 번은 따로 적는다. 잔고가 가득일 때 쉬지 않고 전사하면 576 ÷ (60·b_전사 − 24)
    시간 뒤 바닥난다. 한도를 넘긴 전사 1시간은 상시보다 (b_전사 − b_상시) vCPU시간을 더 써서 그만큼 요금이 붙는다.
    b_전사는 긴 회의의 전사 구간(모델 로드 뒤 started_at~ended_at) 평균이다. steal 은 바쁨에 들어 있지만 평균 1~2%
    라 빼지 않았다.

    메모리. 서버 전체에서 상시 사용(idle 최대)을 뺀 자리에 운영 모델 전사 프로세스(PSS 최대)가 몇 개 들어가는지.
    스왑은 넣지 않는다. 프로세스 하나인 시나리오만 보므로 결과 파일이 없는 workers2 는 빠진다.
    """
    long = run["results"][LONG]
    r = long["runs"][0]
    row = _run_row(r)
    rtf, meeting, wall = row["rtf_meeting"], row["meeting_s"], row["wall_s"]
    per_hour = rtf * 60
    load_s = long["load_s"]
    cap = {
        "long_meeting_min": _c(meeting / 60, f"트랙 길이 합 {r['stats']['track_s']:.1f}초 ÷ 트랙 {row['tracks']}개 ÷ 60"),
        "long_transcribe_min": _c(wall / 60, f"{LONG} 실측 걸린 시간 {wall:.1f}초 ÷ 60"),
        "long_speech_ratio": _c(row["speech_ratio"], f"말한 시간 {row['speech_s']:.1f}초 ÷ 회의 길이 {meeting:.1f}초"),
        "rtf_meeting": _c(rtf, f"걸린 시간 {wall:.1f}초 ÷ 회의 길이 {meeting:.1f}초"),
        "transcribe_min_per_meeting_hour": _c(per_hour, f"회의 길이 기준 RTF {rtf:.3f} × 60분"),
        "meeting_hours_per_day_one_worker": _c(24 / rtf, f"24시간 ÷ RTF {rtf:.3f}. 쉬지 않고 돌릴 때"),
        "model_load_s": _c(load_s, f"{LONG} 의 모델 로드. 첫 디코딩은 넣지 않는다"),
    }
    for n in QUEUE_N:
        cap[f"queue_last_result_min_n{n}"] = _c(n * per_hour + load_s / 60,
                                                f"{n} × {per_hour:.2f}분 + 모델 로드 {load_s:.1f}초")

    b_idle = scenario_metrics(run, IDLE)["busy_vcpus_mean"]
    b_busy = _mean([s["busy_vcpus"] for s in _between(run["samples"], r["started_at"], r["ended_at"])
                    if s["busy_vcpus"] is not None])
    c_idle, c_busy = b_idle * 60, b_busy * 60
    earn_day = EARN_PER_HOUR * 24
    t_day = (earn_day - c_idle * 24) / (c_busy - c_idle)
    hours = (run["samples"][-1]["ts"] - run["samples"][0]["ts"]) / 3600
    cap.update({
        "busy_vcpus_idle": _c(b_idle, f"{IDLE} 구간 서버 전체 바쁜 vCPU 평균"),
        "busy_vcpus_transcribing": _c(b_busy, f"{LONG} 전사 구간 서버 전체 바쁜 vCPU 평균"),
        "credits_per_hour_idle": _c(c_idle, f"{b_idle:.4f} × 60"),
        "credits_per_hour_transcribing": _c(c_busy, f"{b_busy:.4f} × 60"),
        "credits_per_day_idle": _c(c_idle * 24, f"{c_idle:.3f} × 24시간"),
        "credits_earned_per_day": _c(earn_day, f"시간당 적립 {EARN_PER_HOUR} × 24시간"),
        "transcribe_hours_per_day_no_charge": _c(
            t_day, f"({earn_day} − 하루 상시 소모 {c_idle * 24:.1f}) ÷ (전사 중 시간당 소모 {c_busy:.1f} − "
                   f"상시 시간당 소모 {c_idle:.1f})"),
        "meeting_hours_per_day_no_charge": _c(t_day / rtf, f"하루 전사 가능 {t_day:.2f}시간 ÷ RTF {rtf:.3f}"),
        "burst_hours_from_full_balance": _c(
            MAX_BALANCE / (c_busy - EARN_PER_HOUR),
            f"잔고 상한 {MAX_BALANCE} ÷ (전사 중 시간당 소모 {c_busy:.1f} − 적립 {EARN_PER_HOUR}). 한 번만 쓸 수 있다"),
        "usd_per_extra_transcribe_hour": _c(
            (b_busy - b_idle) * USD_PER_VCPU_HOUR,
            f"(전사 중 {b_busy:.4f} − 상시 {b_idle:.4f}) vCPU × ${USD_PER_VCPU_HOUR}/vCPU시간"),
        "credits_net_measured": _c(
            credits_net(run["samples"]),
            f"기록 전체 {hours:.2f}시간의 Σ(바쁜 vCPU × 초 ÷ 60) − {EARN_PER_HOUR} × {hours:.2f}. CloudWatch 와 대조"),
    })

    total = run["samples"][0]["mem_total"] / MIB
    idle_used = scenario_metrics(run, IDLE)["mem_used_max_mib"]
    pss = [scenario_metrics(run, n)["pss_sum_max_mib"] for n, d in run["results"].items() if d["model"] == DEFAULT_MODEL]
    pss_one = max(p for p in pss if p is not None)
    cap.update({
        "mem_total_mib": _c(total, "MemTotal"),
        "idle_mem_used_max_mib": _c(idle_used, f"{IDLE} 구간 MemTotal − MemAvailable 최대"),
        "one_transcription_pss_max_mib": _c(pss_one, f"{DEFAULT_MODEL} 프로세스 하나인 시나리오의 PSS 최대"),
        "workers_fit_in_memory": _c(math.floor((total - idle_used) / pss_one),
                                    f"⌊(전체 {total:.0f} − 상시 {idle_used:.0f}) ÷ {pss_one:.0f}⌋ MiB. 스왑 제외"),
    })
    return cap


# ─────────────────────────────────────────────────────────────── 쓰기
LABELS = {
    "long_meeting_min": "긴 회의 길이(분, 반복 합성)",
    "long_transcribe_min": "긴 회의 전사 시간 실측(분)",
    "long_speech_ratio": "긴 회의 말 비율",
    "rtf_meeting": "회의 길이 기준 RTF",
    "transcribe_min_per_meeting_hour": "회의 1시간당 전사 시간(분)",
    "meeting_hours_per_day_one_worker": "워커 1개가 하루에 처리하는 회의(시간)",
    "model_load_s": "모델 로드(초)",
    **{f"queue_last_result_min_n{n}": f"대기열 회의 {n}개의 마지막 결과까지(분)" for n in QUEUE_N},
    "busy_vcpus_idle": "상시 바쁜 vCPU",
    "busy_vcpus_transcribing": "전사 중 바쁜 vCPU",
    "credits_per_hour_idle": "상시 크레딧 소모(시간당)",
    "credits_per_hour_transcribing": "전사 중 크레딧 소모(시간당)",
    "credits_per_day_idle": "상시 크레딧 소모(하루)",
    "credits_earned_per_day": "크레딧 적립(하루)",
    "transcribe_hours_per_day_no_charge": "추가 요금 없이 하루 전사 가능(시간)",
    "meeting_hours_per_day_no_charge": "추가 요금 없이 하루 처리하는 회의(시간)",
    "burst_hours_from_full_balance": "잔고 가득에서 쉬지 않고 전사할 때 바닥까지(시간)",
    "usd_per_extra_transcribe_hour": "한도를 넘긴 전사 1시간당 추가 요금(USD)",
    "credits_net_measured": "측정 동안 크레딧 순소모(서버 기록)",
    "mem_total_mib": "서버 메모리(MiB)",
    "idle_mem_used_max_mib": "상시 사용 메모리 최대(MiB)",
    "one_transcription_pss_max_mib": "전사 프로세스 하나 PSS 최대(MiB)",
    "workers_fit_in_memory": "메모리에 들어가는 전사 프로세스(개)",
}


def _numbers(x):
    """summary.json 용. 글자 값은 빼고 소수는 둘째 자리로 자른다. 계산은 자르기 전 값으로 끝낸 뒤다."""
    if isinstance(x, dict):
        return {k: _numbers(v) for k, v in x.items() if not isinstance(v, str)}
    if isinstance(x, float):
        return round(x, 2)
    return x


def _f(v) -> str:
    if v is None:
        return "-"
    if isinstance(v, bool):
        return "예" if v else "아니오"
    return f"{v:.2f}" if isinstance(v, float) else str(v)


def _table(cols: list[str], rows: list[list]) -> str:
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    lines += ["| " + " | ".join(_f(v) for v in r) + " |" for r in rows]
    return "\n".join(lines)


def _data(folder: str) -> str:
    return f"{DATA_KIND.get(folder, '-')} {folder}"


def _tables(run: dict, scen: dict, runs: dict, cap: dict, run_name: str) -> str:
    env = run["env"] or {}
    total = cap["mem_total_mib"]["value"]
    out = [f"# 서버 처리 용량 측정 {run_name}", "",
           f"커밋 {(run['commit'] or '-')[:7]}, faster-whisper {env.get('faster_whisper', '-')}, "
           f"ctranslate2 {env.get('ctranslate2', '-')}, vCPU {env.get('cpu_count', '-')}, 메모리 {total:.0f}MiB. "
           "`python -m stt.eval.capacity.report` 가 원자료 폴더에서 만든 표다.", "",
           "데이터 종류. 실녹음은 2인 디스코드 녹음, 정렬본은 6인 목소리에 시간축이 합성이고 대본 낭독이라 짧은 대답과 "
           "겹침이 없다. 반복 합성은 정렬본 둘을 이어 붙인 긴 회의라 시간과 자원만 보고 정확도 근거로 쓰지 않는다.", ""]

    out += ["## 시나리오", "",
            "서버 전체 값이다. 같은 서버에서 BE·DB·봇이 같이 돈다. 스왑은 구간 첫 표본 대비(그 시나리오가 늘린 양)와 "
            "기록 시작 대비(멈춤 장치 기준) 둘이다.", "",
            _table(["시나리오", "걸린 분", "rc", "서버 사용 메모리 최대 MiB", "스왑 증가 최대 MiB(구간 첫 표본 대비)",
                    "스왑 증가 최대 MiB(기록 시작 대비)", "측정 프로세스 PSS 합 최대 MiB", "바쁜 vCPU 평균",
                    "steal 평균 %", "steal 최대 %", "BE 응답 p50 ms", "BE 응답 p95 ms", "BE 응답 최대 ms", "BE 실패",
                    "멈춤 장치"],
                   [[n, m["minutes"], m["rc"], m["mem_used_max_mib"], m["swap_growth_max_mib"],
                     m["swap_over_start_max_mib"], m["pss_sum_max_mib"], m["busy_vcpus_mean"], m["steal_mean_pct"],
                     m["steal_max_pct"], m["be_p50_ms"], m["be_p95_ms"], m["be_max_ms"], m["be_failures"],
                     m["guard_stop"]] for n, m in scen.items()]), ""]

    meeting_rows = []
    for n, d in runs.items():
        if d["kind"] not in ("seq", "botlag"):
            continue
        for label, r in d["runs"].items():
            meeting_rows.append([n, label, _data(d["data"]), d["model"], d["beam"], r["meeting_s"], r["speech_s"],
                                 r["speech_ratio"], r["wall_s"], r["cpu_s"], r["rtf_speech"], r["rtf_meeting"],
                                 r["calls"], r["call_p95_s"], r["calls_over_20s"], r["failed"], r["retries"],
                                 r["wait_s"], r["peak_rss_mib"]])
    out += ["## 회의별", "",
            "워커 1개로 전사한 실행이다. botlag 는 봇처럼 asyncio.to_thread 로 돌렸다. 대기 초는 첫 실행 시작부터 그 실행 "
            "시작까지다.", "",
            _table(["시나리오", "회의", "데이터", "모델", "빔", "회의 길이 초", "말한 시간 초", "말 비율", "걸린 초",
                    "CPU 초", "RTF(말 기준)", "RTF(회의 길이 기준)", "호출", "호출 p95 초", "20초 넘은 호출", "실패",
                    "재시도", "대기 초", "프로세스 최대 RSS MiB"], meeting_rows), ""]

    out += ["## 모델 로드", "",
            _table(["시나리오", "모델", "빔", "모델 로드 초", "첫 디코딩 초"],
                   [[n, d["model"], d["beam"], d["load_s"], d["first_decode_s"]] for n, d in runs.items()]), ""]

    golden = {n: d for n, d in runs.items() if d["kind"] == "golden"}
    out += ["## 골든 정확도", "",
            "걸린 초와 CPU 초는 채점을 뺀 전사 구간이다. 최대 RSS 는 10진 GB(바이트 ÷ 10⁹)다.", "",
            _table(["시나리오", "데이터", "모델", "빔", "CER %", "삽입률 %", "잃은 발화", "순서 뒤바뀜", "시작 시각 오차 최대 초",
                    "걸린 초", "CPU 초", "최대 RSS GB"],
                   [[n, _data(d["data"]), d["model"], d["beam"], d["cer_pct"], d["insertion_pct"],
                     f"{d['lost']}/{d['utterances']}", d["order_edits"], d["start_err_max_s"], d["wall_s"], d["cpu_s"],
                     d["peak_rss_gb"]] for n, d in golden.items()]), "",
            "같은 실행의 회의 길이와 호출이다.", "",
            _table(["시나리오", "회의 길이 초", "말한 시간 초", "말 비율", "RTF(말 기준)", "RTF(회의 길이 기준)", "호출",
                    "호출 p95 초", "20초 넘은 호출", "실패", "재시도", "말 필터가 거른 클립"],
                   [[n, d["meeting_s"], d["speech_s"], d["speech_ratio"], d["rtf_speech"], d["rtf_meeting"], d["calls"],
                     d["call_p95_s"], d["calls_over_20s"], d["failed"], d["retries"], d["gated"]]
                    for n, d in golden.items()]), ""]

    for n, d in runs.items():
        if d["kind"] != "threads":
            continue
        out += [f"## 동시 처리 ({n})", "",
                "한 프로세스의 두 스레드가 모델 하나로 회의 둘을 같이 전사했다. 끝 시각은 공통 시작에서 잰 초다. "
                f"프로세스 전체 CPU 초 {_f(d['cpu_s'])}. 회의별 CPU 초는 서로 섞여 쓰지 않는다.", "",
                _table(["회의", "데이터", "끝 시각 초"],
                       [[label, _data(r["data"]), r["end_s"]] for label, r in d["runs"].items()]
                       + [["전체", "-", d["wall_s"]], ["골든에서 하나씩 돌린 전사 시간 합", "-", d["sequential_wall_s"]]]),
                ""]

    for n, d in runs.items():
        if d["kind"] != "botlag":
            continue
        out += [f"## 봇 루프 지연 ({n})", "",
                "asyncio 루프에서 50ms 마다 깨는 코루틴이 예정보다 늦은 ms 다. 봇처럼 nice 없이 돌렸다.", "",
                _table(["구간", "표본", "p50 ms", "p95 ms", "최대 ms"],
                       [[label, d[k]["n"], d[k]["p50_ms"], d[k]["p95_ms"], d[k]["max_ms"]]
                        for k, label in (("idle", "일 없음"), ("busy", "전사 중"))]), ""]

    out += ["## 용량 계산", "",
            "식과 근거는 stt/eval/capacity/report.py 의 capacity() 에 있다. 시간은 반복 합성 긴 회의의 실측이라 그 "
            "회의의 말 비율을 물려받는다.", "",
            _table(["항목", "값", "식"], [[LABELS[k], v["value"], v["formula"]] for k, v in cap.items()]), ""]
    return "\n".join(out)


def write_report_files(run_dir, out_dir) -> dict:
    """out_dir/summary.json 과 out_dir/tables.md. 표본이 없는 구간(env)은 뺀다. summary 를 돌려준다."""
    run_dir, out_dir = Path(run_dir), Path(out_dir)
    run = load_run(run_dir)
    scen = {n: m for n in run["windows"] if (m := scenario_metrics(run, n))["samples"]}
    runs = run_metrics(run)
    cap = capacity(run)
    summary = _numbers({"scenarios": scen, "runs": runs, "capacity": {k: v["value"] for k, v in cap.items()}})
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out_dir / "tables.md").write_text(_tables(run, scen, runs, cap, run_dir.name), encoding="utf-8")
    return summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="서버 처리 용량 측정 보고서. 원자료 폴더에서 summary.json 과 tables.md 를 만든다")
    ap.add_argument("--run-dir", type=Path, required=True, help="night.sh 의 RUN_DIR. 레포 밖 원자료")
    ap.add_argument("--out-dir", type=Path, required=True, help="표와 숫자 요약을 쓸 폴더")
    a = ap.parse_args(argv)
    write_report_files(a.run_dir, a.out_dir)
    print(f"[capacity] 보고서 {a.out_dir / 'summary.json'}, {a.out_dir / 'tables.md'}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
