"""용량 측정 시나리오 실행(stt/eval/capacity/runner.py). 가짜 백엔드와 합성 톤만 쓴다. 실제 모델은 올리지 않는다."""

import asyncio
import json
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from stt import batch as B
from stt import elice, speech_gate
from stt.backend import SttError, SttResult, Word
from stt.eval.capacity import runner as R

SR = 16_000
NO_GATE = lambda: None  # noqa: E731  말 필터 모델(silero)을 올리지 않는다


def _tone(sec):
    t = np.arange(int(SR * sec)) / SR
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def _silence(sec):
    return np.zeros(int(SR * sec), dtype=np.float32)


def _meeting(d: Path) -> Path:
    """화자 둘, 발화 하나씩. chunk 모드에서 호출 2번이다."""
    d.mkdir(parents=True)
    sf.write(str(d / "a.wav"), np.concatenate([_silence(1), _tone(1.5), _silence(3)]), SR, subtype="PCM_16")
    sf.write(str(d / "b.wav"), np.concatenate([_silence(3), _tone(1.0), _silence(1.5)]), SR, subtype="PCM_16")
    return d


class SlowStt:
    """호출마다 delay_s 를 쉰다. 실행이 겹쳤는지, 줄 선 만큼 늦게 시작했는지를 시각으로 본다."""
    name = "fake/slow"

    def __init__(self, delay_s=0.0):
        self.delay_s = delay_s
        self.calls = 0
        self.last = None

    def transcribe(self, samples, sample_rate):
        self.calls += 1
        self.last = samples
        time.sleep(self.delay_s)
        return SttResult(text="네", words=[Word("네", 0.1, 0.3)])


def test_measure_run_writes_times_cpu_calls_and_lifetime_peak(tmp_path):
    out = tmp_path / "out"
    r = R.measure_run("one", B.discover(_meeting(tmp_path / "m")), SlowStt(), out_dir=out, gate_factory=NO_GATE)
    assert {"label", "started_at", "ended_at", "wall_s", "cpu_s", "lines", "stats", "calls",
            "peak_rss_lifetime_bytes"} <= set(r)
    assert r["ended_at"] >= r["started_at"] and r["wall_s"] >= 0 and r["cpu_s"] >= 0
    assert r["stats"]["calls"] == len(r["calls"]) == 2 and r["lines"] == 2
    assert all(set(c) == {"transcribe_s", "len_s"} and c["len_s"] > 0 for c in r["calls"])
    assert r["peak_rss_lifetime_bytes"] > 0
    assert json.loads((out / "one.json").read_text(encoding="utf-8")) == r


def test_seq_wait_grows_with_queue_position(tmp_path):
    out = tmp_path / "out"
    r = R.run_seq(_meeting(tmp_path / "m"), "two", repeat=3, backend=SlowStt(0.05), out_dir=out, gate_factory=NO_GATE)
    assert [x["label"] for x in r["runs"]] == ["two-1", "two-2", "two-3"]
    waits = [x["wait_s"] for x in r["runs"]]
    assert waits[0] == 0 and waits[0] < waits[1] < waits[2]
    # 줄 선 시간은 앞 실행들이 걸린 시간 이상이다
    assert waits[2] >= r["runs"][0]["wall_s"] + r["runs"][1]["wall_s"] - 0.01
    assert all((out / f"two-{i}.json").exists() for i in (1, 2, 3))


def test_threads_run_two_meetings_at_once_on_one_backend(tmp_path):
    backend = SlowStt(0.2)
    r = R.run_threads([_meeting(tmp_path / "m1"), _meeting(tmp_path / "m2")], backend=backend,
                      out_dir=tmp_path / "out", gate_factory=NO_GATE)
    a, b = r["runs"]
    assert a["label"] != b["label"] and backend.calls == 4
    assert a["started_at"] < b["ended_at"] and b["started_at"] < a["ended_at"]   # 두 회의가 겹쳤다
    assert r["wall_s"] < a["wall_s"] + b["wall_s"] and r["cpu_s"] >= 0


def test_botlag_reports_idle_and_busy_loop_lag(tmp_path):
    out = tmp_path / "out"
    r = asyncio.run(R.run_botlag(_meeting(tmp_path / "m"), backend=SlowStt(0.1), out_dir=out,
                                 tick_ms=10, baseline_s=0.3, gate_factory=NO_GATE))
    for phase in ("idle", "busy"):
        assert set(r[phase]) == {"n", "p50_ms", "p95_ms", "max_ms"}
        assert r[phase]["p50_ms"] <= r[phase]["p95_ms"] <= r[phase]["max_ms"]
    assert 15 <= r["idle"]["n"] <= 30          # 0.3초를 10ms 로 나눈 만큼 안팎
    assert r["busy"]["n"] >= 5                 # 전사 0.2초 넘는 동안
    assert r["run"]["stats"]["calls"] == 2 and r["tick_ms"] == 10 and r["baseline_s"] == 0.3


class LoadingStt(SlowStt):
    """로컬 백엔드처럼 _load() 로 모델을 올린다. 올리는 시간과 첫 디코딩 시간을 따로 잰다."""

    def __init__(self, load_s, delay_s):
        super().__init__(delay_s)
        self.load_s, self.loaded = load_s, False

    def _load(self):
        time.sleep(self.load_s)
        self.loaded = True


def test_warm_backend_times_the_model_load_apart_from_the_first_decode():
    made = []

    def factory(kind, model, mode, *, beam):
        made.append((kind, model, mode, beam))
        return LoadingStt(0.05, 0.03)

    backend, timing = R.warm_backend("local", "tiny", beam=1, factory=factory)
    assert made == [("local", "tiny", "chunk", 1)] and backend.loaded and backend.calls == 1
    assert len(backend.last) == SR and not backend.last.any()
    assert 0.05 <= timing["load_s"] < 0.05 + 0.03    # 첫 디코딩(1초 무음)은 로드에 넣지 않는다
    assert timing["first_decode_s"] >= 0.03


