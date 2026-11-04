from __future__ import annotations

import json

import numpy as np
import pytest
import soundfile as sf

from capture.recorder import STATUS_DIARIZED
from stt import transcribe as T
from stt.backend import SttResult, Word
from upload.diarize import Segment
from upload.prepare import prepare_upload

SR = 16000
STARTED = "2026-10-31T01:00:00+00:00"


class FakeDiarizer:
    def __init__(self, segments):
        self.segments = segments
        self.calls = []

    def diarize(self, path):
        self.calls.append(path)
        return list(self.segments)


class EchoStt:
    name = "echo"
    compute_type = "int8"
    language = "ko"

    def transcribe(self, samples, sample_rate):
        dur = len(samples) / sample_rate
        ws, t = [], 0.25
        while t < dur:
            ws.append(Word(text=f"w{t:.2f}", start_s=t - 0.05, end_s=t + 0.05))
            t += 0.5
        return SttResult(text=" ".join(w.text for w in ws), words=ws)


def _audio(tmp_path, secs=12):
    t = np.arange(secs * SR) / SR
    p = tmp_path / "in.wav"
    sf.write(str(p), (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), SR, subtype="PCM_16")
    return p


SEGS = [Segment(1, 3, "SPEAKER_00"), Segment(6, 9, "SPEAKER_01")]


def _run(tmp_path, segs=SEGS):
    d = FakeDiarizer(segs)
    rec = tmp_path / "rec"
    path, m = prepare_upload(_audio(tmp_path), rec, diarizer=d, started_at=STARTED, timezone="Asia/Seoul")
    return d, rec, path, m


def test_manifest_shape_and_status(tmp_path):
    d, rec, path, m = _run(tmp_path)
    assert json.loads(path.read_text(encoding="utf-8")) == m
    assert path.parent == rec and path.name == f"session_{m['session']}.json"
    assert m["status"] == STATUS_DIARIZED == "diarized" and m["source"] == "upload"
    assert m["started_at"] == STARTED and m["timezone"] == "Asia/Seoul" and m["meeting_dir"] == m["session"]
    assert m["guild"] is None and m["channel"] is None and m["recorded_at"]
    assert {"library_version"} <= m.keys()
    assert [s["user_id"] for s in m["speakers"]] == ["SPEAKER00", "SPEAKER01"]
    for s in m["speakers"]:
        assert s["file"] == f"{m['meeting_dir']}/{s['user_id']}_{m['session'].split('_')[-1]}.wav"
        assert (rec / s["file"]).exists() and s["duration_sec"] == pytest.approx(12.0)


def test_diarization_json_and_single_call(tmp_path):
    d, rec, path, m = _run(tmp_path)
    assert len(d.calls) == 1
    dj = json.loads((rec / m["meeting_dir"] / "diarization.json").read_text(encoding="utf-8"))
    got = [(s["start_s"], s["end_s"], s["label"]) for s in dj["segments"]]
    assert got == [(1, 3, "SPEAKER_00"), (6, 9, "SPEAKER_01")]


def test_no_segments_raises_and_writes_nothing(tmp_path):
    d = FakeDiarizer([])
    rec = tmp_path / "rec"
    with pytest.raises(ValueError):
        prepare_upload(_audio(tmp_path), rec, diarizer=d, started_at=STARTED)
    assert not rec.exists() or not list(rec.glob("session_*.json"))


def test_started_at_is_required(tmp_path):
    with pytest.raises(TypeError):
        prepare_upload(_audio(tmp_path), tmp_path / "rec", diarizer=FakeDiarizer(SEGS))


def test_same_second_does_not_overwrite(tmp_path):
    _, rec, p1, m1 = _run(tmp_path)
    p2, m2 = prepare_upload(_audio(tmp_path), rec, diarizer=FakeDiarizer(SEGS), started_at=STARTED)
    assert m1["session"] != m2["session"] and p1.exists() and p2.exists()


def test_run_session_gives_per_label_speakers_inside_segments(tmp_path):
    d, rec, path, m = _run(tmp_path)
    wavs = [rec / s["file"] for s in m["speakers"]]
    names = {s["user_id"]: s["display_name"] for s in m["speakers"]}
    run = T.run_session(wavs, names, EchoStt(), mode="chunk", model_name="echo", out_dir=tmp_path / "out")
    by = {s["display_name"]: s for s in m["speakers"]}
    for label, (a, b) in (("SPEAKER_00", (1, 3)), ("SPEAKER_01", (6, 9))):
        r = run["results"][rec / by[label]["file"]]
        assert r["speaker"] == label and r["segments"]
        assert all(a - 0.3 <= s["start"] <= b for s in r["segments"])


def test_started_at_without_timezone_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="시간대"):
        prepare_upload(_audio(tmp_path), tmp_path / "rec", diarizer=FakeDiarizer(SEGS), started_at="2026-10-31T10:00:00")
    assert not (tmp_path / "rec").exists()


def test_given_session_that_already_exists_is_rejected(tmp_path):
    _, rec, _p, m = _run(tmp_path)
    with pytest.raises(ValueError, match="이미"):
        prepare_upload(_audio(tmp_path), rec, diarizer=FakeDiarizer(SEGS), started_at=STARTED, session=m["session"])
    (rec / "upload_dir_only").mkdir()
    with pytest.raises(ValueError, match="이미"):
        prepare_upload(_audio(tmp_path), rec, diarizer=FakeDiarizer(SEGS), started_at=STARTED, session="upload_dir_only")


@pytest.mark.parametrize("bad", ["a/b", "..\\x", "../x"])
def test_given_session_with_path_separator_is_rejected(tmp_path, bad):
    with pytest.raises(ValueError, match="구분자|세션"):
        prepare_upload(_audio(tmp_path), tmp_path / "rec", diarizer=FakeDiarizer(SEGS), started_at=STARTED, session=bad)


def test_given_new_session_is_used(tmp_path):
    p, m = prepare_upload(_audio(tmp_path), tmp_path / "rec", diarizer=FakeDiarizer(SEGS), started_at=STARTED, session="upload_mine")
    assert m["session"] == "upload_mine" and p.exists()


def test_overlapping_segments_keep_both_labels_inside_end_bound(tmp_path):
    segs = [Segment(1, 5, "SPEAKER_00"), Segment(4, 8, "SPEAKER_01"), Segment(10, 99, "SPEAKER_00")]
    d, rec, path, m = _run(tmp_path, segs)
    dj = json.loads((rec / m["meeting_dir"] / "diarization.json").read_text(encoding="utf-8"))
    got = [(s["start_s"], s["end_s"], s["label"]) for s in dj["segments"]]
    assert got == [(1, 5, "SPEAKER_00"), (4, 8, "SPEAKER_01"), (10, 12, "SPEAKER_00")]
    assert all(s["end_s"] <= dj["duration_sec"] == 12.0 for s in dj["segments"])
    a = {e["user_id"]: sf.read(rec / e["file"])[0] for e in m["speakers"]}
    assert np.any(a["SPEAKER00"][int(4.2 * SR):int(4.8 * SR)] != 0) and np.any(a["SPEAKER01"][int(4.2 * SR):int(4.8 * SR)] != 0)
