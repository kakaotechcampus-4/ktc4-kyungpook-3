"""용량 측정 시나리오 실행(stt/eval/capacity/runner.py). 가짜 백엔드와 합성 톤만 쓴다. 실제 모델은 올리지 않는다."""

import asyncio
import json
import os
import re
import subprocess
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from stt import batch as B
from stt import speech_gate
from stt.backend import SttResult, Word
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
                        lambda kind, model, beam: (SlowStt(), {"load_s": 1.234, "first_decode_s": 0.5}))
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
        {"speaker": "김동우", "start": 1.0, "end": 2.5, "text": "제가 할게요", "seq": 1}]}
    assert r["lines_file"].endswith("lines-m01-small.json")


def test_seq_saves_each_run_lines_in_the_golden_shape(tmp_path):
    out = tmp_path / "out"
    r = R.run_seq(_meeting(tmp_path / "m"), "real", repeat=2, backend=SlowStt(), out_dir=out, gate_factory=NO_GATE,
                  save_lines=True, model="small")
    for i, run in enumerate(r["runs"], 1):
        saved = json.loads((out / f"lines-real-{i}.json").read_text(encoding="utf-8"))
        assert saved["session"] == "real" and saved["model"] == "small"
        segs = saved["segments"]
        assert all(set(s) == {"speaker", "start", "end", "text", "seq"} and s["start"] < s["end"] for s in segs)
        assert [(s["speaker"], s["text"], s["seq"]) for s in segs] == [("a", "네", 1), ("b", "네", 2)]
        assert run["lines_file"].endswith(f"lines-real-{i}.json")
    R.run_seq(_meeting(tmp_path / "m2"), "quiet", repeat=1, backend=SlowStt(), out_dir=out, gate_factory=NO_GATE)
    assert not list(out.glob("lines-quiet*"))           # 끄면 전사 문장을 남기지 않는다


def test_cli_seq_save_lines_names_the_model_it_ran(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "warm_backend",
                        lambda kind, model, beam: (SlowStt(), {"load_s": 1.0, "first_decode_s": 0.5}))
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
