"""전사와 추출 결과를 BE 에 넘긴다. 봇이 BE 의 회의 API 를 직접 부른다.

BE 의 회의는 created → processing → done 으로 가고 실패는 failed 다 (backend/app/api/meetings.py,
extractions.py). 봇이 이 전이를 순서대로 부른다.

  /record 직후       POST  /api/v1/meetings              created. 매니페스트 be.meeting_id
  트랙을 닫은 뒤     PATCH /api/v1/meetings/{id}/end     processing
  전사가 닫힌 뒤     POST  /api/v1/meetings/{id}/sources 발화 저장(X-Service-Token). 같은 seq 는 BE 가 건너뛴다
  추출이 끝난 뒤     POST  /api/v1/extractions           done. 항목 저장, 담당자 매칭, 게이트 판정
  어느 단계든 실패   PATCH /api/v1/meetings/{id}/fail    failed, failed_stage

판단 경로(MM_EXTRACT_PATH=judge)는 추출 도중에 1단계가 고른 finding 마다 유사 task 검색을 부른다. 전사록의 줄마다가
아니다. 발화 저장과 유사 검색이 서비스 토큰을 요구한다. 토큰이 없으면 발화 저장 단계는 건너뛴다(recorder.saves_sources).

  추출 도중          POST  /api/v1/workspaces/{id}/tasks/similar   X-Service-Token

POST /extractions 는 같은 회의에 두 번 보내도 한 번만 만든다. BE 가 processing → done 을 조건부
UPDATE 로 선점하고, 이미 done 이면 기존 것을 돌려준다. 그래서 복구 경로가 다시 보내도 중복이 없다.
fail 은 끝 상태라 되돌리는 전이가 없다. 실패했던 회의를 나중에 복구해 넘길 때는 새 회의를 만들고
옛 ID 를 be.replaced 에 남긴다. 되돌리는 전이가 BE 에 생기면 그때 바꾼다.

담당자 매칭에 쓰는 것은 둘이다. assignee_raw 는 별칭 텍스트로 찾고, assignee_type 이 first 이면
evidence_speaker 로 찾는다. 여기서는 evidence_speaker 에 그 문장을 말한 트랙의 디스코드 uid 를
넣는다. 추출 결과(ExtractedTask)에는 발화자가 없어 근거 문장을 전사본에서 되찾는다.
판단 경로의 항목(judge.pipeline.to_item)은 이미 이 모양이고 화자도 들어 있어 그대로 보낸다.

Discord 이름은 여기 없다. 매니페스트 dict 와 파일 경로만 다룬다.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from shared.schemas import NotionCandidate, Transcript

API_PREFIX = "/api/v1"
TIMEOUT_S = 10.0
# 유사 검색은 BE 가 임베딩 서버를 10초까지 기다린다. 그보다 길어야 BE 의 502 를 받고, 짧으면 이쪽이 먼저 끊는다
SIMILAR_TIMEOUT_S = 15.0

# 추출기의 마감 상태를 BE 의 숫자 신뢰도로. BE 는 due_raw 가 없으면 이 값을 보지 않는다
STATUS_CONFIDENCE = {"certain": 1.0, "inferred": 0.6, "missing": 0.0}


class BeError(Exception):
    """BE 가 오류 봉투를 돌려줬거나 연결이 안 됐다. code 는 BE 의 ErrorCode 또는 NETWORK, HTTP_<status>."""

    def __init__(self, code: str, message: str, *, status: int = 0, details: dict | None = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


class BeClient:
    """회의 API 네 개와 발화 저장, 유사 task 검색을 얇게 싼다. session 은 requests.Session 과 같은 request() 를 가진 것이면 된다.

    service_token 은 사용자 세션 없이 부르는 경로(발화 저장, 유사 검색)가 요구하는 X-Service-Token 값이다. 그 경로에만 싣는다.
    """

    def __init__(self, base_url: str, *, session=None, timeout: float = TIMEOUT_S, service_token: str = "") -> None:
        self.api = base_url.rstrip("/") + API_PREFIX
        self._session = session or requests.Session()
        self.timeout = timeout
        self.service_token = service_token

    def _call(self, method: str, path: str, body: dict | None = None, *, headers: dict | None = None,
              timeout: float | None = None) -> Any:
        extra = {"headers": headers} if headers else {}
        try:
            r = self._session.request(method, self.api + path, json=body, timeout=timeout or self.timeout, **extra)
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

    def create_sources(self, meeting_id: str, transcript: dict, speaker_names: dict[str, str]) -> dict:
        """전사 발화를 BE 에 저장한다(#130). 같은 seq 는 BE 가 건너뛰어 다시 보내도 쌓이지 않는다.

        돌려주는 것: {meeting_id, inserted, skipped, duration_ms}. transcript 는 Transcript.to_dict() 모양이다.
        """
        headers = {"X-Service-Token": self.service_token} if self.service_token else None
        return self._call("POST", f"/meetings/{meeting_id}/sources", {**transcript, "speaker_names": speaker_names},
                          headers=headers)

    def similar_tasks(self, workspace_id: str, text: str) -> list[NotionCandidate]:
        """문장과 비슷한 기존 task 후보. 판단 파이프라인(judge.pipeline.CandidateSource)이 finding 마다 그 요약 문장으로 부른다.

        후보 수와 유사도 하한은 BE 기본값(3개, 0.4)을 쓴다. 실패는 빈 목록이 아니라 BeError 다. 빈 목록은
        "비슷한 task 없음" 이라 실패를 그렇게 돌려주면 있는 task 가 새 항목으로 또 만들어진다.
        """
        headers = {"X-Service-Token": self.service_token} if self.service_token else None
        data = self._call("POST", f"/workspaces/{workspace_id}/tasks/similar", {"text": text}, headers=headers,
                          timeout=SIMILAR_TIMEOUT_S)
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise BeError("BAD_RESPONSE", "유사 검색 응답에 items 목록이 없다")
        return [NotionCandidate.from_dict(i) for i in items]


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
        kind = t.get("assignee_type")
        # "네가"·"그분"·"백엔드 리더" 는 별칭이 아니다. 이름으로 풀리지 않았으면 BE 에 조회를 시키지 않는다
        mention = None if kind in ("second", "thirdpronoun", "thirdrole") else t.get("assignee_mention")
        items.append({
            "task_title": t.get("task", ""),
            # BE(item_confidence)가 필드별 숫자의 최솟값을 직접 내므로 할일 자체의 상태만 보낸다
            "task_confidence": STATUS_CONFIDENCE.get(t.get("task_status"), 0.0),
            "assignee_raw": t.get("assignee_resolved") or mention,
            "assignee_type": t.get("assignee_type"),
            "due_date": t.get("due_date"),
            "due_raw": t.get("due_raw"),
            "due_confidence": STATUS_CONFIDENCE.get(t.get("due_status"), 0.0),
            "evidence_quote": sentence or None,
            "evidence_speaker": speaker,
            "evidence_at_ms": at_ms,
        })
    return items


def clean_item(item: dict) -> dict:
    """판단 경로의 항목(judge.pipeline.to_item)을 보내기 직전에 다듬는다. 키는 더하지도 빼지도 않는다.

    빈 문자열만 null 로 바꾼다. BE 는 assignee_raw 가 null 이 아니면 "언급은 했는데 못 찾은 담당자" 로 보고
    확신도 계산에 넣는다. 빈 문자열이 가면 담당자 언급이 없는 항목이 hold 로 떨어진다.
    """
    return {k: (None if isinstance(v, str) and not v.strip() else v) for k, v in item.items()}


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
        for k in ("meeting_id", "extraction_id", "item_count", "failed_stage", "error", "sources"):
            be.pop(k, None)                     # 발화도 옛 회의에만 있다. 새 회의에는 다시 보내야 한다
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

    def save_sources(self, manifest: dict, *, transcripts_dir: Path, title: str | None = None) -> dict:
        """전사 발화를 BE 에 저장한다. processing 이나 done 회의에 보낸다. end 로 회의를 확보하고, BE 가 failed 로 닫아
        두었으면 end 가 새 회의로 바꾼다. be["sources"] 에 보낸 회의 ID 를 남겨, 회의가 뒤에 바뀌면 다시 보낼 수 있게 한다.

        발화가 없으면(계약 파일이 없거나 0줄) BE 를 부르지 않고 0줄로 남긴다. 계약 파일의 session·model·speakers 는
        보내지 않고 Transcript 모양만 보낸다. 화자 이름은 매니페스트 speakers 의 표시 이름이다.
        """
        path = Path(manifest.get("transcript_json") or transcripts_dir / f"session_{manifest['session']}.transcript.json")
        transcript = Transcript.from_dict(json.loads(path.read_text(encoding="utf-8"))).to_dict() if path.exists() else None
        if not transcript or not transcript["segments"]:
            be = manifest.setdefault("be", {})
            be["sources"] = {"inserted": 0, "skipped": 0, "duration_ms": None, "meeting_id": be.get("meeting_id")}
            return be
        names = {str(e["user_id"]): e.get("display_name") or str(e["user_id"]) for e in manifest.get("speakers") or []}
        be = self.end(manifest, title=title)
        try:
            data = self.client.create_sources(be["meeting_id"], transcript, names)
        except BeError as e:
            fields = e.details.get("fields")
            if fields:   # 400 이 알려 주는 어느 줄의 어느 필드인지. 다시 보내도 같아 이것이 유일한 단서다(BE 명세)
                raise BeError(e.code, f"{e.message} {json.dumps(fields, ensure_ascii=False)[:300]}", status=e.status,
                              details=e.details) from e
            raise
        be["sources"] = {k: data.get(k) for k in ("inserted", "skipped", "duration_ms")}
        be["sources"]["meeting_id"] = be["meeting_id"]
        return be

    def register(self, manifest: dict, *, transcripts_dir: Path, model_name: str | None,
                 title: str | None = None) -> dict:
        """추출 결과를 BE 에 등록한다. 회의는 done 이 된다. 다시 불러도 BE 가 기존 것을 돌려준다.

        추출 결과는 둘 중 하나다. 판단 경로면 manifest["items"](이미 BE 항목 모양이라 그대로 보낸다),
        옛 경로면 manifest["tasks"](ExtractedTask 목록이라 to_extraction_items 로 바꾼다).
        """
        items_path, tasks_path = manifest.get("items"), manifest.get("tasks")
        if not items_path and not tasks_path:
            raise ValueError("추출 결과(items 나 tasks)가 없어 등록할 것이 없다")
        transcript_json = Path(manifest.get("transcript_json") or
                               transcripts_dir / f"session_{manifest['session']}.transcript.json")
        if items_path:
            items = [clean_item(i) for i in json.loads(Path(items_path).read_text(encoding="utf-8"))]
        else:
            tasks = json.loads(Path(tasks_path).read_text(encoding="utf-8"))
            transcript = json.loads(transcript_json.read_text(encoding="utf-8")) if transcript_json.exists() else {}
            items = to_extraction_items(tasks, transcript)
        changed = bool(manifest.get("reextracted"))                       # 전사가 바뀌어 다시 뽑은 결과다
        previous = (manifest.get("be") or {}).get("extraction_id")

        be = self.end(manifest, title=title)
        try:
            data = self._register(be["meeting_id"], transcript_json, model_name, items)
        except BeError as e:
            if e.code == "MEETING_NOT_PROCESSING" and e.details.get("status") == "failed":
                be = self._fresh(manifest, title)
                be = self.end(manifest, title=title)
                if self.client.service_token:   # 발화 먼저(BE 명세). 옛 회의에 보낸 발화를 새 회의에도 둔다
                    self.save_sources(manifest, transcripts_dir=transcripts_dir, title=title)
                data = self._register(be["meeting_id"], transcript_json, model_name, items)
            else:
                raise
        be.update({"status": "done", "extraction_id": data["extraction_id"], "item_count": data.get("item_count", len(items))})
        # BE 는 done 회의에 새 추출을 만들지 않고 기존 것을 돌려준다. 다시 뽑아 보냈는데 같은 것이 돌아오면 BE 에는 옛 추출이 남은 것이다
        if changed and previous and data["extraction_id"] == previous:
            # dropped_items, missing_findings 는 BE 가 가진 옛 추출의 수다. 돌아온 item_count 도 옛 추출의 것이라
            # 이번 결과의 수로 덮어쓰면 서로 어긋난다. 이번 결과의 실패는 매니페스트의 extract_failures 에 있다
            be["stale_extraction"] = True
        else:
            be.pop("stale_extraction", None)
            # BE 는 수정 대상이 사라졌거나 제목이 빈 항목을 건너뛰고도 201 을 준다. 저장된 수가 적으면 남긴다
            dropped = len(items) - int(be["item_count"])
            if dropped > 0:
                be["dropped_items"] = dropped
            else:
                be.pop("dropped_items", None)
            unjudged = len(manifest.get("extract_failures") or [])  # 판단 경로에서 끝내 판단하지 못한 finding
            if unjudged:
                be["missing_findings"] = unjudged
            else:
                be.pop("missing_findings", None)
        manifest.pop("reextracted", None)
        if manifest.get("partial"):
            be["partial"] = True
            be["missing_units"] = len(manifest.get("failed_units") or [])
        else:
            be.pop("partial", None)
            be.pop("missing_units", None)
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
            data = self.client.fail_meeting(mid, failed_stage) or {}
            # BE 가 이미 done 으로 닫은 회의면 실패로 바꾸지 않는다 (409 의 details 가 지금 상태를 준다)
            be["status"] = str(data.get("status") or "failed")
            if be["status"] == "failed":
                be["failed_stage"] = failed_stage
        except Exception as e:  # noqa: BLE001 - 실패 통보가 실패해도 매니페스트 기록이 먼저다
            be["error"] = f"{type(e).__name__}: {e}"


def from_env() -> Handoff | None:
    """BE_BASE_URL 과 BE_WORKSPACE_ID 가 둘 다 있을 때만. 없으면 인계 단계를 건너뛴다."""
    from shared.config import settings

    cfg = settings()
    if not cfg.be_base_url or not cfg.be_workspace_id:
        return None
    return Handoff(BeClient(cfg.be_base_url, service_token=getattr(cfg, "be_service_token", "")), cfg.be_workspace_id)
