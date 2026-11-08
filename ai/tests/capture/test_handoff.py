"""BE 인계(capture/handoff.py). 가짜 BE 로 호출 순서, 본문, 멱등, 실패 통보를 본다. 실제 서버는 안 쓴다."""

import json
from pathlib import Path

import pytest

from capture import handoff as H
from tests.capture import fake_be
from tests.capture.fake_be import FakeBe, without_stage

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
         "speakers": [{"user_id": "101", "display_name": "민수"}, {"user_id": "103", "display_name": "재환"}],
         "workspace_id": "ws-1"}
    if with_tasks:
        (tdir / "session_500.tasks.json").write_text(json.dumps([_task()], ensure_ascii=False), encoding="utf-8")
        m["tasks"] = str(tdir / "session_500.tasks.json")
    if be is not None:
        m["be"] = be
    return m, tdir


def _handoff(fake):
    return H.Handoff(H.BeClient("http://be.local/", session=fake, service_token="svc-token"))


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


def test_legacy_item_carries_the_seq_of_the_located_sentence():
    transcript = {"segments": [
        {"speaker": "a", "start": 1.0, "end": 2.0, "text": "환불 기능 만들어요.", "seq": 7},
        {"speaker": "b", "start": 3.0, "end": 4.0, "text": "네 좋아요.", "seq": 8},
    ]}

    [item] = H.to_extraction_items([{"task": "환불", "source_sentence": "환불 기능 만들어요."}], transcript)

    assert item["evidence_seqs"] == [7]


def test_legacy_item_has_no_seq_when_the_speaker_is_unknown():
    transcript = {"segments": [
        {"speaker": "a", "start": 1.0, "end": 2.0, "text": "네 좋아요.", "seq": 7},
        {"speaker": "b", "start": 3.0, "end": 4.0, "text": "네 좋아요.", "seq": 8},
    ]}

    [item] = H.to_extraction_items([{"task": "환불", "source_sentence": "네 좋아요."}], transcript)

    assert item["evidence_seqs"] == []


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
    c = H.BeClient("http://be.local", session=fake, service_token="svc-token")
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


def test_from_env_needs_the_base_url(monkeypatch):
    from shared import config

    monkeypatch.setattr(config, "settings", lambda: type("S", (), {"be_base_url": "", "be_service_token": "svc"})())
    assert H.from_env() is None


def _client(fake, token="svc-token"):
    return H.BeClient("http://be.local/", session=fake, service_token=token)


def test_workspace_is_looked_up_by_server_and_pinned_in_the_manifest():
    """회의마다 서버로 워크스페이스를 찾는다(#199). 한 번 정하면 연결이 바뀌어도 그대로다. BE 회의를 만든 뒤 바뀌면
    추출 등록이 WORKSPACE_MISMATCH 로 막힌다."""
    fake = FakeBe()
    fake.guilds = {"900": "ws-9"}
    h = H.Handoff(_client(fake))
    m = {"guild_id": "900"}
    assert h.workspace(m) == "ws-9" and m["workspace_id"] == "ws-9"
    assert fake.calls == [("GET", "/integrations/discord/guilds/900/workspace", None)]
    assert fake.headers[0]["X-Service-Token"] == "svc-token"
    fake.guilds = {"900": "ws-other"}
    assert h.workspace(m) == "ws-9" and len(fake.calls) == 1


def test_an_unconnected_server_has_no_workspace_and_other_errors_raise():
    fake = FakeBe()
    h = H.Handoff(_client(fake))
    m = {"guild_id": "901"}
    assert h.workspace(m) is None and "workspace_id" not in m
    assert H.Handoff(_client(fake)).workspace({}) is None          # 서버가 적히지 않은 매니페스트
    fake.down = True
    with pytest.raises(H.BeError) as e:
        h.workspace({"guild_id": "900"})
    assert e.value.code == "NETWORK"
    with pytest.raises(H.BeError) as e:
        H.Handoff(_client(FakeBe(), token="wrong")).workspace({"guild_id": "900"})
    assert e.value.code == "UNAUTHENTICATED"


def test_the_meeting_is_created_in_the_workspace_of_the_manifest(tmp_path):
    fake = FakeBe()
    fake.guilds = {"900": "ws-9"}
    m, _ = _manifest(tmp_path)
    del m["workspace_id"]
    m["guild_id"] = "900"
    H.Handoff(_client(fake)).start(m)
    assert [c[1] for c in fake.calls] == ["/integrations/discord/guilds/900/workspace", "/meetings"]
    assert fake.calls[1][2]["workspace_id"] == "ws-9" and m["workspace_id"] == "ws-9"


def test_no_meeting_is_created_without_a_workspace(tmp_path):
    fake = FakeBe()
    m, _ = _manifest(tmp_path)
    del m["workspace_id"]
    m["guild_id"] = "901"
    with pytest.raises(H.BeError) as e:
        H.Handoff(_client(fake)).start(m)
    assert e.value.code == H.NOT_CONNECTED and "/meetings" not in [c[1] for c in fake.calls]


def test_from_env_needs_the_base_url_and_the_token_only(monkeypatch):
    from shared import config

    monkeypatch.setattr(config, "settings", lambda: type("S", (), {"be_base_url": "http://be", "be_service_token": "svc"})())
    h = H.from_env()
    assert h is not None and h.client.api == "http://be/api/v1" and not hasattr(h, "workspace_id")


def test_unresolved_second_person_and_pronouns_are_not_sent_as_aliases():
    """"네가", "그분", "백엔드 리더" 는 별칭이 아니다. 이름으로 풀리지 않았으면 BE 에 조회를 시키지 않는다."""
    for kind, mention in (("second", "네가"), ("thirdpronoun", "그분이"), ("thirdrole", "백엔드 리더가")):
        t = _task(assignee_type=kind, assignee_mention=mention, assignee_resolved=None)
        assert H.to_extraction_items([t], TRANSCRIPT)[0]["assignee_raw"] is None, kind
    t = _task(assignee_type="thirdname", assignee_mention="민수", assignee_resolved=None)
    assert H.to_extraction_items([t], TRANSCRIPT)[0]["assignee_raw"] == "민수"


def test_thirdname_sends_the_original_mention_even_when_resolved():
    """이름 지목은 원문만 보낸다. 추출기가 고친 이름이 틀리면 BE 가 그 글자를 별칭으로 배운다."""
    t = _task(assignee_type="thirdname", assignee_mention="화은이가", assignee_resolved="하은")
    assert H.to_extraction_items([t], TRANSCRIPT)[0]["assignee_raw"] == "화은이가"
    t = _task(assignee_type="first", assignee_mention=None, assignee_resolved="민수")
    assert H.to_extraction_items([t], TRANSCRIPT)[0]["assignee_raw"] is None
    # 역할 지목은 이번엔 그대로 푼 이름을 보낸다(원문 전송은 별도 이슈)
    t = _task(assignee_type="thirdrole", assignee_mention="백엔드 리더가", assignee_resolved="환")
    assert H.to_extraction_items([t], TRANSCRIPT)[0]["assignee_raw"] == "환"


