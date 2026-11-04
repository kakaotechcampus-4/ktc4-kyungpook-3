"""답장 판단(judge/reply.py). run·보충 판단·Jev 는 가짜로 끼우고, 마감 지움만 실제 run 으로 고정한다."""

from datetime import date

import pytest

from draft.doc_draft import DraftUnavailableError
from jev import FakeJev
from judge.final_judge import JudgeUnavailableError
from judge.pipeline import DUE_CLEARED_REASON, PipelineFailure, PipelineResult
from judge.reply import MODEL_NAME, ReplyJudgeFailed, judge_reply
from shared.schemas import DraftResult, DraftStructured, JudgeResult
from tests.test_pipeline import _install, _terra

API = {"task_id": "t_api", "title": "API 명세서 작성", "status": "in_progress", "due_date": "2026-11-07",
       "assignee_member_id": "m_jh", "updated_at": "2026-11-01T00:00:00+00:00"}
LOGIN = {"task_id": "t_login", "title": "로그인 화면", "status": "todo", "due_date": "2026-11-10",
         "assignee_member_id": "m_jh", "updated_at": "2026-11-02T00:00:00+00:00"}
REPLY = "API 명세서는 다 했어요"


def _claim(*candidates, lines=None):
    return {"message_id": "msg_1", "attempt": 2, "workspace_id": "ws_1", "member_name": "재환",
            "reply_date": "2026-11-04",
            "lines": lines or [{"sender": "pm", "text": "API 명세서 어떻게 됐어요?"}, {"sender": "member", "text": REPLY}],
            "candidates": list(candidates or [API])}


def _update(task=API, **over):
    snapshot = {k: task[k] for k in ("updated_at", "due_date", "status", "assignee_member_id")} | {"title": task["title"]}
    base = {"action": "update", "target_task_id": task["task_id"], "category": "status", "task_title": task["title"],
            "due_date": None, "status": None, "assignee_type": None, "assignee_raw": None, "doc_text": "해석",
            "evidence_quote": REPLY, "evidence_speaker": "재환", "evidence_at_ms": 1000, "target_snapshot": snapshot}
    return base | over


def _create(**over):
    return {"action": "create", "target_task_id": None, "category": "decision", "task_title": "새 일", "due_date": None,
            "status": None, "assignee_type": "none", "assignee_raw": None, "doc_text": "새 일을 함",
            "evidence_quote": "새 일도 했어요", "evidence_speaker": "재환", "evidence_at_ms": 1000} | over


class FakeRun:
    def __init__(self, *items, failures=()):
        self.result = PipelineResult(items=list(items), failures=list(failures))
        self.calls = []

    def __call__(self, transcript, *, workspace_id, today, candidates, judge_seq):
        self.calls.append((transcript, workspace_id, today, candidates, judge_seq))
        return self.result


def _changed(task, status="done", category="status"):
    return JudgeResult(is_meaningful=True, category=category, is_new=False, matched_task_id=task["task_id"], status=status)


class FakeJudge:
    """task_id → 판정이나 예외. 없는 후보는 바꿀 것 없음이다. 후보를 둘 이상 주면 풀다가 터진다."""

    def __init__(self, verdicts=None):
        self.verdicts = verdicts or {}
        self.inputs = []

    def __call__(self, judge_input):
        self.inputs.append(judge_input)
        (candidate,) = judge_input.candidates
        verdict = self.verdicts.get(candidate.task_id, JudgeResult(is_meaningful=False, category="none", is_new=False))
        if isinstance(verdict, Exception):
            raise verdict
        return verdict


def _draft(finding, result, *, candidate, today):
    return DraftResult(structured=DraftStructured(task=None, due_date=None), doc_text=f"{candidate.title} 보충 해석")


def _yes(status=None, target=None):
    out = {}
    for key, p in (("status", status), ("target", target)):
        if p is not None:
            out[key] = {"probabilities": {"yes": p, "no": 1 - p, "unclear": 0.0}}
    return out


