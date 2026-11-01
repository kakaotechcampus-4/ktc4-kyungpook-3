from __future__ import annotations

import json

import pytest

from capture import recorder as R
from capture.recorder import STATUS_DIARIZED, STATUS_MAPPED
from stt.transcribe import parse_wav_stem
from tests.conftest import SEGS, STARTED, FakeDiarizer, _audio
from upload.mapping import apply_mapping, main
from upload.prepare import prepare_upload


def _make(tmp_path):
    rec = tmp_path / "rec"
    path, m = prepare_upload(_audio(tmp_path), rec, diarizer=FakeDiarizer(SEGS), started_at=STARTED, timezone="Asia/Seoul")
    return rec, path, m


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_label_keys_set_member_id_and_status(tmp_path):
    rec, path, before = _make(tmp_path)
    m = apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": None})
    assert m == _read(path)
    assert m["status"] == STATUS_MAPPED == "mapped" and m["mapped_at"]
    got = {s["user_id"]: s["member_id"] for s in m["speakers"]}
    assert got == {"SPEAKER00": "u-1", "SPEAKER01": None}
    for a, b in zip(before["speakers"], m["speakers"]):
        assert {k: v for k, v in b.items() if k != "member_id"} == a


def test_id_keys_give_same_result(tmp_path):
    rec, path, _ = _make(tmp_path)
    a = apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": "u-2"})
    b = apply_mapping(path, {"SPEAKER00": "u-1", "SPEAKER01": "u-2"})
    assert a["speakers"] == b["speakers"]


@pytest.mark.parametrize("mapping", [
    {"SPEAKER_00": "u-1"},                                        # 빠진 라벨
    {"SPEAKER_00": "u-1", "SPEAKER_01": "u-2", "SPEAKER_09": "x"},  # 모르는 라벨
    {"SPEAKER_00": "u-1", "SPEAKER_01": ""},                      # 빈 문자열
    {"SPEAKER_00": "u-1", "SPEAKER_01": 5},                       # 문자열 아님
])
def test_bad_mapping_raises_and_file_untouched(tmp_path, mapping):
    rec, path, _ = _make(tmp_path)
    raw = path.read_bytes()
    with pytest.raises(ValueError):
        apply_mapping(path, mapping)
    assert path.read_bytes() == raw


def test_same_member_on_two_labels_allowed(tmp_path):
    rec, path, _ = _make(tmp_path)
    m = apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": "u-1"})
    assert [s["member_id"] for s in m["speakers"]] == ["u-1", "u-1"]


def test_remap_from_mapped_overwrites(tmp_path):
    rec, path, _ = _make(tmp_path)
    apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": "u-2"})
    m = apply_mapping(path, {"SPEAKER_00": "u-9", "SPEAKER_01": None})
    assert [s["member_id"] for s in m["speakers"]] == ["u-9", None] and m["status"] == STATUS_MAPPED


@pytest.mark.parametrize("status", ["saved", "recording", "transcribed", "failed"])
def test_wrong_status_rejected(tmp_path, status):
    rec, path, m = _make(tmp_path)
    m["status"] = status
    R.save_manifest(path, m)
    raw = path.read_bytes()
    with pytest.raises(ValueError):
        apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": "u-2"})
    assert path.read_bytes() == raw


def test_non_upload_rejected(tmp_path):
    rec, path, m = _make(tmp_path)
    m["source"] = "discord"
    R.save_manifest(path, m)
    raw = path.read_bytes()
    with pytest.raises(ValueError):
        apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": "u-2"})
    assert path.read_bytes() == raw


def test_locked_manifest_rejected(tmp_path):
    rec, path, _ = _make(tmp_path)
    lock = R.try_lock(path)
    try:
        raw = path.read_bytes()
        with pytest.raises(ValueError):
            apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": "u-2"})
        assert path.read_bytes() == raw
    finally:
        lock.release()
    apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": "u-2"})   # 놓으면 된다


def test_wav_ids_unchanged_after_mapping(tmp_path):
    rec, path, before = _make(tmp_path)
    m = apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": None})
    for a, b in zip(before["speakers"], m["speakers"]):
        assert b["file"] == a["file"] and (rec / b["file"]).exists()
        stem = b["file"].rsplit("/", 1)[-1][:-4]
        assert parse_wav_stem(stem)[0] == a["user_id"]


def test_cli_both_json_shapes(tmp_path, capsys):
    rec, path, _ = _make(tmp_path)
    mp = tmp_path / "m.json"
    mp.write_text(json.dumps({"mapping": {"SPEAKER_00": "u-1", "SPEAKER_01": None}}), encoding="utf-8")
    assert main([str(path), str(mp)]) == 0
    assert [s["member_id"] for s in _read(path)["speakers"]] == ["u-1", None]
    mp.write_text(json.dumps({"SPEAKER00": "u-3", "SPEAKER01": "u-4"}), encoding="utf-8")
    assert main([str(path), str(mp)]) == 0
    assert [s["member_id"] for s in _read(path)["speakers"]] == ["u-3", "u-4"]
    assert "mapped" in capsys.readouterr().out


def test_cli_error_returns_nonzero_and_keeps_file(tmp_path, capsys):
    rec, path, _ = _make(tmp_path)
    raw = path.read_bytes()
    mp = tmp_path / "m.json"
    mp.write_text(json.dumps({"SPEAKER_00": "u-1"}), encoding="utf-8")
    assert main([str(path), str(mp)]) != 0
    assert path.read_bytes() == raw and capsys.readouterr().err
