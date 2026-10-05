"""BE 인계(capture/handoff.py). 가짜 BE 로 호출 순서, 본문, 멱등, 실패 통보를 본다. 실제 서버는 안 쓴다."""

import json
from pathlib import Path

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
    base = {"task": "와이어프레임 그리기", "assignee_member_id": None, "due_date": "2026-09-25",
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
    assert it["task_title"] == "와이어프레임 그리기" and it["task_confidence"] == 1.0
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
    assert "failed_stage" not in be and be["extraction_id"] == "e-m2"     # 옛 회의의 실패 표시는 따라오지 않는다
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


def test_fail_after_be_closed_the_meeting_as_done_keeps_done(tmp_path):
    fake = FakeBe()
    h = _handoff(fake)
    m, tdir = _manifest(tmp_path)
    h.register(m, transcripts_dir=tdir, model_name="x")       # BE 는 done
    h.fail(m, "handoff")                                       # 뒤늦은 실패 통보. BE 는 409 로 done 을 알려 준다
    assert m["be"]["status"] == "done" and "failed_stage" not in m["be"]
    assert fake.meetings["m1"]["status"] == "done"


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


def test_unresolved_second_person_and_pronouns_are_not_sent_as_aliases():
    """"네가", "그분", "백엔드 리더" 는 별칭이 아니다. 이름으로 풀리지 않았으면 BE 에 조회를 시키지 않는다."""
    for kind, mention in (("second", "네가"), ("thirdpronoun", "그분이"), ("thirdrole", "백엔드 리더가")):
        t = _task(assignee_type=kind, assignee_mention=mention, assignee_resolved=None)
        assert H.to_extraction_items([t], TRANSCRIPT)[0]["assignee_raw"] is None, kind
    t = _task(assignee_type="thirdname", assignee_mention="민수", assignee_resolved=None)
    assert H.to_extraction_items([t], TRANSCRIPT)[0]["assignee_raw"] == "민수"


def test_register_marks_a_partial_meeting_in_the_be_record(tmp_path):
    fake = FakeBe()
    m, tdir = _manifest(tmp_path)
    m["partial"] = True
    m["failed_units"] = [{"speaker": "101", "start_ms": 0, "end_ms": 2000, "error": "x"}]
    be = _handoff(fake).register(m, transcripts_dir=tdir, model_name="x")
    assert be["partial"] is True and be["missing_units"] == 1


def test_reregistering_after_a_changed_transcript_flags_the_stale_be_extraction(tmp_path):
    fake = FakeBe()
    h = _handoff(fake)
    m, tdir = _manifest(tmp_path)
    h.register(m, transcripts_dir=tdir, model_name="x")
    m["reextracted"] = True                                   # 전사가 바뀌어 추출을 다시 했다
    be = h.register(m, transcripts_dir=tdir, model_name="x")
    assert be["stale_extraction"] is True and be["extraction_id"] == "e-m1" and len(fake.meetings) == 1
    assert "reextracted" not in m
    h.register(m, transcripts_dir=tdir, model_name="x")       # 바뀐 게 없으면 표시도 없다
    assert "stale_extraction" not in m["be"]


# ── 유사 task 검색. 판단 파이프라인이 1단계가 고른 finding 마다 부른다 ────────────────────

CANDIDATE = {"task_id": "task_login", "notion_page_id": None, "title": "로그인 화면 시안 마무리", "content_snippet": "",
             "assignee_member_id": "mem_1", "due_date": "2026-09-28", "status": "in_progress", "similarity": 0.8213,
             "updated_at": "2026-09-27T01:00:00Z"}


def test_similar_search_sends_the_service_token_and_returns_candidates():
    fake = FakeBe()
    fake.similar["로그인"] = [CANDIDATE]
    client = H.BeClient("http://be.local", session=fake, service_token="svc-token")
    found = client.similar_tasks("ws-1", "로그인 화면 마감을 다음 주 화요일로 연기")
    assert fake.calls[-1] == ("POST", "/workspaces/ws-1/tasks/similar", {"text": "로그인 화면 마감을 다음 주 화요일로 연기"})
    assert fake.headers[-1] == {"X-Service-Token": "svc-token"} and fake.timeouts[-1] == H.SIMILAR_TIMEOUT_S
    assert [(c.task_id, c.title, c.due_date, c.status, c.similarity) for c in found] == \
        [("task_login", "로그인 화면 시안 마무리", "2026-09-28", "in_progress", 0.8213)]
    assert found[0].notion_page_id is None                    # 승인 직후라 Notion 페이지가 아직 없는 task
    assert client.similar_tasks("ws-1", "환불 기능") == []     # 비슷한 task 가 없다. 새 항목이 된다
    client.create_meeting("ws-1")
    assert fake.headers[-1] == {}                             # 토큰은 요구하는 경로에만 싣는다


def test_a_failed_similar_search_is_an_error_not_an_empty_list():
    """빈 목록은 "비슷한 task 없음" 이다. 실패를 빈 목록으로 돌려주면 있는 task 가 새 항목으로 또 만들어진다."""
    fake = FakeBe()
    with pytest.raises(H.BeError) as wrong_token:
        H.BeClient("http://be.local", session=fake, service_token="틀린 토큰").similar_tasks("ws-1", "로그인")
    assert wrong_token.value.code == "UNAUTHENTICATED" and wrong_token.value.status == 401
    client = H.BeClient("http://be.local", session=fake, service_token="svc-token")
    with pytest.raises(H.BeError) as no_workspace:
        client.similar_tasks("없는-워크스페이스", "로그인")
    assert no_workspace.value.code == "WORKSPACE_NOT_FOUND"
    fake.embedding_down = True
    with pytest.raises(H.BeError) as no_embedding:
        client.similar_tasks("ws-1", "로그인")
    assert no_embedding.value.code == "EMBEDDING_UNAVAILABLE" and no_embedding.value.status == 502
    fake.down = True
    with pytest.raises(H.BeError) as down:
        client.similar_tasks("ws-1", "로그인")
    assert down.value.code == "NETWORK"


LINES = {"source": "meeting", "segments": [
    {"speaker": "101", "start": 3.0, "end": 5.0, "text": "와이어프레임은 누가 하죠?", "seq": 1},
    {"speaker": "103", "start": 12.0, "end": 14.5, "text": "제가 할게요. 금요일까지요", "seq": 2},
]}


def test_create_sources_posts_the_transcript_with_the_service_token_and_names():
    fake = FakeBe()
    client = H.BeClient("http://be.local", session=fake, service_token="svc-token")
    mid = client.create_meeting("ws-1")["meeting_id"]
    data = client.create_sources(mid, LINES, {"101": "민수", "103": "재환"})
    assert fake.calls[-1] == ("POST", f"/meetings/{mid}/sources", {**LINES, "speaker_names": {"101": "민수", "103": "재환"}})
    assert fake.headers[-1] == {"X-Service-Token": "svc-token"}
    assert data == {"meeting_id": mid, "inserted": 2, "skipped": 0, "duration_ms": 14500}
    # 다시 보내면 BE 가 같은 seq 를 건너뛴다. 재전송이 중복을 만들지 않는다
    assert client.create_sources(mid, LINES, {})["skipped"] == 2 and len(fake.sources[mid]) == 2


def test_rejected_sources_are_errors_with_the_be_codes():
    fake = FakeBe()
    client = H.BeClient("http://be.local", session=fake, service_token="svc-token")
    with pytest.raises(H.BeError) as missing:
        client.create_sources("없는-회의", LINES, {})
    assert missing.value.code == "MEETING_NOT_FOUND" and missing.value.status == 404
    mid = client.create_meeting("ws-1")["meeting_id"]
    twice = {"source": "meeting", "segments": [LINES["segments"][0], LINES["segments"][0]]}
    with pytest.raises(H.BeError) as invalid:
        client.create_sources(mid, twice, {})               # 한 요청 안에서 seq 가 겹친다
    assert invalid.value.code == "INVALID_REQUEST" and invalid.value.status == 400
    fake.meetings[mid]["status"] = "failed"
    with pytest.raises(H.BeError) as failed:
        client.create_sources(mid, LINES, {})
    assert failed.value.code == "MEETING_FAILED" and failed.value.status == 409
    with pytest.raises(H.BeError) as wrong_token:
        H.BeClient("http://be.local", session=fake, service_token="틀린 토큰").create_sources(mid, LINES, {})
    assert wrong_token.value.code == "UNAUTHENTICATED" and wrong_token.value.status == 401


def _token_handoff(fake):
    return H.Handoff(H.BeClient("http://be.local/", session=fake, service_token="svc-token"), "ws-1")


def test_save_sources_secures_the_meeting_then_saves_the_lines_with_names(tmp_path):
    fake = FakeBe()
    m, tdir = _manifest(tmp_path, with_tasks=False)
    be = _token_handoff(fake).save_sources(m, transcripts_dir=tdir, title="회의방 2026-09-19")
    assert [(c[0], c[1]) for c in fake.calls] == [("POST", "/meetings"), ("PATCH", "/meetings/m1/end"),
                                                   ("POST", "/meetings/m1/sources")]
    sent = fake.calls[-1][2]
    assert set(sent) == {"source", "segments", "speaker_names"}    # 계약 파일의 speakers 같은 다른 키는 안 보낸다
    assert sent["speaker_names"] == {"101": "민수", "103": "재환"}   # 매니페스트 speakers 의 표시 이름
    assert [s["seq"] for s in sent["segments"]] == [1, 2, 3, 4] and sent["source"] == "meeting"
    assert be is m["be"] and be["sources"] == {"inserted": 4, "skipped": 0, "duration_ms": 26000}
    assert fake.meetings["m1"]["status"] == "processing"


def test_save_sources_moves_to_a_new_meeting_when_the_be_failed_it(tmp_path):
    fake = FakeBe()
    h = _token_handoff(fake)
    m, tdir = _manifest(tmp_path, with_tasks=False)
    h.end(m)
    h.fail(m, "stt")                              # 포기해서 BE 에 실패를 알린 회의를 /recover 가 다시 돌렸다
    be = h.save_sources(m, transcripts_dir=tdir)
    assert be["meeting_id"] == "m2" and be["replaced"] == ["m1"]
    assert len(fake.sources["m2"]) == 4 and "m1" not in fake.sources


def test_save_sources_without_lines_saves_nothing(tmp_path):
    fake = FakeBe()
    h = _token_handoff(fake)
    m, tdir = _manifest(tmp_path, with_tasks=False)
    (tdir / "session_500.transcript.json").unlink()            # 말이 없어 계약 파일이 안 생긴 회의
    assert h.save_sources(m, transcripts_dir=tdir)["sources"] == {"inserted": 0, "skipped": 0, "duration_ms": None}
    (tdir / "session_500.transcript.json").write_text(json.dumps({"segments": []}), encoding="utf-8")
    assert h.save_sources(m, transcripts_dir=tdir)["sources"]["inserted"] == 0
    assert fake.calls == []


def test_from_env_passes_the_service_token(monkeypatch):
    from shared import config

    monkeypatch.setattr(config, "settings", lambda: type("S", (), {"be_base_url": "http://be", "be_workspace_id": "ws",
                                                                  "be_service_token": "svc"})())
    assert H.from_env().client.service_token == "svc"


def test_the_service_token_is_read_from_the_environment(monkeypatch):
    import importlib

    from shared import config

    monkeypatch.setenv("BE_SERVICE_TOKEN", "svc-from-env")
    try:
        assert importlib.reload(config).settings().be_service_token == "svc-from-env"
    finally:
        monkeypatch.undo()
        importlib.reload(config)


# ── 판단 경로의 항목. 이미 BE 항목 모양이라 변환하지 않는다 ─────────────────────────────

def _judge_item(**over):
    base = {"action": "create", "target_task_id": None, "category": "decision", "task_title": "결제 환불 기능 구현",
            "due_date": "2026-10-04", "status": None, "assignee_type": "thirdname", "assignee_raw": "지민님",
            "doc_text": "결제 환불 기능 구현을 지민님이 10/4까지 하기로 함",
            "evidence_quote": "결제 환불 기능은 지민님이 다음 주까지 만들어 주세요.", "evidence_speaker": "101",
            "evidence_at_ms": 3000}
    base.update(over)
    return base


def _judge_manifest(tmp_path, items, **extra):
    m, tdir = _manifest(tmp_path, with_tasks=False)
    path = tdir / "session_500.items.json"
    path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    m["items"] = str(path)
    m.update(extra)
    return m, tdir


def test_judge_items_are_registered_as_they_are(tmp_path):
    fake = FakeBe()
    fake.tasks.add("task_login")
    update = _judge_item(action="update", target_task_id="task_login", category="schedule",
                         task_title="로그인 화면 시안 마무리", due_date="2026-10-06", assignee_type=None,
                         assignee_raw=None, doc_text="로그인 화면 시안 마무리 마감을 9/28에서 10/6으로 연기")
    items = [_judge_item(), update]
    m, tdir = _judge_manifest(tmp_path, items)
    be = _handoff(fake).register(m, transcripts_dir=tdir, model_name="x")
    assert fake.calls[-1][2]["items"] == items       # 키를 더하지도 빼지도 않는다. 확신도는 파이프라인이 준 그대로다
    assert be["status"] == "done" and be["item_count"] == 2 and "dropped_items" not in be


def test_empty_strings_become_null_before_registering(tmp_path):
    """BE 는 빈 문자열을 "언급은 했는데 못 찾은 담당자" 로 계산한다. null 이어야 계산에서 빠진다."""
    fake = FakeBe()
    m, tdir = _judge_manifest(tmp_path, [_judge_item(assignee_raw="", assignee_type="none", due_date="", status="  ")])
    _handoff(fake).register(m, transcripts_dir=tdir, model_name="x")
    sent = fake.calls[-1][2]["items"][0]
    assert sent["assignee_raw"] is None and sent["due_date"] is None and sent["status"] is None
    assert sent["task_title"] == "결제 환불 기능 구현" and sent["assignee_type"] == "none"


def test_items_the_be_skipped_are_counted(tmp_path):
    """BE 는 수정 대상이 사라진 항목과 제목 없는 새 항목을 건너뛰고 201 을 준다. 보낸 수와 저장된 수가 다르면 남긴다."""
    fake = FakeBe()                                       # task_login 이라는 task 가 없다
    gone = _judge_item(action="update", target_task_id="task_login")
    m, tdir = _judge_manifest(tmp_path, [_judge_item(), gone])
    h = _handoff(fake)
    be = h.register(m, transcripts_dir=tdir, model_name="x")
    assert be["item_count"] == 1 and be["dropped_items"] == 1
    assert h.register(m, transcripts_dir=tdir, model_name="x")["dropped_items"] == 1     # 복구가 다시 보내도 같다


def test_unjudged_findings_are_marked_in_the_be_record(tmp_path):
    fake = FakeBe()
    fails = [{"stage": "judge", "text": "로그인 화면 마감을 미루기로 함", "reason": "Terra 응답을 파싱하지 못했습니다."}]
    m, tdir = _judge_manifest(tmp_path, [_judge_item()], extract_failures=fails, extract_partial=True)
    h = _handoff(fake)
    assert h.register(m, transcripts_dir=tdir, model_name="x")["missing_findings"] == 1
    m.pop("extract_failures")
    assert "missing_findings" not in h.register(m, transcripts_dir=tdir, model_name="x")


def test_a_stale_be_extraction_keeps_the_counts_of_what_the_be_holds(tmp_path):
    """전사가 바뀌어 다시 뽑아 보냈는데 BE 가 옛 추출을 돌려줬다. be 에 적힌 수는 BE 에 남은 옛 추출의 것이어야 한다.
    새 결과의 수로 덮어쓰면 item_count(옛 추출)와 어긋난다. 새 결과의 실패는 매니페스트의 extract_failures 에 있다."""
    fake = FakeBe()                                       # task_login 이 없어 수정 항목 하나가 건너뛰어진다
    gone = _judge_item(action="update", target_task_id="task_login")
    fails = [{"stage": "judge", "text": "로그인 화면 마감을 미루기로 함", "reason": "Terra 응답을 파싱하지 못했습니다."}]
    m, tdir = _judge_manifest(tmp_path, [_judge_item(), gone], extract_failures=fails, extract_partial=True)
    h = _handoff(fake)
    be = h.register(m, transcripts_dir=tdir, model_name="x")
    assert (be["item_count"], be["dropped_items"], be["missing_findings"]) == (1, 1, 1)
    Path(m["items"]).write_text(json.dumps([_judge_item()] * 3, ensure_ascii=False), encoding="utf-8")
    m["extract_failures"] = fails * 2                     # 새 전사로 다시 뽑았다. 항목 셋, 판단하지 못한 finding 둘
    m["reextracted"] = True
    be = h.register(m, transcripts_dir=tdir, model_name="x")
    assert be["stale_extraction"] is True and len(fake.extractions["m1"]["items"]) == 2
    assert (be["item_count"], be["dropped_items"], be["missing_findings"]) == (1, 1, 1)


def test_similar_search_over_a_real_http_connection():
    """가짜 세션이 아니라 requests 로 실제 소켓을 거친다. 헤더와 본문이 선을 타고 그대로 가는지 본다."""
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            seen["path"] = self.path
            seen["token"] = self.headers.get("X-Service-Token")
            seen["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])).decode("utf-8"))
            body = json.dumps({"data": {"items": [CANDIDATE]}, "error": None}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = H.BeClient(f"http://127.0.0.1:{server.server_port}", service_token="svc-token")
        found = client.similar_tasks("ws-1", "로그인 화면 마감을 미루기로 함")
    finally:
        server.shutdown()
        server.server_close()
    assert seen == {"path": "/api/v1/workspaces/ws-1/tasks/similar", "token": "svc-token",
                    "body": {"text": "로그인 화면 마감을 미루기로 함"}}
    assert [c.task_id for c in found] == ["task_login"]
