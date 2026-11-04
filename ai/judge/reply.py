"""리마인드 답장 판단. BE 가 맡긴 답장 하나를 판단 본문(태스크별 변경 줄)으로 바꾼다.

회의 판단(judge/pipeline.py)을 그대로 쓴다. 대화를 chat 전사로 만들고, 유사 검색 대신 BE 가 정한 후보를 끼우고,
judge_seq 로 이번 답장에 근거가 있는 finding 만 판단한다. 앞 줄은 1단계의 문맥이다.

1단계는 답장 하나를 finding 하나로 묶거나 "다 했어요" 를 걸러낸다. 그러면 언급된 태스크가 빠지거나 PM 이 답장을 모른다.
그래서 후보가 둘 이상이면 run 이 고르지 않은 후보마다 답장 글을 후보 하나만 끼워 Terra 에게 다시 묻는다. 대상이 모호한
답장은 뒤의 Jev target 질문에서 unknown 이 된다.

여기서는 무엇을 반영할지 정하지 않는다. 필드마다 한 줄로 나누고 status 근거를 Jev 에게 물어 적을 뿐, 자동 반영과
PM 확인의 갈림은 BE 게이트가 맡는다.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from jev import JevClient
from judge import pipeline
from judge.evidence import verify_reply
from shared.schemas import JudgeFinding, JudgeInput, NotionCandidate, Transcript, TranscriptSegment

logger = logging.getLogger(__name__)

MODEL_NAME = "terra+luna+jev"


class ReplyJudgeFailed(RuntimeError):
    """바꿀 줄 없이 판단하지 못한 finding 만 남았다. 메시지에 답장 글을 싣지 않는다."""


class _FixedCandidates:
    """CandidateSource. 어떤 문장이든 BE 가 정한 후보를 돌려준다."""

    def __init__(self, candidates: list[dict[str, Any]]):
        self._found = [NotionCandidate.from_dict({**c, "similarity": 1.0}) for c in candidates]

    def similar_tasks(self, workspace_id: str, text: str) -> list[NotionCandidate]:
        return self._found


def _squeeze(text: str) -> str:
    return " ".join(text.split())


def _line(field: str, summary: str | None, quote: str | None, *, task_id: str | None = None,
          new_value: str | None = None, evidence_status: str | None = None, assignee_type: str | None = None,
          assignee_raw: str | None = None, base: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"task_id": task_id, "field": field, "new_value": new_value, "evidence_status": evidence_status,
            "summary": summary, "evidence_quote": quote, "assignee_type": assignee_type,
            "assignee_raw": assignee_raw, "base": base}


def _field_lines(item: dict[str, Any], evidence_status: str) -> list[dict[str, Any]]:
    """update item 하나를 필드마다 한 줄로. status 만 Jev 로 잰다."""
    same = {"summary": item["doc_text"], "quote": item["evidence_quote"], "task_id": item["target_task_id"],
            "base": item["target_snapshot"]}
    lines = []
    if item["status"] is not None:
        lines.append(_line("status", **same, new_value=item["status"], evidence_status=evidence_status))
    if item["due_date"] is not None:
        lines.append(_line("due_date", **same, new_value=item["due_date"]))
    if item["assignee_raw"] or item["assignee_type"] == "first":
        lines.append(_line("assignee", **same, new_value=item["assignee_raw"], assignee_type=item["assignee_type"],
                           assignee_raw=item["assignee_raw"]))
    if item["category"] == "scope":
        lines.append(_line("scope", **same))
    return lines


def _changes(result: pipeline.PipelineResult, claim: dict[str, Any], jev: JevClient) -> list[dict[str, Any]]:
    """run 결과 → 변경 줄.

    create            unknown 한 줄. 답장으로 새 태스크를 만들지 않는다
    update            필드마다 한 줄. target_clear=False 면 그 대신 unknown 한 줄
    마감 지움 실패    due_clear 한 줄
    대상 실패         unknown 한 줄
    그 밖의 실패      failed 한 줄
    """
    lines = [{**line, "text": _squeeze(line["text"])} for line in claim["lines"]]
    reply = lines[-1]["text"]
    today = date.fromisoformat(claim["reply_date"])
    titles = {c["task_id"]: c["title"] for c in claim["candidates"]}
    changes: list[dict[str, Any]] = []
    for item in result.items:
        if item["action"] == "create":
            changes.append(_line("unknown", item["doc_text"], item["evidence_quote"]))
            continue
        others = [title for task_id, title in titles.items() if task_id != item["target_task_id"]]
        evidence_status, target_clear = verify_reply(lines, item["task_title"], status=item["status"], others=others,
                                                     today=today, client=jev)
        changes += (_field_lines(item, evidence_status) if target_clear
                    else [_line("unknown", item["doc_text"], item["evidence_quote"])])
    for failure in result.failures:
        field = ("due_clear" if failure.reason == pipeline.DUE_CLEARED_REASON
                 else "unknown" if failure.stage == "target" else "failed")
        changes.append(_line(field, failure.finding_text, reply))
    return changes


def _supplement(result: pipeline.PipelineResult, found: list[NotionCandidate], transcript: Transcript, *, today: date,
                judge, draft) -> list[dict[str, Any]]:
    """run 이 고르지 않은 후보의 update item. 후보를 하나만 주므로 run 과 같은 태스크가 나올 수 없다."""
    reply = transcript.segments[-1]
    finding = JudgeFinding(text=reply.text, evidence=[reply.text], source="chat", seq=reply.seq, speaker=reply.speaker,
                           method="llm")
    chosen = {item["target_task_id"] for item in result.items}
    items = []
    for target in found:
        if target.task_id in chosen:
            continue
        try:
            verdict = judge(JudgeInput(source="chat", text=reply.text, candidates=[target]))
            if not verdict.is_meaningful or verdict.is_new:
                continue
            drafted = draft(finding, verdict, candidate=target, today=today)
        except (pipeline.JudgeUnavailableError, pipeline.DraftUnavailableError) as e:
            logger.warning("보충 판단을 건너뛴다: task=%s %s", target.task_id, type(e).__name__)
            continue
        item = pipeline.to_item(finding, verdict, drafted, target, transcript)
        if item is not None:
            items.append(item)
    return items


def judge_reply(item: dict[str, Any], *, run=None, jev: JevClient | None = None, judge=None,
                draft=None) -> dict[str, Any]:
    """claim item → judgment 본문. run, jev, judge, draft 는 테스트가 바꿔 끼운다.

    후보가 하나면 보충 판단을 하지 않는다. PM 이 고른 뒤의 재판단도 고른 태스크만 후보로 온다.
    전체 실패는 예외다. 호출자가 예외 종류를 failure_reason 으로 보고한다.
    """
    transcript = Transcript(source="chat", segments=[
        TranscriptSegment(speaker="PM" if line["sender"] == "pm" else item["member_name"], start=float(i),
                          end=float(i), text=_squeeze(line["text"]), seq=i + 1)
        for i, line in enumerate(item["lines"])])
    today = date.fromisoformat(item["reply_date"])
    candidates = _FixedCandidates(item["candidates"])
    result = (run or pipeline.run)(transcript, workspace_id=item["workspace_id"], today=today, candidates=candidates,
                                   judge_seq=len(item["lines"]))
    if len(item["candidates"]) > 1:
        found = candidates.similar_tasks(item["workspace_id"], transcript.segments[-1].text)
        result.items += _supplement(result, found, transcript, today=today, judge=judge or pipeline.judge,
                                    draft=draft or pipeline.draft)
    changes = _changes(result, item, jev or pipeline.get_jev())
    if changes and all(c["field"] == "failed" for c in changes):
        raise ReplyJudgeFailed(f"판단하지 못한 finding {len(changes)}개만 남았다")
    return {"attempt": item["attempt"], "failure_reason": None, "model_name": MODEL_NAME, "changes": changes}
