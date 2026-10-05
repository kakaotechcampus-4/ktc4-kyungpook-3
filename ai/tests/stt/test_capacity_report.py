"""용량 측정 보고서(stt/eval/capacity/report.py). tmp_path 에 night.sh 결과 폴더 모양의 작은 가짜 run 을 만든다."""

import json
import math

import pytest

from stt.eval.capacity import report as R

MIB = 1024 * 1024
SECRET_TEXT = "비밀 회의 문장이 새면 안 된다"
SECRET_NAME = "홍길동"


def _sample(ts, used, *, swap=1, busy=0.1, steal=0.0, procs=None):
    """서버 기록기 한 줄. 메모리는 MiB 로 받아 바이트로 쓴다. 전체 4000MiB, 기록 시작 스왑 1MiB."""
    return {"ts": ts, "mono": ts, "mem_total": 4000 * MIB, "mem_available": (4000 - used) * MIB,
            "swap_used": swap * MIB, "cpu_busy_pct": None if busy is None else busy * 50,
            "cpu_steal_pct": steal, "busy_vcpus": busy,
            "procs": {pid: (None if v is None else {"rss": v * MIB, "pss": v * MIB}) for pid, v in (procs or {}).items()},
            "cgroups": {}, "swap_base": 1 * MIB}


def _stats(*, tracks=2, track_s=240.0, speech_s=100.0, calls=4, p95=31.0, over=3, failed=0):
    return {"mode": "chunk", "tracks": tracks, "track_s": track_s, "speech_s": speech_s, "calls": calls,
            "transcribe_p95_s": p95, "calls_over_20s": over, "failed": failed, "retries": 0, "gated": 0}


def _measure(label, started, ended, wall, cpu, **kw):
    return {"label": label, "started_at": started, "ended_at": ended, "wall_s": wall, "cpu_s": cpu, "lines": 7,
            "stats": _stats(**kw), "calls": [{"transcribe_s": 30.0, "len_s": 24.0}],
            "peak_rss_lifetime_bytes": 2 * 1024 ** 3}


def _score(cer, lost, wall, cpu, speech):
    return {"session": "m01", "beam": 5, "cer": cer, "lost_utterances": lost, "wall_s": wall, "cpu_s": cpu,
            "speech_s": speech, "peak_rss_gb": 2.19, "cer_by_speaker": {SECRET_NAME: 0.1},
            "hyp_by_speaker": {SECRET_NAME: SECRET_TEXT}, "tracks": 6, "track_s": 300.0, "calls": 7,
            "transcribe_p95_s": 32.36, "calls_over_20s": 7, "failed": 0, "retries": 0, "gated": 0,
            "insertion_rate": 0.0154, "order_edits": 0, "start_abs_err_max_s": 0.0}