def test_measure_run_refuses_a_folder_without_tracks(tmp_path):
    # 데이터 폴더 이름이 틀리면 discover 가 빈 목록을 준다. 0초짜리 결과를 성공으로 남기지 않는다
    import pytest
    with pytest.raises(ValueError, match="트랙"):
        R.measure_run("x", [], SlowStt(), out_dir=tmp_path, gate_factory=NO_GATE)


def test_env_info_keeps_only_the_listed_settings_and_no_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("MM_STT_MODEL", "small")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "tok-must-not-leak")
    monkeypatch.setenv("ELICE_API_KEY", "key-must-not-leak")
    e = R.env_info(tmp_path)                   # git 저장소가 아니다
    dumped = json.dumps(e, ensure_ascii=False)
    for s in ("DISCORD_BOT_TOKEN", "tok-must-not-leak", "ELICE_API_KEY", "key-must-not-leak"):
        assert s not in dumped
    assert set(e["env"]) == set(R.ENV_KEYS) and e["env"]["MM_STT_MODEL"] == "small"
    assert e["git_commit"] is None and e["cpu_threads"] == "기본값"
    assert e["cpu_count"] == os.cpu_count() and isinstance(e["nice"], int)
    repo = tmp_path / "repo"                   # 레포 사본에서도 돌게 커밋 하나짜리 저장소를 만든다
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false",
                    "commit", "-q", "--allow-empty", "-m", "x"], check=True)
    assert re.fullmatch(r"[0-9a-f]{40}", R.env_info(repo)["git_commit"])


def test_golden_calls_score_on_the_production_path_and_keeps_its_numbers(monkeypatch, tmp_path):
    seen = {}

    def fake_score(session, mode, kind, model, gate_on, workers, yes, **kw):
        seen.update(args=(session, mode, kind, model, gate_on, workers, yes), **kw)
        return {"cer": 0.05, "wall_s": 1.0, "cpu_s": 2.0}

    monkeypatch.setattr(R.golden, "score", fake_score)
    backend, out = SlowStt(), tmp_path / "out"
    r = R.run_golden(tmp_path / "m01", model="small", tag="m01", backend=backend, out_dir=out, beam=1)
    assert seen["args"] == (tmp_path / "m01", "chunk", "local", "small", True, 1, True)
    assert seen["backend"] is backend and seen["out_dir"] == out and seen["tag"] == "m01"
    assert seen["beam"] == 1 and r["beam"] == 1          # 결과 JSON 의 beam 이 실제 백엔드와 맞는다
    assert r["score"] == {"cer": 0.05, "wall_s": 1.0, "cpu_s": 2.0}
    assert r["wall_s"] >= 0 and r["cpu_s"] >= 0


def test_cli_appends_its_pid_and_saves_load_time_and_env(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "warm_backend",
                        lambda kind, model, beam, **kw: (SlowStt(), {"load_s": 1.234, "first_decode_s": 0.5,
                                                                  "warm_failed_s": []}))
    monkeypatch.setattr(speech_gate, "ENABLED", False)   # 기본 말 필터가 모델을 올리지 않게
    pids, out = tmp_path / "pids", tmp_path / "out"
    pids.write_text("1\n", encoding="utf-8")
    assert R.main(["seq", "--tracks-dir", str(_meeting(tmp_path / "m")), "--label", "two",
                   "--out-dir", str(out), "--pids-file", str(pids)]) == 0
    assert pids.read_text(encoding="utf-8") == f"1\n{os.getpid()}\n"
    saved = json.loads((out / "seq-two.json").read_text(encoding="utf-8"))
    assert saved["load_s"] == 1.23 and saved["first_decode_s"] == 0.5 and saved["beam"] == 5
    assert saved["model"] == R.DEFAULT_MODEL and "nice" in saved["env"]
    assert [x["wait_s"] for x in saved["runs"]] == [0.0]


