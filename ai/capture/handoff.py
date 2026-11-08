"""전사와 추출 결과를 BE 에 넘긴다. 봇이 BE 의 회의 API 를 직접 부른다.

BE 의 회의는 created → processing → done 으로 가고 실패는 failed 다 (backend/app/api/meetings.py,
extractions.py). 봇이 이 전이를 순서대로 부른다.

  /record 직후       POST  /api/v1/meetings              created. 매니페스트 be.meeting_id
  트랙을 닫은 뒤     PATCH /api/v1/meetings/{id}/end     processing
  단계가 시작될 때   PATCH /api/v1/meetings/{id}/stage   변화 없음(BE 진행 표시). 실패는 삼킨다
  전사가 닫힌 뒤     POST  /api/v1/meetings/{id}/sources 발화 저장(X-Service-Token). 같은 seq 는 BE 가 건너뛴다
  추출이 끝난 뒤     POST  /api/v1/extractions           done. 항목 저장, 담당자 매칭, 게이트 판정
  어느 단계든 실패   PATCH /api/v1/meetings/{id}/fail    failed, failed_stage

판단 경로(MM_EXTRACT_PATH=judge)는 추출 도중에 1단계가 고른 finding 마다 유사 task 검색을 부른다. 전사록의 줄마다가
아니다. BE 는 봇이 부르는 경로 모두에서 서비스 토큰을 검사한다(#179). 토큰이 없으면 인계를 켜지 않는다(from_env).

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
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

from shared.schemas import NotionCandidate, Transcript

log = logging.getLogger(__name__)

API_PREFIX = "/api/v1"
TIMEOUT_S = 10.0
# 유사 검색은 BE 가 임베딩 서버를 10초까지 기다린다. 그보다 길어야 BE 의 502 를 받고, 짧으면 이쪽이 먼저 끊는다
SIMILAR_TIMEOUT_S = 15.0
# 녹음 내려받기의 읽기 제한. 스트리밍이라 청크 사이 무응답 시간이고 전체 시간이 아니다
DOWNLOAD_TIMEOUT_S = 60.0
DOWNLOAD_CHUNK = 1 << 20
# 단계 보고는 진행 표시일 뿐이다. BE 가 느려도 처리를 붙들지 않게 짧게 끊는다
STAGE_TIMEOUT_S = 3.0

# 서버(길드)에 연결된 워크스페이스가 없을 때 BE 가 주는 코드(backend/app/api/integrations.py, #180)
NOT_CONNECTED = "INTEGRATION_NOT_CONNECTED"

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


class MeetingEnded(BeError):
    """업로드 회의가 BE 에서 이미 끝났거나(failed·done) 없다. 새 회의를 만들지 않고 이 회의의 인계를 멈춘다는 뜻이다.

    발화 저장의 409 MEETING_FAILED·404, 추출 등록의 409 MEETING_NOT_PROCESSING·404, 매니페스트의 be.status 가
    processing·done 이 아닐 때 낸다. 디스코드 회의는 새 회의로 바꾸므로 이 예외를 내지 않는다.
    """


def is_upload(manifest: dict) -> bool:
    """수동 업로드 회의인가. 업로드는 BE 회의를 웹 업로드가 이미 만들어 두었다."""
    return manifest.get("source") == "upload"


def speaker_members(manifest: dict) -> dict[str, str | None]:
    """화자 라벨 id(speakers[].user_id) -> BE 멤버 ID. 외부 참석자나 지정 전이면 None. 라벨을 멤버로 바꾸는 곳은 인계뿐이다."""
    return {str(e["user_id"]): e.get("member_id") or None for e in manifest.get("speakers") or []}


def _upload_speaker_names(manifest: dict) -> dict[str, str]:
    """업로드의 라벨 -> LLM 이 볼 이름. 멤버면 hint_members(PM 이 정한 이름), 없으면 참석자 표시 이름, 그것도 없으면 라벨의
    표시 이름. 외부 참석자는 "외부 참석자 N"(N 은 speakers 순서)."""
    by_id = {m["member_id"]: m["name"] for m in manifest.get("hint_members") or [] if m.get("member_id") and m.get("name")}
    for a in manifest.get("attendees") or []:
        if a.get("member_id") and a.get("display_name"):
            by_id.setdefault(a["member_id"], a["display_name"])
    out: dict[str, str] = {}
    external = 0
    for e in manifest.get("speakers") or []:
        uid, mid = str(e["user_id"]), e.get("member_id")
        if mid:
            out[uid] = by_id.get(mid) or e.get("display_name") or uid
        else:
            external += 1
            out[uid] = f"외부 참석자 {external}"
    return out


def speaker_names(manifest: dict) -> dict[str, str]:
    """화자 uid -> 회의록에 쓸 이름. BE 에서 받은 팀원 이름(hint_members)에 그 uid 가 있으면 PM 이 정한 이름,
    없으면 디스코드 표시 이름이다. 매니페스트의 speakers 는 디스코드 표시 이름 그대로 둔다.
    업로드는 라벨이 uid 자리에 있고 멤버 이름으로 바꾼다(_upload_speaker_names)."""
    if is_upload(manifest):
        return _upload_speaker_names(manifest)
    pm = {str(m["discord_user_id"]): m["name"] for m in manifest.get("hint_members") or []
          if m.get("discord_user_id") and m.get("name")}
    return {str(e["user_id"]): pm.get(str(e["user_id"])) or e.get("display_name") or str(e["user_id"])
            for e in manifest.get("speakers") or []}


class BeClient:
    """회의 API 네 개와 발화 저장, 유사 task 검색을 얇게 싼다. session 은 requests.Session 과 같은 request() 를 가진 것이면 된다.

    service_token 은 사용자 세션 없이 부르는 봇 경로가 요구하는 X-Service-Token 값이다. BE 가 회의 생성·종료·실패,
    추출 등록, 발화 저장, 유사 검색 모두에서 검사하므로(#179) 모든 요청에 싣는다.
    """

    def __init__(self, base_url: str, *, session=None, timeout: float = TIMEOUT_S, service_token: str = "") -> None:
        self.api = base_url.rstrip("/") + API_PREFIX
        self._session = session or requests.Session()
        self.timeout = timeout
        self.service_token = service_token

    def _call(self, method: str, path: str, body: dict | None = None, *, headers: dict | None = None,
              timeout: float | None = None) -> Any:
        if self.service_token:
            headers = {**(headers or {}), "X-Service-Token": self.service_token}
        extra = {"headers": headers} if headers else {}
        try:
            r = self._session.request(method, self.api + path, json=body, timeout=timeout or self.timeout, **extra)
        except requests.RequestException as e:
            raise BeError("NETWORK", f"{type(e).__name__}: {e}") from e
        return self._unwrap(r)

    @staticmethod
    def _unwrap(r) -> Any:
        """응답 봉투를 벗긴다. 오류 봉투와 4xx·5xx 는 BeError 다."""
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

    def pending_uploads(self) -> list[dict]:
        """웹 업로드 회의 중 아직 아무도 가져가지 않은 것(GET /uploads/pending), 먼저 올라온 순서.

        항목: {meeting_id, workspace_id, title, started_at, attendees: [{member_id, display_name}], original_filename,
        stored_filename, size_bytes, content_type, uploaded_at}.
        """
        data = self._call("GET", "/uploads/pending")
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise BeError("BAD_RESPONSE", "대기 목록 응답에 items 목록이 없다")
        return items

    def claim_upload(self, meeting_id: str) -> dict:
        """업로드 회의를 가져간다(PATCH /uploads/{id}/claim). 성공하면 {meeting_id, status}.

        돌려주지 않고 BeError 로 알리는 경우는 부르는 쪽이 판단한다. 409 MEETING_PROCESSING_IN_PROGRESS(이미 가져감,
        앞선 응답을 놓친 재시도일 수 있다), 409 MEETING_ALREADY_ENDED(details.status), 404 MEETING_NOT_FOUND, NETWORK.
        """
        return self._call("PATCH", f"/uploads/{meeting_id}/claim")

    def report_speakers(self, meeting_id: str, speakers: list[dict]) -> dict:
        """화자 분리가 끝난 업로드 회의의 라벨과 샘플 구간을 보고한다(POST /uploads/{id}/speakers). 성공하면 {meeting_id, status}.

        speakers: [{label, total_sec, samples: [{start, end}]}]. 같은 내용을 다시 보내면 BE 가 200 을 주고(status 는 현재 값)
        응답을 잃은 재시도가 안전하다. BeError: 409 SPEAKERS_ALREADY_REPORTED(details.labels 가 저장된 라벨),
        409 MEETING_ALREADY_ENDED(details.status), 409 UPLOAD_NOT_CLAIMED, 404 MEETING_NOT_FOUND, 400(details.fields), NETWORK.
        """
        data = self._call("POST", f"/uploads/{meeting_id}/speakers", {"speakers": speakers})
        if not isinstance(data, dict):
            raise BeError("BAD_RESPONSE", "라벨 보고 응답에 data 객체가 없다")
        return data

    def assigned_uploads(self) -> list[dict]:
        """PM 이 화자 지정을 끝냈고 아직 resume 하지 않은 업로드 회의(GET /uploads/assigned), 지정 순서.

        항목: {meeting_id, workspace_id, title, started_at, mapping, assigned_at}. 여기 mapping 은 쓰지 않고
        resume 응답의 것을 쓴다.
        """
        data = self._call("GET", "/uploads/assigned")
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise BeError("BAD_RESPONSE", "지정 목록 응답에 items 목록이 없다")
        return items

    def resume_upload(self, meeting_id: str) -> dict:
        """지정 결과를 가져간다(PATCH /uploads/{id}/resume). 성공하면 {meeting_id, status, mapping}.

        processing 이면 몇 번 불러도 같은 mapping 으로 200 이라 응답을 잃은 재시도가 안전하다. BeError:
        409 SPEAKERS_NOT_ASSIGNED(details.status), 409 MEETING_ALREADY_ENDED(details.status), 404 MEETING_NOT_FOUND.
        """
        data = self._call("PATCH", f"/uploads/{meeting_id}/resume")
        if not isinstance(data, dict) or not isinstance(data.get("mapping"), dict):
            raise BeError("BAD_RESPONSE", "resume 응답에 mapping 객체가 없다")
        return data

    def download_upload(self, meeting_id: str, dest: Path) -> int:
        """업로드 녹음 원본을 dest 로 스트리밍으로 받고 바이트 수를 돌려준다(GET /uploads/{id}/file).

        임시 파일에 받아 끝까지 성공해야 dest 로 바꾼다. 실패하면 임시 파일을 지우고 dest 는 건드리지 않는다.
        오류 봉투와 연결 끊김은 BeError 로 올리고, 디스크 오류(OSError)는 그대로 나간다.
        """
        dest = Path(dest)
        headers = {"X-Service-Token": self.service_token} if self.service_token else {}
        try:
            r = self._session.request("GET", f"{self.api}/uploads/{meeting_id}/file", timeout=DOWNLOAD_TIMEOUT_S,
                                      headers=headers, stream=True)
        except requests.RequestException as e:
            raise BeError("NETWORK", f"{type(e).__name__}: {e}") from e
        tmp = dest.with_name(dest.name + ".part")
        try:
            if r.status_code >= 400:
                self._unwrap(r)
                raise BeError(f"HTTP_{r.status_code}", "", status=r.status_code)
            size = 0
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=DOWNLOAD_CHUNK):
                    f.write(chunk)
                    size += len(chunk)
            tmp.replace(dest)
            return size
        except requests.RequestException as e:
            raise BeError("NETWORK", f"{type(e).__name__}: {e}") from e
        finally:
            tmp.unlink(missing_ok=True)
            close = getattr(r, "close", None)
            if close:
                close()

    def guild_workspace(self, guild_id: str) -> str:
        """디스코드 서버에 연결된 워크스페이스(#199, BE #197). 연결이 없으면 BeError(INTEGRATION_NOT_CONNECTED)."""
        return self._call("GET", f"/integrations/discord/guilds/{guild_id}/workspace")["workspace_id"]

    def member_names(self, workspace_id: str) -> list[dict]:
        """워크스페이스 팀원의 이름(PM 이 온보딩에서 정한 것)과 별칭. 전사 이름 힌트에 쓴다(BE 봇용 조회).

        [{"member_id", "name", "discord_user_id", "aliases"}]. 탈퇴한 팀원은 BE 가 빼고 준다.
        """
        data = self._call("GET", f"/workspaces/{workspace_id}/members/names")
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise BeError("BAD_RESPONSE", "팀원 이름 응답에 items 목록이 없다")
        return items

    def chat_channels(self) -> list[dict]:
        """채팅 폴링 대상 채널 목록(BE #432 구현). [{"workspace_id", "guild_id", "channel_id"}] 모두 str."""
        data = self._call("GET", "/bot/chat-channels")
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list) or not all(isinstance(i, dict) for i in items):
            raise BeError("BAD_RESPONSE", "채팅 채널 응답에 items 목록이 없다")
        return items

    def create_meeting(self, workspace_id: str, *, title: str | None = None, source: str = "discord",
                       started_at: datetime | None = None) -> dict:
        body = {"workspace_id": workspace_id, "title": title, "source": source}
        if started_at is not None:
            body["started_at"] = started_at.isoformat()
        return self._call("POST", "/meetings", body)

    def chat_cursor(self, workspace_id: str) -> datetime | None:
        """BE 가 이미 가진 마지막 채팅 메시지 시각(chat-cursor). 채팅 회의가 없으면 None."""
        data = self._call("GET", f"/workspaces/{workspace_id}/chat-cursor")
        if not data:
            return None
        return datetime.fromisoformat(data["last_message_at"])

    def end_meeting(self, meeting_id: str) -> str:
        """created → processing. 이미 넘어간 회의면 BE 가 409 로 지금 상태를 알려 주므로 그 상태를 돌려준다."""
        try:
            data = self._call("PATCH", f"/meetings/{meeting_id}/end")
            return str(data.get("status", "processing"))
        except BeError as e:
            if e.code == "MEETING_ALREADY_ENDED":
                return str(e.details.get("status", "processing"))
            raise

    def report_stage(self, meeting_id: str, stage: str) -> dict:
        """처리 단계가 시작됐다고 알린다(stt, sources, extract, handoff). BE 가 진행 표시에 쓴다.

        data 는 {meeting_id, status, processing_stage, applied}. 처리 중이 아니거나 같은·앞선 단계면 applied 가 False 다.
        오류는 BeError 그대로 올린다. 삼키는 것은 Handoff.report_stage 다.
        """
        return self._call("PATCH", f"/meetings/{meeting_id}/stage", {"stage": stage}, timeout=STAGE_TIMEOUT_S)

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

    def create_sources(self, meeting_id: str, transcript: dict, speaker_names: dict[str, str] | None) -> dict:
        """전사 발화를 BE 에 저장한다(#130). 같은 seq 는 BE 가 건너뛰어 다시 보내도 쌓이지 않는다.

        돌려주는 것: {meeting_id, inserted, skipped, duration_ms}. transcript 는 Transcript.to_dict() 모양이다.
        speaker_names 가 None 이면 그 키를 보내지 않는다(업로드는 화자가 uid 가 아니라 멤버 ID 다).
        """
        body = transcript if speaker_names is None else {**transcript, "speaker_names": speaker_names}
        return self._call("POST", f"/meetings/{meeting_id}/sources", dict(body))

    def similar_tasks(self, workspace_id: str, text: str) -> list[NotionCandidate]:
        """문장과 비슷한 기존 task 후보. 판단 파이프라인(judge.pipeline.CandidateSource)이 finding 마다 그 요약 문장으로 부른다.

        후보 수와 유사도 하한은 BE 기본값(3개, 0.4)을 쓴다. 실패는 빈 목록이 아니라 BeError 다. 빈 목록은
        "비슷한 task 없음" 이라 실패를 그렇게 돌려주면 있는 task 가 새 항목으로 또 만들어진다.
        """
        data = self._call("POST", f"/workspaces/{workspace_id}/tasks/similar", {"text": text}, timeout=SIMILAR_TIMEOUT_S)
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise BeError("BAD_RESPONSE", "유사 검색 응답에 items 목록이 없다")
        return [NotionCandidate.from_dict(i) for i in items]


# ─────────────────────────────────────────────────────────── 추출 결과 → BE 항목
def _squash(text: str) -> str:
    """공백과 문장 부호를 뺀다. 추출기가 돌려준 근거 문장은 전사본과 띄어쓰기가 다를 수 있다."""
    return re.sub(r"[\W_]+", "", text or "")


def locate_sentence(sentence: str, segments: list[dict]) -> tuple[str | None, int | None, int | None]:
    """근거 문장을 말한 화자, 시각, 발화 seq. 화자가 둘 이상 같은 문장을 말했으면 모른다고 답한다 (PM 확인으로)."""
    key = _squash(sentence)
    if not key:
        return None, None, None
    squashed = [(s, _squash(s.get("text", ""))) for s in segments]
    # 통째로 같은 발화가 있으면 그것. 없으면 그 문장을 품은 발화 (한 발화에 문장이 여럿일 때)
    hits = [s for s, t in squashed if t == key] or [s for s, t in squashed if key in t]
    speakers = {s.get("speaker") for s in hits}
    if len(speakers) != 1:
        return None, None, None
    first = min(hits, key=lambda s: float(s.get("start", 0.0)))
    return first.get("speaker"), int(round(float(first.get("start", 0.0)) * 1000)), first.get("seq")


def to_extraction_items(tasks: list[dict], transcript: dict) -> list[dict]:
    """ExtractedTask.to_dict() 목록을 BE 의 ExtractionItemCreate 목록으로.

    assignee_raw 는 별칭 텍스트다. 2인칭·대명사·역할은 추출기가 문맥으로 푼 이름(assignee_resolved)이 있으면
    그것을 보낸다. thirdname 은 원문 언급만 보낸다 — 추출기가 고친 이름이 틀리면 BE 가 그 글자를 별칭으로
    배우기 때문이다. first, group, none 은 None 이 간다.
    """
    segments = transcript.get("segments", [])
    items = []
    for t in tasks:
        sentence = t.get("source_sentence") or ""
        speaker, at_ms, seq = locate_sentence(sentence, segments)
        kind = t.get("assignee_type")
        # "네가"·"그분"·"백엔드 리더" 는 별칭이 아니라 푼 이름만 보낸다. 그 밖은 원문 언급만(resolved 무시)
        if kind in ("second", "thirdpronoun", "thirdrole"):
            assignee_raw = t.get("assignee_resolved")
        else:
            assignee_raw = t.get("assignee_mention")
        items.append({
            "task_title": t.get("task", ""),
            # BE(item_confidence)가 필드별 숫자의 최솟값을 직접 내므로 할일 자체의 상태만 보낸다
            "task_confidence": STATUS_CONFIDENCE.get(t.get("task_status"), 0.0),
            "assignee_raw": assignee_raw,
            "assignee_type": t.get("assignee_type"),
            "due_date": t.get("due_date"),
            "due_raw": t.get("due_raw"),
            "due_confidence": STATUS_CONFIDENCE.get(t.get("due_status"), 0.0),
            "evidence_quote": sentence or None,
            "evidence_speaker": speaker,
            "evidence_at_ms": at_ms,
            "evidence_seqs": [] if seq is None else [seq],
        })
    return items


def clean_item(item: dict) -> dict:
    """판단 경로의 항목(judge.pipeline.to_item)을 보내기 직전에 다듬는다. 키는 더하지도 빼지도 않는다.

    빈 문자열만 null 로 바꾼다. BE 는 assignee_raw 가 null 이 아니면 "언급은 했는데 못 찾은 담당자" 로 보고
    확신도 계산에 넣는다. 빈 문자열이 가면 담당자 언급이 없는 항목이 hold 로 떨어진다.
    """
    return {k: (None if isinstance(v, str) and not v.strip() else v) for k, v in item.items()}


def _with_member_speakers(items: list[dict], members: dict[str, str | None]) -> list[dict]:
    """업로드 항목의 화자(라벨 id)를 멤버 ID 로 바꾼 사본. evidence_speaker 는 None, 멤버면 evidence_speaker_member_id 를 더한다.
    외부 참석자나 화자를 모르는 항목은 그 키를 더하지 않는다."""
    out = []
    for item in items:
        member = members.get(item.get("evidence_speaker"))
        item = {**item, "evidence_speaker": None}
        if member:
            item["evidence_speaker_member_id"] = member
        out.append(item)
    return out


def _explained(e: BeError) -> BeError:
    """400 이 알려 주는 단서를 오류 문장에 싣는다. fields 는 어느 줄의 어느 필드인지, member_ids 는 어느 팀원 ID 인지다.
    다시 보내도 같아 이것이 유일한 단서다(BE 명세). 단서가 없으면 문장은 그대로다."""
    clues = [json.dumps(e.details[k], ensure_ascii=False)[:300] for k in ("fields", "member_ids") if e.details.get(k)]
    message = " ".join([e.message, *clues])
    return BeError(e.code, message, status=e.status, details=e.details)


# ─────────────────────────────────────────────────────────── 인계
@dataclass
class Handoff:
    """매니페스트의 워크스페이스로 인계한다. 매니페스트의 be 항목과 workspace_id 를 읽고 쓴다."""

    client: BeClient

    def workspace(self, manifest: dict) -> str | None:
        """회의의 워크스페이스. 비어 있으면 서버(guild_id)로 BE 에 묻고 매니페스트에 고정한다. 연결이 없으면 None.

        정한 값은 바꾸지 않는다. BE 회의를 만든 뒤 바뀌면 추출 등록이 WORKSPACE_MISMATCH 로 막힌다.
        연결 없음 밖의 오류(연결 실패, 5xx, 401)는 BeError 로 올린다.
        """
        if manifest.get("workspace_id"):
            return manifest["workspace_id"]
        if not manifest.get("guild_id"):
            return None
        try:
            ws = self.client.guild_workspace(str(manifest["guild_id"]))
        except BeError as e:
            if e.code == NOT_CONNECTED:
                return None
            raise
        manifest["workspace_id"] = ws
        return ws

    def start(self, manifest: dict, *, title: str | None = None) -> dict:
        """BE 회의를 만든다. 이미 있으면 그대로. /record 직후와 인계 단계가 같이 부른다."""
        be = manifest.setdefault("be", {})
        if be.get("meeting_id"):
            return be
        ws = self.workspace(manifest)
        if ws is None:
            raise BeError(NOT_CONNECTED, "이 서버에 연결된 워크스페이스가 없다")
        data = self.client.create_meeting(ws, title=title)
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
        """녹음이 끝났다. created → processing. BE 가 failed 로 닫아 둔 회의면 새로 만든다.

        업로드는 BE 의 웹 업로드가 회의를 이미 processing 으로 만들어 두었다. 부르지 않고 매니페스트의 be 를 믿는다.
        processing·done 이 아니면(failed 등) 새 회의를 만들지 않고 MeetingEnded 다.
        """
        if is_upload(manifest):
            be = manifest.setdefault("be", {})
            if not be.get("meeting_id") or be.get("status") not in ("processing", "done"):
                raise MeetingEnded("MEETING_ENDED", f"업로드 회의가 처리 중이 아니다: {be.get('status')!r}", details=dict(be))
            return be
        be = self.start(manifest, title=title)
        if be.get("status") in ("processing", "done"):
            return be
        status = self.client.end_meeting(be["meeting_id"])
        if status == "failed":
            be = self._fresh(manifest, title)
            status = self.client.end_meeting(be["meeting_id"])
        be["status"] = status
        return be

    def report_stage(self, manifest: dict, stage: str) -> None:
        """단계가 시작될 때 BE 에 알린다. 진행 표시용이라 매니페스트를 바꾸지 않고, 어떤 실패도 삼킨다.

        BE 회의가 아직 없으면(be.meeting_id 없음) 부르지 않는다. 처리 결과를 바꾸면 안 되므로 예외는 로그만 남긴다.
        """
        meeting_id = (manifest.get("be") or {}).get("meeting_id")
        if not meeting_id:
            return
        try:
            self.client.report_stage(meeting_id, stage)
        except Exception as e:  # noqa: BLE001 - 진행 표시 실패가 전사·인계를 막으면 안 된다
            print(f"[stage] 세션 {manifest.get('session')} 단계 보고 실패({stage}): {type(e).__name__}: {e}", flush=True)

    def save_sources(self, manifest: dict, *, transcripts_dir: Path, title: str | None = None) -> dict:
        """전사 발화를 BE 에 저장한다. processing 이나 done 회의에 보낸다. end 로 회의를 확보하고, BE 가 failed 로 닫아
        두었으면 end 가 새 회의로 바꾼다. be["sources"] 에 보낸 회의 ID 를 남겨, 회의가 뒤에 바뀌면 다시 보낼 수 있게 한다.

        발화가 없으면(전사가 계약 파일을 쓰지 않았거나 0줄) BE 를 부르지 않고 0줄로 남긴다. 그 기록 없이 계약 파일이
        없으면 FileNotFoundError 다. 계약 파일의 session·model·speakers 는 보내지 않고 Transcript 모양만 보낸다.
        화자 이름은 매니페스트 speakers 의 표시 이름이다.
        """
        path = Path(manifest.get("transcript_json") or transcripts_dir / f"session_{manifest['session']}.transcript.json")
        no_speech = "transcript_json" in manifest and manifest["transcript_json"] is None   # 전사가 0줄이라 파일을 안 썼다
        if not path.exists() and not no_speech:
            # 있어야 할 파일이 없다. 0줄로 닫으면 sources_saved 가 막아 파일을 되살려도 다시 보내지 못한다
            raise FileNotFoundError(f"전사 계약 파일이 없다: {path}")
        transcript = Transcript.from_dict(json.loads(path.read_text(encoding="utf-8"))).to_dict() if path.exists() else None
        if not transcript or not transcript["segments"]:
            be = manifest.setdefault("be", {})
            be["sources"] = {"inserted": 0, "skipped": 0, "duration_ms": None, "meeting_id": be.get("meeting_id")}
            return be
        upload = is_upload(manifest)
        be = self.end(manifest, title=title)
        if upload:
            return self._save_upload_sources(manifest, be, transcript)
        names = speaker_names(manifest)
        try:
            data = self.client.create_sources(be["meeting_id"], transcript, names)
        except BeError as e:
            raise _explained(e) from e
        be["sources"] = {k: data.get(k) for k in ("inserted", "skipped", "duration_ms")}
        be["sources"]["meeting_id"] = be["meeting_id"]
        return be

    def _save_upload_sources(self, manifest: dict, be: dict, transcript: dict) -> dict:
        """업로드 발화 저장. 라벨을 멤버 ID 로 바꿔 보낸다. BE 가 팀원이 아니라고 돌려준 ID(400 details.member_ids)는 null 로
        바꿔 다시 보내고 be["sources"]["dropped_member_ids"] 에 남긴다. 다시 보내는 횟수는 서로 다른 ID 수까지다.
        끝난 회의(409 MEETING_FAILED, 404)는 MeetingEnded 다."""
        members = speaker_members(manifest)
        segments = [{**s, "speaker": None, **({"speaker_member_id": members[s["speaker"]]} if members.get(s["speaker"]) else {})}
                    for s in transcript["segments"]]
        dropped: list[str] = []
        budget = len({s["speaker_member_id"] for s in segments if "speaker_member_id" in s})
        while True:
            try:
                data = self.client.create_sources(be["meeting_id"], {**transcript, "segments": segments}, None)
                break
            except BeError as e:
                if e.code == "MEETING_FAILED" or e.code == "MEETING_NOT_FOUND":
                    raise MeetingEnded(e.code, e.message, status=e.status, details=e.details) from e
                ids = e.details.get("member_ids")
                present = {s["speaker_member_id"] for s in segments if "speaker_member_id" in s}
                bad = [i for i in ids if i in present] if isinstance(ids, list) else []
                if not bad or budget <= 0:
                    raise _explained(e) from e
                budget -= 1
                segments = [{k: v for k, v in s.items() if not (k == "speaker_member_id" and v in bad)} for s in segments]
                dropped += [i for i in bad if i not in dropped]
        be["sources"] = {k: data.get(k) for k in ("inserted", "skipped", "duration_ms")}
        be["sources"]["meeting_id"] = be["meeting_id"]
        if dropped:
            be["sources"]["dropped_member_ids"] = dropped
            log.warning("BE 가 팀원이 아니라고 한 멤버 ID 를 비우고 보냈다: %s (회의 %s)", dropped, be["meeting_id"])
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
        upload = is_upload(manifest)
        if upload:
            dropped = ((manifest.get("be") or {}).get("sources") or {}).get("dropped_member_ids") or []
            members = {label: (None if member in dropped else member) for label, member in speaker_members(manifest).items()}
            items = _with_member_speakers(items, members)   # 발화 저장에서 BE 가 거절해 비운 ID 는 여기서도 뺀다
        changed = bool(manifest.get("reextracted"))                       # 전사가 바뀌어 다시 뽑은 결과다
        previous = (manifest.get("be") or {}).get("extraction_id")

        be = self.end(manifest, title=title)
        try:
            data = self._register(be["meeting_id"], manifest["workspace_id"], transcript_json, model_name, items)
        except BeError as e:
            if upload and e.code in ("MEETING_NOT_PROCESSING", "MEETING_NOT_FOUND"):
                raise MeetingEnded(e.code, e.message, status=e.status, details=e.details) from e
            if e.code == "MEETING_NOT_PROCESSING" and e.details.get("status") == "failed":
                be = self._fresh(manifest, title)
                be = self.end(manifest, title=title)
                # 발화 먼저(BE 명세). 옛 회의에 보낸 발화를 새 회의에도 둔다
                self.save_sources(manifest, transcripts_dir=transcripts_dir, title=title)
                data = self._register(be["meeting_id"], manifest["workspace_id"], transcript_json, model_name, items)
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

    def _register(self, meeting_id: str, workspace_id: str, transcript_json: Path, model_name: str | None,
                  items: list[dict]) -> dict:
        return self.client.create_extraction(meeting_id, workspace_id, transcript_path=str(transcript_json),
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
    """BE_BASE_URL 과 BE_SERVICE_TOKEN 이 다 있을 때만. 하나라도 없으면 인계 단계를 건너뛴다.
    워크스페이스는 설정이 아니라 회의마다 서버로 찾는다(Handoff.workspace, #199).

    토큰이 없으면 BE 가 봇의 모든 쓰기 요청을 401 로 거절한다(#179). 회의마다 실패하게 두지 않고 켜지 않는다.
    """
    from shared.config import settings

    cfg = settings()
    token = getattr(cfg, "be_service_token", "")
    if not cfg.be_base_url or not token:
        return None
    return Handoff(BeClient(cfg.be_base_url, service_token=token))
