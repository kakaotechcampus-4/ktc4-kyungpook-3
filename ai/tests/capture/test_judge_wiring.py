"""실제 판단 파이프라인(judge/pipeline.py)을 추출 단계에 끼워 전사본에서 BE 등록까지 잇는다.

LLM 은 llm.FakeLLM, BE 는 FakeBe 다. 네트워크도 과금도 없다. 가짜 추출기로 본 것(test_judge_stage.py)과 달리
여기서는 1단계 프롬프트, 유사 검색 호출, to_item 이 만든 항목이 실제 코드로 이어지는지를 본다.
"""

import json

import pytest

pytest.importorskip("judge.pipeline")        # 파이프라인이 없는 체크아웃에서는 건너뛴다

import draft.doc_draft as doc_draft  # noqa: E402
import judge.final_judge as final_judge  # noqa: E402
import judge.pipeline as pipeline  # noqa: E402
import judge.semantic_judge as semantic_judge  # noqa: E402
from capture import handoff as H  # noqa: E402
from capture import judge_path as J  # noqa: E402
from capture import recorder as R  # noqa: E402
from llm import FakeLLM  # noqa: E402
from tests.capture.fake_be import FakeBe  # noqa: E402
from tests.capture.test_judge_path import _cfg  # noqa: E402

SPEAKERS = [{"user_id": "101", "display_name": "민수"}, {"user_id": "103", "display_name": "재환"},
            {"user_id": "105", "display_name": "서연"}]
MEETING = [
    {"speaker": "101", "start": 3.0, "end": 6.0, "seq": 1, "text": "결제 환불 기능은 다음 주까지 누가 맡을까요?"},
    {"speaker": "103", "start": 7.0, "end": 8.5, "seq": 2, "text": "네, 제가 맡을게요."},
    {"speaker": "105", "start": 12.0, "end": 14.0, "seq": 3, "text": "검색 성능 개선 어제 다 끝냈어요."},
    {"speaker": "101", "start": 20.0, "end": 23.0, "seq": 4, "text": "로그인 화면 마감은 다음 주 화요일로 미루죠."},
    {"speaker": "105", "start": 24.0, "end": 25.0, "seq": 5, "text": "네, 알겠습니다."},
]
# 1단계가 보는 문장 번호는 세그먼트 순서와 같다(세그먼트마다 한 문장)
FINDINGS = [
    {"indices": [0, 1], "summary": "결제 환불 기능을 재환이 다음 주까지 구현하기로 함", "signal": "decision",
     "assignee_type": "first", "reason": "지시와 수락"},
    {"indices": [2], "summary": "검색 성능 개선 작업을 끝냈다고 보고함", "signal": "progress",
     "assignee_type": "none", "reason": "완료 보고"},
    {"indices": [3, 4], "summary": "로그인 화면 마감을 다음 주 화요일로 연기하기로 함", "signal": "decision",
     "assignee_type": "none", "reason": "일정 변경"},
]
TERRA = [
    {"is_meaningful": True, "category": "decision", "is_new": True, "matched_candidate_index": None, "status": None,
     "evidence": "후보 없음"},
    {"is_meaningful": True, "category": "decision", "is_new": False, "matched_candidate_index": 0, "status": "done",
     "evidence": "진행 중이던 작업이 끝남"},
    {"is_meaningful": True, "category": "schedule", "is_new": False, "matched_candidate_index": 0, "status": None,
     "evidence": "마감이 바뀜"},
]
DRAFTS = [
    {"task": "결제 환불 기능 구현", "due_date": "2026-10-11", "doc_text": "결제 환불 기능 구현을 재환이 10/11까지 하기로 함"},
    {"task": None, "due_date": None, "doc_text": "검색 기능 성능 개선 완료 (진행 중 → 완료)"},
    {"task": None, "due_date": "2026-10-06", "doc_text": "로그인 화면 시안 마무리 마감을 9/28에서 10/6으로 연기"},
]


def _candidate(task_id, title, **over):
    base = {"task_id": task_id, "notion_page_id": None, "title": title, "content_snippet": "",
            "assignee_member_id": None, "due_date": None, "status": "in_progress", "similarity": 0.8,
            "updated_at": "2026-09-27T01:00:00Z"}
    base.update(over)
    return base


def _fake_llms(monkeypatch, *, stage1, terra, drafts):
    fakes = {"stage1": FakeLLM(responses=[stage1]), "terra": FakeLLM(responses=list(terra)),
             "draft": FakeLLM(responses=list(drafts))}
    monkeypatch.setattr(semantic_judge, "get_llm", lambda which: fakes["stage1"])
    monkeypatch.setattr(final_judge, "get_llm", lambda which: fakes["terra"])
    monkeypatch.setattr(doc_draft, "get_llm", lambda which: fakes["draft"])
    monkeypatch.setattr(pipeline, "get_llm", lambda which: fakes["terra"] if which == "terra" else fakes["draft"])
    return fakes