def _judge(run, claim=None, jev=None, judge=None, draft=_draft):
    return judge_reply(claim or _claim(), run=run, jev=jev or FakeJev(), judge=judge or FakeJudge(), draft=draft)


def _shape(body):
    return [(c["task_id"], c["field"], c["new_value"], c["evidence_status"]) for c in body["changes"]]


# ── 전사와 후보


def test_the_chat_becomes_a_transcript_and_only_this_reply_is_judged():
    run = FakeRun()
    lines = [{"sender": "pm", "text": "API  명세서\n어떻게 됐어요?"}, {"sender": "member", "text": "금요일까지요"},
             {"sender": "pm", "text": "로그인은요?"}, {"sender": "member", "text": REPLY}]
    _judge(run, _claim(API, lines=lines))

    (transcript, workspace_id, today, _, judge_seq), = run.calls
    assert transcript.source == "chat"
    assert [(s.speaker, s.text, s.seq, s.start, s.end) for s in transcript.segments] == [
        ("PM", "API 명세서 어떻게 됐어요?", 1, 0.0, 0.0), ("재환", "금요일까지요", 2, 1.0, 1.0),
        ("PM", "로그인은요?", 3, 2.0, 2.0), ("재환", REPLY, 4, 3.0, 3.0)]
    assert (workspace_id, today, judge_seq) == ("ws_1", date(2026, 11, 4), 4)


def test_candidates_are_the_claimed_tasks_whatever_the_text():
    run = FakeRun()
    _judge(run, _claim(API, LOGIN))

    source = run.calls[0][3]
    (api, login) = source.similar_tasks("ws_1", "관계없는 문장")
    assert (api.task_id, api.title, api.status, api.due_date, api.assignee_member_id, api.updated_at) == (
        "t_api", "API 명세서 작성", "in_progress", "2026-11-07", "m_jh", "2026-11-01T00:00:00+00:00")
    assert (api.similarity, api.meeting_note) == (1.0, "")
    assert login.task_id == "t_login"


# ── 표: update


def test_a_status_change_is_one_line_with_its_evidence():
    jev = FakeJev([_yes(status=0.95)])
    body = _judge(FakeRun(_update(status="done")), jev=jev)

    assert body["attempt"] == 2 and body["failure_reason"] is None and body["model_name"] == MODEL_NAME
    (line,) = body["changes"]
    assert line == {"task_id": "t_api", "field": "status", "new_value": "done", "evidence_status": "certain",
                    "summary": "해석", "evidence_quote": REPLY, "assignee_type": None, "assignee_raw": None,
                    "base": {"updated_at": API["updated_at"], "due_date": "2026-11-07", "status": "in_progress",
                             "assignee_member_id": "m_jh", "title": "API 명세서 작성"}}


def test_a_low_yes_stays_inferred():
    body = _judge(FakeRun(_update(status="done")), jev=FakeJev([_yes(status=0.3)]))
    assert _shape(body) == [("t_api", "status", "done", "inferred")]


def test_a_failed_jev_call_stays_inferred_and_keeps_the_task():
    body = _judge(FakeRun(_update(status="done")), _claim(API, LOGIN), jev=FakeJev([None]))
    assert _shape(body) == [("t_api", "status", "done", "inferred")]


def test_every_field_of_an_item_is_its_own_line_and_jev_is_called_once():
    jev = FakeJev([_yes(status=0.9)])
    item = _update(status="done", due_date="2026-11-14", assignee_type="thirdname", assignee_raw="지민", category="scope")
    body = _judge(FakeRun(item), jev=jev)

    assert _shape(body) == [("t_api", "status", "done", "certain"), ("t_api", "due_date", "2026-11-14", None),
                            ("t_api", "assignee", "지민", None), ("t_api", "scope", None, None)]
    assignee = body["changes"][2]
    assert (assignee["assignee_type"], assignee["assignee_raw"]) == ("thirdname", "지민")
    assert all(c["base"]["title"] == "API 명세서 작성" for c in body["changes"])
    assert len(jev.calls) == 1