def test_first_group_none_never_send_assignee_text():
    """추출기가 "우리" 같은 글자를 채워도 BE 가 별칭으로 조회해 hold 로 돌리지 않게 None 을 보낸다."""
    for kind in ("first", "group", "none"):
        t = _task(assignee_type=kind, assignee_mention="우리", assignee_resolved=None)
        assert H.to_extraction_items([t], TRANSCRIPT)[0]["assignee_raw"] is None, kind


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
    return H.Handoff(H.BeClient("http://be.local/", session=fake, service_token="svc-token"))


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
    assert be is m["be"] and be["sources"] == {"inserted": 4, "skipped": 0, "duration_ms": 26000, "meeting_id": "m1"}
    assert fake.meetings["m1"]["status"] == "processing"


def test_save_sources_moves_to_a_new_meeting_when_the_be_failed_it(tmp_path):
    fake = FakeBe()
    h = _token_handoff(fake)
    m, tdir = _manifest(tmp_path, with_tasks=False)
    h.end(m)
    h.fail(m, "stt")                              # 포기해서 BE 에 실패를 알린 회의를 --retry 가 다시 돌렸다
    be = h.save_sources(m, transcripts_dir=tdir)
    assert be["meeting_id"] == "m2" and be["replaced"] == ["m1"] and be["sources"]["meeting_id"] == "m2"
    assert len(fake.sources["m2"]) == 4 and "m1" not in fake.sources


def test_save_sources_without_lines_saves_nothing(tmp_path):
    fake = FakeBe()
    h = _token_handoff(fake)
    m, tdir = _manifest(tmp_path, with_tasks=False)
    m["transcript_json"] = None                                # 말이 없어 계약 파일이 안 생긴 회의. 전사가 이렇게 적는다
    (tdir / "session_500.transcript.json").unlink()
    assert h.save_sources(m, transcripts_dir=tdir)["sources"] == {"inserted": 0, "skipped": 0, "duration_ms": None,
                                                                   "meeting_id": None}
    (tdir / "session_500.transcript.json").write_text(json.dumps({"segments": []}), encoding="utf-8")
    assert h.save_sources(m, transcripts_dir=tdir)["sources"]["inserted"] == 0
    assert fake.calls == []


def test_save_sources_raises_when_the_transcript_it_should_have_is_missing(tmp_path):
    """전사가 쓴 계약 파일이 없으면 0줄로 닫지 않는다. 닫으면 파일을 되살려도 sources_saved 가 막아 다시 보내지 못한다."""
    fake = FakeBe()
    h = _token_handoff(fake)
    m, tdir = _manifest(tmp_path, with_tasks=False)
    contract = tdir / "session_500.transcript.json"
    m["transcript_json"] = str(contract)
    contract.unlink()                                          # 옮겨졌거나 지워졌다
    with pytest.raises(FileNotFoundError):
        h.save_sources(m, transcripts_dir=tdir)
    del m["transcript_json"]                                   # 경로를 적기 전의 매니페스트는 transcripts_dir 에서 찾는다
    with pytest.raises(FileNotFoundError):
        h.save_sources(m, transcripts_dir=tdir)
    assert fake.calls == [] and "sources" not in m.get("be", {})


def test_every_be_call_carries_the_service_token():
    """BE 가 회의 생성·종료·실패와 추출 등록에도 토큰을 검사한다(#179). 봇이 보내는 요청 전부에 싣는다."""
    fake = FakeBe()
    client = H.BeClient("http://be.local", session=fake, service_token="svc-token")
    mid = client.create_meeting("ws-1")["meeting_id"]
    client.end_meeting(mid)
    client.create_extraction(mid, "ws-1", transcript_path=None, model_name=None, items=[])
    other = client.create_meeting("ws-1")["meeting_id"]
    client.fail_meeting(other, "stt")
    assert [c[:2] for c in fake.calls] == [("POST", "/meetings"), ("PATCH", f"/meetings/{mid}/end"),
                                           ("POST", "/extractions"), ("POST", "/meetings"),
                                           ("PATCH", f"/meetings/{other}/fail")]
    assert all(h == {"X-Service-Token": "svc-token"} for h in fake.headers)


def test_the_be_refuses_meeting_calls_without_the_token():
    fake = FakeBe()
    with pytest.raises(H.BeError) as e:
        H.BeClient("http://be.local", session=fake).create_meeting("ws-1")
    assert e.value.code == "UNAUTHENTICATED" and e.value.status == 401


def test_from_env_needs_the_service_token(monkeypatch):
    """토큰이 없으면 BE 가 네 경로를 모두 거절한다. 회의마다 401 로 실패하게 두지 않고 인계를 켜지 않는다."""
    from shared import config

    monkeypatch.setattr(config, "settings", lambda: type("S", (), {"be_base_url": "http://be", "be_service_token": ""})())
    assert H.from_env() is None


def test_from_env_passes_the_service_token(monkeypatch):
    from shared import config

    monkeypatch.setattr(config, "settings", lambda: type("S", (), {"be_base_url": "http://be", "be_service_token": "svc"})())
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


# ─────────────────────────────────────────────────────────── 웹 업로드 가져가기
def _upload_client(fake, token="svc-token"):
    return H.BeClient("http://be.local/", session=fake, service_token=token)


def test_pending_uploads_returns_the_items_with_the_service_token():
    fake = FakeBe()
    item = fake.add_upload("m-up1")
    got = _upload_client(fake).pending_uploads()
    assert got == [item]
    assert fake.calls[-1][:2] == ("GET", "/uploads/pending")
    assert fake.headers[-1]["X-Service-Token"] == "svc-token"


def test_pending_uploads_skips_claimed_and_ended_meetings():
    fake = FakeBe()
    fake.add_upload("m-a")
    fake.add_upload("m-b")
    fake.add_upload("m-c", status="failed")
    client = _upload_client(fake)
    client.claim_upload("m-a")
    assert [i["meeting_id"] for i in client.pending_uploads()] == ["m-b"]


def test_a_wrong_token_is_unauthenticated_on_every_upload_call(tmp_path):
    fake = FakeBe()
    fake.add_upload("m-up1")
    client = _upload_client(fake, token="wrong")
    for call in (client.pending_uploads, lambda: client.claim_upload("m-up1"),
                 lambda: client.download_upload("m-up1", tmp_path / "a.bin")):
        with pytest.raises(H.BeError) as e:
            call()
        assert e.value.code == "UNAUTHENTICATED"
    assert not (tmp_path / "a.bin").exists()


def test_claim_succeeds_once_then_in_progress_409():
    fake = FakeBe()
    fake.add_upload("m-up1")
    client = _upload_client(fake)
    assert client.claim_upload("m-up1") == {"meeting_id": "m-up1", "status": "processing"}
    assert fake.calls[-1][:2] == ("PATCH", "/uploads/m-up1/claim")
    with pytest.raises(H.BeError) as e:
        client.claim_upload("m-up1")
    assert e.value.code == "MEETING_PROCESSING_IN_PROGRESS" and e.value.status == 409
    assert e.value.details == {"meeting_id": "m-up1"}


def test_claim_on_an_ended_meeting_is_already_ended_with_the_status():
    fake = FakeBe()
    fake.add_upload("m-up1", status="done")
    with pytest.raises(H.BeError) as e:
        _upload_client(fake).claim_upload("m-up1")
    assert e.value.code == "MEETING_ALREADY_ENDED" and e.value.details["status"] == "done"


