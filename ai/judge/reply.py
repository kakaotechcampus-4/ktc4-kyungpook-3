"""리마인드 답장 판단. BE 가 맡긴 답장 하나를 판단 본문(태스크별 변경 줄)으로 바꾼다.

회의 판단(judge/pipeline.py)을 그대로 쓴다. 대화를 chat 전사로 만들고, 유사 검색 대신 BE 가 정한 후보를 끼우고,
judge_seq 로 이번 답장에 근거가 있는 finding 만 판단한다. 앞 줄은 1단계의 문맥이다.

여기서는 무엇을 반영할지 정하지 않는다. 필드마다 한 줄로 나누고 status 근거를 Jev 에게 물어 적을 뿐, 자동 반영과
PM 확인의 갈림은 BE 게이트가 맡는다.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from jev import JevClient
from judge import pipeline
from judge.evidence import verify_reply
from shared.schemas import NotionCandidate, Transcript, TranscriptSegment

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


def judge_reply(item: dict[str, Any], *, run=None, jev: JevClient | None = None) -> dict[str, Any]:
    """claim item → judgment 본문. run 과 jev 는 테스트가 바꿔 끼운다.

    전체 실패는 예외다. 호출자가 예외 종류를 failure_reason 으로 보고한다.
    """
    transcript = Transcript(source="chat", segments=[
        TranscriptSegment(speaker="PM" if line["sender"] == "pm" else item["member_name"], start=float(i),
                          end=float(i), text=_squeeze(line["text"]), seq=i + 1)
        for i, line in enumerate(item["lines"])])
    result = (run or pipeline.run)(transcript, workspace_id=item["workspace_id"],
                                   today=date.fromisoformat(item["reply_date"]),
                                   candidates=_FixedCandidates(item["candidates"]), judge_seq=len(item["lines"]))
    changes = _changes(result, item, jev or pipeline.get_jev())
    if changes and all(c["field"] == "failed" for c in changes):
        raise ReplyJudgeFailed(f"판단하지 못한 finding {len(changes)}개만 남았다")
    return {"attempt": item["attempt"], "failure_reason": None, "model_name": MODEL_NAME, "changes": changes}
