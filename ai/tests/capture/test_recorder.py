"""녹음 코어(capture/recorder.py). 매니페스트 상태, 단계 재개, 부분 실패 재전사, 트랙 재발견, 회의 날짜. 모델은 안 쓴다."""

import json
import shutil
from datetime import date

import numpy as np
import soundfile as sf

from capture import handoff as H
from capture import recorder as R
from stt import batch as B
from stt.backend import SttResult, Word
from tests.capture.fake_be import FakeBe

SR = 16_000


def _tone(ms):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def _silence(ms):
    return np.zeros(int(SR * ms / 1000), dtype=np.float32)


class EchoStt:
    name = "echo"

    def transcribe(self, samples, sample_rate):
        dur = len(samples) / sample_rate
        ws = [Word(text=f"w{t:.2f}", start_s=t - 0.05, end_s=t + 0.05) for t in np.arange(0.25, dur, 0.5)]
        return SttResult(text=" ".join(w.text for w in ws), words=ws)


class DiesOnLong(EchoStt):
    """이 길이를 넘는 오디오는 죽는다. 묶음(4.4초)은 죽고 클립 하나(2.1초)는 산다."""

    def __init__(self, limit_s=3.5):
        self.limit_s = limit_s
        self.calls = []

    def transcribe(self, samples, sample_rate):
        self.calls.append(len(samples) / sample_rate)
        if len(samples) / sample_rate > self.limit_s:
            raise RuntimeError("죽음")
        return super().transcribe(samples, sample_rate)


class Task:
    """ExtractedTask.to_dict() 와 같은 모양만 흉내 낸다."""

    def __init__(self, sentence):
        self.sentence = sentence

    def to_dict(self):
        return {"task": "와이어프레임 그리기", "assignee_member_id": None, "due_date": "2026-09-18", "confidence": 1.0,
                "assignee_mention": None, "source_sentence": self.sentence, "assignee_type": "first",
                "due_raw": "내일", "due_status": "certain"}


def _extractor(seen: dict):
    def run(transcript, names, today):
        seen["names"], seen["n"], seen["today"] = names, len(transcript.segments), today
        return [Task(transcript.segments[0].text)]
    return run


def _session(tmp_path, ts=500, started_at="2026-09-16T00:00:00Z", guild="77", status=R.STATUS_SAVED):
    rec = tmp_path / "recordings"
    meeting = rec / f"{guild}_{ts}"
    meeting.mkdir(parents=True)
    sf.write(str(meeting / f"1_{ts}.wav"), np.concatenate([_tone(2000), _silence(8000), _tone(2000)]), SR, subtype="PCM_16")
    sf.write(str(meeting / f"2_{ts}.wav"), np.concatenate([_silence(5000), _tone(3000), _silence(4000)]), SR, subtype="PCM_16")
    entries = [{"user_id": "1", "display_name": "민수", "file": f"{guild}_{ts}/1_{ts}.wav", "duration_sec": 12.0},
               {"user_id": "2", "display_name": "서연", "file": f"{guild}_{ts}/2_{ts}.wav", "duration_sec": 12.0}]
    if status == R.STATUS_RECORDING:
        entries = []
    path, manifest = R.write_status(rec, f"{guild}_{ts}", status=status, entries=entries, guild="g", channel="회의방",
                                    library_version="x", started_at=started_at, meeting_dir=f"{guild}_{ts}",
                                    extra={"timezone": "Asia/Seoul", "guild_id": guild, "text_channel_id": "900"})
    return rec, path, manifest


def _run(rec, manifest, tmp_path, backend=None, **kw):
    return R.process_session(rec, manifest, backend=backend or EchoStt(), model_name="echo", workers=1, gate=None,
                             transcripts_dir=tmp_path / "transcripts", **kw)


