"""녹음 올리기 대기 폴더(#659). 매니페스트와 따로 recordings/audio_outbox 에 <회의ID>.m4a·.json 을 두고 BE 로 올린다."""

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import soundfile as sf

from capture import audio_outbox as O
from capture.handoff import BeError, MeetingEnded

NOW = datetime(2026, 11, 20, 3, 0, 0, tzinfo=timezone.utc)


def _track(path, seconds=0.5):
    path.parent.mkdir(parents=True, exist_ok=True)
    t = np.arange(int(seconds * 16000)) / 16000
    sf.write(str(path), (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), 16000, subtype="PCM_16")
    return path


class Client:
    def __init__(self, errors=None):
        self.errors = errors or {}
        self.calls = []

    def upload_recording(self, meeting_id, path):
        self.calls.append((meeting_id, path.read_bytes()[4:8]))
        err = self.errors.get(meeting_id)
        if err:
            raise err
        return {"meeting_id": meeting_id, "size_bytes": 1, "expires_at": "x", "stored": True}


def _enqueue(rec, meeting_id="m1", *, workspace="w1", handed=NOW - timedelta(hours=1)):
    return O.enqueue(rec, meeting_id=meeting_id, workspace_id=workspace, handed_off_at=handed,
                     tracks=[_track(rec / "s" / f"{meeting_id}.wav")])


def _entries(rec):
    return sorted(p.name for p in (rec / "audio_outbox").glob("*")) if (rec / "audio_outbox").exists() else []


def test_enqueue_writes_m4a_and_meta(tmp_path):
    rec = tmp_path / "rec"
    path = _enqueue(rec)
    assert path == rec / "audio_outbox" / "m1.m4a"
    assert path.read_bytes()[4:8] == b"ftyp"
    meta = json.loads((rec / "audio_outbox" / "m1.json").read_text(encoding="utf-8"))
    assert meta == {"meeting_id": "m1", "workspace_id": "w1", "handed_off_at": (NOW - timedelta(hours=1)).isoformat()}
    assert O.has(rec, "m1") and not O.has(rec, "m2")
    assert _entries(rec) == ["m1.json", "m1.m4a"]


def test_enqueue_twice_keeps_the_first_entry(tmp_path):
    rec = tmp_path / "rec"
    first = _enqueue(rec)
    stamp = first.stat().st_mtime_ns
    assert _enqueue(rec, workspace="other") == first
    assert first.stat().st_mtime_ns == stamp
    assert json.loads((rec / "audio_outbox" / "m1.json").read_text(encoding="utf-8"))["workspace_id"] == "w1"


def test_enqueue_failure_leaves_no_entry(tmp_path):
    rec = tmp_path / "rec"
    bad = tmp_path / "rec" / "s" / "bad.wav"
    bad.parent.mkdir(parents=True)
    bad.write_bytes(b"not a wav")
    with pytest.raises(Exception):
        O.enqueue(rec, meeting_id="m1", workspace_id="w1", handed_off_at=NOW, tracks=[bad])
    assert not O.has(rec, "m1")
    assert _entries(rec) == []


@pytest.mark.parametrize("bad", ["../x", "a/b", "", ".", "..", "a\\b", "a:b"])
def test_rejects_unsafe_meeting_id(tmp_path, bad):
    rec = tmp_path / "rec"
    with pytest.raises(ValueError):
        O.enqueue(rec, meeting_id=bad, workspace_id="w1", handed_off_at=NOW, tracks=[_track(tmp_path / "t.wav")])
    with pytest.raises(ValueError):
        O.remove_meeting(rec, bad)
    assert not (tmp_path / "x.m4a").exists()


def test_drain_uploads_and_deletes(tmp_path):
    rec = tmp_path / "rec"
    _enqueue(rec)
    client = Client()
    assert O.drain(rec, client, now=NOW) == ["m1"]
    assert client.calls == [("m1", b"ftyp")]
    assert _entries(rec) == []


def test_drain_deletes_even_when_be_says_not_stored(tmp_path):
    rec = tmp_path / "rec"
    _enqueue(rec)
    client = Client()
    client.upload_recording = lambda meeting_id, path: {"meeting_id": meeting_id, "stored": False}
    assert O.drain(rec, client, now=NOW) == ["m1"]
    assert _entries(rec) == []


def test_drain_keeps_on_network_error(tmp_path):
    rec = tmp_path / "rec"
    _enqueue(rec)
    assert O.drain(rec, Client({"m1": BeError("NETWORK", "down")}), now=NOW) == []
    assert _entries(rec) == ["m1.json", "m1.m4a"]
    assert O.drain(rec, Client({"m1": BeError("HTTP_502", "bad gateway", status=502)}), now=NOW) == []
    assert _entries(rec) == ["m1.json", "m1.m4a"]
    assert O.drain(rec, Client(), now=NOW) == ["m1"]


