"""디스코드 회의가 BE 에 보내는 요청을 바이트까지 고정한다(#286).

업로드 회의를 같은 인계 코드로 보내려고 TranscriptSegment 와 handoff 를 고치는 동안, 디스코드 회의의
요청(메서드, 경로, json.dumps 한 본문)은 한 글자도 달라지면 안 된다. legacy 경로와 judge 경로를 모두 본다.
LLM 은 FakeLLM, BE 는 FakeBe 다.
"""

import json

from tests.capture import test_judge_wiring as W
from tests.capture import test_recorder as T
from tests.capture.fake_be import FakeBe


def _wire(fake: FakeBe, tmp_path) -> list[tuple[str, str, str | None]]:
    """부른 순서 그대로 (메서드, 경로, 본문 바이트). 본문은 ensure_ascii=False 로 직렬화한 문자열이고,
    임시 폴더 경로(transcript_path 안)만 <tmp> 로 바꾼다."""
    return [(m, p, None if body is None else json.dumps(body, ensure_ascii=False).replace(str(tmp_path) + "/", "<tmp>/"))
            for m, p, body in fake.calls]


LEGACY = [
    ('POST', '/meetings',
     '{"workspace_id": "ws-1", "title": "회의방 2026-09-16", "source": "discord"}'),
    ('PATCH', '/meetings/m1/end', None),
    ('GET', '/workspaces/ws-1/members/names', None),
    ('POST', '/meetings/m1/sources',
     '{"source": "meeting", "segments": [{"speaker": "1", "start": 0.0, "end": 2.0, "text": "w0.25 w0.75 w1.25 w1.75 w2.25", "seq": 1}, {"speaker": "2", "start": 5.0, "end": 8.0, "text": "w0.25 w0.75 w1.25 w1.75 w2.25 w2.75 w3.25", "seq": 2}, {"speaker": "1", "start": 10.0, "end": 12.0, "text": "w2.75 w3.25 w3.75 w4.25", "seq": 3}], "speaker_names": {"1": "민수", "2": "서연"}}'),
    ('POST', '/extractions',
     '{"meeting_id": "m1", "workspace_id": "ws-1", "transcript_path": "<tmp>/transcripts/session_77_500.transcript.json", "model_name": "echo", "items": [{"task_title": "와이어프레임 그리기", "task_confidence": 0.0, "assignee_raw": null, "assignee_type": "first", "due_date": "2026-09-18", "due_raw": "내일", "due_confidence": 1.0, "evidence_quote": "w0.25 w0.75 w1.25 w1.75 w2.25", "evidence_speaker": "1", "evidence_at_ms": 0}]}'),
]
JUDGE = [
    ('POST', '/meetings',
     '{"workspace_id": "ws-1", "title": "회의방 2026-09-28", "source": "discord"}'),
    ('PATCH', '/meetings/m1/end', None),
    ('POST', '/meetings/m1/sources',
     '{"source": "meeting", "segments": [{"speaker": "101", "start": 3.0, "end": 6.0, "text": "결제 환불 기능은 다음 주까지 누가 맡을까요?", "seq": 1}, {"speaker": "103", "start": 7.0, "end": 8.5, "text": "네, 제가 맡을게요.", "seq": 2}, {"speaker": "105", "start": 12.0, "end": 14.0, "text": "검색 성능 개선 어제 다 끝냈어요.", "seq": 3}, {"speaker": "101", "start": 20.0, "end": 23.0, "text": "로그인 화면 마감은 다음 주 화요일로 미루죠.", "seq": 4}, {"speaker": "105", "start": 24.0, "end": 25.0, "text": "네, 알겠습니다.", "seq": 5}], "speaker_names": {"101": "민수", "103": "재환", "105": "서연"}}'),
    ('POST', '/workspaces/ws-1/tasks/similar',
     '{"text": "결제 환불 기능을 재환이 다음 주까지 구현하기로 함"}'),
    ('POST', '/workspaces/ws-1/tasks/similar',
     '{"text": "검색 성능 개선 작업을 끝냈다고 보고함"}'),
    ('POST', '/workspaces/ws-1/tasks/similar',
     '{"text": "로그인 화면 마감을 다음 주 화요일로 연기하기로 함"}'),
    ('POST', '/extractions',
     '{"meeting_id": "m1", "workspace_id": "ws-1", "transcript_path": "<tmp>/transcripts/session_77_500.transcript.json", "model_name": "echo", "items": [{"action": "create", "target_task_id": null, "category": "decision", "task_title": "결제 환불 기능 구현", "due_date": "2026-10-11", "status": null, "assignee_type": "first", "assignee_raw": null, "doc_text": "결제 환불 기능 구현을 재환이 10/11까지 하기로 함", "evidence_quote": "네, 제가 맡을게요.", "evidence_speaker": "103", "evidence_at_ms": 7000, "task_status": "inferred", "due_status": "inferred", "due_raw": null, "similar_count": 0, "top_similarity": null}, {"action": "update", "target_task_id": "task_search", "category": "decision", "task_title": "검색 기능 성능 개선", "due_date": null, "status": "done", "assignee_type": null, "assignee_raw": null, "doc_text": "검색 기능 성능 개선 완료 (진행 중 → 완료)", "evidence_quote": "검색 성능 개선 어제 다 끝냈어요.", "evidence_speaker": "105", "evidence_at_ms": 12000, "target_snapshot": {"updated_at": "2026-09-27T01:00:00Z", "due_date": null, "status": "in_progress", "assignee_member_id": null, "title": "검색 기능 성능 개선"}}, {"action": "update", "target_task_id": "task_login", "category": "schedule", "task_title": "로그인 화면 시안 마무리", "due_date": "2026-10-06", "status": null, "assignee_type": null, "assignee_raw": null, "doc_text": "로그인 화면 시안 마무리 마감을 9/28에서 10/6으로 연기", "evidence_quote": "네, 알겠습니다.", "evidence_speaker": "105", "evidence_at_ms": 24000, "target_snapshot": {"updated_at": "2026-09-27T01:00:00Z", "due_date": "2026-09-28", "status": "in_progress", "assignee_member_id": null, "title": "로그인 화면 시안 마무리"}}]}'),
]