def test_a_first_person_assignee_counts_as_a_change():
    body = _judge(FakeRun(_update(category="assignee", assignee_type="first")))
    assert _shape(body) == [("t_api", "assignee", None, None)]
    assert body["changes"][0]["assignee_type"] == "first"


def test_due_date_on_one_candidate_does_not_call_jev():
    jev = FakeJev()
    body = _judge(FakeRun(_update(category="schedule", due_date="2026-11-14")), jev=jev)
    assert _shape(body) == [("t_api", "due_date", "2026-11-14", None)]
    assert jev.calls == []


def test_due_date_with_other_candidates_asks_the_target_once():
    jev = FakeJev([_yes(target=0.9)])
    body = _judge(FakeRun(_update(category="schedule", due_date="2026-11-14")), _claim(API, LOGIN), jev=jev)
    assert _shape(body) == [("t_api", "due_date", "2026-11-14", None)]
    (state, questions), = jev.calls
    assert set(questions) == {"target"} and "로그인 화면" in state


def test_two_tasks_in_one_reply_are_two_lines():
    jev = FakeJev([_yes(status=0.9, target=0.9), _yes(target=0.9)])
    items = [_update(status="done"), _update(LOGIN, category="schedule", due_date="2026-11-14")]
    body = _judge(FakeRun(*items), _claim(API, LOGIN), jev=jev)

    assert _shape(body) == [("t_api", "status", "done", "certain"), ("t_login", "due_date", "2026-11-14", None)]
    assert len(jev.calls) == 2


def test_an_unclear_target_turns_the_whole_item_into_one_unknown():
    jev = FakeJev([_yes(status=0.9, target=0.2)])
    item = _update(status="done", due_date="2026-11-14")
    body = _judge(FakeRun(item), _claim(API, LOGIN), jev=jev)

    assert _shape(body) == [(None, "unknown", None, None)]
    (line,) = body["changes"]
    assert (line["summary"], line["evidence_quote"], line["base"]) == ("해석", REPLY, None)


# ── 표: 그 밖


def test_a_new_item_becomes_unknown_and_never_a_task():
    body = _judge(FakeRun(_create()))
    assert _shape(body) == [(None, "unknown", None, None)]
    assert (body["changes"][0]["summary"], body["changes"][0]["evidence_quote"]) == ("새 일을 함", "새 일도 했어요")


def test_a_target_failure_becomes_unknown():
    body = _judge(FakeRun(failures=[PipelineFailure("target", "요약", "수정 대상 후보를 찾지 못했습니다.")]))
    assert _shape(body) == [(None, "unknown", None, None)]
    assert (body["changes"][0]["summary"], body["changes"][0]["evidence_quote"]) == ("요약", REPLY)


def test_the_due_cleared_reason_becomes_due_clear():
    body = _judge(FakeRun(failures=[PipelineFailure("draft", "마감을 없앰", DUE_CLEARED_REASON)]))
    assert _shape(body) == [(None, "due_clear", None, None)]
    assert (body["changes"][0]["summary"], body["changes"][0]["evidence_quote"]) == ("마감을 없앰", REPLY)


def test_another_failure_next_to_a_change_is_a_failed_line():
    jev = FakeJev([_yes(status=0.9)])
    run = FakeRun(_update(status="done"), failures=[PipelineFailure("judge", "요약", "Terra 응답을 파싱하지 못했습니다.")])
    body = _judge(run, jev=jev)

    assert _shape(body) == [("t_api", "status", "done", "certain"), (None, "failed", None, None)]
    assert body["failure_reason"] is None


def test_unknown_next_to_a_failure_is_returned():
    run = FakeRun(_create(), failures=[PipelineFailure("draft", "요약", "x")])
    assert [c["field"] for c in _judge(run)["changes"]] == ["unknown", "failed"]


