"""BE 인계(capture/handoff.py). 가짜 BE 로 호출 순서, 본문, 멱등, 실패 통보를 본다. 실제 서버는 안 쓴다."""

import json

import pytest

from capture import handoff as H
from tests.capture.fake_be import FakeBe

TRANSCRIPT = {
    "speakers": {"101": "민수", "103": "재환"},
    "segments": [
        {"speaker": "101", "start": 3.0, "end": 5.0, "text": "와이어프레임은 누가 하죠?", "seq": 1},
        {"speaker": "103", "start": 12.0, "end": 14.5, "text": "제가 할게요. 금요일까지요", "seq": 2},
        {"speaker": "101", "start": 20.0, "end": 21.0, "text": "네", "seq": 3},
        {"speaker": "103", "start": 25.0, "end": 26.0, "text": "네", "seq": 4},
    ],
}


def _task(**over):
    base = {"task": "와이어프레임 그리기", "assignee_member_id": None, "due_date": "2026-09-25", "confidence": 0.9,
            "assignee_mention": None, "source_sentence": "제가 할게요.", "method": "llm", "assignee_type": "first",
            "assignee_resolved": None, "due_raw": "금요일까지", "task_status": "certain",
            "assignee_status": "certain", "due_status": "certain"}
    base.update(over)
    return base


def _manifest(tmp_path, *, with_tasks=True, be=None):
    tdir = tmp_path / "transcripts"
    tdir.mkdir(exist_ok=True)
    (tdir / "session_500.transcript.json").write_text(json.dumps(TRANSCRIPT, ensure_ascii=False), encoding="utf-8")
    m = {"session": "500", "channel": "회의방", "started_at": "2026-09-19T05:00:00+00:00", "timezone": "Asia/Seoul",
         "speakers": [{"user_id": "101", "display_name": "민수"}, {"user_id": "103", "display_name": "재환"}]}
    if with_tasks:
        (tdir / "session_500.tasks.json").write_text(json.dumps([_task()], ensure_ascii=False), encoding="utf-8")
        m["tasks"] = str(tdir / "session_500.tasks.json")
    if be is not None:
        m["be"] = be
    return m, tdir


def _handoff(fake):
    return H.Handoff(H.BeClient("http://be.local/", session=fake), "ws-1")


def test_first_person_item_carries_the_speaker_uid_and_time():
    items = H.to_extraction_items([_task()], TRANSCRIPT)
    it = items[0]
    assert it["evidence_speaker"] == "103" and it["evidence_at_ms"] == 12000      # 그 문장을 말한 트랙
    assert it["assignee_raw"] is None and it["assignee_type"] == "first"          # 1인칭은 별칭 텍스트가 없다
    assert it["task_title"] == "와이어프레임 그리기" and it["task_confidence"] == 0.9
    assert it["due_date"] == "2026-09-25" and it["due_raw"] == "금요일까지" and it["due_confidence"] == 1.0
    assert it["evidence_quote"] == "제가 할게요."


def test_resolved_name_goes_to_assignee_raw_and_missing_due_is_zero():
    t = _task(assignee_type="second", assignee_mention="네가", assignee_resolved="민수", due_raw=None,
              due_date=None, due_status="missing", source_sentence="와이어프레임은 누가 하죠")
    it = H.to_extraction_items([t], TRANSCRIPT)[0]
    assert it["assignee_raw"] == "민수" and it["evidence_speaker"] == "101"
    assert it["due_confidence"] == 0.0 and it["due_raw"] is None


def test_sentence_said_by_two_speakers_leaves_the_speaker_empty():
    it = H.to_extraction_items([_task(source_sentence="네")], TRANSCRIPT)[0]
    assert it["evidence_speaker"] is None and it["evidence_at_ms"] is None      # PM 확인으로 간다
    assert H.to_extraction_items([_task(source_sentence="")], TRANSCRIPT)[0]["evidence_speaker"] is None