REPLACED = [
    ('POST', '/meetings',
     '{"workspace_id": "ws-1", "title": null, "source": "discord"}'),
    ('PATCH', '/meetings/m1/end',
     None),
    ('POST', '/extractions',
     '{"meeting_id": "m1", "workspace_id": "ws-1", "transcript_path": "<tmp>/transcripts/session_500.transcript.json", "model_name": "x", "items": [{"task_title": "와이어프레임 그리기", "task_confidence": 1.0, "assignee_raw": null, "assignee_type": "first", "due_date": "2026-09-25", "due_raw": "금요일까지", "due_confidence": 1.0, "evidence_quote": "제가 할게요.", "evidence_speaker": "103", "evidence_at_ms": 12000}]}'),
    ('POST', '/meetings',
     '{"workspace_id": "ws-1", "title": null, "source": "discord"}'),
    ('PATCH', '/meetings/m2/end',
     None),
    ('POST', '/meetings/m2/sources',
     '{"source": "meeting", "segments": [{"speaker": "101", "start": 3.0, "end": 5.0, "text": "와이어프레임은 누가 하죠?", "seq": 1}, {"speaker": "103", "start": 12.0, "end": 14.5, "text": "제가 할게요. 금요일까지요", "seq": 2}, {"speaker": "101", "start": 20.0, "end": 21.0, "text": "네", "seq": 3}, {"speaker": "103", "start": 25.0, "end": 26.0, "text": "네", "seq": 4}], "speaker_names": {"101": "민수", "103": "재환"}}'),
    ('POST', '/extractions',
     '{"meeting_id": "m2", "workspace_id": "ws-1", "transcript_path": "<tmp>/transcripts/session_500.transcript.json", "model_name": "x", "items": [{"task_title": "와이어프레임 그리기", "task_confidence": 1.0, "assignee_raw": null, "assignee_type": "first", "due_date": "2026-09-25", "due_raw": "금요일까지", "due_confidence": 1.0, "evidence_quote": "제가 할게요.", "evidence_speaker": "103", "evidence_at_ms": 12000}]}'),
]


def test_a_discord_meeting_on_the_legacy_path_sends_the_same_bytes(tmp_path):
    rec, path, manifest = T._session(tmp_path)
    fake = FakeBe()
    r = T._run(rec, manifest, tmp_path, extractor=T._extractor({}), handoff=T._be(fake))
    assert r["status"] == "handed_off"
    assert _wire(fake, tmp_path) == LEGACY


def test_a_discord_meeting_on_the_judge_path_sends_the_same_bytes(tmp_path, monkeypatch):
    W._fake_llms(monkeypatch, stage1={"findings": W.FINDINGS}, terra=W.TERRA, drafts=W.DRAFTS)
    fake = FakeBe()
    fake.tasks |= {"task_search", "task_login"}
    fake.similar["검색"] = [W._candidate("task_search", "검색 기능 성능 개선")]
    fake.similar["로그인"] = [W._candidate("task_login", "로그인 화면 시안 마무리", due_date="2026-09-28")]
    result, _ = W._process(tmp_path, fake)
    assert result["status"] == "handed_off"
    assert _wire(fake, tmp_path) == JUDGE


def test_a_discord_register_409_failed_replaces_the_meeting_and_resends_sources_with_the_same_bytes(tmp_path):
    """BE 가 회의를 failed 로 닫아 둔 상태에서 추출 등록이 409 MEETING_NOT_PROCESSING 을 받으면 새 회의를 만들고
    발화와 추출을 새 회의에 다시 보낸다. 그 요청도 업로드 인계를 넣기 전과 같은 바이트여야 한다."""
    from tests.capture import test_handoff as HT
    fake = FakeBe()
    h = HT._handoff(fake)
    m, tdir = HT._manifest(tmp_path)
    h.end(m)
    fake.meetings["m1"]["status"] = "failed"
    m["be"]["status"] = "processing"
    be = h.register(m, transcripts_dir=tdir, model_name="x")
    assert be["meeting_id"] == "m2" and be["replaced"] == ["m1"]
    assert _wire(fake, tmp_path) == REPLACED