def test_night_script_parses():
    p = subprocess.run(["bash", "-n", str(Path(R.__file__).with_name("night.sh"))], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr


def _night():
    return (Path(R.__file__).parent / "night.sh").read_text(encoding="utf-8")


def test_night_runs_the_two_worker_scenario_last():
    # 워커 2개가 메모리를 가장 많이 쓴다. 멈춤 장치에 꺼지거나 스왑을 남겨도 60분 실측을 잃지 않게 맨 뒤에 둔다
    order = re.findall(r"^scenario ([\w$-]+)", _night(), flags=re.M)
    assert order[-1] == "workers2" and order.index("seq-long60") < order.index("workers2")


def test_night_runs_the_small_model_with_beam_one_and_checks_the_data_first():
    text = _night()
    assert "--model small --beam 1" in text                  # 계획의 S4 는 small int8 beam 1
    assert "HF_HUB_OFFLINE=1" in text                         # 로드 시간에 Hub 확인이 섞이지 않게
    assert "stt.eval.capacity.synth" in text                  # 60분 합성 회의가 없으면 만든다
    assert "/proc/self/cgroup" in text                        # 측정 단위 자신의 cgroup 도 기록한다


def test_golden_saves_the_turn_lines_for_the_extraction_comparison(monkeypatch, tmp_path):
    from stt.lines import Line

    def fake_score(session, mode, kind, model, gate_on, workers, yes, *, lines_out=None, **kw):
        lines_out.append(Line(speaker_id="김동우", speaker_name="김동우", turn_id="", seq=1, start_ms=1000,
                              end_ms=2500, text="제가 할게요", final=True))
        return {"cer": 0.05}

    monkeypatch.setattr(R.golden, "score", fake_score)
    out = tmp_path / "out"
    r = R.run_golden(tmp_path / "m01", model="small", tag="m01", backend=SlowStt(), out_dir=out, save_lines=True)
    saved = json.loads((out / "lines-m01-small.json").read_text(encoding="utf-8"))
    assert saved == {"session": "m01", "model": "small", "segments": [
        {"speaker": "김동우", "start": 1.0, "end": 2.5, "text": "제가 할게요", "seq": 1, "timing": "word"}]}
    assert r["lines_file"].endswith("lines-m01-small.json")


def test_seq_saves_each_run_lines_in_the_golden_shape(tmp_path):
    out = tmp_path / "out"
    r = R.run_seq(_meeting(tmp_path / "m"), "real", repeat=2, backend=SlowStt(), out_dir=out, gate_factory=NO_GATE,
                  save_lines=True, model="small")
    for i, run in enumerate(r["runs"], 1):
        saved = json.loads((out / f"lines-real-{i}.json").read_text(encoding="utf-8"))
        assert saved["session"] == "real" and saved["model"] == "small"
        segs = saved["segments"]
        assert all(set(s) == {"speaker", "start", "end", "text", "seq", "timing"} and s["start"] < s["end"] for s in segs)
        assert [(s["speaker"], s["text"], s["seq"]) for s in segs] == [("a", "네", 1), ("b", "네", 2)]
        assert run["lines_file"].endswith(f"lines-real-{i}.json")
    R.run_seq(_meeting(tmp_path / "m2"), "quiet", repeat=1, backend=SlowStt(), out_dir=out, gate_factory=NO_GATE)
    assert not list(out.glob("lines-quiet*"))           # 끄면 전사 문장을 남기지 않는다


def test_saved_lines_mark_the_lines_that_cover_a_whole_chunk(tmp_path):
    # 단어 시각이 없으면(Elice) 묶음 전체가 한 줄이다. 뒤 도구(real929·judge_diff)가 그 줄을 가려낼 수 있어야 한다
    class NoWordsStt(SlowStt):
        def transcribe(self, samples, sample_rate):
            super().transcribe(samples, sample_rate)
            return SttResult(text="네", words=[])

    out = tmp_path / "out"
    R.run_seq(_meeting(tmp_path / "m"), "e", repeat=1, backend=NoWordsStt(), out_dir=out, gate_factory=NO_GATE,
              save_lines=True)
    segs = json.loads((out / "lines-e-1.json").read_text(encoding="utf-8"))["segments"]
    assert [s["timing"] for s in segs] == ["chunk", "chunk"]


def test_cli_seq_save_lines_names_the_model_it_ran(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "warm_backend",
                        lambda kind, model, beam, **kw: (SlowStt(), {"load_s": 1.0, "first_decode_s": 0.5,
                                                                  "warm_failed_s": []}))
    monkeypatch.setattr(speech_gate, "ENABLED", False)
    out = tmp_path / "out"
    assert R.main(["seq", "--tracks-dir", str(_meeting(tmp_path / "m")), "--label", "real929-small", "--model", "small",
                   "--beam", "1", "--save-lines", "--out-dir", str(out)]) == 0
    saved = json.loads((out / "lines-real929-small-1.json").read_text(encoding="utf-8"))
    assert saved["session"] == "real929-small" and saved["model"] == "small" and len(saved["segments"]) == 2


def test_prep_measures_the_preparation_without_loading_a_model(monkeypatch, tmp_path):
    def no_warm(*a, **kw):
        raise AssertionError("prep 은 모델을 올리지 않는다")

    monkeypatch.setattr(R, "warm_backend", no_warm)
    monkeypatch.setattr(speech_gate, "ENABLED", False)
    out = tmp_path / "out"
    assert R.main(["prep", "--tracks-dir", str(_meeting(tmp_path / "m")), "--label", "long-60",
                   "--out-dir", str(out)]) == 0
    saved = json.loads((out / "prep-long-60.json").read_text(encoding="utf-8"))
    assert saved["scenario"] == "prep" and saved["label"] == "long-60"
    # 보고서(report.py)가 모든 결과에서 읽는 칸이다. 모델을 안 올렸으니 비운다
    assert (saved["model"], saved["beam"], saved["load_s"], saved["first_decode_s"]) == (None, None, None, None)
    run = saved["run"]
    assert {"started_at", "wall_s", "cpu_s", "peak_rss_lifetime_bytes"} <= set(run) and run["wall_s"] >= 0
    assert run["stats"]["clips"] == 2 and run["stats"]["calls"] == 2      # 자르기와 묶음까지는 다 돌았다
    assert run["stats"]["transcribe_max_s"] < 0.05                         # 전사는 바로 돌아왔다
    assert (out / "prep-long-60-run.json").exists()


def _night2():
    return (Path(R.__file__).parent / "night2.sh").read_text(encoding="utf-8")


def test_night2_script_parses():
    p = subprocess.run(["bash", "-n", str(Path(R.__file__).with_name("night2.sh"))], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr


def test_night2_runs_prep_long_meetings_then_the_real_recording():
    text = re.sub(r"\\\n\s*", " ", _night2())                            # 줄 이음(\)은 한 줄로 본다
    order = re.findall(r"^scenario ([\w$-]+)", text, flags=re.M)
    assert order == ["env", "prep-long60", "synth-long10", "synth-long30", "seq-long10", "seq-long30",
                     "seq-real929-turbo", "seq-real929-small"]
    assert re.search(r"^sleep 60$", text, flags=re.M)                    # 일 없는 구간 60초
    saving = [ln for ln in text.splitlines() if "--save-lines" in ln]
    assert len(saving) == 2 and all("real929" in ln for ln in saving)   # 전사 문장은 실녹음에서만 남긴다
    small = next(ln for ln in text.splitlines() if ln.startswith("scenario seq-real929-small"))
    assert "--model small --beam 1" in small and "--label real929-small" in small
    assert "--repeat 3" in next(ln for ln in text.splitlines() if ln.startswith("scenario seq-long10"))
    assert "capacity.judge_diff" not in text                             # 유료 비교는 따로 승인받아 돈다
    for s in ("HF_HUB_OFFLINE=1", "/proc/self/cgroup", "stt.eval.capacity.sampler", "stt.eval.capacity.probe"):
        assert s in text


# ─────────────────────────────────────────────────────────────── Elice 로 돌리기
class CountingStt(SlowStt):
    """동시에 몇 호출이 들어와 있었는지 센다."""

    def __init__(self, delay_s=0.0):
        super().__init__(delay_s)
        self.now = self.peak = 0
        self.lock = threading.Lock()

    def transcribe(self, samples, sample_rate):
        with self.lock:
            self.calls += 1
            self.now += 1
            self.peak = max(self.peak, self.now)
        try:
            time.sleep(self.delay_s)
            return SttResult(text="네", words=[Word("네", 0.1, 0.3)])
        finally:
            with self.lock:
                self.now -= 1


class FailingStt(SlowStt):
    def transcribe(self, samples, sample_rate):
        self.calls += 1
        raise SttError("STT 요청 실패: ReadTimeout")


def _ledger(path):
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines()]


def _fake_elice(monkeypatch):
    """B.make_backend 를 가짜로 바꾼다. 키도 지워 실수로 실제 Elice 를 부르지 못하게 한다."""
    monkeypatch.delenv("ELICE_API_KEY", raising=False)
    monkeypatch.setattr(speech_gate, "ENABLED", False)
    made = []

    def factory(kind, model, mode="chunk", *, beam=5, **kw):
        made.append((kind, SlowStt()))
        return made[-1][1]

    monkeypatch.setattr(B, "make_backend", factory)
    return made


def test_metered_backend_books_the_cost_before_the_call_and_keeps_it_when_the_call_fails(tmp_path):
    spend, seen = tmp_path / "spend.jsonl", []
    assert R.spent_krw(spend) == 0.0                       # 장부가 없으면 쓴 돈도 없다

    class PeekStt(SlowStt):
        def transcribe(self, samples, sample_rate):
            seen.append(len(_ledger(spend)))               # 부르는 순간 장부에 이미 적혀 있다
            return super().transcribe(samples, sample_rate)

    m = R.MeteredBackend(PeekStt(), spend, 10, label="seq-two")
    assert m.name == "fake/slow" and m.transcribe(_tone(3), SR).text == "네"
    assert seen == [1]
    (row,) = _ledger(spend)
    assert set(row) == {"ts", "label", "audio_s", "billed_s", "krw"} and row["label"] == "seq-two"
    assert row["audio_s"] == 3.0 and row["krw"] == pytest.approx(3 * elice.WHISPER_KRW_PER_SEC)
    with pytest.raises(SttError):                         # 시간이 넘친 호출도 과금됐을 수 있다
        R.MeteredBackend(FailingStt(), spend, 10, label="seq-two").transcribe(_tone(2), SR)
    assert len(_ledger(spend)) == 2
    assert R.spent_krw(spend) == pytest.approx(5 * elice.WHISPER_KRW_PER_SEC)


def test_metered_backend_refuses_a_call_past_the_cap_without_booking_or_calling(tmp_path):
    spend, inner = tmp_path / "spend.jsonl", SlowStt()
    m = R.MeteredBackend(inner, spend, 1.0, label="x")
    m.transcribe(_silence(10), SR)                        # 상한에 딱 닿는 호출은 보낸다
    with pytest.raises(SttError, match="비용 상한"):
        m.transcribe(_silence(0.5), SR)
    assert inner.calls == 1 and len(_ledger(spend)) == 1 and R.spent_krw(spend) == pytest.approx(1.0)


def test_metered_backend_counts_its_refusals_apart_from_other_failures(tmp_path):
    # 거절은 장부에 남지 않는다. 결과의 stats.failed 로는 시간 초과·429 와 상한 거절이 갈리지 않는다
    spend = tmp_path / "spend.jsonl"
    m = R.MeteredBackend(SlowStt(), spend, 1.0, label="x")
    m.transcribe(_silence(10), SR)
    for _ in range(2):
        with pytest.raises(R.CapReached):
            m.transcribe(_silence(1), SR)
    assert issubclass(R.CapReached, SttError) and m.refused == 2
    with pytest.raises(SttError):
        R.MeteredBackend(FailingStt(), tmp_path / "other.jsonl", 10, label="x").transcribe(_tone(1), SR)
    assert R.MeteredBackend(SlowStt(), spend, 10, label="x").refused == 0


def test_cli_elice_writes_how_many_calls_the_cap_refused(monkeypatch, tmp_path):
    made = _fake_elice(monkeypatch)
    monkeypatch.setattr(B, "RETRY_WAIT_S", 0.0)
    spend, out = tmp_path / "spend.jsonl", tmp_path / "out"
    spend.write_text(json.dumps({"ts": 0, "label": "앞 시나리오", "audio_s": 98.5, "krw": 9.85}) + "\n",
                     encoding="utf-8")
    assert R.main(["seq", "--tracks-dir", str(_meeting(tmp_path / "m")), "--label", "two", "--backend", "elice",
                   "--spend-file", str(spend), "--cap-krw", "10", "--out-dir", str(out)]) == 0
    saved = json.loads((out / "seq-two.json").read_text(encoding="utf-8"))
    assert made[0][1].calls == 1                          # 예열(0.1원)만 나가고 묶음 둘은 상한에 걸렸다
    assert saved["refused"] == 2 * (B.RETRIES + 1)        # batch 가 거절도 재시도한다
    assert saved["runs"][0]["stats"]["failed"] == 2
    R.main(["seq", "--tracks-dir", str(tmp_path / "m"), "--label", "loc", "--out-dir", str(out)])
    assert json.loads((out / "seq-loc.json").read_text(encoding="utf-8"))["refused"] is None   # 로컬은 장부가 없다


class FlakyStt(SlowStt):
    """처음 fails 번은 fail_s 를 쉬고 실패한다. 서버리스가 식어 첫 호출이 잘리는 경우다."""

    def __init__(self, fails, fail_s=0.0, delay_s=0.0):
        super().__init__(delay_s)
        self.fails, self.fail_s = fails, fail_s

    def transcribe(self, samples, sample_rate):
        if self.calls < self.fails:
            self.calls += 1
            time.sleep(self.fail_s)
            raise SttError("STT 요청 실패: ReadTimeout")
        return super().transcribe(samples, sample_rate)


def test_warm_backend_retries_like_the_batch_and_keeps_the_failed_round_trips(monkeypatch):
    monkeypatch.setattr(B, "RETRY_WAIT_S", 0.0)
    backend, timing = R.warm_backend("elice", "x", factory=lambda *a, **kw: FlakyStt(2, fail_s=0.05))
    assert backend.calls == 3 and len(timing["warm_failed_s"]) == 2
    assert all(t >= 0.05 for t in timing["warm_failed_s"])   # 식은 서버의 왕복 시간을 잃지 않는다
    assert timing["first_decode_s"] < 0.05                     # 첫 디코딩은 성공한 호출의 시간이다
    _, timing = R.warm_backend("elice", "x", factory=lambda *a, **kw: SlowStt())
    assert timing["warm_failed_s"] == []
    with pytest.raises(SttError):
        R.warm_backend("elice", "x", factory=lambda *a, **kw: FlakyStt(B.RETRIES + 1))


def test_warm_backend_does_not_retry_a_cap_refusal(monkeypatch, tmp_path):
    spend = tmp_path / "spend.jsonl"
    spend.write_text(json.dumps({"ts": 0, "label": "x", "audio_s": 100.0, "krw": 10.0}) + "\n", encoding="utf-8")
    made = []

    def factory(*a, **kw):
        made.append(R.MeteredBackend(SlowStt(), spend, 10, label="x"))
        return made[-1]

    with pytest.raises(R.CapReached):
        R.warm_backend("elice", "x", factory=factory)
    assert made[0].refused == 1 and made[0].inner.calls == 0


def test_metered_backend_threads_booking_at_once_never_pass_the_cap(tmp_path):
    # elice 워커 6개와 multi 의 회의 여럿이 한 장부를 같이 쓴다. 읽고 더하고 쓰기가 끼어들면 상한을 넘는다
    spend, n = tmp_path / "spend.jsonl", 24
    m = R.MeteredBackend(SlowStt(), spend, 10, label="multi")
    start = threading.Barrier(n)

    def one(_):
        start.wait()
        try:
            m.transcribe(_silence(10), SR)               # 1원
            return True
        except SttError:
            return False

    with ThreadPoolExecutor(n) as ex:
        ok = list(ex.map(one, range(n)))
    assert sum(ok) == 10 and len(_ledger(spend)) == 10 and R.spent_krw(spend) == pytest.approx(10)


def test_measure_run_sends_calls_with_the_given_workers(tmp_path):
    m, out = _meeting(tmp_path / "m"), tmp_path / "out"
    one, two = CountingStt(0.3), CountingStt(0.3)
    R.measure_run("w1", B.discover(m), one, out_dir=out, gate_factory=NO_GATE)
    R.measure_run("w2", B.discover(m), two, out_dir=out, gate_factory=NO_GATE, workers=2)
    assert one.peak == 1 and two.peak == 2


def test_warm_backend_for_elice_has_no_model_to_load_and_times_one_call():
    made = []

    def factory(kind, model, mode, *, beam):
        made.append(kind)
        return SlowStt(0.03)

    backend, timing = R.warm_backend("elice", "large-v3-turbo", factory=factory)
    assert made == ["elice"] and backend.calls == 1
    assert timing["load_s"] == 0.0 and timing["first_decode_s"] >= 0.03


@pytest.mark.parametrize("cmd,extra,name", [
    ("seq", ["--label", "two"], "seq-two"),
    ("threads", [], "threads"),
    ("botlag", ["--tick-ms", "10", "--baseline-s", "0.05"], "botlag-m"),
    ("multi", ["--n", "2"], "multi-2"),
])
def test_cli_every_transcription_scenario_takes_the_backend_and_workers(monkeypatch, tmp_path, cmd, extra, name):
    made = _fake_elice(monkeypatch)
    real_run, workers = B.run, []
    monkeypatch.setattr(B, "run", lambda *a, **kw: workers.append(kw["workers"]) or real_run(*a, **kw))
    out = tmp_path / "out"
    assert R.main([cmd, "--tracks-dir", str(_meeting(tmp_path / "m")), *extra, "--backend", "elice",
                   "--workers", "2", "--spend-file", str(tmp_path / "spend.jsonl"), "--cap-krw", "10",
                   "--out-dir", str(out)]) == 0
    saved = json.loads((out / f"{name}.json").read_text(encoding="utf-8"))
    assert (saved["backend"], saved["workers"], saved["model"], saved["beam"], saved["load_s"]) == \
        ("elice", 2, "elice/whisper-large-v3", None, 0.0)
    assert saved["first_decode_s"] >= 0 and [k for k, _ in made] == ["elice"]
    assert workers and set(workers) == {2}                 # 회의마다 B.run 에 워커 수가 닿았다


def test_cli_elice_defaults_to_six_workers_and_books_every_call_on_the_ledger(monkeypatch, tmp_path):
    made = _fake_elice(monkeypatch)
    out, spend = tmp_path / "out", tmp_path / "spend.jsonl"
    assert R.main(["seq", "--tracks-dir", str(_meeting(tmp_path / "m")), "--label", "two", "--backend", "elice",
                   "--spend-file", str(spend), "--cap-krw", "10", "--out-dir", str(out)]) == 0
    saved = json.loads((out / "seq-two.json").read_text(encoding="utf-8"))
    assert saved["workers"] == B.default_workers("elice") == 6
    ((_, inner),) = made
    rows = _ledger(spend)
    assert inner.calls == len(rows) == 3                  # 1초 무음 예열 한 번과 묶음 둘
    assert rows[0]["audio_s"] == 1.0 and {r["label"] for r in rows} == {"seq-two"}


def test_cli_elice_stops_at_the_warm_up_when_the_ledger_is_already_at_the_cap(monkeypatch, tmp_path):
    made = _fake_elice(monkeypatch)
    spend = tmp_path / "spend.jsonl"
    spend.write_text(json.dumps({"ts": 0, "label": "앞 시나리오", "audio_s": 100.0, "krw": 10.0}) + "\n",
                     encoding="utf-8")
    with pytest.raises(SttError, match="비용 상한"):
        R.main(["seq", "--tracks-dir", str(_meeting(tmp_path / "m")), "--label", "two", "--backend", "elice",
                "--spend-file", str(spend), "--cap-krw", "10", "--out-dir", str(tmp_path / "out")])
    assert made[0][1].calls == 0 and not (tmp_path / "out" / "seq-two.json").exists()


def test_cli_local_is_not_metered_and_a_ledger_needs_a_cap(monkeypatch, tmp_path):
    _fake_elice(monkeypatch)
    out, spend, m = tmp_path / "out", tmp_path / "spend.jsonl", _meeting(tmp_path / "m")
    assert R.main(["seq", "--tracks-dir", str(m), "--label", "two", "--spend-file", str(spend), "--cap-krw", "10",
                   "--out-dir", str(out)]) == 0
    saved = json.loads((out / "seq-two.json").read_text(encoding="utf-8"))
    assert (saved["backend"], saved["workers"], saved["model"], saved["beam"]) == ("local", 1, R.DEFAULT_MODEL, 5)
    assert not spend.exists()
    with pytest.raises(SystemExit):                       # 상한 없는 장부는 받지 않는다
        R.main(["seq", "--tracks-dir", str(m), "--label", "two", "--backend", "elice", "--spend-file", str(spend),
                "--out-dir", str(out)])


@pytest.mark.parametrize("cmd,extra", [
    ("seq", ["--tracks-dir", "M", "--label", "two"]),
    ("golden", ["--session", "M"]),
    ("threads", ["--tracks-dir", "M"]),
    ("botlag", ["--tracks-dir", "M"]),
    ("multi", ["--tracks-dir", "M", "--n", "2"]),
])
def test_cli_elice_without_a_ledger_stops_before_any_call(monkeypatch, tmp_path, cmd, extra):
    made = _fake_elice(monkeypatch)
    m = str(_meeting(tmp_path / "m"))
    with pytest.raises(SystemExit):                       # 장부 없이 부르면 상한이 아예 걸리지 않는다
        R.main([cmd, *[m if x == "M" else x for x in extra], "--backend", "elice", "--out-dir", str(tmp_path / "out")])
    assert made == [] and not (tmp_path / "out").exists()


def test_cli_golden_on_elice_passes_the_kind_and_workers_and_keeps_slashes_out_of_file_names(monkeypatch, tmp_path):
    from stt.lines import Line
    _fake_elice(monkeypatch)
    seen = {}

    def fake_score(session, mode, kind, model, gate_on, workers, yes, *, lines_out=None, **kw):
        seen.update(args=(kind, model, workers, yes), backend=kw["backend"])
        lines_out.append(Line(speaker_id="a", speaker_name="a", turn_id="", seq=1, start_ms=0, end_ms=1000,
                              text="네", final=True))
        return {"cer": 0.05}

    monkeypatch.setattr(R.golden, "score", fake_score)
    out = tmp_path / "out"
    assert R.main(["golden", "--session", str(tmp_path / "m01"), "--tag", "m01", "--save-lines", "--backend", "elice",
                   "--spend-file", str(tmp_path / "spend.jsonl"), "--cap-krw", "10", "--out-dir", str(out)]) == 0
    assert seen["args"] == ("elice", "elice/whisper-large-v3", 6, True)
    assert isinstance(seen["backend"], R.MeteredBackend)
    assert sorted(p.name for p in out.iterdir()) == ["golden-m01-elice-m01.json", "lines-m01-elice.json"]
    saved = json.loads((out / "golden-m01-elice-m01.json").read_text(encoding="utf-8"))
    assert (saved["model"], saved["beam"], saved["workers"]) == ("elice/whisper-large-v3", None, 6)
    assert json.loads((out / "lines-m01-elice.json").read_text(encoding="utf-8"))["model"] == "elice/whisper-large-v3"


def test_multi_runs_n_copies_of_one_meeting_at_once_on_one_backend(tmp_path):
    backend = CountingStt(0.3)
    r = R.run_multi(_meeting(tmp_path / "m"), 3, label="3", backend=backend, out_dir=tmp_path / "out",
                    gate_factory=NO_GATE, workers=2)
    assert (r["scenario"], r["n"], len(r["runs"]), backend.calls) == ("multi", 3, 3, 6)
    assert [x["label"] for x in r["runs"]] == ["multi-3-1", "multi-3-2", "multi-3-3"]
    assert backend.peak == 6                               # 회의 셋이 저마다 워커 2개로 동시에 불렀다
    assert max(x["started_at"] for x in r["runs"]) < min(x["ended_at"] for x in r["runs"])
    for x in r["runs"]:
        assert x["end_s"] == pytest.approx(x["ended_at"] - r["started_at"], abs=0.002)
    assert {"tracks_dir", "started_at", "ended_at", "wall_s", "cpu_s"} <= set(r)
    assert r["wall_s"] < sum(x["wall_s"] for x in r["runs"])


def test_cli_multi_names_files_by_n_so_runs_of_different_n_do_not_collide(monkeypatch, tmp_path):
    _fake_elice(monkeypatch)
    out, m = tmp_path / "out", _meeting(tmp_path / "m")
    for n in ("2", "3"):
        assert R.main(["multi", "--tracks-dir", str(m), "--n", n, "--backend", "elice",
                       "--spend-file", str(tmp_path / "spend.jsonl"), "--cap-krw", "10", "--out-dir", str(out)]) == 0
    assert R.main(["multi", "--tracks-dir", str(m), "--n", "2", "--label", "again", "--out-dir", str(out)]) == 0
    assert len(list(out.glob("multi-2-*.json"))) == 2 and len(list(out.glob("multi-3-*.json"))) == 3
    saved = json.loads((out / "multi-3.json").read_text(encoding="utf-8"))
    assert {"scenario", "tracks_dir", "n", "workers", "backend", "model", "beam", "load_s", "first_decode_s",
            "started_at", "ended_at", "wall_s", "cpu_s", "runs"} <= set(saved)
    assert (saved["n"], saved["workers"], len(saved["runs"])) == (3, 6, 3)
    assert json.loads((out / "multi-again.json").read_text(encoding="utf-8"))["backend"] == "local"


# ─────────────────────────────────────────────────────────────── night3.sh
NIGHT3 = Path(R.__file__).with_name("night3.sh")


def _night3():
    return re.sub(r"\\\n\s*", " ", NIGHT3.read_text(encoding="utf-8"))   # 줄 이음(\)은 한 줄로 본다


def _line(text, name):
    return next(ln for ln in text.splitlines() if ln.startswith(f"scenario {name} "))


def test_night3_script_parses():
    p = subprocess.run(["bash", "-n", str(NIGHT3)], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr


def test_night3_runs_the_short_meetings_first_and_the_expensive_long_ones_last():
    text = _night3()
    order = re.findall(r"^scenario ([\w$-]+)", text, flags=re.M)
    assert order == ["env", "seq-two", "golden-m01-elice", "golden-m02-elice", "botlag-m01", "threads", "workers2",
                     "multi-2", "multi-3", "multi-5", "seq-m01-w1", "seq-m01-w3", "seq-real929",
                     "golden-m01-elice-turn", "golden-m02-elice-turn", "seq-real929-turn",
                     "seq-long10", "seq-long30", "seq-long60"]
    assert re.search(r"^sleep 60$", text, flags=re.M)
    assert "--repeat 3" in _line(text, "seq-two") and "--repeat 3" in _line(text, "seq-long10")
    for n in (2, 3, 5):
        assert f"multi --tracks-dir \"$DATA_DIR/m01\" --n {n} " in _line(text, f"multi-{n}")
    assert "--workers 1 " in _line(text, "seq-m01-w1") and "--workers 3 " in _line(text, "seq-m01-w3")
    assert '--tracks-dir "$DATA_DIR/m01" --tracks-dir "$DATA_DIR/m02"' in _line(text, "threads")
    for m in ("m01", "m02"):
        assert f"--tag {m}" in _line(text, f"golden-{m}-elice")
    saving = sorted(re.findall(r"^scenario (\S+) .*--save-lines", text, flags=re.M))
    assert saving == ["golden-m01-elice", "golden-m01-elice-turn", "golden-m02-elice", "golden-m02-elice-turn",
                      "seq-real929", "seq-real929-turn"]
    # 턴마다 묶음 하나로 다시 재는 비교 실행. 묶음 한 줄이 다른 턴을 덮는지 본다
    turn = sorted(re.findall(r"^scenario (\S+) .*--no-pack-turns", text, flags=re.M))
    assert turn == ["golden-m01-elice-turn", "golden-m02-elice-turn", "seq-real929-turn"]
    assert "--tag m01-turn" in _line(text, "golden-m01-elice-turn") and "--label real929-elice-turn " in _line(
        text, "seq-real929-turn")
    # 추출 비교(judge_diff --lines elice=lines-{session}-elice-1.json)가 읽는 이름. 둘째 밤의 real929-small 과 같은 꼴
    assert "--label real929-elice " in _line(text, "seq-real929")
    assert _line(text, "botlag-m01").startswith('scenario botlag-m01 "${RUNNER[@]}"')   # 봇처럼 nice 없이


def test_night3_books_every_transcription_on_one_ledger_under_a_cap():
    text = _night3()
    assert ('ELICE=(--backend elice --spend-file "$RUN_DIR/elice_spend.jsonl" --cap-krw "${CAP_KRW:-1500}" '
            '--min-bill-s "${MIN_BILL_S:-60}")') in text
    calls = [ln for ln in text.splitlines() if '"${RUNNER[@]}"' in ln and '"${RUNNER[@]}" env ' not in ln]
    assert len(calls) == 19                                # 워커 2개 시나리오는 프로세스 둘이다
    assert all('"${ELICE[@]}"' in ln for ln in calls)
    two = re.search(r"two_workers\(\) \{(.*?)\n\}", text, flags=re.S).group(1)
    assert two.count('"${ELICE[@]}"') == 2 and two.count("&\n") == 2 and "m01" in two and "m02" in two
    assert "capacity.judge_diff" not in text
    for s in ("two-person m01 m02 real929", "synth long-10 10", "synth long-30 30", "synth long-60 60",
              "stt.eval.capacity.synth", "/proc/self/cgroup", "stt.eval.capacity.sampler",
              "stt.eval.capacity.probe", "NICE=(nice -n 10)"):
        assert s in text


def test_night3_stops_before_anything_without_the_elice_settings_and_never_prints_them(tmp_path):
    base = {"PATH": os.environ["PATH"], "HOME": str(tmp_path)}
    args = ["bash", str(NIGHT3), str(tmp_path / "data"), str(tmp_path / "run")]
    p = subprocess.run(args, env={**base, "ELICE_API_KEY": "sk-fake-must-not-leak"}, capture_output=True, text=True)
    assert p.returncode == 1 and "ELICE_STT_BASE_URL" in p.stderr
    assert "sk-fake-must-not-leak" not in p.stdout + p.stderr
    p = subprocess.run(args, env={**base, "ELICE_STT_BASE_URL": "https://mlapi.example/abc"},
                       capture_output=True, text=True)
    assert p.returncode == 1 and "ELICE_API_KEY" in p.stderr
    assert "mlapi.example" not in p.stdout + p.stderr
    assert not (tmp_path / "run").exists()                # 폴더도 만들지 않았다


def test_cli_seq_no_pack_turns_sends_one_turn_per_chunk_and_says_so(monkeypatch, tmp_path):
    # 단어 시각이 없는 백엔드는 묶음이 한 줄로 남는다. 턴마다 묶음 하나로 재는 비교 실행을 고를 수 있어야 한다
    seen = {}
    real_run = R.B.run

    def spy(*a, **kw):
        seen["pack_turns"] = kw.get("pack_turns", True)
        return real_run(*a, **kw)

    monkeypatch.setattr(R.B, "run", spy)
    monkeypatch.setattr(R, "warm_backend",
                        lambda kind, model, beam, **kw: (SlowStt(), {"load_s": 1.0, "first_decode_s": 0.5,
                                                                  "warm_failed_s": []}))
    monkeypatch.setattr(speech_gate, "ENABLED", False)
    out = tmp_path / "out"
    assert R.main(["seq", "--tracks-dir", str(_meeting(tmp_path / "m")), "--label", "t", "--no-pack-turns",
                   "--out-dir", str(out)]) == 0
    assert seen["pack_turns"] is False
    assert json.loads((out / "seq-t.json").read_text(encoding="utf-8"))["pack_turns"] is False


def test_golden_passes_pack_turns_to_score(monkeypatch, tmp_path):
    seen = {}

    def fake_score(session, mode, kind, model, gate_on, workers, yes, **kw):
        seen.update(kw)
        return {"cer": 0.05, "wall_s": 1.0, "cpu_s": 2.0}

    monkeypatch.setattr(R.golden, "score", fake_score)
    R.run_golden(tmp_path / "m01", model="small", tag="m01", backend=SlowStt(), out_dir=tmp_path / "o", pack_turns=False)
    assert seen["pack_turns"] is False


def test_golden_turn_per_chunk_lines_do_not_overwrite_the_packed_run_lines(monkeypatch, tmp_path):
    monkeypatch.setattr(R.golden, "score", lambda *a, **kw: {"cer": 0.05, "wall_s": 1.0, "cpu_s": 2.0})
    out = tmp_path / "o"
    a = R.run_golden(tmp_path / "m01", model="elice/whisper-large-v3", tag="m01", backend=SlowStt(), out_dir=out,
                     save_lines=True, kind="elice")
    b = R.run_golden(tmp_path / "m01", model="elice/whisper-large-v3", tag="m01-turn", backend=SlowStt(), out_dir=out,
                     save_lines=True, kind="elice", pack_turns=False)
    assert Path(a["lines_file"]).name == "lines-m01-elice.json"
    assert Path(b["lines_file"]).name == "lines-m01-elice-turn.json"


def test_metered_backend_books_at_least_the_minimum_billed_seconds_per_call(tmp_path):
    # 과금 단위를 모른다. 호출마다 최소 60초로 적으면 실제 과금이 어느 쪽이어도 장부보다 크지 않다
    spend = tmp_path / "spend.jsonl"
    m = R.MeteredBackend(SlowStt(), spend, 100, label="x", min_bill_s=60)
    m.transcribe(_tone(2), SR)
    row = _ledger(spend)[0]
    assert row["audio_s"] == pytest.approx(2.0) and row["billed_s"] == 60
    assert row["krw"] == pytest.approx(6.0)
    with pytest.raises(R.CapReached):          # 남은 94원으로는 6원짜리 호출이 15번까지다
        for _ in range(16):
            m.transcribe(_tone(2), SR)
    assert R.spent_krw(spend) == pytest.approx(96.0)


def test_cli_passes_the_minimum_billed_seconds_to_the_ledger(monkeypatch, tmp_path):
    _fake_elice(monkeypatch)
    out, spend = tmp_path / "out", tmp_path / "spend.jsonl"
    assert R.main(["seq", "--tracks-dir", str(_meeting(tmp_path / "m")), "--label", "t", "--backend", "elice",
                   "--spend-file", str(spend), "--cap-krw", "100", "--min-bill-s", "60", "--out-dir", str(out)]) == 0
    assert all(r["billed_s"] >= 60 for r in _ledger(spend))