def test_status_manifest_keeps_the_contract_fields_and_adds_status(tmp_path):
    rec = tmp_path / "recordings"
    path, m = R.write_status(rec, "77_7", status=R.STATUS_RECORDING, entries=[], guild="g", channel="c",
                             library_version="v", started_at="2026-09-16T00:00:00Z", meeting_dir="77_7",
                             extra={"timezone": "Asia/Seoul", "be": {}, "guild_id": "77"})
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert path.name == "session_77_7.json"
    assert saved["session"] == "77_7" and saved["speakers"] == [] and saved["status"] == "recording"
    assert saved["started_at"] == "2026-09-16T00:00:00Z" and saved["meeting_dir"] == "77_7" and saved["guild_id"] == "77"
    assert saved["timezone"] == "Asia/Seoul" and saved["be"] == {} and "recorded_at" in saved
    assert not path.with_suffix(".json.tmp").exists()           # 임시 파일은 바꿔 끼운 뒤 남지 않는다
    assert R.pending_sessions(rec) == []                        # 트랙도 화자도 없는 녹음은 할 것이 없다


def test_meeting_date_is_the_meeting_day_in_its_timezone():
    # UTC 15:30 은 한국 시각으로 다음 날 00:30 이다. 처리하는 날과 무관하다
    assert R.meeting_date({"started_at": "2026-09-16T15:30:00+00:00", "timezone": "Asia/Seoul"}) == date(2026, 9, 17)
    assert R.meeting_date({"started_at": "2026-09-16T14:30:00Z", "timezone": "Asia/Seoul"}) == date(2026, 9, 16)
    assert R.meeting_date({"started_at": "2026-09-16T15:30:00+00:00", "timezone": "UTC"}) == date(2026, 9, 16)
    assert R.meeting_title({"channel": "회의방", "started_at": "2026-09-16T15:30:00+00:00", "timezone": "Asia/Seoul"}) \
        == "회의방 2026-09-17"


def test_backend_from_env_reuses_one_model_per_process(monkeypatch):
    calls = []
    monkeypatch.setattr(B, "make_backend", lambda kind, model, mode: calls.append((kind, model)) or object())
    R._backend.cache_clear()
    monkeypatch.setenv("MM_STT_BACKEND", "local")
    monkeypatch.setenv("MM_STT_MODEL", "tiny")
    a, name, workers = R.backend_from_env()
    b, _, _ = R.backend_from_env()
    assert a is b and calls == [("local", "tiny")] and name == "tiny" and workers == 1
    R._backend.cache_clear()


def test_transcribe_session_writes_script_and_be_contract(tmp_path):
    rec, path, manifest = _session(tmp_path)
    out = R.transcribe_session(rec, manifest, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                               transcripts_dir=tmp_path / "transcripts")
    assert out["markdown"].exists() and out["jsonl"].exists() and out["failed"] == 0 and out["failed_units"] == []
    md = out["markdown"].read_text(encoding="utf-8")
    assert "**민수**:" in md and "**서연**:" in md
    assert out["transcript_json"].name == "session_77_500.transcript.json"         # 회의 ID 로 이름을 짓는다
    contract = json.loads(out["transcript_json"].read_text(encoding="utf-8"))
    assert [s["speaker"] for s in contract["segments"]] == ["1", "2", "1"]   # 회의 시각 순
    assert [s["seq"] for s in contract["segments"]] == [1, 2, 3]
    assert contract["speakers"] == {"1": "민수", "2": "서연"}
    assert out["summary"]["calls"] == 2
    assert (tmp_path / "transcripts" / "session_77_500.lines.json").exists()


def test_process_session_runs_every_stage_and_records_when(tmp_path):
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    seen = {}
    r = _run(rec, manifest, tmp_path, extractor=_extractor(seen),
             handoff=H.Handoff(H.BeClient("http://be", session=fake), "ws-1"))
    assert r["ran"] == ["transcribed", "extracted", "handed_off"] and r["status"] == "handed_off"
    assert r["text_channel_id"] == "900"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["status"] == "handed_off" and set(saved["stages"]) == {"transcribed", "extracted", "handed_off"}
    assert saved["transcript"] == "77_500/transcript.md" and saved["tasks"].endswith("session_77_500.tasks.json")
    assert saved["be"]["meeting_id"] == "m1" and saved["be"]["status"] == "done" and saved["be"]["extraction_id"] == "e-m1"
    assert seen["today"] == date(2026, 9, 16) and seen["names"] == {"1": "민수", "2": "서연"} and seen["n"] == 3
    # BE 에는 회의 생성 → 종료 → 추출 등록 순서로 갔고, 1인칭 항목에 그 트랙의 uid 가 실렸다
    assert [(c[0], c[1]) for c in fake.calls] == [("POST", "/meetings"), ("PATCH", "/meetings/m1/end"),
                                                   ("POST", "/extractions")]
    assert fake.calls[0][2]["title"] == "회의방 2026-09-16"
    assert fake.calls[2][2]["items"][0]["evidence_speaker"] == "1"
    assert R.pending_sessions(rec) == []