def test_claim_of_an_unknown_meeting_is_not_found():
    with pytest.raises(H.BeError) as e:
        _upload_client(FakeBe()).claim_upload("nope")
    assert e.value.code == "MEETING_NOT_FOUND" and e.value.status == 404


def test_claim_whose_response_was_lost_raises_network_and_the_retry_sees_in_progress():
    fake = FakeBe()
    fake.add_upload("m-up1")
    fake.claim_lost = True
    client = _upload_client(fake)
    with pytest.raises(H.BeError) as e:
        client.claim_upload("m-up1")
    assert e.value.code == "NETWORK"
    fake.claim_lost = False
    with pytest.raises(H.BeError) as e:
        client.claim_upload("m-up1")
    assert e.value.code == "MEETING_PROCESSING_IN_PROGRESS"      # 서버에는 이미 반영됐다


def test_download_streams_the_bytes_to_dest_and_returns_the_size(tmp_path):
    fake = FakeBe()
    audio = bytes(range(256)) * 5000          # 청크 하나보다 크다
    fake.add_upload("m-up1", audio=audio)
    dest = tmp_path / "in" / "audio.m4a"
    dest.parent.mkdir()
    assert _upload_client(fake).download_upload("m-up1", dest) == len(audio)
    assert dest.read_bytes() == audio
    assert fake.calls[-1][:2] == ("GET", "/uploads/m-up1/file")
    assert fake.streams[-1] is True      # 스트리밍으로 받는다(큰 파일을 메모리에 올리지 않는다)
    assert [p.name for p in dest.parent.iterdir()] == ["audio.m4a"]      # 임시 파일이 남지 않는다


def test_download_of_a_missing_file_is_not_found_and_leaves_nothing(tmp_path):
    fake = FakeBe()
    fake.add_upload("m-up1", audio=None)
    dest = tmp_path / "audio.m4a"
    with pytest.raises(H.BeError) as e:
        _upload_client(fake).download_upload("m-up1", dest)
    assert e.value.code == "MEETING_NOT_FOUND"
    assert list(tmp_path.iterdir()) == []


def test_a_broken_stream_is_a_network_error_and_removes_the_partial_file(tmp_path):
    fake = FakeBe()
    fake.add_upload("m-up1", audio=b"x" * 100_000)
    fake.file_break_after = 40_000
    dest = tmp_path / "audio.m4a"
    with pytest.raises(H.BeError) as e:
        _upload_client(fake).download_upload("m-up1", dest)
    assert e.value.code == "NETWORK"
    assert list(tmp_path.iterdir()) == []


def test_a_failed_download_does_not_clobber_an_existing_dest(tmp_path):
    fake = FakeBe()
    fake.add_upload("m-up1", audio=b"x" * 100_000)
    fake.file_break_after = 10
    dest = tmp_path / "audio.m4a"
    dest.write_bytes(b"old")
    with pytest.raises(H.BeError):
        _upload_client(fake).download_upload("m-up1", dest)
    assert dest.read_bytes() == b"old"


def test_an_upload_meeting_can_be_failed_through_fail_meeting():
    fake = FakeBe()
    fake.add_upload("m-up1")
    _upload_client(fake).fail_meeting("m-up1", "stt")
    assert fake.meetings["m-up1"]["status"] == "failed"


# ─────────────────────────────────────────────────────────── 화자 지정 결과 받기
def _assigned_upload(fake, mid, mapping=None, **kw):
    """가져가고 보고한 뒤 지정한다(가짜 BE 의 assign 은 awaiting_speakers 이고 라벨 집합이 같을 때만 받는다)."""
    mapping = mapping or {"SPEAKER_00": "u1"}
    fake.add_upload(mid, **kw)
    fake.mark_reported(mid, sorted(mapping))
    fake.assign(mid, mapping)


def test_assigned_uploads_lists_assigned_not_resumed_in_assign_order_with_the_token():
    fake = FakeBe()
    fake.add_upload("m-none")                                   # 지정 안 됨
    _assigned_upload(fake, "m-b", {"SPEAKER_00": "u2"})
    _assigned_upload(fake, "m-a")
    client = _upload_client(fake)
    got = client.assigned_uploads()
    assert [i["meeting_id"] for i in got] == ["m-b", "m-a"]
    assert got[0]["mapping"] == {"SPEAKER_00": "u2"}
    assert fake.calls[-1][:2] == ("GET", "/uploads/assigned")
    assert fake.headers[-1]["X-Service-Token"] == "svc-token"


def test_assigned_uploads_drops_resumed_and_ended_meetings():
    fake = FakeBe()
    _assigned_upload(fake, "m-r")
    _assigned_upload(fake, "m-d")
    _assigned_upload(fake, "m-ok")
    client = _upload_client(fake)
    client.resume_upload("m-r")
    fake.meetings["m-d"]["status"] = "done"
    assert [i["meeting_id"] for i in client.assigned_uploads()] == ["m-ok"]


def test_assigned_uploads_with_a_wrong_token_is_unauthenticated():
    fake = FakeBe()
    with pytest.raises(H.BeError) as e:
        _upload_client(fake, token="wrong").assigned_uploads()
    assert e.value.code == "UNAUTHENTICATED"


def test_assigned_uploads_without_an_items_list_is_bad_response():
    class Odd(FakeBe):
        def _uploads(self, *a, **k):
            return fake_be._ok(200, {"items": None})
    with pytest.raises(H.BeError) as e:
        _upload_client(Odd()).assigned_uploads()
    assert e.value.code == "BAD_RESPONSE"


def test_resume_returns_meeting_status_and_mapping():
    fake = FakeBe()
    _assigned_upload(fake, "m-up1", {"SPEAKER_00": "u1", "SPEAKER_01": None})
    got = _upload_client(fake).resume_upload("m-up1")
    assert got == {"meeting_id": "m-up1", "status": "processing", "mapping": {"SPEAKER_00": "u1", "SPEAKER_01": None}}
    assert fake.calls[-1][:2] == ("PATCH", "/uploads/m-up1/resume")


def test_resume_is_idempotent_while_processing_and_lost_response_is_retried():
    fake = FakeBe()
    _assigned_upload(fake, "m-up1")
    client = _upload_client(fake)
    fake.resume_lost = True
    with pytest.raises(H.BeError) as e:
        client.resume_upload("m-up1")
    assert e.value.code == "NETWORK"
    fake.resume_lost = False
    assert client.resume_upload("m-up1")["mapping"] == {"SPEAKER_00": "u1"}
    assert client.resume_upload("m-up1")["mapping"] == {"SPEAKER_00": "u1"}
    assert client.assigned_uploads() == []


def test_resume_before_assignment_is_not_assigned_409_with_the_status():
    fake = FakeBe()
    fake.add_upload("m-up1")
    with pytest.raises(H.BeError) as e:
        _upload_client(fake).resume_upload("m-up1")
    assert (e.value.status, e.value.code) == (409, "SPEAKERS_NOT_ASSIGNED")
    assert e.value.details["status"] == "processing"
    fake.meetings["m-up1"]["status"] = "awaiting_speakers"
    with pytest.raises(H.BeError) as e:
        _upload_client(fake).resume_upload("m-up1")
    assert (e.value.code, e.value.details["status"]) == ("SPEAKERS_NOT_ASSIGNED", "awaiting_speakers")