def test_drain_keeps_on_upload_failure_that_may_pass_later(tmp_path):
    rec = tmp_path / "rec"
    _enqueue(rec)
    assert O.drain(rec, Client({"m1": BeError("AUDIO_UPLOAD_FAILED", "s3", status=422)}), now=NOW) == []
    assert O.has(rec, "m1")


@pytest.mark.parametrize("error", [MeetingEnded("MEETING_DELETED", "gone", status=410),
                                   BeError("MEETING_NOT_FOUND", "x", status=404),
                                   BeError("INVALID_REQUEST", "x", status=400),
                                   BeError("AUDIO_FORMAT_UNSUPPORTED", "x", status=422),
                                   BeError("AUDIO_TOO_LARGE", "x", status=413)])
def test_drain_deletes_when_retrying_cannot_help(tmp_path, error):
    rec = tmp_path / "rec"
    _enqueue(rec)
    assert O.drain(rec, Client({"m1": error}), now=NOW) == ["m1"]
    assert _entries(rec) == []


def test_drain_gives_up_after_7_days(tmp_path):
    rec = tmp_path / "rec"
    _enqueue(rec, "old", handed=NOW - timedelta(seconds=O.OUTBOX_KEEP_S))
    _enqueue(rec, "new", handed=NOW - timedelta(seconds=O.OUTBOX_KEEP_S) + timedelta(minutes=1))
    client = Client()
    assert O.drain(rec, client, now=NOW) == ["new", "old"]
    assert [c[0] for c in client.calls] == ["new"]   # 포기한 항목은 BE 를 부르지 않는다
    assert _entries(rec) == []


def test_one_failure_does_not_block_others(tmp_path):
    rec = tmp_path / "rec"
    for mid in ("a", "b", "c"):
        _enqueue(rec, mid)
    client = Client({"a": RuntimeError("boom")})
    assert O.drain(rec, client, now=NOW) == ["b", "c"]
    assert O.has(rec, "a") and not O.has(rec, "b")


def test_drain_drops_entry_whose_audio_file_is_gone(tmp_path):
    rec = tmp_path / "rec"
    _enqueue(rec)
    (rec / "audio_outbox" / "m1.m4a").unlink()
    client = Client()
    assert O.drain(rec, client, now=NOW) == ["m1"]
    assert client.calls == [] and _entries(rec) == []


def test_drain_skips_broken_meta(tmp_path):
    rec = tmp_path / "rec"
    _enqueue(rec, "ok")
    (rec / "audio_outbox" / "broken.json").write_text("{", encoding="utf-8")
    assert O.drain(rec, Client(), now=datetime.now(timezone.utc)) == ["ok"]   # 방금 쓴 깨진 항목은 7일 전까지 둔다
    assert (rec / "audio_outbox" / "broken.json").exists()


def test_drain_removes_unreadable_entries_after_7_days(tmp_path):
    """깨진 meta 나 이름이 다른 meta 는 시각을 알 수 없어 건너뛰지만, 파일이 7일 넘게 묵으면 m4a 와 함께 지운다."""
    import os
    rec = tmp_path / "rec"
    box = rec / "audio_outbox"
    box.mkdir(parents=True)
    for name, text in (("broken", "{"), ("renamed", json.dumps({"meeting_id": "other", "handed_off_at": NOW.isoformat()}))):
        (box / f"{name}.json").write_text(text, encoding="utf-8")
        (box / f"{name}.m4a").write_bytes(b"x")
    fresh = NOW.timestamp() - O.OUTBOX_KEEP_S + 60
    for name in ("broken", "renamed"):
        os.utime(box / f"{name}.json", (fresh, fresh))
    assert O.drain(rec, Client(), now=NOW) == []
    assert _entries(rec) == ["broken.json", "broken.m4a", "renamed.json", "renamed.m4a"]
    stale = NOW.timestamp() - O.OUTBOX_KEEP_S
    os.utime(box / "broken.json", (stale, stale))
    os.utime(box / "renamed.json", (stale, stale))
    assert O.drain(rec, Client(), now=NOW) == ["broken", "renamed"]
    assert _entries(rec) == []


def test_drain_of_missing_folder_is_empty(tmp_path):
    assert O.drain(tmp_path / "none", Client(), now=NOW) == []


def test_remove_workspace_only_that_workspace(tmp_path):
    rec = tmp_path / "rec"
    _enqueue(rec, "a", workspace="w1")
    _enqueue(rec, "b", workspace="w2")
    _enqueue(rec, "c", workspace="w1")
    assert O.remove_workspace(rec, "w1") == ["a", "c"]
    assert _entries(rec) == ["b.json", "b.m4a"]


def test_remove_meeting_removes_both_files_and_is_idempotent(tmp_path):
    rec = tmp_path / "rec"
    _enqueue(rec)
    O.remove_meeting(rec, "m1")
    O.remove_meeting(rec, "m1")
    assert _entries(rec) == []