def _transcribed(tmp_path, segments):
    """전사까지 끝난 회의. 트랙은 없어도 된다(추출과 인계만 돈다)."""
    rec, tdir = tmp_path / "recordings", tmp_path / "transcripts"
    tdir.mkdir(parents=True)
    (tdir / "session_77_500.transcript.json").write_text(
        json.dumps({"source": "meeting", "segments": segments}, ensure_ascii=False), encoding="utf-8")
    path, manifest = R.write_status(rec, "77_500", status=R.STATUS_TRANSCRIBED, entries=SPEAKERS, guild="g",
                                    channel="회의방", library_version="x", started_at="2026-09-28T01:00:00+00:00",
                                    meeting_dir="77_500", extra={"timezone": "Asia/Seoul", "guild_id": "77",
                                                                 "stages": {"transcribed": "2026-09-28T01:30:00+00:00"}})
    return rec, tdir, path, manifest


def _process(tmp_path, fake, segments=MEETING):
    rec, tdir, path, manifest = _transcribed(tmp_path, segments)
    client = H.BeClient("http://be", session=fake, service_token="svc-token")
    extractor = J.build_extractor(run=pipeline.run, candidates=client, cfg=_cfg())
    result = R.process_session(rec, manifest, backend=None, model_name="echo", workers=1, transcripts_dir=tdir,
                               extractor=extractor, handoff=H.Handoff(client, "ws-1"))
    return result, json.loads(path.read_text(encoding="utf-8"))


def test_a_meeting_goes_from_the_transcript_to_be_through_the_real_pipeline(tmp_path, monkeypatch):
    fakes = _fake_llms(monkeypatch, stage1={"findings": FINDINGS}, terra=TERRA, drafts=DRAFTS)
    fake = FakeBe()
    fake.tasks |= {"task_search", "task_login"}
    fake.similar["검색"] = [_candidate("task_search", "검색 기능 성능 개선")]
    fake.similar["로그인"] = [_candidate("task_login", "로그인 화면 시안 마무리", due_date="2026-09-28")]
    result, saved = _process(tmp_path, fake)
    assert result["ran"] == ["extracted", "handed_off"] and saved["status"] == "handed_off"

    # 1단계 프롬프트에는 화자가 이름으로 보인다. uid 는 LLM 에 가지 않는다
    prompt = fakes["stage1"].prompts[0]
    assert "[0] 민수: 결제 환불 기능은" in prompt and "[1] 재환: 네, 제가 맡을게요." in prompt
    assert not any(uid in prompt for uid in ("101", "103", "105"))

    # 유사 검색은 1단계가 고른 finding 마다 한 번, 요약 문장과 서비스 토큰으로. 전사록의 줄마다가 아니다
    similar = [(c, h) for c, h in zip(fake.calls, fake.headers) if c[1].endswith("/tasks/similar")]
    assert len(MEETING) == 5 and len(similar) == len(FINDINGS) == 3
    assert [c[2]["text"] for c, _ in similar] == [f["summary"] for f in FINDINGS]
    assert [len(fakes["terra"].prompts), len(fakes["draft"].prompts)] == [3, 3]    # 2단계와 초안도 finding 마다
    assert [c[1] for c in fake.calls].count("/extractions") == 1                  # 등록은 회의마다 한 번
    assert all(h == {"X-Service-Token": "svc-token"} and c[1] == "/workspaces/ws-1/tasks/similar" for c, h in similar)

    sent = fake.extractions["m1"]["items"]
    assert [(i["action"], i["target_task_id"]) for i in sent] == [("create", None), ("update", "task_search"),
                                                                 ("update", "task_login")]
    create, progress, schedule = sent
    # 1인칭 담당자는 BE 가 uid 로 찾는다. 이름으로 나갔던 화자가 uid 로 돌아왔다
    assert create["assignee_type"] == "first" and create["assignee_raw"] is None and create["evidence_speaker"] == "103"
    assert create["task_title"] == "결제 환불 기능 구현" and create["due_date"] == "2026-10-11"
    assert create["evidence_quote"] == "네, 제가 맡을게요." and create["evidence_at_ms"] == 7000
    # 진척 보고는 문서에 쓸 새 내용이 없어도 기존 task 의 상태 변경으로 BE 까지 간다
    assert progress["status"] == "done" and progress["doc_text"].startswith("검색 기능 성능 개선 완료")
    assert schedule["due_date"] == "2026-10-06" and schedule["evidence_speaker"] == "105"
    # 확신도는 파이프라인이 준 그대로다. 지금은 값이 없어 BE 가 새 항목을 hold 로 둔다
    assert not any("task_confidence" in i for i in sent)
    assert saved["be"]["item_count"] == 3 and "dropped_items" not in saved["be"] and "extract_failures" not in saved


