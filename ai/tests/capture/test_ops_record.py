"""회의마다 처리 기록(capture/ops_record.py). 단계 시각, 최대 메모리 표본, CPU 초, 기록 한 건의 칸, 사람이 읽는 파일,
결과 한 줄. 모델과 LLM 은 안 쓴다. 메모리 읽기와 표본 간격은 바꿔 끼운다."""

import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from capture import ops_record as O

MANIFEST = {"session": "77_500", "meeting_dir": "77_500", "timezone": "Asia/Seoul",
            "speakers": [{"user_id": "1", "file": "77_500/1_500.wav", "duration_sec": 12.0},
                         {"user_id": "2", "file": "77_500/2_500.wav", "duration_sec": 10.0}]}
SUMMARY = {"calls": 4, "failed": 1, "retries": 2, "calls_over_20s": 1, "gated": 3, "speech_s": 6.0, "track_s": 22.0,
           "audio_sent_s": 60.0, "unmapped_chunks": 4}


def _ago(seconds):
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).replace(microsecond=0).isoformat()


def _result(**over):
    base = {"status": "handed_off", "failed_stage": None, "retried": 0,
            "transcribe": {"markdown": "x", "failed": 1, "summary": dict(SUMMARY), "lines": 3}}
    base.update(over)
    return base


def _sampler_threads():
    return [t for t in threading.enumerate() if t.name == O.SAMPLER_NAME and t.is_alive()]


def test_read_rss_is_vmrss_in_bytes_and_none_where_it_cannot_be_read(tmp_path):
    status = tmp_path / "status"
    status.write_text("Name:\tpython\nVmPeak:\t  9999 kB\nVmRSS:\t  2048 kB\nThreads:\t4\n", encoding="utf-8")
    assert O.read_rss(status) == 2048 * 1024
    assert O.read_rss(tmp_path / "없음") is None                  # /proc 이 없는 OS


def test_the_sampler_keeps_the_peak_and_stops_when_the_run_ends():
    values = iter([100, 300, 200])
    run = O.OpsRun(dict(MANIFEST), read=lambda: next(values, 200), interval_s=0.01)
    time.sleep(0.1)
    entry = run.finish(dict(MANIFEST), _result(), model="echo", backend="echo")
    assert entry["peak_rss_bytes"] == 300
    assert _sampler_threads() == []


def test_without_a_readable_memory_the_peak_is_none():
    run = O.OpsRun(dict(MANIFEST), read=lambda: None, interval_s=0.01)
    assert run.finish(dict(MANIFEST), _result(), model="echo", backend="echo")["peak_rss_bytes"] is None


def test_stages_get_start_end_and_seconds_and_the_next_stage_closes_the_last():
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    run.begin("stt")
    time.sleep(0.25)
    run.begin("extract")                                          # 전사는 여기서 닫힌다
    entry = run.finish(dict(MANIFEST), _result(), model="echo", backend="echo")   # 열린 추출은 끝에서 닫힌다
    assert list(entry["stages"]) == ["stt", "extract"]
    stt = entry["stages"]["stt"]
    assert stt["s"] >= 0.2 and stt["started_at"] <= stt["ended_at"] <= entry["run_ended_at"]
    assert entry["stages"]["extract"]["s"] >= 0
    assert entry["rtf_meeting"] == round(stt["s"] / 12.0, 3)        # 회의 길이는 가장 긴 트랙
    assert entry["rtf_speech"] == round(stt["s"] / 6.0, 3)