def _jl(path, rows):
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def _js(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def run_dir(tmp_path):
    d = tmp_path / "run"
    d.mkdir()
    ev = [("env", 99.0, 99.5, 0), ("idle", 100, 104, 0), ("seq-long60", 104, 124, 0),
          ("golden-m01-turbo", 124, 127, 0), ("golden-m02-turbo", 127, 130, 0), ("threads", 130, 140, 0),
          ("botlag-m01", 140, 150, 0), ("workers2", 150, 155, 143)]
    rows = []
    for name, a, b, rc in ev:
        rows += [{"ts": a, "event": "start", "scenario": name}, {"ts": b, "event": "end", "scenario": name, "rc": rc}]
    _jl(d / "events.jsonl", rows)

    samples = [
        # idle. 첫 표본은 앞 표본이 없어 CPU 칸이 비어 있다
        _sample(100, 700, busy=None, steal=None), _sample(101, 800), _sample(102, 750, steal=2.0), _sample(103, 760),
        # seq-long60. 실제 전사 구간은 106~122 다(앞뒤는 모델 로드와 정리)
        _sample(104.2, 1500, swap=2, busy=0.4, procs={"7": 300}),
        _sample(106, 2900, swap=3, busy=1.2, procs={"7": 1300}),
        _sample(110, 3000, swap=6, busy=1.4, steal=5.0, procs={"7": 1400}),
        _sample(120, 2950, swap=4, busy=1.3, procs={"7": None}),     # 끝나는 중이라 읽지 못했다
        _sample(123, 2000, swap=4, busy=0.5),
        _sample(125, 2950, swap=4, busy=1.2, procs={"8": 1500}),     # golden-m01-turbo
        _sample(128, 2900, swap=4, busy=1.2, procs={"8": 1450}),     # golden-m02-turbo
        _sample(135, 3000, swap=4, busy=1.3, procs={"9": 1480}),     # threads
        _sample(145, 2900, swap=4, busy=1.1, procs={"10": 1450}),    # botlag
        _sample(151, 3300, swap=50, busy=0.5, procs={"11": 1100, "12": 1100}),   # workers2
        _sample(152, 3400, swap=900, busy=0.5, procs={"11": 1200, "12": 1200}),
    ]
    lines = [json.dumps(s) for s in samples]
    lines.append(json.dumps({"event": "guard_stop", "reason": "스왑 기준을 넘었다", "pids": [11, 12]},
                            ensure_ascii=False))
    (d / "sampler.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    _jl(d / "probe.jsonl", [
        {"ts": 100.5, "ms": 2.0, "status": 200}, {"ts": 101.5, "ms": 3.0, "status": 200},
        {"ts": 102.5, "ms": 4.0, "status": 200}, {"ts": 103.5, "ms": 5000.0, "error": "TimeoutError: timed out"},
        {"ts": 105.0, "ms": 6.0, "status": 200}, {"ts": 115.0, "ms": 8.0, "status": 500},
    ])

    env = {"git_commit": None, "cpu_count": 2, "faster_whisper": "1.2.1", "ctranslate2": "4.8.2", "nice": 10}
    _js(d / "env.json", env)
    (d / "COMMIT").write_text("abc1234\n")
    common = {"model": "large-v3-turbo", "beam": 5, "load_s": 15.0, "first_decode_s": 25.0, "env": env}
    _js(d / "seq-long-60.json", {"scenario": "seq", "tracks_dir": "/data/long-60", "label": "long-60", "repeat": 1,
                                  "runs": [{**_measure("long-60-1", 106, 122, 150.0, 170.0), "wait_s": 0.0}],
                                  **common})
    _js(d / "long-60-1.json", _measure("long-60-1", 106, 122, 150.0, 170.0))   # 실행 하나의 파일. 시나리오가 아니다
    for m, a, wall in (("m01", 124.5, 60.0), ("m02", 127.5, 62.0)):
        _js(d / f"golden-{m}-large-v3-turbo-{m}.json",
            {"scenario": "golden", "session": m, "model": "large-v3-turbo", "tag": m, "beam": 5, "started_at": a,
             "ended_at": a + 2, "wall_s": wall + 1, "cpu_s": 71.0, "score": _score(0.0533, "1/7", wall, 70.0, 40.0),
             **{k: v for k, v in common.items() if k not in ("model", "beam")}})
        _js(d / f"score_chunk_local-large-v3-turbo-{m}.json", _score(0.0533, "1/7", wall, 70.0, 40.0))
    _js(d / "threads.json", {"scenario": "threads", "tracks_dirs": ["/data/m01", "/data/m02"],
                             "started_at": 130.5, "ended_at": 139.5, "wall_s": 9.0, "cpu_s": 16.0,
                             "runs": [_measure("threads-1-m01", 130.5, 139.5, 9.0, 16.0),
                                      _measure("threads-2-m02", 130.5, 139.0, 8.5, 15.0)], **common})
    _js(d / "botlag-m01.json", {"scenario": "botlag", "tracks_dir": "/data/m01", "tick_ms": 50, "baseline_s": 30,
                                "idle": {"n": 600, "p50_ms": 0.2, "p95_ms": 0.3, "max_ms": 3.0},
                                "busy": {"n": 4000, "p50_ms": 0.25, "p95_ms": 1.4, "max_ms": 52.5},
                                "run": _measure("botlag-m01-run", 141, 149, 8.0, 9.0), **common})
    return d