def test_register_calls_create_end_extraction_in_order(tmp_path):
    fake = FakeBe()
    m, tdir = _manifest(tmp_path)
    be = _handoff(fake).register(m, transcripts_dir=tdir, model_name="turbo+sonnet", title="회의방 2026-09-19")
    assert [(c[0], c[1]) for c in fake.calls] == [("POST", "/meetings"), ("PATCH", "/meetings/m1/end"),
                                                   ("POST", "/extractions")]
    assert fake.calls[0][2] == {"workspace_id": "ws-1", "title": "회의방 2026-09-19", "source": "discord"}
    sent = fake.calls[2][2]
    assert sent["meeting_id"] == "m1" and sent["workspace_id"] == "ws-1" and sent["model_name"] == "turbo+sonnet"
    assert sent["items"][0]["evidence_speaker"] == "103"
    assert be == m["be"] and be["meeting_id"] == "m1" and be["status"] == "done" and be["extraction_id"] == "e-m1"
    assert fake.meetings["m1"]["status"] == "done"


def test_start_at_record_is_reused_and_already_ended_is_not_an_error(tmp_path):
    fake = FakeBe()
    h = _handoff(fake)
    m, tdir = _manifest(tmp_path)
    h.start(m, title="회의방 2026-09-19")            # /record 시점
    h.end(m)                                        # /stop 시점
    fake.calls.clear()
    h.register(m, transcripts_dir=tdir, model_name="x")   # 인계 단계. end 를 다시 부르지 않는다
    assert [(c[0], c[1]) for c in fake.calls] == [("POST", "/extractions")]
    # 복구가 한 번 더 보내도 BE 가 기존 것을 돌려주고 회의는 하나다
    again = h.register(m, transcripts_dir=tdir, model_name="x")
    assert again["extraction_id"] == "e-m1" and len(fake.meetings) == 1


def test_end_twice_tolerates_409_and_keeps_the_meeting(tmp_path):
    fake = FakeBe()
    h = _handoff(fake)
    m, tdir = _manifest(tmp_path)
    h.end(m)
    m["be"]["status"] = "created"                 # 매니페스트가 옛 상태로 남았다고 치자 (저장 전에 죽음)
    assert h.end(m)["status"] == "processing" and len(fake.meetings) == 1


def test_meeting_be_marked_failed_is_replaced_on_recovery(tmp_path):
    fake = FakeBe()
    h = _handoff(fake)
    m, tdir = _manifest(tmp_path)
    h.end(m)
    h.fail(m, "stt")                              # 전사 실패를 알렸다. BE 에서는 끝 상태다
    assert fake.meetings["m1"]["status"] == "failed" and m["be"]["failed_stage"] == "stt"
    be = h.register(m, transcripts_dir=tdir, model_name="x")   # 복구가 성공해 넘긴다
    assert be["meeting_id"] == "m2" and be["replaced"] == ["m1"] and be["status"] == "done"
    assert fake.meetings["m2"]["status"] == "done"


def test_fail_without_meeting_or_with_be_down_is_quiet(tmp_path):
    fake = FakeBe()
    h = _handoff(fake)
    m, _ = _manifest(tmp_path, with_tasks=False)
    h.fail(m, "stt")                              # BE 회의가 없다
    assert fake.calls == []
    h.start(m)
    fake.down = True
    h.fail(m, "extract")                          # BE 가 꺼져 있다. 예외 대신 기록만
    assert "error" in m["be"] and "ConnectionError" in m["be"]["error"]


def test_register_without_tasks_refuses(tmp_path):
    m, tdir = _manifest(tmp_path, with_tasks=False)
    with pytest.raises(ValueError):
        _handoff(FakeBe()).register(m, transcripts_dir=tdir, model_name="x")


def test_client_turns_error_envelopes_and_bad_bodies_into_be_error():
    fake = FakeBe()
    c = H.BeClient("http://be.local", session=fake)
    with pytest.raises(H.BeError) as e:
        c.create_extraction("nope", "ws-1", transcript_path=None, model_name=None, items=[])
    assert e.value.code == "MEETING_NOT_FOUND" and e.value.status == 404
    with pytest.raises(H.BeError) as e2:
        c._call("GET", "/nothing")
    assert e2.value.code == "HTTP_404"
    fake.down = True
    with pytest.raises(H.BeError) as e3:
        c.create_meeting("ws-1")
    assert e3.value.code == "NETWORK"


def test_from_env_needs_both_settings(monkeypatch):
    from shared import config

    monkeypatch.setattr(config, "settings", lambda: type("S", (), {"be_base_url": "", "be_workspace_id": "ws"})())
    assert H.from_env() is None
    monkeypatch.setattr(config, "settings", lambda: type("S", (), {"be_base_url": "http://be", "be_workspace_id": "ws"})())
    h = H.from_env()
    assert h is not None and h.workspace_id == "ws" and h.client.api == "http://be/api/v1"