def test_a_first_person_item_carries_the_speaker_of_the_last_evidence_line(tmp_path, monkeypatch):
    """지금의 한계를 적어 둔다. 파이프라인은 근거 묶음의 마지막 줄 화자를 넘기고, BE 는 그 사람을 1인칭 담당자로 찾는다.

    "제가 맡을게요" 뒤에 다른 사람의 "네, 감사합니다" 가 같은 묶음에 들어오면 감사 인사를 한 사람이 담당자가 된다.
    결정 근거와 담당자 근거를 나누는 것은 파이프라인 출력이 바뀌어야 한다. 그때 이 테스트와 인계를 같이 고친다.
    """
    segments = [
        {"speaker": "103", "start": 3.0, "end": 5.0, "seq": 1, "text": "API 명세서는 제가 맡을게요."},
        {"speaker": "101", "start": 6.0, "end": 7.0, "seq": 2, "text": "네, 감사합니다."},
    ]
    finding = {"indices": [0, 1], "summary": "API 명세서 작성을 재환이 맡기로 함", "signal": "decision",
               "assignee_type": "first", "reason": "수락"}
    _fake_llms(monkeypatch, stage1={"findings": [finding]}, terra=[TERRA[0]],
               drafts=[{"task": "API 명세서 작성", "due_date": None, "doc_text": "API 명세서 작성을 재환이 맡기로 함"}])
    fake = FakeBe()
    _process(tmp_path, fake, segments)
    item = fake.extractions["m1"]["items"][0]
    assert item["assignee_type"] == "first" and item["evidence_speaker"] == "101"      # 맡겠다고 한 사람은 103 이다


def test_a_wrong_service_token_never_registers_an_empty_extraction(tmp_path, monkeypatch):
    """토큰이 틀리면 finding 마다 유사 검색이 401 이다. 파이프라인은 예외 없이 빈 결과를 돌려주지만 등록하지 않는다."""
    _fake_llms(monkeypatch, stage1={"findings": FINDINGS}, terra=[], drafts=[])
    fake = FakeBe()
    fake.service_token = "다른 값"
    result, saved = _process(tmp_path, fake)
    assert result["status"] == "failed" and result["failed_stage"] == "extract"
    assert "JudgeAllFailed" in result["error"] and "UNAUTHENTICATED" in result["error"]
    assert fake.extractions == {} and fake.meetings["m1"]["status"] == "processing"
    assert saved["recovery"]["attempts"] == 1 and "items" not in saved


def test_a_stage1_reply_without_findings_never_registers_an_empty_extraction(tmp_path, monkeypatch):
    """1단계가 첫 실행부터 findings 키 없는 응답({})을 주면, "결정 없는 회의"로 등록하지 않고 단계 실패로 센다.

    0건으로 받아들이면 items=[]/failures=[] 로 인계돼 회의가 done 으로 닫히고, 재전송도 기존 빈 추출을 돌려준다(#128).
    """
    fakes = _fake_llms(monkeypatch, stage1={}, terra=[], drafts=[])
    fake = FakeBe()
    result, saved = _process(tmp_path, fake)
    assert result["status"] == "failed" and result["failed_stage"] == "extract"
    assert "FindingExtractionUnavailableError" in result["error"]
    assert fake.extractions == {} and fake.meetings["m1"]["status"] == "processing" and "items" not in saved
    assert fakes["terra"].prompts == []                                       # 2단계까지 가지 않았다


def test_an_unjudged_finding_with_no_items_is_not_registered_as_an_empty_extraction(tmp_path, monkeypatch):
    """finding 둘은 바꿀 것이 없다고 판단됐고 하나는 판단하지 못했다. 항목은 0개다. 그대로 등록하면 판단 실패가
    "결정 없는 회의" 로 저장된다. BE 에는 판단하지 못한 finding 을 받을 칸이 없다. 등록하지 않고 단계 실패로 센다."""
    quiet = {"is_meaningful": False, "category": "none", "is_new": False, "matched_candidate_index": None,
             "status": None, "evidence": "이미 반영돼 있다"}
    _fake_llms(monkeypatch, stage1={"findings": FINDINGS}, terra=[quiet, quiet, None], drafts=[])
    fake = FakeBe()
    result, saved = _process(tmp_path, fake)
    assert result["status"] == "failed" and result["failed_stage"] == "extract"
    assert "JudgeAllFailed" in result["error"] and "판단하지 못한 발화 1개" in result["error"]
    assert "첫 실패(judge)" in result["error"]
    assert fake.extractions == {} and fake.meetings["m1"]["status"] == "processing" and "items" not in saved