def test_windows_pair_start_and_end_with_rc():
    ev = [{"ts": 1.0, "event": "start", "scenario": "a"}, {"ts": 2.0, "event": "end", "scenario": "a", "rc": 0},
          {"ts": 2.5, "event": "start", "scenario": "b"}, {"ts": 9.0, "event": "end", "scenario": "b", "rc": 143}]
    assert R.windows(ev) == {"a": (1.0, 2.0, 0), "b": (2.5, 9.0, 143)}


def test_load_run_matches_scenario_files_to_windows_by_time(run_dir):
    run = R.load_run(run_dir)
    # 파일 이름(seq-long-60, golden-m01-large-v3-turbo-m01)과 구간 이름(seq-long60, golden-m01-turbo)이 다르다
    assert list(run["results"]) == ["seq-long60", "golden-m01-turbo", "golden-m02-turbo", "threads", "botlag-m01"]
    assert run["results"]["seq-long60"]["label"] == "long-60"
    assert run["commit"] == "abc1234"


def test_load_run_gives_the_guard_line_the_time_of_the_sample_before_it(run_dir):
    run = R.load_run(run_dir)
    assert [g["ts"] for g in run["guards"]] == [152]
    assert all("ts" in s for s in run["samples"])


def test_scenario_metrics_for_idle(run_dir):
    m = R.scenario_metrics(R.load_run(run_dir), "idle")
    assert m["minutes"] == pytest.approx(4 / 60)
    assert m["rc"] == 0
    assert m["mem_used_max_mib"] == pytest.approx(800)
    assert m["busy_vcpus_mean"] == pytest.approx(0.1)          # 첫 표본의 빈 칸은 빼고 평균
    assert m["steal_mean_pct"] == pytest.approx(2 / 3)
    assert m["steal_max_pct"] == pytest.approx(2.0)
    assert m["pss_sum_max_mib"] is None                         # 따라간 프로세스가 없다
    assert m["swap_growth_max_mib"] == pytest.approx(0)
    # BE 응답 2, 3, 4, 5000ms. 제한 시간에 걸린 것도 시간에 넣고 실패로 센다. p95 는 가까운 순위
    assert (m["be_p50_ms"], m["be_p95_ms"], m["be_failures"]) == (pytest.approx(3.5), 5000.0, 1)
    assert m["guard_stop"] is False


def test_scenario_metrics_for_a_transcription_window(run_dir):
    m = R.scenario_metrics(R.load_run(run_dir), "seq-long60")
    assert m["mem_used_max_mib"] == pytest.approx(3000)
    assert m["swap_growth_max_mib"] == pytest.approx(4)         # 구간 첫 표본(2MiB) 대비
    assert m["swap_over_start_max_mib"] == pytest.approx(5)     # 기록 시작(1MiB) 대비. 멈춤 장치의 기준
    assert m["pss_sum_max_mib"] == pytest.approx(1400)          # 읽지 못한 프로세스(None)는 0 으로 둔다
    assert m["busy_vcpus_mean"] == pytest.approx((0.4 + 1.2 + 1.4 + 1.3 + 0.5) / 5)
    assert m["steal_max_pct"] == pytest.approx(5.0)
    assert m["be_failures"] == 1                                # 500 도 실패다


def test_scenario_metrics_marks_the_guard_and_sums_pss_over_processes(run_dir):
    m = R.scenario_metrics(R.load_run(run_dir), "workers2")
    assert m["guard_stop"] is True and m["rc"] == 143
    assert m["pss_sum_max_mib"] == pytest.approx(2400)
    assert m["swap_growth_max_mib"] == pytest.approx(850)
    assert m["swap_over_start_max_mib"] == pytest.approx(899)


def test_scenario_metrics_without_samples_has_no_server_numbers(run_dir):
    m = R.scenario_metrics(R.load_run(run_dir), "env")
    assert m["samples"] == 0 and m["mem_used_max_mib"] is None and m["busy_vcpus_mean"] is None


