"""심사용 시드 데이터(app/cli/demo_seed/meetings.json)와 로더(#606)."""
import json

import pytest

from app.cli.demo_seed import DEFAULT_DATA_PATH, SeedDataError, load_seed_data


def test_default_data_loads_and_has_required_shape():
    data = load_seed_data()
    assert [p.key for p in data.people] == ["p1", "p2", "p3", "p4", "p5", "p6"]
    assert len(data.meetings) >= 5
    assert len({m.title for m in data.meetings}) == len(data.meetings)
    assert all(m.items and m.summary.get("overview") for m in data.meetings)
    assert data.asr_terms and all(1 <= len(t.strip()) <= 30 for t in data.asr_terms)
    assert len(set(data.asr_terms)) == len(data.asr_terms)
    days = [m.days_ago for m in data.meetings]
    assert len(set(days)) == len(days) and all(1 <= d <= 30 for d in days)


def test_items_reference_existing_turns_and_people():
    data = load_seed_data()
    keys = {p.key for p in data.people}
    for m in data.meetings:
        assert {t.speaker for t in m.turns} <= keys
        for item in m.items:
            assert all(0 <= s < len(m.turns) for s in item["evidence_seqs"])
            assert item.get("speaker_key") is None or item["speaker_key"] in keys
            assert "evidence_speaker" not in item and "due_date" not in item


def test_first_item_of_each_meeting_is_auto_shaped_and_review_hold_exist():
    data = load_seed_data()
    keys = {p.key for p in data.people}
    for m in data.meetings:
        first = m.items[0]
        assert first["task_status"] == "certain" and first["similar_count"] == 0
        assert first["due_status"] in ("certain", "missing")
        assert first["assignee_type"] == "first" and first["asr_suspects"] == []
        assert first["speaker_key"] in keys
    rest = [i for m in data.meetings for i in m.items[1:]]
    assert any(i["task_status"] == "inferred" or i["assignee_type"] == "thirdrole" for i in rest)
    holds = [i for i in rest if i["assignee_type"] == "thirdname"]
    names = {p.name for p in data.people}
    stems = {n[1:] for n in names}
    assert any(
        not any(n in i["assignee_raw"] for n in names | stems) for i in holds
    )


def _write_variant(tmp_path, mutate):
    raw = json.loads(DEFAULT_DATA_PATH.read_text(encoding="utf-8"))
    mutate(raw)
    path = tmp_path / "meetings.json"
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    return path


def _seq_out_of_range(raw):
    raw["meetings"][0]["items"][0]["evidence_seqs"] = [999]


def _unknown_speaker(raw):
    raw["meetings"][0]["turns"][0]["speaker"] = "p99"


def _unknown_speaker_key(raw):
    raw["meetings"][0]["items"][0]["speaker_key"] = "p99"


def _duplicate_days(raw):
    raw["meetings"][1]["days_ago"] = raw["meetings"][0]["days_ago"]


@pytest.mark.parametrize(
    "mutate", [_seq_out_of_range, _unknown_speaker, _unknown_speaker_key, _duplicate_days]
)
def test_bad_reference_is_rejected(tmp_path, mutate):
    path = _write_variant(tmp_path, mutate)
    with pytest.raises(SeedDataError):
        load_seed_data(path)


def test_error_message_names_the_meeting(tmp_path):
    path = _write_variant(tmp_path, _seq_out_of_range)
    title = json.loads(path.read_text(encoding="utf-8"))["meetings"][0]["title"]
    with pytest.raises(SeedDataError, match=title):
        load_seed_data(path)