def test_process_session_stops_where_settings_are_missing_and_recover_resumes(tmp_path):
    rec, path, manifest = _session(tmp_path)
    r = _run(rec, manifest, tmp_path, extractor=None, handoff=None)
    assert r["ran"] == ["transcribed"] and r["skipped"] == {"extracted": "LLM 설정 없음"} and r["status"] == "transcribed"
    assert R.pending_sessions(rec) == [path]                    # 설정이 생기면 이어서 하도록 남는다
    # 추출만 켜졌다. 전사는 다시 하지 않고 추출부터 이어 간다
    results = R.recover(rec, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts", extractor=_extractor({}), handoff=None)
    assert [(x["session"], x["ran"], x["status"]) for x in results] == [("77_500", ["extracted"], "extracted")]
    assert results[0]["skipped"] == {"handed_off": "BE 설정 없음"}
    # BE 까지 켜졌다. 인계만 한다
    fake = FakeBe()
    results = R.recover(rec, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts", extractor=_extractor({}),
                        handoff=H.Handoff(H.BeClient("http://be", session=fake), "ws-1"))
    assert results[0]["ran"] == ["handed_off"] and results[0]["status"] == "handed_off"
    assert [c[1] for c in fake.calls] == ["/meetings", "/meetings/m1/end", "/extractions"]
    assert R.pending_sessions(rec) == []


def test_partial_transcription_is_not_closed_and_recover_resends_only_the_failed_lines(tmp_path, monkeypatch):
    """화자 1 의 묶음(4.4초)만 죽는다. 완료로 닫지 않고, 복구가 그 두 클립만 다시 보내 채운다."""
    monkeypatch.setattr(B, "RETRY_WAIT_S", 0.0)
    rec, path, manifest = _session(tmp_path)
    stt = DiesOnLong()
    r = _run(rec, manifest, tmp_path, backend=stt, extractor=_extractor({}))
    assert r["status"] == "partial" and r["ran"] == ["partial"] and r["transcribe"]["failed"] == 2
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["status"] == "partial" and "transcribed" in saved["stages"] and "extracted" not in saved["stages"]
    assert [(u["speaker"], u["start_ms"] // 1000) for u in saved["failed_units"]] == [("1", 0), ("1", 10)]
    md = (rec / "77_500" / "transcript.md").read_text(encoding="utf-8")
    assert "**서연**:" in md and "**민수**:" not in md                     # 실패한 줄은 회의록에 없다
    assert R.pending_sessions(rec) == [path]

    stt.calls.clear()
    results = R.recover(rec, backend=stt, model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts", extractor=_extractor({}), handoff=None)
    r2 = results[0]
    assert r2["ran"] == ["retried", "extracted"] and r2["retried"] == 2 and r2["transcribe"]["failed"] == 0
    assert all(c < 3.5 for c in stt.calls) and len(stt.calls) == 2            # 실패한 클립 둘만, 클립 단위로
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["status"] == "extracted" and "failed_units" not in saved and saved["retry_runs"] == 1
    md = (rec / "77_500" / "transcript.md").read_text(encoding="utf-8")
    assert "**민수**:" in md and "**서연**:" in md
    contract = json.loads((tmp_path / "transcripts" / "session_77_500.transcript.json").read_text(encoding="utf-8"))
    assert [s["speaker"] for s in contract["segments"]] == ["1", "2", "1"]
    assert [s["seq"] for s in contract["segments"]] == [1, 2, 3]              # 첫 전사 때 매긴 순번 그대로


def test_lines_that_fail_twice_are_kept_in_the_manifest_and_the_meeting_moves_on(tmp_path, monkeypatch):
    """묶음 둘이 다 죽고(2.5초 넘음), 재전사에서 화자 1 의 클립 둘(2.1초)은 살고 화자 2 의 클립(3.1초)은 또 죽는다."""
    monkeypatch.setattr(B, "RETRY_WAIT_S", 0.0)
    rec, path, manifest = _session(tmp_path)
    stt = DiesOnLong(limit_s=2.5)
    r = _run(rec, manifest, tmp_path, backend=stt, extractor=_extractor({}))
    assert r["status"] == "partial" and r["transcribe"]["failed"] == 3
    results = R.recover(rec, backend=stt, model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts", extractor=_extractor({}), handoff=None)
    r2 = results[0]
    assert r2["ran"] == ["retried", "extracted"] and r2["retried"] == 3 and r2["transcribe"]["failed"] == 1
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["status"] == "extracted" and [u["speaker"] for u in saved["failed_units"]] == ["2"]   # 구간은 남는다
    md = (rec / "77_500" / "transcript.md").read_text(encoding="utf-8")
    assert "**민수**:" in md and "**서연**:" not in md


def test_when_no_line_survives_the_meeting_stays_partial(tmp_path, monkeypatch):
    monkeypatch.setattr(B, "RETRY_WAIT_S", 0.0)
    rec, path, manifest = _session(tmp_path)
    always = DiesOnLong(limit_s=1.0)                     # 클립 하나도 죽는다
    _run(rec, manifest, tmp_path, backend=always, extractor=_extractor({}))
    results = R.recover(rec, backend=always, model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts", extractor=_extractor({}), handoff=None)
    assert results[0]["ran"] == ["retried"] and results[0]["status"] == "partial"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["status"] == "partial" and len(saved["failed_units"]) == 3 and "extracted" not in saved["stages"]
    assert R.pending_sessions(rec) == [path]


def test_failed_stage_is_recorded_told_to_be_and_retried_from_there(tmp_path):
    rec, path, manifest = _session(tmp_path)
    fake = FakeBe()
    h = H.Handoff(H.BeClient("http://be", session=fake), "ws-1")

    def dying(transcript, names, today):
        raise RuntimeError("LLM 죽음")

    r = _run(rec, manifest, tmp_path, extractor=dying, handoff=h)
    assert r["status"] == "failed" and r["failed_stage"] == "extract" and "LLM 죽음" in r["error"]
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["status"] == "failed" and saved["failed_stage"] == "extract" and "transcribed" in saved["stages"]
    assert fake.meetings["m1"]["status"] == "failed" and fake.meetings["m1"]["failed_stage"] == "extract"
    assert R.pending_sessions(rec) == [path]
    # 복구. 전사는 건너뛰고 추출부터. BE 는 failed 로 닫혀 있어 새 회의로 넘긴다
    results = R.recover(rec, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts", extractor=_extractor({}), handoff=h)
    assert results[0]["ran"] == ["extracted", "handed_off"] and results[0]["status"] == "handed_off"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["be"]["meeting_id"] == "m2" and saved["be"]["replaced"] == ["m1"] and "error" not in saved


def test_recover_transcribes_pending_and_marks_a_broken_one_failed(tmp_path):
    rec, path, manifest = _session(tmp_path, ts=500)
    rec2, path2, manifest2 = _session(tmp_path, ts=600)
    (rec / "77_600" / "1_600.wav").write_bytes(b"not a wav")            # 깨진 트랙
    assert [p.name for p in R.pending_sessions(rec)] == ["session_77_500.json", "session_77_600.json"]
    results = R.recover(rec, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts")
    assert [(r["session"], r["status"]) for r in results] == [("77_500", "transcribed"), ("77_600", "failed")]
    m500 = json.loads(path.read_text(encoding="utf-8"))
    assert m500["status"] == "transcribed" and m500["transcript"] == "77_500/transcript.md"
    m600 = json.loads(path2.read_text(encoding="utf-8"))
    assert m600["status"] == "failed" and m600["failed_stage"] == "stt" and "error" in m600
    # 실패한 것도, 설정이 없어 멈춘 것도 다음 시도 대상으로 남는다
    assert R.pending_sessions(rec) == [path, path2]


def test_recover_can_be_limited_to_one_guild(tmp_path):
    rec, path_a, _ = _session(tmp_path, ts=500, guild="77")
    rec, path_b, _ = _session(tmp_path, ts=500, guild="88")            # 다른 서버가 같은 초에 시작했다
    assert path_a.name == "session_77_500.json" and path_b.name == "session_88_500.json"
    assert R.pending_sessions(rec, guild_id=77) == [path_a] and R.pending_sessions(rec, guild_id="88") == [path_b]
    results = R.recover(rec, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts", guild_id=77)
    assert [r["session"] for r in results] == ["77_500"]
    assert json.loads(path_b.read_text(encoding="utf-8"))["status"] == "saved"   # 남의 서버 회의는 그대로


def test_tracks_left_by_a_dead_recording_are_rediscovered(tmp_path):
    """녹음 중에 죽으면 매니페스트에 화자가 없다. 디렉토리의 wav 를 다시 찾아 복구한다."""
    rec, path, manifest = _session(tmp_path, status=R.STATUS_RECORDING)
    assert manifest["speakers"] == []
    assert R.pending_sessions(rec) == [path]
    names = {"1": "민수"}
    results = R.recover(rec, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts", name_of=lambda uid: names.get(uid))
    assert results[0]["status"] == "transcribed" and results[0]["speakers"] == 2
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert [e["user_id"] for e in saved["speakers"]] == ["1", "2"] and saved["recovered_tracks"] is True
    assert [e["display_name"] for e in saved["speakers"]] == ["민수", "2"]     # 이름을 못 찾으면 ID 로 둔다
    assert saved["speakers"][0]["duration_sec"] == 12.0


def test_a_wav_the_dead_process_never_closed_is_still_readable(tmp_path):
    """TrackWriter 가 닫지 못한 wav 는 헤더의 길이 필드가 0 이다. soundfile 은 파일 끝까지 읽는다."""
    mdir = tmp_path / "recordings" / "77_9"
    mdir.mkdir(parents=True)
    f = sf.SoundFile(str(mdir / "1_9.tmp"), mode="w", samplerate=SR, channels=1, subtype="PCM_16", format="WAV")
    f.write(np.concatenate([_tone(1000), _silence(500)]))
    f.flush()
    shutil.copy(mdir / "1_9.tmp", mdir / "1_9.wav")      # 닫기 전의 파일 상태를 그대로 뜬다
    f.close()
    entries = R.discover_tracks(tmp_path / "recordings", {"meeting_dir": "77_9"})
    assert [(e["user_id"], e["duration_sec"]) for e in entries] == [("1", 1.5)]
    (mdir / "2_9.wav").write_bytes(b"not a wav")
    assert [e["user_id"] for e in R.discover_tracks(tmp_path / "recordings", {"meeting_dir": "77_9"})] == ["1"]


def test_extract_after_transcription_uses_the_meeting_date_and_skips_without_extractor(tmp_path):
    rec, path, manifest = _session(tmp_path, started_at="2026-09-16T15:30:00+00:00")
    tdir = tmp_path / "transcripts"
    R.transcribe_session(rec, manifest, backend=EchoStt(), model_name="echo", workers=1, gate=None, transcripts_dir=tdir)
    seen = {}
    out = R.extract_after_transcription(tdir, manifest, extractor=_extractor(seen))
    assert out == tdir / "session_77_500.tasks.json"
    assert json.loads(out.read_text(encoding="utf-8"))[0]["task"] == "와이어프레임 그리기"
    assert seen["today"] == date(2026, 9, 17)                          # 한국 시각으로 다음 날
    assert R.extract_after_transcription(tdir, manifest, extractor=lambda *a: [], today=date(2026, 1, 1)) == out
    assert R.extract_after_transcription(tmp_path / "없음", manifest, extractor=_extractor({})) is None