@pytest.mark.parametrize("status", ["done", "failed"])
def test_resume_of_an_ended_meeting_is_already_ended_with_the_status(status):
    fake = FakeBe()
    _assigned_upload(fake, "m-up1")
    fake.meetings["m-up1"]["status"] = status
    with pytest.raises(H.BeError) as e:
        _upload_client(fake).resume_upload("m-up1")
    assert (e.value.status, e.value.code) == (409, "MEETING_ALREADY_ENDED")
    assert e.value.details["status"] == status


def test_resume_of_an_unknown_meeting_is_not_found():
    with pytest.raises(H.BeError) as e:
        _upload_client(FakeBe()).resume_upload("nope")
    assert (e.value.status, e.value.code) == (404, "MEETING_NOT_FOUND")


def test_resume_without_an_object_mapping_is_bad_response():
    class Odd(FakeBe):
        def _uploads(self, *a, **k):
            return fake_be._ok(200, {"meeting_id": "m", "status": "processing", "mapping": ["x"]})
    with pytest.raises(H.BeError) as e:
        _upload_client(Odd()).resume_upload("m")
    assert e.value.code == "BAD_RESPONSE"


def test_member_names_come_from_the_meetings_workspace():
    """PM 이 온보딩에서 정한 이름과 별칭(BE 봇용 조회). 탈퇴한 팀원은 BE 가 빼고 준다."""
    fake = FakeBe()
    fake.members = {"ws-1": [{"member_id": "m1", "name": "김동우", "discord_user_id": "1", "aliases": ["동우형"]}]}
    client = H.BeClient("http://be", session=fake, service_token="svc-token")
    assert client.member_names("ws-1") == [{"member_id": "m1", "name": "김동우", "discord_user_id": "1",
                                            "aliases": ["동우형"]}]
    assert fake.calls[-1][:2] == ("GET", "/workspaces/ws-1/members/names")
    with pytest.raises(H.BeError) as e:
        client.member_names("ws-9")
    assert e.value.code == "WORKSPACE_NOT_FOUND"


# ─────────────────────────────────────────────────────────── 화자 라벨 보고
def _spk(label, total=10.0, samples=((1.0, 4.0),)):
    return {"label": label, "total_sec": total, "samples": [{"start": a, "end": b} for a, b in samples]}


def _claimed(fake, mid="m-up1", **kw):
    fake.add_upload(mid, **kw)
    _upload_client(fake).claim_upload(mid)


def _post(fake, mid, body, token="svc-token"):
    r = fake.request("POST", f"http://be/api/v1/uploads/{mid}/speakers", json=body, headers={"X-Service-Token": token})
    return r.status_code, r.json()


def test_report_speakers_posts_the_body_with_the_token_and_returns_meeting_and_status():
    fake = FakeBe()
    _claimed(fake)
    body = [_spk("SPEAKER_00"), _spk("SPEAKER_01", 3.5)]
    got = _upload_client(fake).report_speakers("m-up1", body)
    assert got == {"meeting_id": "m-up1", "status": "awaiting_speakers"}
    assert fake.calls[-1] == ("POST", "/uploads/m-up1/speakers", {"speakers": body})
    assert fake.headers[-1]["X-Service-Token"] == "svc-token"
    assert fake.meetings["m-up1"]["status"] == "awaiting_speakers"


def test_report_speakers_without_a_dict_data_is_bad_response():
    class Odd(FakeBe):
        def _uploads(self, *a, **k):
            return fake_be._ok(200, None)
    with pytest.raises(H.BeError) as e:
        _upload_client(Odd()).report_speakers("m", [_spk("A")])
    assert e.value.code == "BAD_RESPONSE"


def test_fake_same_content_in_another_order_and_notation_is_200_and_keeps_the_status():
    fake = FakeBe()
    _claimed(fake)
    client = _upload_client(fake)
    client.report_speakers("m-up1", [_spk("B", 2, ((5, 6), (1, 2))), _spk("A", 1)])
    again = client.report_speakers("m-up1", [_spk("A", 1.0), _spk("B", 2.0, ((1.0, 2.0), (5.0, 6.0)))])
    assert again == {"meeting_id": "m-up1", "status": "awaiting_speakers"}
    assert fake.uploads["m-up1"]["speakers"] == [_spk("A", 1.0),
                                                 _spk("B", 2.0, ((1.0, 2.0), (5.0, 6.0)))]


def test_fake_different_content_is_already_reported_409_with_sorted_labels():
    fake = FakeBe()
    _claimed(fake)
    client = _upload_client(fake)
    client.report_speakers("m-up1", [_spk("SPEAKER_01"), _spk("SPEAKER_00")])
    with pytest.raises(H.BeError) as e:
        client.report_speakers("m-up1", [_spk("SPEAKER_00", 99.0)])
    assert (e.value.status, e.value.code) == (409, "SPEAKERS_ALREADY_REPORTED")
    assert e.value.details["labels"] == ["SPEAKER_00", "SPEAKER_01"]
    assert e.value.details["status"] == "awaiting_speakers"


def test_fake_unclaimed_upload_is_not_claimed_409():
    fake = FakeBe()
    fake.add_upload("m-up1")
    with pytest.raises(H.BeError) as e:
        _upload_client(fake).report_speakers("m-up1", [_spk("A")])
    assert (e.value.status, e.value.code) == (409, "UPLOAD_NOT_CLAIMED")
    assert fake.uploads["m-up1"]["speakers"] is None


@pytest.mark.parametrize("status", ["done", "failed"])
def test_fake_ended_meeting_is_checked_before_not_claimed(status):
    fake = FakeBe()
    fake.add_upload("m-up1")                         # 가져가지 않았다
    fake.meetings["m-up1"]["status"] = status
    with pytest.raises(H.BeError) as e:
        _upload_client(fake).report_speakers("m-up1", [_spk("A")])
    assert (e.value.status, e.value.code) == (409, "MEETING_ALREADY_ENDED")
    assert e.value.details["status"] == status


def test_fake_unknown_meeting_is_404():
    with pytest.raises(H.BeError) as e:
        _upload_client(FakeBe()).report_speakers("nope", [_spk("A")])
    assert (e.value.status, e.value.code) == (404, "MEETING_NOT_FOUND")


def test_fake_wrong_token_is_unauthenticated():
    fake = FakeBe()
    _claimed(fake)
    with pytest.raises(H.BeError) as e:
        _upload_client(fake, token="wrong").report_speakers("m-up1", [_spk("A")])
    assert e.value.code == "UNAUTHENTICATED"


@pytest.mark.parametrize("speakers", [
    [],
    [_spk("")],
    [_spk("   ")],
    [_spk("x" * 65)],
    [_spk("A"), _spk("A")],
    [_spk("A", -1.0)],
    [_spk("A", float("nan"))],
    [_spk("A", float("inf"))],
    [_spk("A", 1.0, ((-0.5, 1.0),))],
    [_spk("A", 1.0, ((2.0, 2.0),))],
    [_spk("A", 1.0, ((3.0, 2.0),))],
    [_spk("A", 1.0, ((1.0, float("inf")),))],
])
def test_fake_invalid_body_is_400_invalid_request_with_fields_before_the_meeting_check(speakers):
    fake = FakeBe()                                  # 회의가 없어도 검증이 먼저다
    status, payload = _post(fake, "nope", {"speakers": speakers})
    assert status == 400
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["details"]["fields"]