def test_only_failures_raise_without_quoting_the_reply():
    run = FakeRun(failures=[PipelineFailure("judge", "요약 문장", "x"), PipelineFailure("similar", "요약 문장", "y")])
    with pytest.raises(ReplyJudgeFailed) as e:
        _judge(run)
    assert "요약 문장" not in str(e.value) and REPLY not in str(e.value)


def test_nothing_found_is_no_changes():
    body = _judge(FakeRun())
    assert body == {"attempt": 2, "failure_reason": None, "model_name": MODEL_NAME, "changes": []}


# ── 보충 판단


def test_a_later_task_left_out_of_the_run_gets_its_own_line():
    jev = FakeJev([_yes(status=0.9, target=0.9), _yes(status=0.9, target=0.9)])
    judge = FakeJudge({"t_login": _changed(LOGIN, status="blocked")})
    body = _judge(FakeRun(_update(status="done")), _claim(API, LOGIN), jev=jev, judge=judge)

    assert _shape(body) == [("t_api", "status", "done", "certain"), ("t_login", "status", "blocked", "certain")]
    line = body["changes"][1]
    assert (line["summary"], line["evidence_quote"]) == ("로그인 화면 보충 해석", REPLY)
    assert line["base"] == {"updated_at": LOGIN["updated_at"], "due_date": "2026-11-10", "status": "todo",
                            "assignee_member_id": "m_jh", "title": "로그인 화면"}


def test_a_candidate_the_run_chose_is_not_judged_again():
    judge = FakeJudge()
    _judge(FakeRun(_update(status="done")), _claim(API, LOGIN), jev=FakeJev([_yes(status=0.9, target=0.9)]), judge=judge)

    (judged,) = judge.inputs
    assert (judged.source, judged.text) == ("chat", REPLY)
    assert [c.task_id for c in judged.candidates] == ["t_login"]


def test_a_new_item_chooses_no_candidate():
    judge = FakeJudge()
    _judge(FakeRun(_create()), _claim(API, LOGIN), judge=judge)
    assert [c.task_id for j in judge.inputs for c in j.candidates] == ["t_api", "t_login"]


@pytest.mark.parametrize("text", ["다 했어요", "그거 끝났어요"])
def test_a_bare_finish_over_two_candidates_after_an_empty_run_is_unknown(text):
    lines = [{"sender": "pm", "text": "API 명세서는요?"}, {"sender": "pm", "text": "로그인 화면은요?"},
             {"sender": "member", "text": text}]
    jev = FakeJev([_yes(status=0.9, target=0.2), _yes(status=0.9, target=0.2)])
    judge = FakeJudge({"t_api": _changed(API), "t_login": _changed(LOGIN)})
    body = _judge(FakeRun(), _claim(API, LOGIN, lines=lines), jev=jev, judge=judge)

    assert {c["field"] for c in body["changes"]} == {"unknown"}
    assert {(c["task_id"], c["evidence_quote"]) for c in body["changes"]} == {(None, text)}


def test_a_plain_ack_stays_no_changes_after_the_supplement():
    jev = FakeJev()
    judge = FakeJudge()
    body = _judge(FakeRun(), _claim(API, LOGIN), jev=jev, judge=judge)

    assert body["changes"] == [] and jev.calls == []
    assert len(judge.inputs) == 2


def test_a_candidate_judged_as_a_new_item_is_no_line():
    verdict = JudgeResult(is_meaningful=True, category="decision", is_new=True)
    body = _judge(FakeRun(), _claim(API, LOGIN), judge=FakeJudge({"t_api": verdict, "t_login": verdict}))
    assert body["changes"] == []


def test_a_supplement_with_nothing_to_change_is_no_line():
    body = _judge(FakeRun(), _claim(API, LOGIN), judge=FakeJudge({"t_api": _changed(API, status="in_progress")}))
    assert body["changes"] == []


def test_one_candidate_is_never_supplemented():
    judge = FakeJudge()
    _judge(FakeRun(), _claim(API), judge=judge)
    assert judge.inputs == []