def test_run_metrics_seq_has_both_rtfs_and_speech_ratio(run_dir):
    seq = R.run_metrics(R.load_run(run_dir))["seq-long60"]
    assert (seq["kind"], seq["data"], seq["load_s"], seq["first_decode_s"]) == ("seq", "long-60", 15.0, 25.0)
    r = seq["runs"]["long-60-1"]
    assert r["meeting_s"] == pytest.approx(120)                 # track_s 240 / 트랙 2
    assert r["rtf_meeting"] == pytest.approx(150 / 120)
    assert r["rtf_speech"] == pytest.approx(150 / 100)
    assert r["speech_ratio"] == pytest.approx(100 / 120)
    assert (r["wall_s"], r["cpu_s"], r["speech_s"], r["calls"], r["call_p95_s"], r["calls_over_20s"],
            r["failed"], r["wait_s"]) == (150.0, 170.0, 100.0, 4, 31.0, 3, 0, 0.0)


def test_run_metrics_golden_keeps_only_whitelisted_numbers(run_dir):
    g = R.run_metrics(R.load_run(run_dir))["golden-m01-turbo"]
    assert g["cer_pct"] == pytest.approx(5.33)
    assert (g["lost"], g["utterances"]) == (1, 7)
    assert (g["wall_s"], g["cpu_s"], g["speech_s"], g["peak_rss_gb"], g["beam"]) == (60.0, 70.0, 40.0, 2.19, 5)
    assert "cer_by_speaker" not in g and "hyp_by_speaker" not in g


def test_run_metrics_golden_has_meeting_length_rtf_and_call_numbers(run_dir):
    g = R.run_metrics(R.load_run(run_dir))["golden-m01-turbo"]
    # 회의 길이는 트랙 길이 합 ÷ 트랙 수(300 ÷ 6 = 50초). 걸린 60초 ÷ 50초 = 1.2, ÷ 말 40초 = 1.5
    assert g["meeting_s"] == pytest.approx(50.0)
    assert g["rtf_meeting"] == pytest.approx(1.2) and g["rtf_speech"] == pytest.approx(1.5)
    assert g["speech_ratio"] == pytest.approx(0.8)
    assert (g["calls"], g["call_p95_s"], g["calls_over_20s"], g["failed"], g["retries"], g["gated"]) == \
        (7, 32.36, 7, 0, 0, 0)
    assert g["insertion_pct"] == pytest.approx(1.54)
    assert (g["order_edits"], g["start_err_max_s"]) == (0, 0.0)


def test_run_metrics_seq_keeps_retries_gated_and_peak_rss(run_dir):
    r = R.run_metrics(R.load_run(run_dir))["seq-long60"]["runs"]
    row = next(iter(r.values()))
    assert (row["retries"], row["gated"]) == (0, 0)
    assert row["peak_rss_mib"] == pytest.approx(2048.0)


def test_run_metrics_threads_reports_end_times_from_the_common_start(run_dir):
    t = R.run_metrics(R.load_run(run_dir))["threads"]
    assert t["runs"]["threads-1-m01"]["end_s"] == pytest.approx(9.0)
    assert t["runs"]["threads-2-m02"]["end_s"] == pytest.approx(8.5)
    assert (t["wall_s"], t["cpu_s"]) == (9.0, 16.0)
    assert t["sequential_wall_s"] == pytest.approx(60.0 + 62.0)   # 같은 회의를 골든에서 하나씩 돌린 전사 시간 합


def test_run_metrics_botlag(run_dir):
    b = R.run_metrics(R.load_run(run_dir))["botlag-m01"]
    assert b["idle"] == {"n": 600, "p50_ms": 0.2, "p95_ms": 0.3, "max_ms": 3.0}
    assert b["busy"]["max_ms"] == 52.5
    assert b["runs"]["botlag-m01-run"]["rtf_meeting"] == pytest.approx(8.0 / 120)


def _value(cap, key):
    return cap[key]["value"]