def test_fake_label_of_64_chars_and_zero_total_are_valid():
    fake = FakeBe()
    _claimed(fake)
    assert _upload_client(fake).report_speakers("m-up1", [_spk("x" * 64, 0.0, ())])["status"] == "awaiting_speakers"


def test_fake_same_content_after_assign_is_200_with_the_current_status():
    fake = FakeBe()
    _claimed(fake)
    client = _upload_client(fake)
    client.report_speakers("m-up1", [_spk("SPEAKER_00")])
    fake.assign("m-up1", {"SPEAKER_00": "u1"})
    assert client.report_speakers("m-up1", [_spk("SPEAKER_00")])["status"] == "processing"
    assert fake.meetings["m-up1"]["status"] == "processing"


def test_fake_report_lost_applies_on_the_server_but_the_response_is_lost():
    fake = FakeBe()
    _claimed(fake)
    fake.speakers_lost = True
    with pytest.raises(H.BeError) as e:
        _upload_client(fake).report_speakers("m-up1", [_spk("A")])
    assert e.value.code == "NETWORK"
    assert fake.meetings["m-up1"]["status"] == "awaiting_speakers"
    fake.speakers_lost = False
    assert _upload_client(fake).report_speakers("m-up1", [_spk("A")])["status"] == "awaiting_speakers"


def test_fake_assign_is_strict_about_state_and_label_set_and_repeat_is_a_noop():
    fake = FakeBe()
    fake.add_upload("m-up1")
    with pytest.raises(AssertionError):              # 아직 보고 전이라 awaiting_speakers 가 아니다
        fake.assign("m-up1", {"SPEAKER_00": "u1"})
    _claimed(fake, "m-up2")
    _upload_client(fake).report_speakers("m-up2", [_spk("SPEAKER_00"), _spk("SPEAKER_01")])
    with pytest.raises(AssertionError):              # 라벨 집합이 다르다
        fake.assign("m-up2", {"SPEAKER_00": "u1"})
    assert fake.meetings["m-up2"]["status"] == "awaiting_speakers"
    fake.assign("m-up2", {"SPEAKER_00": "u1", "SPEAKER_01": None})
    n = fake._assign_n
    fake.assign("m-up2", {"SPEAKER_00": "u1", "SPEAKER_01": None})   # 같은 지정 반복
    assert fake._assign_n == n and fake.meetings["m-up2"]["status"] == "processing"


# ───────────────────────────────────────────── 가짜 BE: 발화 저장·추출 등록의 멤버 ID 검증 (#286)
def _members(fake, ws="ws-1", **deleted):
    fake.members[ws] = [{"member_id": mid, "name": mid, "discord_user_id": None, "aliases": [], **({"deleted": True} if deleted.get(mid) else {})}
                        for mid in ("u1", "u2", "u3")]


def _put_sources(fake, mid, segments, token="svc-token"):
    r = fake.request("POST", f"http://be/api/v1/meetings/{mid}/sources", json={"source": "meeting", "segments": segments},
                     headers={"X-Service-Token": token})
    return r.status_code, r.json()


def _seg(seq, **kw):
    return {"speaker": None, "start": float(seq), "end": float(seq) + 1, "text": f"t{seq}", "seq": seq, **kw}


def test_fake_sources_too_long_member_id_is_400_with_fields_before_the_meeting_check_and_stores_nothing():
    fake = FakeBe()                                   # 회의가 없어도 검증이 먼저다
    status, payload = _put_sources(fake, "nope", [_seg(1), _seg(2, speaker_member_id="x" * 37)])
    assert status == 400 and payload["error"]["code"] == "INVALID_REQUEST"
    fields = payload["error"]["details"]["fields"]
    assert fields == [{"loc": ["body", "segments", 1, "speaker_member_id"], "msg": fields[0]["msg"]}] and fields[0]["msg"]
    fake.add_upload("m-up1")
    assert _put_sources(fake, "m-up1", [_seg(1, speaker_member_id="x" * 37)])[0] == 400
    assert fake.sources == {}


def test_fake_sources_member_id_of_36_chars_is_checked_as_a_member_not_as_a_length_error():
    fake = FakeBe()
    fake.add_upload("m-up1")
    _members(fake)
    status, payload = _put_sources(fake, "m-up1", [_seg(1, speaker_member_id="x" * 36)])
    assert status == 400 and payload["error"]["details"] == {"member_ids": ["x" * 36]}


def test_fake_sources_unknown_inactive_or_other_workspace_ids_are_400_member_ids_in_first_seen_order_without_duplicates():
    fake = FakeBe()
    fake.add_upload("m-up1")
    _members(fake, u2=True)                           # u2 는 탈퇴
    fake.workspaces.add("ws-2")
    _members(fake, ws="ws-2")
    fake.members["ws-2"].append({"member_id": "other", "name": "x", "discord_user_id": None, "aliases": []})
    segs = [_seg(1, speaker_member_id="u1"), _seg(2, speaker_member_id="other"), _seg(3, speaker_member_id="u2"),
            _seg(4, speaker_member_id="other"), _seg(5, speaker_member_id="ghost")]
    status, payload = _put_sources(fake, "m-up1", segs)
    assert status == 400 and payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["message"]
    assert payload["error"]["details"] == {"member_ids": ["other", "u2", "ghost"]}
    assert fake.sources == {}                          # 하나라도 틀리면 아무것도 저장하지 않는다


def test_fake_sources_already_stored_seq_is_still_validated():
    fake = FakeBe()
    fake.add_upload("m-up1")
    _members(fake)
    assert _put_sources(fake, "m-up1", [_seg(1, speaker_member_id="u1")])[0] == 201
    status, payload = _put_sources(fake, "m-up1", [_seg(1, speaker_member_id="ghost"), _seg(2)])
    assert status == 400 and payload["error"]["details"] == {"member_ids": ["ghost"]}
    assert set(fake.sources["m-up1"]) == {1}


def test_fake_sources_stores_member_id_preferring_speaker_member_id_over_the_discord_uid():
    fake = FakeBe()
    fake.add_upload("m-up1")
    _members(fake)
    fake.members["ws-1"][0]["discord_user_id"] = "101"          # u1 의 디스코드 uid
    segs = [_seg(1, speaker="101"), _seg(2, speaker="101", speaker_member_id="u2"), _seg(3, speaker_member_id="u3"),
            _seg(4), _seg(5, speaker="999")]
    assert _put_sources(fake, "m-up1", segs)[0] == 201
    got = {q: s.get("member_id") for q, s in fake.sources["m-up1"].items()}
    assert got == {1: "u1", 2: "u2", 3: "u3", 4: None, 5: None}


def test_fake_sources_failed_meeting_is_409_meeting_failed_and_done_meeting_is_accepted():
    fake = FakeBe()
    fake.add_upload("m-up1", status="failed")
    status, payload = _put_sources(fake, "m-up1", [_seg(1)])
    assert status == 409 and payload["error"]["code"] == "MEETING_FAILED" and fake.sources == {}
    fake.add_upload("m-up2", status="done")
    assert _put_sources(fake, "m-up2", [_seg(1)])[0] == 201