@pytest.mark.parametrize("failure", [JudgeUnavailableError("x"), DraftUnavailableError("x")])
def test_a_failed_supplement_marks_that_candidate_and_keeps_the_rest(failure, caplog):
    def draft(finding, result, *, candidate, today):
        if candidate.task_id == "t_api" and isinstance(failure, DraftUnavailableError):
            raise failure
        return _draft(finding, result, candidate=candidate, today=today)

    verdicts = {"t_api": failure if isinstance(failure, JudgeUnavailableError) else _changed(API), "t_login": _changed(LOGIN)}
    body = _judge(FakeRun(), _claim(API, LOGIN), jev=FakeJev([_yes(status=0.9, target=0.9)]),
                  judge=FakeJudge(verdicts), draft=draft)

    assert _shape(body) == [("t_login", "status", "done", "certain"), ("t_api", "failed", None, None)]
    assert "t_api" in caplog.text and REPLY not in caplog.text


def test_a_failed_supplement_next_to_a_run_change_is_a_failed_line_for_that_task():
    jev = FakeJev([_yes(status=0.9, target=0.9)])
    judge = FakeJudge({"t_login": JudgeUnavailableError("x")})
    body = _judge(FakeRun(_update(status="done")), _claim(API, LOGIN), jev=jev, judge=judge)

    assert _shape(body) == [("t_api", "status", "done", "certain"), ("t_login", "failed", None, None)]
    assert body["changes"][1]["evidence_quote"] == REPLY and body["failure_reason"] is None


def test_nothing_found_and_a_failed_supplement_is_a_failed_judgment():
    def down(judge_input):
        raise JudgeUnavailableError("terra")

    with pytest.raises(ReplyJudgeFailed):
        judge_reply(_claim(API, LOGIN), run=FakeRun(), jev=FakeJev({}), judge=down, draft=None)


def test_failure_lines_stay_as_they_are_next_to_a_supplement():
    run = FakeRun(failures=[PipelineFailure("draft", "마감을 없앰", DUE_CLEARED_REASON),
                            PipelineFailure("target", "요약", "수정 대상 후보를 찾지 못했습니다.")])
    body = _judge(run, _claim(API, LOGIN), jev=FakeJev([_yes(status=0.9, target=0.9)]),
                  judge=FakeJudge({"t_login": _changed(LOGIN)}))

    assert [c["field"] for c in body["changes"]] == ["status", "due_clear", "unknown"]


# ── 실제 run


def test_the_real_run_splits_a_reply_stage_one_merged(monkeypatch):
    # 1단계가 답장 전체를 finding 하나로 묶어 Terra 가 로그인 화면만 골라도, 나머지 후보가 제 줄을 받는다
    reply = "로그인 화면은 다 했는데 API 명세서는 서버 스펙이 안 와서 막혔어요"
    stage1 = {"findings": [{"indices": [2], "summary": reply, "assignee_type": "none", "reason": "진척"}]}
    fakes = _install(monkeypatch, stage1=stage1,
                     terra=[_terra(category="status", status="done", matched_candidate_index=1),
                            _terra(category="status", status="blocked", matched_candidate_index=0)],
                     luna_draft=[{"task": None, "due_date": None, "doc_text": "로그인 화면 완료"},
                                 {"task": None, "due_date": None, "doc_text": "API 명세서 막힘"}])
    jev = FakeJev([_yes(status=0.9, target=0.9), _yes(status=0.9, target=0.9)])

    body = judge_reply(_claim(API, LOGIN, lines=[
        {"sender": "pm", "text": "API 명세서는요?"}, {"sender": "pm", "text": "로그인 화면은요?"},
        {"sender": "member", "text": reply}]), jev=jev)

    assert _shape(body) == [("t_login", "status", "done", "certain"), ("t_api", "status", "blocked", "certain")]
    assert body["changes"][1]["evidence_quote"] == reply
    assert len(fakes["terra"].prompts) == 2 and "로그인 화면'," not in fakes["terra"].prompts[1]