def test_a_record_has_the_capacity_fields(monkeypatch):
    monkeypatch.setenv("MM_PIPELINE_MODE", "worker")
    manifest = dict(MANIFEST, recorded_at=_ago(30), recovery={"attempts": 2, "next_at": _ago(0)})
    run = O.OpsRun(manifest, read=lambda: 5)
    manifest.pop("recovery")                                       # 이번 처리가 단계를 닫으면 recovery 는 지워진다
    entry = run.finish(dict(manifest, status="handed_off"), _result(), model="large-v3-turbo",
                       backend="local/large-v3-turbo-int8-b5")
    assert 29 <= entry["wait_s"] < 40 and entry["wall_s"] >= 0
    # 대기는 적힌 두 시각의 차 그대로다. recorded_at 이 초 단위라 처리 시작도 같은 단위로 잘라 뺀다
    started = datetime.fromisoformat(entry["run_started_at"])
    assert entry["wait_s"] == (started - datetime.fromisoformat(manifest["recorded_at"])).total_seconds()
    assert entry["run_started_at"] <= entry["run_ended_at"]
    assert (entry["meeting_s"], entry["speech_s"], entry["track_s"]) == (12.0, 6.0, 22.0)
    assert (entry["calls"], entry["failed"], entry["retries"], entry["calls_over_20s"], entry["gated"]) == (4, 1, 2, 1, 3)
    assert entry["retried_lines"] == 0 and entry["recovery_attempts"] == 2      # 처리를 시작할 때 본 값
    assert entry["status"] == "handed_off" and entry["failed_stage"] is None
    assert (entry["mode"], entry["extract_path"]) == ("worker", "legacy")
    assert (entry["model"], entry["backend"]) == ("large-v3-turbo", "local/large-v3-turbo-int8-b5")
    assert entry["model_load_s"] is None and entry["llm_calls"] is None
    assert entry["cpu_s"] is None or entry["cpu_s"] >= 0
    assert "transcript" not in entry and "lines" not in entry                    # 숫자만. 전사 문장은 없다


def test_a_record_has_the_sent_audio_its_cost_and_the_chunks_left_without_word_times():
    # API 전사는 회의마다 비용이 든다. 보낸 소리로 센다. 단어 시각 없이 묶음째 한 줄로 남은 수도 남긴다
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    elice = run.finish(dict(MANIFEST, status="transcribed"), _result(), model="elice", backend="elice/whisper-large-v3")
    assert elice["audio_sent_s"] == 60.0 and elice["unmapped_chunks"] == 4
    assert elice["stt_krw"] == pytest.approx(6.0)                               # 60초 × 6원/60초
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    local = run.finish(dict(MANIFEST, status="transcribed"), _result(), model="large-v3-turbo",
                       backend="local/large-v3-turbo-int8-b5")
    assert local["stt_krw"] == 0.0                                              # 로컬은 호출 비용이 없다
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    none = run.finish(dict(MANIFEST, status="partial"), _result(transcribe={"summary": None, "failed": 1, "lines": 3}),
                      model="elice", backend="elice/whisper-large-v3")
    assert (none["audio_sent_s"], none["unmapped_chunks"], none["stt_krw"]) == (None, None, None)


def test_a_run_without_full_transcription_leaves_the_stt_fields_empty():
    """전사가 이미 끝난 회의를 추출부터 이었거나, 실패한 줄만 다시 보낸 처리다. 다시 보낸 몇 줄의 시간을 회의 길이로
    나누면 실제 회의끼리 견줄 수 없는 RTF 가 나온다."""
    manifest = dict(MANIFEST)
    manifest.pop("speakers")
    run = O.OpsRun(manifest, read=lambda: None)
    run.begin("stt")
    entry = run.finish(dict(manifest, status="partial"), _result(status="partial", retried=2,
                                                                 transcribe={"summary": None, "failed": 1, "lines": 3}),
                       model="echo", backend="echo")
    assert entry["wait_s"] is None and entry["meeting_s"] is None                # recorded_at 도 화자도 없다
    assert entry["retried_lines"] == 2 and entry["recovery_attempts"] == 0
    for key in ("rtf_meeting", "rtf_speech", "speech_s", "track_s", "calls", "failed", "retries", "calls_over_20s",
                "gated"):
        assert entry[key] is None, key


