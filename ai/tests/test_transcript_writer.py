import json

from stt.session import Line
from stt.transcript_writer import write_transcript


def L(speaker, name, turn, seq, start, end, text):
    return Line(speaker, name, turn, seq, start, end, text, True)


def test_writes_jsonl_and_markdown(tmp_path):
    lines = [
        L("1", "김환", "t1", 1, 0, 2_000, "안녕하세요"),
        L("2", "유재환", "t2", 1, 2_500, 4_000, "네 반갑습니다"),
    ]
    out = write_transcript(lines, tmp_path, meeting_id="m1")
    assert out["jsonl"].exists() and out["markdown"].exists()

    rows = [json.loads(x) for x in out["jsonl"].read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 2
    assert rows[0]["speaker"] == "1"
    assert rows[0]["seq"] == 1
    assert rows[0]["start"] == 0.0
    assert rows[0]["end"] == 2.0


def test_markdown_is_time_ordered(tmp_path):
    lines = [
        L("2", "유재환", "t2", 1, 5_000, 6_000, "나중"),
        L("1", "김환", "t1", 1, 0, 1_000, "먼저"),
    ]
    out = write_transcript(lines, tmp_path, meeting_id="m1")
    md = out["markdown"].read_text(encoding="utf-8")
    assert md.index("먼저") < md.index("나중")


def test_markdown_has_per_speaker_section(tmp_path):
    lines = [
        L("1", "김환", "t1", 1, 0, 1_000, "가"),
        L("2", "유재환", "t2", 1, 2_000, 3_000, "나"),
        L("1", "김환", "t3", 2, 4_000, 5_000, "다"),
    ]
    out = write_transcript(lines, tmp_path, meeting_id="m1")
    md = out["markdown"].read_text(encoding="utf-8")
    assert "## 화자별" in md
    kim = md.split("김환")[-1]
    assert "가" in kim and "다" in kim


def test_partial_lines_are_excluded(tmp_path):
    lines = [
        Line("1", "김환", "t1", 1, 0, 1_000, "부분", False),
        Line("1", "김환", "t1", 1, 0, 2_000, "최종", True),
    ]
    out = write_transcript(lines, tmp_path, meeting_id="m1")
    rows = out["jsonl"].read_text(encoding="utf-8").strip().splitlines()
    assert len(rows) == 1
    assert "최종" in rows[0]