def test_the_real_run_reports_a_cleared_due_as_due_clear(monkeypatch):
    # judge_reply 가 DUE_CLEARED_REASON 으로 알아보는 자리를 실제 run 으로 고정한다
    stage1 = {"findings": [{"indices": [1], "summary": "API 명세서 마감을 없앰", "assignee_type": "none", "reason": "일정"}]}
    _install(monkeypatch, stage1=stage1, terra=[_terra(category="schedule")],
             luna_draft=[{"task": None, "due_date": "none", "doc_text": "마감을 없앰"}])

    body = judge_reply(_claim(lines=[{"sender": "pm", "text": "마감 괜찮아요?"},
                                     {"sender": "member", "text": "마감이 없어졌어요"}]), jev=FakeJev())

    assert _shape(body) == [(None, "due_clear", None, None)]
    assert body["changes"][0]["evidence_quote"] == "마감이 없어졌어요"


def test_the_real_run_keeps_a_block_on_a_task_shown_with_its_earlier_status(monkeypatch):
    # 시계가 도는 막힘 태스크는 막기 전 상태로 온다. to_item 이 같은 값이라며 지우지 않아야 한다
    stage1 = {"findings": [{"indices": [1], "summary": "API 명세서가 막혔다고 함", "assignee_type": "none", "reason": "진척"}]}
    _install(monkeypatch, stage1=stage1, terra=[_terra(category="status", status="blocked")],
             luna_draft=[{"task": None, "due_date": None, "doc_text": "API 명세서가 막힘"}])

    body = judge_reply(_claim(lines=[{"sender": "pm", "text": "API 명세서는요?"},
                                     {"sender": "member", "text": "서버가 안 와서 막혔어요"}]),
                       jev=FakeJev([_yes(status=0.9)]))

    assert _shape(body) == [("t_api", "status", "blocked", "certain")]
    assert body["changes"][0]["base"]["status"] == "in_progress"


def test_the_real_run_splits_one_reply_into_a_line_per_task(monkeypatch):
    stage1 = {"findings": [
        {"indices": [2], "summary": "API 명세서를 끝냄", "assignee_type": "none", "reason": "진척"},
        {"indices": [2], "summary": "로그인 화면 마감을 11/13으로 미룸", "assignee_type": "none", "reason": "일정"}]}
    _install(monkeypatch, stage1=stage1,
             terra=[_terra(category="status", status="done"), _terra(category="schedule", matched_candidate_index=1)],
             luna_draft=[{"task": None, "due_date": None, "doc_text": "API 명세서 완료"},
                         {"task": None, "due_date": "2026-11-13", "doc_text": "로그인 마감을 11/13으로"}])
    jev = FakeJev([_yes(status=0.9, target=0.9), _yes(target=0.9)])

    body = judge_reply(_claim(API, LOGIN, lines=[
        {"sender": "pm", "text": "API 명세서는요?"}, {"sender": "pm", "text": "로그인 화면은요?"},
        {"sender": "member", "text": "API 는 다 했고 로그인은 다음 주 금요일까지요"}]), jev=jev)

    assert _shape(body) == [("t_api", "status", "done", "certain"), ("t_login", "due_date", "2026-11-13", None)]


def test_the_real_run_makes_no_line_from_an_earlier_reply(monkeypatch):
    stage1 = {"findings": [{"indices": [1], "summary": "API 명세서 마감을 금요일로 정함", "assignee_type": "none", "reason": "일정"}]}
    fakes = _install(monkeypatch, stage1=stage1, terra=[], luna_draft=[])

    body = judge_reply(_claim(lines=[{"sender": "pm", "text": "API 명세서는요?"},
                                     {"sender": "member", "text": "금요일까지 할게요"},
                                     {"sender": "member", "text": "네 그렇게요"}]), jev=FakeJev())

    assert body["changes"] == [] and fakes["terra"].prompts == []
