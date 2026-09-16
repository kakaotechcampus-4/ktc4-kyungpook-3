"""녹음 코어(capture/recorder.py). 매니페스트 상태, 저장 뒤 전사, 남은 녹음 회수. 모델은 안 쓴다."""

import json

import numpy as np
import soundfile as sf

from capture import recorder as R
from stt.backend import SttResult, Word

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


def _session(tmp_path, ts=500):
    rec = tmp_path / "recordings"
    meeting = rec / f"g_{ts}"
    meeting.mkdir(parents=True)
    sf.write(str(meeting / f"1_{ts}.wav"), np.concatenate([_tone(2000), _silence(8000), _tone(2000)]), SR, subtype="PCM_16")
    sf.write(str(meeting / f"2_{ts}.wav"), np.concatenate([_silence(5000), _tone(3000), _silence(4000)]), SR, subtype="PCM_16")
    entries = [{"user_id": "1", "display_name": "민수", "file": f"g_{ts}/1_{ts}.wav", "duration_sec": 12.0},
               {"user_id": "2", "display_name": "서연", "file": f"g_{ts}/2_{ts}.wav", "duration_sec": 12.0}]
    path, manifest = R.write_status(rec, ts, status=R.STATUS_SAVED, entries=entries, guild="g", channel="c",
                                    library_version="x", started_at="2026-09-16T00:00:00Z", meeting_dir=f"g_{ts}")
    return rec, path, manifest


def test_status_manifest_keeps_the_contract_fields_and_adds_status(tmp_path):
    rec = tmp_path / "recordings"
    path, m = R.write_status(rec, 7, status=R.STATUS_RECORDING, entries=[], guild="g", channel="c",
                             library_version="v", started_at="2026-09-16T00:00:00Z", meeting_dir="g_7")
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["session"] == "7" and saved["speakers"] == [] and saved["status"] == "recording"
    assert saved["started_at"] == "2026-09-16T00:00:00Z" and saved["meeting_dir"] == "g_7"
    assert R.pending_sessions(rec) == []            # 화자가 없는 녹음은 전사할 것이 없다


def test_transcribe_session_writes_script_and_be_contract(tmp_path):
    rec, path, manifest = _session(tmp_path)
    out = R.transcribe_session(rec, manifest, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                               transcripts_dir=tmp_path / "transcripts")
    assert out["markdown"].exists() and out["jsonl"].exists() and out["failed"] == 0
    md = out["markdown"].read_text(encoding="utf-8")
    assert "**민수**:" in md and "**서연**:" in md
    contract = json.loads(out["transcript_json"].read_text(encoding="utf-8"))
    assert [s["speaker"] for s in contract["segments"]] == ["1", "2", "1"]   # 회의 시각 순
    assert [s["seq"] for s in contract["segments"]] == [1, 2, 3]
    assert contract["speakers"] == {"1": "민수", "2": "서연"}
    assert out["summary"]["calls"] == 2


def test_recover_transcribes_pending_and_marks_a_broken_one_failed(tmp_path):
    rec, path, manifest = _session(tmp_path, ts=500)
    rec2, path2, manifest2 = _session(tmp_path, ts=600)
    (rec / "g_600" / "1_600.wav").write_bytes(b"not a wav")            # 깨진 트랙
    assert [p.name for p in R.pending_sessions(rec)] == ["session_500.json", "session_600.json"]
    results = R.recover(rec, backend=EchoStt(), model_name="echo", workers=1, gate=None,
                        transcripts_dir=tmp_path / "transcripts")
    assert [(r["session"], r["status"]) for r in results] == [("500", "transcribed"), ("600", "failed")]
    m500 = json.loads(path.read_text(encoding="utf-8"))
    assert m500["status"] == "transcribed" and m500["transcript"] == "g_500/transcript.md"
    assert json.loads(path2.read_text(encoding="utf-8"))["status"] == "failed"
    assert R.pending_sessions(rec) == [path2]      # 실패한 것은 다시 시도 대상으로 남는다


def test_extract_after_transcription_writes_tasks_and_skips_without_extractor(tmp_path):
    rec, path, manifest = _session(tmp_path)
    tdir = tmp_path / "transcripts"
    R.transcribe_session(rec, manifest, backend=EchoStt(), model_name="echo", workers=1, gate=None, transcripts_dir=tdir)
    seen = {}

    class Task:
        def to_dict(self):
            return {"task": "와이어프레임 그리기", "assignee_member_id": None, "due_date": "2026-09-18", "confidence": 1.0}

    def fake_extractor(transcript, names):
        seen["names"] = names
        seen["n"] = len(transcript.segments)
        return [Task()]

    out = R.extract_after_transcription(tdir, manifest, extractor=fake_extractor)
    assert out == tdir / "session_500.tasks.json"
    assert json.loads(out.read_text(encoding="utf-8"))[0]["task"] == "와이어프레임 그리기"
    assert seen["names"] == {"1": "민수", "2": "서연"} and seen["n"] == 3
    assert R.extract_after_transcription(tdir, manifest, extractor=None) in (None, out)   # 설정이 없으면 건너뛴다