def test_capacity_time_numbers(run_dir):
    cap = R.capacity(R.load_run(run_dir))
    assert all(set(v) == {"value", "formula"} for v in cap.values())
    assert _value(cap, "long_meeting_min") == pytest.approx(2.0)
    assert _value(cap, "long_transcribe_min") == pytest.approx(2.5)
    assert _value(cap, "rtf_meeting") == pytest.approx(1.25)
    assert _value(cap, "transcribe_min_per_meeting_hour") == pytest.approx(75.0)
    assert _value(cap, "meeting_hours_per_day_one_worker") == pytest.approx(24 / 1.25)
    # 워커 1개가 모델을 한 번 올리고 회의 N개를 차례로
    assert _value(cap, "queue_last_result_min_n1") == pytest.approx(75.0 + 0.25)
    assert _value(cap, "queue_last_result_min_n5") == pytest.approx(5 * 75.0 + 0.25)


def test_capacity_credit_numbers(run_dir):
    cap = R.capacity(R.load_run(run_dir))
    # 전사 중 바쁜 vCPU 는 긴 회의의 실제 전사 구간(106~122) 표본 1.2, 1.4, 1.3 의 평균 1.3. 상시는 idle 의 0.1
    assert _value(cap, "busy_vcpus_transcribing") == pytest.approx(1.3)
    assert _value(cap, "credits_per_hour_transcribing") == pytest.approx(78.0)
    assert _value(cap, "credits_per_day_idle") == pytest.approx(0.1 * 60 * 24)
    # 하루 적립 576 = 상시 소모 144 + 전사가 상시보다 더 쓰는 72/시간 × T  →  T = 6
    assert _value(cap, "transcribe_hours_per_day_no_charge") == pytest.approx(6.0)
    assert _value(cap, "meeting_hours_per_day_no_charge") == pytest.approx(6.0 / 1.25)
    assert _value(cap, "burst_hours_from_full_balance") == pytest.approx(576 / (78 - 24))
    assert _value(cap, "usd_per_extra_transcribe_hour") == pytest.approx(0.05 * 1.2)


def test_capacity_memory_fit_uses_one_production_model_process(run_dir):
    cap = R.capacity(R.load_run(run_dir))
    assert _value(cap, "idle_mem_used_max_mib") == pytest.approx(800)
    # 운영 모델 시나리오의 PSS 최대 1500(golden-m01). 워커 둘(2400)은 하나짜리가 아니라 뺀다
    assert _value(cap, "one_transcription_pss_max_mib") == pytest.approx(1500)
    assert _value(cap, "workers_fit_in_memory") == math.floor((4000 - 800) / 1500)


def test_credits_net_integrates_busy_over_time_minus_earnings():
    # 60초씩 두 칸을 vCPU 1개로 → 2 크레딧. 2분 동안 적립 24 × 2/60 = 0.8
    samples = [{"ts": 0, "busy_vcpus": None}, {"ts": 60, "busy_vcpus": 1.0}, {"ts": 120, "busy_vcpus": 1.0}]
    assert R.credits_net(samples) == pytest.approx(2 - 0.8)


def test_write_report_files_writes_numbers_only_and_korean_tables(run_dir, tmp_path):
    out = tmp_path / "out"
    R.write_report_files(run_dir, out)
    summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    text = (out / "summary.json").read_text(encoding="utf-8")

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                assert k.isascii()
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        else:
            assert x is None or isinstance(x, (int, float, bool)), x
            if isinstance(x, float):
                assert round(x, 2) == x

    walk(summary)
    assert summary["capacity"]["transcribe_hours_per_day_no_charge"] == 6.0
    assert summary["scenarios"]["workers2"]["guard_stop"] is True
    assert summary["runs"]["seq-long60"]["runs"]["long-60-1"]["rtf_meeting"] == 1.25

    md = (out / "tables.md").read_text(encoding="utf-8")
    for heading in ("시나리오", "회의별", "용량 계산"):
        assert heading in md
    assert "바쁜 vCPU" in md and "(576 − " in md
    for leak in (SECRET_TEXT, SECRET_NAME):
        assert leak not in md and leak not in text


def test_main_writes_both_files(run_dir, tmp_path):
    out = tmp_path / "out2"
    assert R.main(["--run-dir", str(run_dir), "--out-dir", str(out)]) == 0
    assert (out / "summary.json").exists() and (out / "tables.md").exists()