def test_fake_sources_400s_have_loc_msg_fields():
    fake = FakeBe()
    fake.add_upload("m-up1")
    status, payload = _put_sources(fake, "m-up1", [_seg(1), _seg(1)])
    assert status == 400 and all(set(f) == {"loc", "msg"} for f in payload["error"]["details"]["fields"])
    status, payload = _put_sources(fake, "m-up1", [_seg(-1)])
    assert status == 400 and payload["error"]["details"]["fields"][0]["loc"] == ["body", "segments", 0, "seq"]


def _post_extraction(fake, body, token="svc-token"):
    r = fake.request("POST", "http://be/api/v1/extractions", json=body, headers={"X-Service-Token": token})
    return r.status_code, r.json()


def test_fake_extraction_too_long_evidence_member_id_is_400_fields_and_records_nothing():
    fake = FakeBe()
    fake.add_upload("m-up1")
    item = {"task_title": "a", "evidence_speaker_member_id": "x" * 37}
    status, payload = _post_extraction(fake, {"meeting_id": "m-up1", "workspace_id": "ws-1", "items": [item]})
    assert status == 400 and payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["details"]["fields"][0]["loc"] == ["body", "items", 0, "evidence_speaker_member_id"]
    assert fake.extractions == {} and fake.meetings["m-up1"]["status"] == "processing"


def test_fake_extraction_records_the_received_items_as_they_are_and_not_processing_is_409_with_status():
    fake = FakeBe()
    fake.add_upload("m-up1")
    item = {"task_title": "a", "evidence_speaker": None, "evidence_speaker_member_id": "u1"}
    assert _post_extraction(fake, {"meeting_id": "m-up1", "workspace_id": "ws-1", "items": [item]})[0] == 201
    assert fake.extractions["m-up1"]["items"] == [item]
    fake.add_upload("m-up2", status="failed")
    status, payload = _post_extraction(fake, {"meeting_id": "m-up2", "workspace_id": "ws-1", "items": [item]})
    assert status == 409 and payload["error"]["code"] == "MEETING_NOT_PROCESSING"
    assert payload["error"]["details"]["status"] == "failed"


# ───────────────────────────────────────────── 업로드 회의 인계 (#286)
UP_TRANSCRIPT = {
    "source": "meeting",
    "segments": [
        {"speaker": "SPEAKER_00", "start": 1.0, "end": 3.0, "text": "와이어프레임은 누가 하죠?", "seq": 1},
        {"speaker": "SPEAKER_01", "start": 4.0, "end": 6.0, "text": "제가 할게요. 금요일까지요", "seq": 2},
        {"speaker": "SPEAKER_02", "start": 7.0, "end": 8.0, "text": "저는 외부 사람입니다", "seq": 3},
    ],
}