def test_a_failed_run_names_its_stage():
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    entry = run.finish(dict(MANIFEST, status="failed"), _result(status="failed", failed_stage="extract", transcribe=None),
                       model="echo", backend="echo")
    assert (entry["status"], entry["failed_stage"]) == ("failed", "extract")


class LocalLike:
    """로컬 백엔드처럼 _model 과 _load 가 있다. 첫 _load 가 모델을 올린다."""

    def __init__(self, fail=False):
        self._model = None
        self.loads = 0
        self.fail = fail

    def _load(self):
        self.loads += 1
        if self.fail:
            raise OSError("모델 파일 없음")
        time.sleep(0.05)
        self._model = object()
        return self._model


def test_the_model_load_is_timed_only_when_this_run_loads_it():
    backend = LocalLike()
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    run.load_model(backend)
    entry = run.finish(dict(MANIFEST), _result(), model="echo", backend="echo")
    assert entry["model_load_s"] >= 0.05 and backend.loads == 1
    again = O.OpsRun(dict(MANIFEST), read=lambda: None)
    again.load_model(backend)                                     # 이미 올라가 있다
    assert again.finish(dict(MANIFEST), _result(), model="echo", backend="echo")["model_load_s"] is None
    assert backend.loads == 1
    remote = O.OpsRun(dict(MANIFEST), read=lambda: None)
    remote.load_model(object())                                   # 원격 백엔드는 올릴 모델이 없다
    assert remote.finish(dict(MANIFEST), _result(), model="echo", backend="echo")["model_load_s"] is None


def test_a_model_that_fails_to_load_is_left_to_the_first_call():
    """올리다 실패해도 여기서 예외를 내지 않는다. 원래처럼 첫 전사 호출이 다시 올리고, 그 실패는 전사 단계가 센다."""
    backend = LocalLike(fail=True)
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    run.load_model(backend)
    assert run.finish(dict(MANIFEST), _result(), model="echo", backend="echo")["model_load_s"] is None
    assert backend._model is None


class Counting:
    def __init__(self, calls):
        self.calls = calls


def test_llm_calls_are_the_difference_over_the_extract_stage_on_the_judge_path(monkeypatch):
    import llm

    clients = {"terra": Counting(5), "luna": Counting(10)}
    monkeypatch.setattr(llm, "get_llm", lambda which: clients[which])
    monkeypatch.setenv("MM_EXTRACT_PATH", "judge")
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    run.watch_llm()
    clients["terra"].calls += 3
    clients["luna"].calls += 4
    entry = run.finish(dict(MANIFEST), _result(), model="echo", backend="echo")
    assert entry["llm_calls"] == {"terra": 3, "luna": 4} and entry["extract_path"] == "judge"


def test_llm_calls_are_none_on_the_legacy_path_or_without_a_counter(monkeypatch):
    import llm

    monkeypatch.setattr(llm, "get_llm", lambda which: object())            # NullLLM 처럼 calls 가 없다
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    run.watch_llm()
    assert run.finish(dict(MANIFEST), _result(), model="echo", backend="echo")["llm_calls"] is None
    monkeypatch.setenv("MM_EXTRACT_PATH", "judge")
    run = O.OpsRun(dict(MANIFEST), read=lambda: None)
    run.watch_llm()
    assert run.finish(dict(MANIFEST), _result(), model="echo", backend="echo")["llm_calls"] == \
        {"terra": None, "luna": None}


def test_the_result_line_has_time_wait_and_memory():
    entry = {"wall_s": 2395.0, "wait_s": 12.0, "peak_rss_bytes": int(2.2 * 1024 ** 3)}
    assert O.summary_line(entry) == "⏱ 처리 39분 55초 · 대기 12초 · 최대 메모리 2.2GB"
    assert O.summary_line({"wall_s": 3.25, "wait_s": None, "peak_rss_bytes": None}) == "⏱ 처리 3.2초"
    assert O.summary_line({"wall_s": 9.96, "wait_s": None, "peak_rss_bytes": None}) == "⏱ 처리 10초"   # 10.0초가 아니다
    assert O.summary_line({"wall_s": 4000, "wait_s": 61, "peak_rss_bytes": 850 * 1024 ** 2}) == \
        "⏱ 처리 1시간 6분 · 대기 1분 1초 · 최대 메모리 850MB"


