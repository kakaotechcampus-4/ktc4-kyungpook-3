from __future__ import annotations

import json

import pytest

from capture import recorder as R
from capture.recorder import STATUS_DIARIZED, STATUS_MAPPED
from stt.transcribe import parse_wav_stem
from tests.conftest import SEGS, STARTED, FakeDiarizer, _audio
from upload.mapping import MappingBusy, apply_mapping, main
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
        with pytest.raises(MappingBusy):
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


def test_keys_duplicating_after_normalization_rejected(tmp_path):
    rec, path, _ = _make(tmp_path)
    raw = path.read_bytes()
    with pytest.raises(ValueError):
        apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER00": "u-2", "SPEAKER_01": "u-3"})
    assert path.read_bytes() == raw


@pytest.mark.parametrize("member", ["   ", " u-1 ", "u-1 ", "\tu-1"])
def test_blank_or_padded_member_id_rejected(tmp_path, member):
    rec, path, _ = _make(tmp_path)
    raw = path.read_bytes()
    with pytest.raises(ValueError):
        apply_mapping(path, {"SPEAKER_00": member, "SPEAKER_01": None})
    assert path.read_bytes() == raw


def test_mapped_at_is_tz_aware_iso_and_refreshed_on_remap(tmp_path):
    from datetime import datetime
    rec, path, _ = _make(tmp_path)
    first = apply_mapping(path, {"SPEAKER_00": "u-1", "SPEAKER_01": None})["mapped_at"]
    assert datetime.fromisoformat(first).tzinfo is not None
    import time
    time.sleep(1.1)
    second = apply_mapping(path, {"SPEAKER_00": "u-2", "SPEAKER_01": None})["mapped_at"]
    assert datetime.fromisoformat(second).tzinfo is not None
    assert datetime.fromisoformat(second) > datetime.fromisoformat(first)


@pytest.mark.parametrize("bad", [[], "x", {"source": "upload", "status": "diarized", "speakers": "abc"},
                                 {"source": "upload", "status": "diarized", "speakers": [{"file": "a"}]},
                                 {"source": "upload", "status": "diarized", "speakers": ["SPEAKER00"]}])
def test_malformed_manifest_raises_valueerror(tmp_path, bad):
    rec, path, _ = _make(tmp_path)
    path.write_text(json.dumps(bad), encoding="utf-8")
    raw = path.read_bytes()
    with pytest.raises(ValueError):
        apply_mapping(path, {"SPEAKER_00": "u-1"})
    assert path.read_bytes() == raw


def test_cli_malformed_manifest_returns_one_without_traceback(tmp_path, capsys):
    rec, path, _ = _make(tmp_path)
    path.write_text("[]", encoding="utf-8")
    mp = tmp_path / "m.json"
    mp.write_text(json.dumps({"SPEAKER_00": "u-1"}), encoding="utf-8")
    assert main([str(path), str(mp)]) == 1
    assert "Traceback" not in capsys.readouterr().err


def test_missing_manifest_raises_without_creating_lock_or_dir(tmp_path):
    path = tmp_path / "nope" / "session_upload_x.json"
    with pytest.raises(ValueError):
        apply_mapping(path, {"SPEAKER_00": "u-1"})
    assert not (tmp_path / "nope").exists()
    assert main([str(path), str(tmp_path / "m.json")]) == 1
    assert not (tmp_path / "nope").exists()


def test_mapping_busy_is_a_value_error_only_for_lock_contention(tmp_path):
    assert issubclass(MappingBusy, ValueError)
    rec, path, _ = _make(tmp_path)
    with pytest.raises(ValueError) as e:
        apply_mapping(path, {"SPEAKER_00": "u-1"})
    assert not isinstance(e.value, MappingBusy)


def test_cli_output_does_not_claim_the_worker_ignores_uploads(tmp_path, capsys):
    """mapped 업로드는 워커의 처리 바퀴가 전사·인계까지 한다(#286). '워커가 처리하지 않는다'·'#286 에서 한다' 는 오래된 말을 하지 않는다."""
    rec, path, _ = _make(tmp_path)
    mp = tmp_path / "m.json"
    mp.write_text(json.dumps({"SPEAKER_00": "u-1", "SPEAKER_01": None}), encoding="utf-8")
    assert main([str(path), str(mp)]) == 0
    out = capsys.readouterr().out
    assert "아직 집지" not in out and "#254" not in out and "#286" not in out
    assert "처리하지 않는다" not in out and "처리 바퀴" in out