def _upload(tmp_path, *, be=None, with_tasks=True, items=None):
    """mapped 업로드 매니페스트. 라벨 SPEAKER_00 → u1(hint_members 에 이름), SPEAKER_01 → u2(참석자 이름), SPEAKER_02 → 외부 참석자."""
    tdir = tmp_path / "transcripts"
    tdir.mkdir(exist_ok=True)
    (tdir / "session_up1.transcript.json").write_text(json.dumps(UP_TRANSCRIPT, ensure_ascii=False), encoding="utf-8")
    m = {"session": "up1", "source": "upload", "status": "mapped", "started_at": "2026-11-03T01:00:00+09:00",
         "timezone": "Asia/Seoul", "workspace_id": "ws-1", "mapped_at": "2026-11-03T03:00:00+00:00",
         "speakers": [{"user_id": "SPEAKER_00", "display_name": "SPEAKER_00", "member_id": "u1"},
                      {"user_id": "SPEAKER_01", "display_name": "SPEAKER_01", "member_id": "u2"},
                      {"user_id": "SPEAKER_02", "display_name": "SPEAKER_02", "member_id": None}],
         "hint_members": [{"member_id": "u1", "name": "민수", "discord_user_id": None, "aliases": []}],
         "attendees": [{"member_id": "u1", "display_name": "민수(참석자)"}, {"member_id": "u2", "display_name": "서연"}],
         "be": be if be is not None else {"meeting_id": "m-up1", "status": "processing"}}
    if with_tasks:
        (tdir / "session_up1.tasks.json").write_text(json.dumps([_task(source_sentence="제가 할게요.")], ensure_ascii=False),
                                                     encoding="utf-8")
        m["tasks"] = str(tdir / "session_up1.tasks.json")
    if items is not None:
        (tdir / "session_up1.items.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        m["items"] = str(tdir / "session_up1.items.json")
    return m, tdir


def _upload_fake(**kw):
    fake = FakeBe()
    fake.add_upload("m-up1", **kw)
    fake.members["ws-1"] = [{"member_id": "u1", "name": "민수", "discord_user_id": None, "aliases": []},
                            {"member_id": "u2", "name": "서연", "discord_user_id": None, "aliases": []}]
    return fake


def _body(fake, path):
    return next(b for _, p, b in fake.calls if p == path)


def test_is_upload_and_speaker_members_read_the_manifest():
    m = {"source": "upload", "speakers": [{"user_id": "A", "member_id": "u1"}, {"user_id": "B", "member_id": None},
                                          {"user_id": "C"}]}
    assert H.is_upload(m) and not H.is_upload({"speakers": []})
    assert H.speaker_members(m) == {"A": "u1", "B": None, "C": None}


def test_upload_speaker_names_are_member_names_with_external_numbering():
    m = {"source": "upload",
         "speakers": [{"user_id": "L0", "display_name": "L0", "member_id": "u1"}, {"user_id": "L1", "display_name": "L1", "member_id": "u2"},
                      {"user_id": "L2", "display_name": "L2", "member_id": None}, {"user_id": "L3", "display_name": "L3", "member_id": "u9"},
                      {"user_id": "L4", "display_name": "L4", "member_id": None}],
         "hint_members": [{"member_id": "u1", "name": "민수"}],
         "attendees": [{"member_id": "u1", "display_name": "민수(참석자)"}, {"member_id": "u2", "display_name": "서연"}]}
    assert H.speaker_names(m) == {"L0": "민수", "L1": "서연", "L2": "외부 참석자 1", "L3": "L3", "L4": "외부 참석자 2"}


def test_upload_save_sources_sends_member_ids_not_speakers_and_no_speaker_names_and_no_meeting_calls(tmp_path):
    fake = _upload_fake()
    h = _handoff(fake)
    m, tdir = _upload(tmp_path)
    be = h.save_sources(m, transcripts_dir=tdir)
    assert [(c[0], c[1]) for c in fake.calls] == [("POST", "/meetings/m-up1/sources")]      # /meetings·/end 는 부르지 않는다
    sent = fake.calls[0][2]
    assert sent == {"source": "meeting", "segments": [
        {"speaker": None, "start": 1.0, "end": 3.0, "text": "와이어프레임은 누가 하죠?", "seq": 1, "speaker_member_id": "u1"},
        {"speaker": None, "start": 4.0, "end": 6.0, "text": "제가 할게요. 금요일까지요", "seq": 2, "speaker_member_id": "u2"},
        {"speaker": None, "start": 7.0, "end": 8.0, "text": "저는 외부 사람입니다", "seq": 3}]}     # 외부 참석자는 키가 없다
    assert "speaker_names" not in sent
    assert be["sources"] == {"inserted": 3, "skipped": 0, "duration_ms": 8000, "meeting_id": "m-up1"}
    assert "replaced" not in m["be"]
    # 전사 계약 파일은 라벨 id 그대로다
    saved = json.loads((tdir / "session_up1.transcript.json").read_text(encoding="utf-8"))
    assert [s["speaker"] for s in saved["segments"]] == ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"]


def test_upload_400_member_ids_resends_those_ids_as_null_on_the_first_send_and_records_them(tmp_path):
    fake = _upload_fake()
    fake.members["ws-1"][1]["deleted"] = True                # u2 는 그 사이 탈퇴
    h = _handoff(fake)
    m, tdir = _upload(tmp_path)
    be = h.save_sources(m, transcripts_dir=tdir)
    assert [c[1] for c in fake.calls] == ["/meetings/m-up1/sources"] * 2
    first, second = fake.calls[0][2]["segments"], fake.calls[1][2]["segments"]
    assert first[1]["speaker_member_id"] == "u2"
    assert "speaker_member_id" not in second[1] and second[1]["speaker"] is None   # null 로(키 없음) 다시 보낸다
    assert second[0]["speaker_member_id"] == "u1"
    assert be["sources"]["dropped_member_ids"] == ["u2"] and be["sources"]["inserted"] == 3
    assert fake.sources["m-up1"][2].get("member_id") is None


def test_register_leaves_out_the_member_id_that_the_sources_400_dropped(tmp_path):
    """BE 가 팀원이 아니라고 해 발화에서 비운 멤버 ID 는 추출 등록의 evidence_speaker_member_id 에도 보내지 않는다."""
    fake = _upload_fake()
    fake.members["ws-1"][1]["deleted"] = True                # u2(근거 화자)는 그 사이 탈퇴
    h = _handoff(fake)
    m, tdir = _upload(tmp_path)
    h.save_sources(m, transcripts_dir=tdir)
    assert m["be"]["sources"]["dropped_member_ids"] == ["u2"]
    h.register(m, transcripts_dir=tdir, model_name="x")
    sent = next(c[2] for c in fake.calls if c[1] == "/extractions")
    assert sent["items"][0]["evidence_speaker"] is None
    assert "evidence_speaker_member_id" not in sent["items"][0]


def test_upload_400_member_ids_on_a_resend_is_handled_the_same_way(tmp_path):
    fake = _upload_fake()
    h = _handoff(fake)
    m, tdir = _upload(tmp_path)
    h.save_sources(m, transcripts_dir=tdir)                   # 첫 전송은 성공했다
    fake.members["ws-1"][0]["deleted"] = True                 # u1 이 탈퇴한 뒤 다시 보낸다
    fake.calls.clear()
    m["be"].pop("sources")
    be = h.save_sources(m, transcripts_dir=tdir)
    assert len(fake.calls) == 2 and be["sources"]["dropped_member_ids"] == ["u1"]
    assert be["sources"]["skipped"] == 3


def test_upload_400_member_ids_with_an_id_that_stays_is_an_error_that_carries_the_ids(tmp_path):
    fake = _upload_fake()
    fake.sources_fail = (400, "INVALID_REQUEST", {"member_ids": ["ghost"]})   # 보낸 적 없는 ID. 다시 보내도 같다
    h = _handoff(fake)
    m, tdir = _upload(tmp_path)
    with pytest.raises(H.BeError) as e:
        h.save_sources(m, transcripts_dir=tdir)
    assert not isinstance(e.value, H.MeetingEnded) and "ghost" in str(e.value) and e.value.details == {"member_ids": ["ghost"]}
    assert len(fake.calls) == 1                               # 되풀이하지 않는다


def test_upload_400_member_ids_retries_are_bounded_by_the_distinct_ids(tmp_path):
    fake = _upload_fake()
    fake.sources_fail = (400, "INVALID_REQUEST", {"member_ids": ["u1"]})      # 지워도 계속 u1 을 탓한다
    h = _handoff(fake)
    m, tdir = _upload(tmp_path)
    with pytest.raises(H.BeError) as e:
        h.save_sources(m, transcripts_dir=tdir)
    assert "u1" in str(e.value)
    assert len(fake.calls) <= 3                               # 서로 다른 ID 2개 + 처음 한 번


def test_discord_400_error_also_carries_member_ids_in_the_message(tmp_path):
    fake = FakeBe()
    h = _handoff(fake)
    m, tdir = _manifest(tmp_path)
    h.end(m)
    fake.sources_fail = (400, "INVALID_REQUEST", {"member_ids": ["ghost"]})
    with pytest.raises(H.BeError) as e:
        h.save_sources(m, transcripts_dir=tdir)
    assert "ghost" in str(e.value)


@pytest.mark.parametrize("code,status", [("MEETING_FAILED", 409), ("MEETING_NOT_FOUND", 404)])
def test_upload_sources_409_failed_or_404_is_meeting_ended_and_no_new_meeting(tmp_path, code, status):
    fake = _upload_fake()
    fake.sources_fail = (status, code, {"meeting_id": "m-up1", "status": "failed"})
    h = _handoff(fake)
    m, tdir = _upload(tmp_path)
    with pytest.raises(H.MeetingEnded) as e:
        h.save_sources(m, transcripts_dir=tdir)
    assert isinstance(e.value, H.BeError) and e.value.code == code and e.value.status == status
    assert [c[1] for c in fake.calls] == ["/meetings/m-up1/sources"]          # 새 회의·end 없음
    assert m["be"]["meeting_id"] == "m-up1" and "replaced" not in m["be"]


def test_discord_sources_409_is_still_a_plain_be_error(tmp_path):
    fake = FakeBe()
    h = _handoff(fake)
    m, tdir = _manifest(tmp_path)
    h.end(m)
    fake.sources_fail = (409, "MEETING_FAILED", {"status": "failed"})
    with pytest.raises(H.BeError) as e:
        h.save_sources(m, transcripts_dir=tdir)
    assert not isinstance(e.value, H.MeetingEnded)


def test_upload_end_with_a_failed_be_status_raises_meeting_ended_without_patching(tmp_path):
    fake = _upload_fake()
    h = _handoff(fake)
    m, _ = _upload(tmp_path, be={"meeting_id": "m-up1", "status": "failed"})
    with pytest.raises(H.MeetingEnded):
        h.end(m)
    assert fake.calls == [] and m["be"]["meeting_id"] == "m-up1" and "replaced" not in m["be"]


def test_upload_end_with_processing_or_done_status_is_a_noop(tmp_path):
    fake = _upload_fake()
    h = _handoff(fake)
    for status in ("processing", "done"):
        m, _ = _upload(tmp_path, be={"meeting_id": "m-up1", "status": status})
        assert h.end(m)["status"] == status
    assert fake.calls == []


def test_upload_register_on_the_legacy_path_sends_the_member_id_and_no_speaker(tmp_path):
    fake = _upload_fake()
    h = _handoff(fake)
    m, tdir = _upload(tmp_path)
    be = h.register(m, transcripts_dir=tdir, model_name="x")
    assert [(c[0], c[1]) for c in fake.calls] == [("POST", "/extractions")]
    item = fake.calls[0][2]["items"][0]
    assert item["evidence_speaker"] is None and item["evidence_speaker_member_id"] == "u2" and item["evidence_at_ms"] == 4000
    assert be["status"] == "done" and fake.extractions["m-up1"]["items"][0]["evidence_speaker_member_id"] == "u2"


def test_upload_register_on_the_judge_path_converts_every_item_and_leaves_an_external_speaker_without_the_key(tmp_path):
    fake = _upload_fake()
    h = _handoff(fake)
    items = [{"action": "create", "task_title": "a", "evidence_speaker": "SPEAKER_00"},
             {"action": "create", "task_title": "b", "evidence_speaker": "SPEAKER_02"},
             {"action": "create", "task_title": "c", "evidence_speaker": None}]
    m, tdir = _upload(tmp_path, with_tasks=False, items=items)
    h.register(m, transcripts_dir=tdir, model_name="x")
    sent = fake.calls[0][2]["items"]
    assert [i["evidence_speaker"] for i in sent] == [None, None, None]
    assert sent[0]["evidence_speaker_member_id"] == "u1"
    assert "evidence_speaker_member_id" not in sent[1] and "evidence_speaker_member_id" not in sent[2]
    # 매니페스트가 가리키는 items 파일은 라벨 id 그대로다
    assert json.loads(Path(m["items"]).read_text(encoding="utf-8"))[0]["evidence_speaker"] == "SPEAKER_00"


@pytest.mark.parametrize("status", ["failed", "done"])
def test_upload_register_409_not_processing_is_meeting_ended_and_no_new_meeting(tmp_path, status):
    fake = _upload_fake(status=status)
    h = _handoff(fake)
    m, tdir = _upload(tmp_path)                                # 매니페스트는 processing 이라고 믿는다
    with pytest.raises(H.MeetingEnded) as e:
        h.register(m, transcripts_dir=tdir, model_name="x")
    assert e.value.code == "MEETING_NOT_PROCESSING" and e.value.details["status"] == status
    assert [(c[0], c[1]) for c in fake.calls] == [("POST", "/extractions")]
    assert "replaced" not in m["be"] and m["be"]["meeting_id"] == "m-up1"


def test_upload_register_404_is_meeting_ended(tmp_path):
    h = _handoff(FakeBe())                                     # BE 에 그 회의가 없다
    m, tdir = _upload(tmp_path)
    with pytest.raises(H.MeetingEnded) as e:
        h.register(m, transcripts_dir=tdir, model_name="x")
    assert e.value.code == "MEETING_NOT_FOUND"


def test_discord_register_409_failed_still_makes_a_new_meeting(tmp_path):
    fake = FakeBe()
    h = _handoff(fake)
    m, tdir = _manifest(tmp_path)
    h.end(m)
    fake.meetings["m1"]["status"] = "failed"
    m["be"]["status"] = "processing"
    be = h.register(m, transcripts_dir=tdir, model_name="x")
    assert be["meeting_id"] == "m2" and be["replaced"] == ["m1"]


# ─────────────────────────────────────────────────────────── 처리 단계 보고
def _staged(be=True):
    return {"session": "500", "status": "saved", **({"be": {"meeting_id": "m1", "status": "processing"}} if be else {})}


def test_report_stage_patches_stage_with_token_and_short_timeout():
    fake = FakeBe()
    fake.meetings["m1"] = {"meeting_id": "m1", "workspace_id": "ws-1", "status": "processing"}
    _handoff(fake).report_stage(_staged(), "stt")
    assert fake.calls[-1] == ("PATCH", "/meetings/m1/stage", {"stage": "stt"})
    assert fake.headers[-1] == {"X-Service-Token": "svc-token"}
    assert fake.timeouts[-1] == H.STAGE_TIMEOUT_S == 3.0
    assert fake.meetings["m1"]["stage"] == "stt"


def test_report_stage_without_meeting_id_is_noop():
    fake = FakeBe()
    _handoff(fake).report_stage(_staged(be=False), "stt")
    _handoff(fake).report_stage({"session": "500", "be": {}}, "stt")
    assert fake.calls == []


@pytest.mark.parametrize("trouble", [{"down": True}, {"stage_fail": 500}, {"stage_fail": 404}])
def test_report_stage_swallows_errors(trouble):
    fake = FakeBe()
    fake.meetings["m1"] = {"meeting_id": "m1", "workspace_id": "ws-1", "status": "processing"}
    for k, v in trouble.items():
        setattr(fake, k, v)
    manifest = _staged()
    before = json.loads(json.dumps(manifest))
    _handoff(fake).report_stage(manifest, "sources")        # 예외가 나면 이 줄에서 테스트가 죽는다
    assert manifest == before
    assert without_stage(fake.calls) == []


def test_chat_cursor_parses_and_null():
    from datetime import datetime, timezone
    fake = FakeBe()
    c = _client(fake)
    assert c.chat_cursor("ws-1") is None
    fake.chat_cursors["ws-1"] = "2026-11-03T15:30:00+00:00"
    assert c.chat_cursor("ws-1") == datetime(2026, 11, 3, 15, 30, tzinfo=timezone.utc)
    assert fake.calls[-1] == ("GET", "/workspaces/ws-1/chat-cursor", None)
    assert fake.headers[-1]["X-Service-Token"] == "svc-token"


def test_create_meeting_sends_started_at():
    from datetime import datetime, timezone
    fake = FakeBe()
    at = datetime(2026, 11, 3, 15, 30, tzinfo=timezone.utc)
    _client(fake).create_meeting("ws-1", title="t", source="chat", started_at=at)
    assert fake.calls[-1][2]["started_at"] == at.isoformat() and fake.calls[-1][2]["source"] == "chat"
    _client(fake).create_meeting("ws-1")
    assert "started_at" not in fake.calls[-1][2]


def test_chat_channels_returns_items_with_service_token():
    fake = FakeBe()
    fake.chat_channels = [{"workspace_id": "ws-1", "guild_id": "900", "channel_id": "1"}]
    client = H.BeClient("http://be.local", session=fake, service_token="svc-token")
    assert client.chat_channels() == fake.chat_channels
    assert fake.calls[-1] == ("GET", "/bot/chat-channels", None)
    assert fake.headers[-1] == {"X-Service-Token": "svc-token"}


def test_chat_channels_without_items_is_bad_response():
    fake = FakeBe()
    fake.chat_channels = None      # FakeBe 가 {"data": {}} 를 준다
    client = H.BeClient("http://be.local", session=fake, service_token="svc-token")
    with pytest.raises(H.BeError) as e:
        client.chat_channels()
    assert e.value.code == "BAD_RESPONSE"


def test_chat_channels_non_dict_item_is_bad_response():
    fake = FakeBe()
    fake.chat_channels = ["x"]
    client = H.BeClient("http://be.local", session=fake, service_token="svc-token")
    with pytest.raises(H.BeError) as e:
        client.chat_channels()
    assert e.value.code == "BAD_RESPONSE"


def test_chat_channels_wrong_token_is_unauthenticated():
    with pytest.raises(H.BeError) as e:
        H.BeClient("http://be.local", session=FakeBe(), service_token="틀린 토큰").chat_channels()
    assert e.value.code == "UNAUTHENTICATED" and e.value.status == 401