def test_the_readable_file_has_one_row_per_run_and_explains_its_terms(tmp_path):
    first = {"run_started_at": "2026-10-06T12:00:00+00:00", "run_ended_at": "2026-10-06T12:40:07+00:00",
             "wall_s": 2407.0, "wait_s": 12.0, "status": "partial", "failed_stage": None,
             "stages": {"stt": {"started_at": "a", "ended_at": "b", "s": 2395.0}}, "meeting_s": 3600.0,
             "speech_s": 1200.0, "rtf_meeting": 0.665, "rtf_speech": 1.996, "peak_rss_bytes": int(2.2 * 1024 ** 3),
             "cpu_s": 4100.5, "calls": 120, "failed": 2, "retries": 3, "audio_sent_s": 3402.0, "stt_krw": 340.2,
             "unmapped_chunks": 120}
    second = {"run_started_at": "2026-10-06T12:41:10+00:00", "run_ended_at": "2026-10-06T12:41:40+00:00",
              "wall_s": 30.0, "wait_s": 2475.0, "status": "failed", "failed_stage": "extract",
              "stages": {"stt": {"s": 4.0}, "sources": {"s": 1.5}, "extract": {"s": 20.0}}, "meeting_s": 3600.0,
              "speech_s": None, "rtf_meeting": None, "rtf_speech": None, "peak_rss_bytes": None, "cpu_s": None,
              "calls": None, "failed": None, "retries": None}
    manifest = dict(MANIFEST, ops=[first, second])
    path = O.write_markdown(tmp_path / "77_500", "회의방 2026-10-06", manifest)
    assert path == tmp_path / "77_500" / "처리기록.md"
    text = path.read_text(encoding="utf-8")
    assert text.startswith("# 처리 기록: 회의방 2026-10-06")
    rows = [ln for ln in text.splitlines() if ln.startswith("| 10/06")]
    assert len(rows) == 2
    assert rows[0].startswith("| 10/06 21:00:00 |")                         # 회의 시간대(한국 시각)
    assert "40분 19초" in rows[0] and "39분 55초" in rows[0] and "2.2GB" in rows[0] and "120·2·3" in rows[0]
    assert "0.665 · 1.996" in rows[0] and "20분" in rows[0]
    assert "| 56분 42초 · 340원 | 120 |" in rows[0]                          # 보낸 소리 · 전사 비용, 한 줄 묶음
    assert "| 대기 | 처리 | 전사 |" in text                                   # 처리 시간도 칸이 있다
    assert "| 12초 | 40분 7초 | 39분 55초 |" in rows[0] and "| 41분 15초 | 30초 |" in rows[1]
    assert "실패(추출)" in rows[1] and "41분 45초" in rows[1]                # 결과까지 = 대기 + 처리
    assert rows[1].count("|  |") >= 4                                        # 잴 수 없었던 칸은 비운다
    terms = text.split("## 용어", 1)[1]
    for term in ("대기", "RTF", "최대 메모리", "CPU 초", "호출", "20초 넘은 호출", "말 필터가 거른 클립", "보낸 소리",
                 "전사 비용", "단어 시각 없는 묶음"):
        assert f"| {term}" in terms, term
    for term in ("최대 메모리", "CPU 초"):                                    # 봇이 회의 둘을 같이 처리하면 섞인다
        assert "같이 처리한 회의" in next(ln for ln in terms.splitlines() if ln.startswith(f"| {term} |")), term
    assert "—" not in text and "–" not in text


@pytest.fixture(autouse=True)
def no_sampler_left():
    yield
    deadline = time.monotonic() + 2
    while _sampler_threads() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert _sampler_threads() == []
