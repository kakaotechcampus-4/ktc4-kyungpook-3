import json

from stt.latency import format_summary, snapshot, summarize, write_latency
from stt.session import Line


def L(seq, start, queue_s=None, transcribe_s=None, publish_s=None, final=True, speaker="1"):
    ln = Line(speaker, "김환", f"t{seq}", seq, start, start + 1_000, f"발화{seq}", final)
    ln.queue_s, ln.transcribe_s, ln.publish_s = queue_s, transcribe_s, publish_s
    return ln


def test_summary_reports_median_and_max_per_stage():
    lines = [
        L(1, 0, queue_s=0.10, transcribe_s=1.0, publish_s=0.30),
        L(2, 2_000, queue_s=0.20, transcribe_s=2.0, publish_s=0.40),
        L(3, 4_000, queue_s=0.90, transcribe_s=9.0, publish_s=0.50),
    ]
    stats = summarize(snapshot(lines))
    assert stats["queue"] == {"n": 3, "median_s": 0.20, "max_s": 0.90}
    assert stats["transcribe"]["median_s"] == 2.0 and stats["transcribe"]["max_s"] == 9.0

    out = format_summary(snapshot(lines))
    assert "큐 0.20/0.90초" in out
    assert "전사 2.00/9.00초" in out
    assert "게시 0.40/0.50초" in out


def test_average_would_hide_the_slow_call():
    """중앙값과 최대를 같이 내는 이유. 평균 하나였다면 둘 다 3.67 로 같아진다."""
    one_slow = [L(1, 0, transcribe_s=1.0), L(2, 0, transcribe_s=1.0), L(3, 0, transcribe_s=9.0)]
    all_middling = [L(1, 0, transcribe_s=3.0), L(2, 0, transcribe_s=4.0), L(3, 0, transcribe_s=4.0)]
    assert format_summary(snapshot(one_slow)) != format_summary(snapshot(all_middling))


def test_unmeasured_stage_says_so_instead_of_zero():
    """0 은 "즉시" 로 읽힌다. 못 잰 것은 못 쟀다고 적어야 한다."""
    out = format_summary(snapshot([L(1, 0, queue_s=0.1, transcribe_s=1.0, publish_s=None)]))
    assert "게시 미측정" in out
    assert "게시 0.00" not in out


def test_partially_measured_stage_shows_how_many():
    lines = [
        L(1, 0, queue_s=0.1, transcribe_s=1.0, publish_s=0.2),
        L(2, 2_000, queue_s=0.1, transcribe_s=1.0, publish_s=None),
    ]
    out = format_summary(snapshot(lines))
    assert "게시 0.20/0.20초 (2건 중 1건)" in out
    assert "큐 0.10/0.10초 ·" in out or out.endswith("큐 0.10/0.10초")


def test_no_utterances_says_so():
    assert format_summary(snapshot([])) == "지연 미측정 (확정된 발화 없음)"


def test_partial_lines_are_excluded():
    lines = [L(1, 0, transcribe_s=9.0, final=False), L(2, 0, transcribe_s=1.0)]
    assert summarize(snapshot(lines))["transcribe"] == {"n": 1, "median_s": 1.0, "max_s": 1.0}


def test_writes_one_row_per_final_line_in_transcript_order(tmp_path):
    lines = [
        L(2, 5_000, queue_s=0.2, transcribe_s=2.0, publish_s=0.5, speaker="2"),
        L(1, 0, queue_s=0.1, transcribe_s=1.0, publish_s=0.3, speaker="1"),
        L(3, 9_000, queue_s=0.3, transcribe_s=3.0, publish_s=0.7, final=False),
    ]
    path = write_latency(snapshot(lines), tmp_path)
    rows = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]

    assert path.name == "latency.jsonl"
    assert [r["seq"] for r in rows] == [1, 2]
    assert rows[0] == {"seq": 1, "speaker": "1", "start": 0.0, "end": 1.0,
                       "queue_s": 0.1, "transcribe_s": 1.0, "publish_s": 0.3}


def test_unmeasured_values_are_written_as_null(tmp_path):
    """0 을 쓰면 나중에 이 파일을 읽는 쪽이 즉시 게시된 것으로 읽는다."""
    path = write_latency(snapshot([L(1, 0, queue_s=0.1, transcribe_s=1.0, publish_s=None)]), tmp_path)
    row = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
    assert row["publish_s"] is None
    assert '"publish_s": null' in path.read_text(encoding="utf-8")


def test_writes_an_empty_file_when_nothing_was_said(tmp_path):
    """무음으로 끝난 회의도 파일은 남는다. 매니페스트와 같은 규칙이다."""
    path = write_latency(snapshot([]), tmp_path)
    assert path.exists() and path.read_text(encoding="utf-8") == ""


def test_snapshot_does_not_follow_later_publisher_updates(tmp_path):
    """스냅샷을 뜬 뒤에 게시기가 값을 채워도 파일과 요약이 같은 값을 말해야 한다.

    종료 경로는 스냅샷과 요약 사이에서 여러 번 await 한다 (트랙 닫기, 매니페스트,
    회의록). 그동안 게시 태스크는 계속 돌면서 같은 Line 객체의 publish_s 를 채운다.
    줄을 그대로 들고 다니면 파일에는 null 이, 바로 다음 줄의 요약에는 수치가 찍힌다.
    """
    ln = L(1, 0, queue_s=0.1, transcribe_s=1.0, publish_s=None)
    rows = snapshot([ln])
    ln.publish_s = 0.9                      # 게시기가 뒤늦게 채운다

    path = write_latency(rows, tmp_path)
    row = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
    assert row["publish_s"] is None
    assert "게시 미측정" in format_summary(rows)
