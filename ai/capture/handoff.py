"""전사와 추출 결과를 BE 에 넘긴다. 봇이 BE 의 회의 API 를 직접 부른다.

BE 의 회의는 created → processing → done 으로 가고 실패는 failed 다 (backend/app/api/meetings.py,
extractions.py). 봇이 이 전이를 순서대로 부른다.

  /record 직후       POST  /api/v1/meetings              created. 매니페스트 be.meeting_id
  트랙을 닫은 뒤     PATCH /api/v1/meetings/{id}/end     processing
  추출이 끝난 뒤     POST  /api/v1/extractions           done. 항목 저장, 담당자 매칭, 게이트 판정
  어느 단계든 실패   PATCH /api/v1/meetings/{id}/fail    failed, failed_stage

POST /extractions 는 같은 회의에 두 번 보내도 한 번만 만든다. BE 가 processing → done 을 조건부
UPDATE 로 선점하고, 이미 done 이면 기존 것을 돌려준다. 그래서 복구 경로가 다시 보내도 중복이 없다.
fail 은 끝 상태라 되돌리는 전이가 없다. 실패했던 회의를 나중에 복구해 넘길 때는 새 회의를 만들고
옛 ID 를 be.replaced 에 남긴다. 되돌리는 전이가 BE 에 생기면 그때 바꾼다.

담당자 매칭에 쓰는 것은 둘이다. assignee_raw 는 별칭 텍스트로 찾고, assignee_type 이 first 이면
evidence_speaker 로 찾는다. 여기서는 evidence_speaker 에 그 문장을 말한 트랙의 디스코드 uid 를
넣는다. 추출 결과(ExtractedTask)에는 발화자가 없어 근거 문장을 전사본에서 되찾는다.

Discord 이름은 여기 없다. 매니페스트 dict 와 파일 경로만 다룬다.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

API_PREFIX = "/api/v1"
TIMEOUT_S = 10.0

# 추출기의 마감 상태를 BE 의 숫자 신뢰도로. BE 는 due_raw 가 없으면 이 값을 보지 않는다
DUE_CONFIDENCE = {"certain": 1.0, "inferred": 0.6, "missing": 0.0}


class BeError(Exception):
    """BE 가 오류 봉투를 돌려줬거나 연결이 안 됐다. code 는 BE 의 ErrorCode 또는 NETWORK, HTTP_<status>."""

    def __init__(self, code: str, message: str, *, status: int = 0, details: dict | None = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


class BeClient:
    """회의 API 네 개를 얇게 싼다. session 은 requests.Session 과 같은 request() 를 가진 것이면 된다."""

    def __init__(self, base_url: str, *, session=None, timeout: float = TIMEOUT_S) -> None:
        self.api = base_url.rstrip("/") + API_PREFIX
        self._session = session or requests.Session()
        self.timeout = timeout

    def _call(self, method: str, path: str, body: dict | None = None) -> Any:
        try:
            r = self._session.request(method, self.api + path, json=body, timeout=self.timeout)
        except requests.RequestException as e:
            raise BeError("NETWORK", f"{type(e).__name__}: {e}") from e
        try:
            payload = r.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict) and payload.get("error"):
            err = payload["error"]
            raise BeError(str(err.get("code", "UNKNOWN")), str(err.get("message", "")), status=r.status_code,
                          details=err.get("details") or {})
        if r.status_code >= 400 or not isinstance(payload, dict):
            raise BeError(f"HTTP_{r.status_code}", (getattr(r, "text", "") or "")[:200], status=r.status_code)
        return payload.get("data")

    def create_meeting(self, workspace_id: str, *, title: str | None = None, source: str = "discord") -> dict:
        return self._call("POST", "/meetings", {"workspace_id": workspace_id, "title": title, "source": source})

    def end_meeting(self, meeting_id: str) -> str:
        """created → processing. 이미 넘어간 회의면 BE 가 409 로 지금 상태를 알려 주므로 그 상태를 돌려준다."""
        try:
            data = self._call("PATCH", f"/meetings/{meeting_id}/end")
            return str(data.get("status", "processing"))
        except BeError as e:
            if e.code == "MEETING_ALREADY_ENDED":
                return str(e.details.get("status", "processing"))
            raise

    def fail_meeting(self, meeting_id: str, failed_stage: str) -> dict:
        try:
            return self._call("PATCH", f"/meetings/{meeting_id}/fail", {"failed_stage": failed_stage}) or {}
        except BeError as e:
            if e.code == "MEETING_ALREADY_ENDED":  # 이미 done 이거나 failed 다
                return e.details
            raise

    def create_extraction(self, meeting_id: str, workspace_id: str, *, transcript_path: str | None,
                          model_name: str | None, items: list[dict]) -> dict:
        return self._call("POST", "/extractions", {"meeting_id": meeting_id, "workspace_id": workspace_id,
                                                    "transcript_path": transcript_path, "model_name": model_name,
                                                    "items": items})


# ─────────────────────────────────────────────────────────── 추출 결과 → BE 항목
def _squash(text: str) -> str:
    """공백과 문장 부호를 뺀다. 추출기가 돌려준 근거 문장은 전사본과 띄어쓰기가 다를 수 있다."""
    return re.sub(r"[\W_]+", "", text or "")


def locate_sentence(sentence: str, segments: list[dict]) -> tuple[str | None, int | None]:
    """근거 문장을 말한 화자와 시각. 화자가 둘 이상 같은 문장을 말했으면 모른다고 답한다 (PM 확인으로)."""
    key = _squash(sentence)
    if not key:
        return None, None
    squashed = [(s, _squash(s.get("text", ""))) for s in segments]
    # 통째로 같은 발화가 있으면 그것. 없으면 그 문장을 품은 발화 (한 발화에 문장이 여럿일 때)
    hits = [s for s, t in squashed if t == key] or [s for s, t in squashed if key in t]
    speakers = {s.get("speaker") for s in hits}
    if len(speakers) != 1:
        return None, None
    first = min(hits, key=lambda s: float(s.get("start", 0.0)))
    return first.get("speaker"), int(round(float(first.get("start", 0.0)) * 1000))


def to_extraction_items(tasks: list[dict], transcript: dict) -> list[dict]:
    """ExtractedTask.to_dict() 목록을 BE 의 ExtractionItemCreate 목록으로.

    assignee_raw 는 별칭 텍스트다. 2인칭·대명사는 추출기가 문맥으로 푼 이름(assignee_resolved)이 있으면
    그것을 보낸다. first, group, none 은 추출기가 언급을 비우므로 None 이 간다.
    """
    segments = transcript.get("segments", [])
    items = []
    for t in tasks:
        sentence = t.get("source_sentence") or ""
        speaker, at_ms = locate_sentence(sentence, segments)
        items.append({
            "task_title": t.get("task", ""),
            "task_confidence": float(t.get("confidence") or 0.0),
            "assignee_raw": t.get("assignee_resolved") or t.get("assignee_mention"),
            "assignee_type": t.get("assignee_type"),
            "due_date": t.get("due_date"),
            "due_raw": t.get("due_raw"),
            "due_confidence": DUE_CONFIDENCE.get(t.get("due_status"), 0.0),
            "evidence_quote": sentence or None,
            "evidence_speaker": speaker,
            "evidence_at_ms": at_ms,
        })
    return items


# ─────────────────────────────────────────────────────────── 인계
@dataclass
class Handoff:
    """한 워크스페이스로 인계한다. 매니페스트의 be 항목을 읽고 쓴다."""

    client: BeClient
    workspace_id: str

    def start(self, manifest: dict, *, title: str | None = None) -> dict:
        """BE 회의를 만든다. 이미 있으면 그대로. /record 직후와 인계 단계가 같이 부른다."""
        be = manifest.setdefault("be", {})
        if be.get("meeting_id"):
            return be
        data = self.client.create_meeting(self.workspace_id, title=title)
        be.update({"meeting_id": data["meeting_id"], "status": str(data.get("status", "created"))})
        be.pop("error", None)
        return be

    def _fresh(self, manifest: dict, title: str | None) -> dict:
        be = manifest.setdefault("be", {})
        old = be.get("meeting_id")
        if old:
            be.setdefault("replaced", []).append(old)
        be.pop("meeting_id", None)
        be.pop("extraction_id", None)
        return self.start(manifest, title=title)

    def end(self, manifest: dict, *, title: str | None = None) -> dict:
        """녹음이 끝났다. created → processing. BE 가 failed 로 닫아 둔 회의면 새로 만든다."""
        be = self.start(manifest, title=title)
        if be.get("status") in ("processing", "done"):
            return be
        status = self.client.end_meeting(be["meeting_id"])
        if status == "failed":
            be = self._fresh(manifest, title)
            status = self.client.end_meeting(be["meeting_id"])
        be["status"] = status
        return be

    def register(self, manifest: dict, *, transcripts_dir: Path, model_name: str | None,
                 title: str | None = None) -> dict:
        """추출 결과를 BE 에 등록한다. 회의는 done 이 된다. 다시 불러도 BE 가 기존 것을 돌려준다."""
        tasks_path = manifest.get("tasks")
        if not tasks_path:
            raise ValueError("추출 결과(tasks)가 없어 등록할 것이 없다")
        transcript_json = Path(manifest.get("transcript_json") or
                               transcripts_dir / f"session_{manifest['session']}.transcript.json")
        tasks = json.loads(Path(tasks_path).read_text(encoding="utf-8"))
        transcript = json.loads(transcript_json.read_text(encoding="utf-8")) if transcript_json.exists() else {}
        items = to_extraction_items(tasks, transcript)

        be = self.end(manifest, title=title)
        try:
            data = self._register(be["meeting_id"], transcript_json, model_name, items)
        except BeError as e:
            if e.code == "MEETING_NOT_PROCESSING" and e.details.get("status") == "failed":
                be = self._fresh(manifest, title)
                self.client.end_meeting(be["meeting_id"])
                data = self._register(be["meeting_id"], transcript_json, model_name, items)
            else:
                raise
        be.update({"status": "done", "extraction_id": data["extraction_id"], "item_count": data.get("item_count", len(items))})
        return be

    def _register(self, meeting_id: str, transcript_json: Path, model_name: str | None, items: list[dict]) -> dict:
        return self.client.create_extraction(meeting_id, self.workspace_id, transcript_path=str(transcript_json),
                                             model_name=model_name, items=items)

    def fail(self, manifest: dict, failed_stage: str) -> None:
        """단계가 실패했다고 알린다. BE 회의가 없거나 BE 도 안 되면 조용히 넘어간다. 인계 자체는 복구가 다시 한다."""
        be = manifest.get("be") or {}
        mid = be.get("meeting_id")
        if not mid:
            return
        try:
            self.client.fail_meeting(mid, failed_stage)
            be.update({"status": "failed", "failed_stage": failed_stage})
        except Exception as e:  # noqa: BLE001 - 실패 통보가 실패해도 매니페스트 기록이 먼저다
            be["error"] = f"{type(e).__name__}: {e}"


def from_env() -> Handoff | None:
    """BE_BASE_URL 과 BE_WORKSPACE_ID 가 둘 다 있을 때만. 없으면 인계 단계를 건너뛴다."""
    from shared.config import settings

    cfg = settings()
    if not cfg.be_base_url or not cfg.be_workspace_id:
        return None
    return Handoff(BeClient(cfg.be_base_url), cfg.be_workspace_id)
