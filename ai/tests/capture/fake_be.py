"""BE 회의 API 를 흉내 낸다. 상태 전이와 409 응답이 backend/app/api/meetings.py, extractions.py 와 같다.
유사 task 검색(similar_tasks.py)은 서비스 토큰과 워크스페이스를 보고 401, 404, 502 를 같은 봉투로 낸다.
서버로 워크스페이스 찾기(integrations.py get_discord_guild_workspace)는 토큰을 보고 401, 연결이 없으면 409 다.
회의 요약(bot_summaries.py)은 대기열 규칙이 services/summary.py 와 같다.

requests.Session 자리에 넣는다. 부른 순서를 calls 에 남기고 회의와 추출 결과를 메모리에 둔다.
"""

from __future__ import annotations

import math
import secrets


class _Resp:
    def __init__(self, status: int, body: dict | None, text: str = "", *, raw: bytes | None = None,
                 break_after: int | None = None):
        self.status_code = status
        self._body = body
        self.text = text
        self._raw = raw                   # 스트리밍 응답의 본문(파일 바이트)
        self._break_after = break_after   # 이만큼 보낸 뒤 연결이 끊긴 것처럼 군다
        self.closed = False

    def iter_content(self, chunk_size: int = 1):
        raw = self._raw or b""
        sent = 0
        for i in range(0, len(raw), chunk_size):
            chunk = raw[i:i + chunk_size]
            if self._break_after is not None and sent + len(chunk) > self._break_after:
                if self._break_after > sent:
                    yield chunk[:self._break_after - sent]
                import requests
                raise requests.ConnectionError("스트림이 중간에 끊겼다")
            sent += len(chunk)
            yield chunk

    def close(self):
        self.closed = True

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


def _ok(status: int, data: dict) -> _Resp:
    return _Resp(status, {"data": data, "error": None})


def _err(status: int, code: str, details: dict | None = None) -> _Resp:
    return _Resp(status, {"data": None, "error": {"code": code, "message": code, "details": details or {}}})


def without_stage(calls: list) -> list:
    """처리 단계 보고(PATCH .../stage)를 뺀 호출 목록. 단계 보고는 진행 표시용이라 흐름 단정에서는 보지 않는다."""
    return [c for c in calls if not (c[0] == "PATCH" and c[1].endswith("/stage"))]


class FakeBe:
    ENDED = ("processing", "done", "failed")

    def __init__(self):
        self.meetings: dict[str, dict] = {}
        self.extractions: dict[str, dict] = {}
        self.calls: list[tuple[str, str, dict | None]] = []
        self.headers: list[dict] = []        # calls 와 같은 순서. 호출마다 받은 헤더
        self.timeouts: list[float | None] = []
        self.down = False          # True 면 연결 오류처럼 군다
        self.stage_fail: int | None = None         # HTTP 코드를 넣으면 /stage 만 그 코드로 실패한다
        # 유사 task 검색 (backend/app/api/similar_tasks.py)
        self.service_token = "svc-token"
        self.workspaces = {"ws-1"}
        self.similar: dict[str, list[dict]] = {}   # 문장에 이 낱말이 있으면 이 후보들을 돌려준다
        self.embedding_down = False                # True 면 502 EMBEDDING_UNAVAILABLE
        self.tasks: set[str] = set()               # 수정 항목의 target_task_id 로 받아 주는 task
        # 발화 저장 (backend/app/api/sources.py). 회의마다 {seq: 발화}
        self.sources: dict[str, dict[int, dict]] = {}
        self.sources_fail: tuple | None = None     # (상태, 코드) 를 넣으면 발화 저장이 그 오류로 실패한다
        # 서버로 워크스페이스 찾기 (backend/app/api/integrations.py). 서버 ID 문자열 → 워크스페이스. 없으면 연결 없음
        self.guilds: dict[str, str] = {}
        # 웹 업로드 가져가기 (backend/app/api/uploads.py). 회의 ID → {"item": 대기 목록 항목, "claimed": bool, "audio": bytes | None}
        self.uploads: dict[str, dict] = {}
        self.claim_lost = False       # True 면 claim 은 서버에 반영되지만 응답이 오지 않는다(시간 초과)
        self.streams: list[bool] = []             # 호출마다 받은 stream 인자(원본을 메모리에 다 올리지 않고 받는지 확인용)
        self.file_break_after: int | None = None   # 파일을 이 바이트까지 보내고 연결이 끊긴다
        self.resume_lost = False      # True 면 resume 은 서버에 반영되지만 응답이 오지 않는다
        self.speakers_lost = False    # True 면 라벨 보고는 서버에 반영되지만 응답이 오지 않는다
        self._assign_n = 0            # 지정 순번. 지정 시각 순 정렬에 쓴다
        # 봇용 팀원 이름 조회 (backend/app/api/bot_lookups.py). 워크스페이스 → [{member_id, name, discord_user_id, aliases}]
        self.members: dict[str, list[dict]] = {}
        self.asr_terms: dict[str, set[str]] = {}        # 워크스페이스 → 전사 오인식 검사 용어
        self.asr_titles: dict[str, list[dict]] = {}     # 워크스페이스 → 승인 뒤 아직 안 뽑은 제목
        # 채팅 커서 (backend chat-cursor). 워크스페이스 → last_message_at 문자열. 없으면 data null
        self.chat_cursors: dict[str, str] = {}
        # 채팅 채널 목록 (BE #432 모양). None 이면 items 없는 {"data": {}} 를 준다
        self.chat_channels: list[dict] | None = []
        # 회의 요약 대기열 (backend/app/api/bot_summaries.py). 회의 시작 순서로 더한다. 회의 ID → add_summary 의 행
        self.summaries: dict[str, dict] = {}
        self.summary_put_fail: tuple | None = None   # (상태, 코드) 를 넣으면 요약 저장이 그 오류로 실패한다
        self._n = 0

    def add_upload(self, meeting_id: str, *, workspace_id: str = "ws-1", audio: bytes | None = b"RIFFfake-audio",
                   attendees: list[dict] | None = None, status: str = "processing", **over) -> dict:
        """업로드 회의 하나를 만든다. 회의 행(processing)과 업로드 정보를 함께 둔다. 대기 목록 항목을 돌려준다."""
        item = {"meeting_id": meeting_id, "workspace_id": workspace_id, "title": "주간 회의",
                "started_at": "2026-11-03T01:00:00+09:00",
                "attendees": attendees if attendees is not None else [{"member_id": "u1", "display_name": "민수"}],
                "original_filename": "회의.m4a", "stored_filename": "audio.m4a",
                "size_bytes": len(audio or b""), "content_type": "audio/mp4",
                "uploaded_at": "2026-11-03T02:00:00+00:00"}
        item.update(over)
        self.meetings[meeting_id] = {"meeting_id": meeting_id, "workspace_id": workspace_id, "status": status,
                                     "title": item["title"]}
        self.uploads[meeting_id] = {"item": item, "claimed": False, "audio": audio,
                                     "speakers_assigned": None, "mapping": None, "resumed": False,
                                     "speakers": None, "reported": False}
        return item

    def add_summary(self, meeting_id: str, *, extraction_id: str | None = None, workspace_id: str = "ws-1",
                    requested: bool = True, attempts: int = 0, leased: bool = False, saved: dict | None = None,
                    blocked: str | None = None, chars: int = 100) -> None:
        """blocked 는 지금 돌지 않는 이유(no_sources, awaiting_approval, no_approved_items, not_done)다. 대기열 칸은 Extraction 칸과 같다."""
        extraction_id = None if blocked == "not_done" else extraction_id or f"e-{meeting_id}"
        self.summaries[meeting_id] = {
            "meeting_id": meeting_id, "extraction_id": extraction_id, "workspace_id": workspace_id,
            "identity_epoch": 0, "claim_token": None,
            "requested": requested, "attempts": attempts, "leased": leased, "saved": saved, "blocked": blocked,
            "chars": chars, "title": f"{meeting_id} 회의", "started_at": "2026-11-05T05:00:00Z",
            "source": "discord", "members": ["민수"], "asr_terms": [],
            "lines": [{"seq": 1, "at_ms": 125000, "speaker": "민수", "text": "초대는 이메일로만 하죠"}],
            "items": [{"item_id": "item-1", "action": "create", "title": "초대 메일 보내기", "assignee": "민수",
                       "due_date": "2026-11-14"}],
            "topics": [{"topic_id": "topic-1", "name": "팀원 초대", "description": "초대 방식"}],
            "decisions": [{"decision_id": "dec-1", "text": "초대 코드로 합류한다", "topic": "팀원 초대",
                           "decided_on": "2026-10-20"}],
        }

    def mark_reported(self, meeting_id: str, labels: list[str]) -> None:
        """테스트 준비용: 가져가고(claim) 이 라벨들을 보고한 상태(awaiting_speakers)로 만든다. 샘플 구간은 없다."""
        u = self.uploads[meeting_id]
        u["claimed"] = True
        u["speakers"] = normalize_speakers([{"label": l, "total_sec": 1, "samples": []} for l in labels])
        u["reported"] = True
        self.meetings[meeting_id]["status"] = "awaiting_speakers"

    def expire(self, meeting_id: str) -> None:
        """테스트 준비용: BE 의 업로드 sweeper 가 기한이 지난 회의를 닫은 것을 흉내 낸다(awaiting_speakers·processing -> failed)."""
        m = self.meetings[meeting_id]
        assert m["status"] in ("awaiting_speakers", "processing"), f"기한으로 닫히는 것은 지정을 기다리거나 처리 중인 회의다(지금 {m['status']})"
        m["status"] = "failed"

    def assign(self, meeting_id: str, mapping: dict) -> None:
        """PM 이 화자 지정을 끝낸 것을 흉내 낸다(assign_speakers). 엄격하다: awaiting_speakers 이고 지정 키 집합이
        보고한 라벨 집합과 같을 때만 지정을 기록하고 processing 으로 옮긴다. 아니면 테스트 준비 오류(AssertionError).
        같은 지정을 반복하면 아무것도 하지 않는다."""
        u = self.uploads[meeting_id]
        if u["mapping"] is not None and u["mapping"] == dict(mapping):
            return
        status = self.meetings[meeting_id]["status"]
        assert status == "awaiting_speakers", f"지정은 awaiting_speakers 에서만 받는다(지금 {status}): 먼저 보고하라"
        labels = {s["label"] for s in u["speakers"] or []}
        assert set(mapping) == labels, f"지정 키 {sorted(mapping)} 가 보고한 라벨 {sorted(labels)} 과 다르다"
        self._assign_n += 1
        u["speakers_assigned"] = self._assign_n
        u["mapping"] = dict(mapping)
        self.meetings[meeting_id]["status"] = "processing"

    def request(self, method: str, url: str, json=None, timeout=None, headers=None, stream=False):
        if self.down:
            import requests
            raise requests.ConnectionError("BE 가 꺼져 있다")
        path = url.split("/api/v1", 1)[1]
        self.calls.append((method, path, json))
        self.headers.append(dict(headers or {}))
        self.timeouts.append(timeout)
        self.streams.append(stream)
        body = json or {}
        if path.startswith("/uploads/"):
            return self._uploads(method, path, headers or {}, body)
        if method == "GET" and path.startswith("/integrations/discord/guilds/") and path.endswith("/workspace"):
            return self._guild_workspace(path.split("/")[4], headers or {})
        if method == "GET" and path.startswith("/workspaces/") and path.endswith("/chat-cursor"):
            ws = path.split("/")[2]
            at = self.chat_cursors.get(ws)
            return _ok(200, {"meeting_id": "m-prev", "last_message_at": at} if at else None)
        if method == "GET" and path == "/bot/chat-channels":
            if (headers or {}).get("X-Service-Token") != self.service_token:
                return _err(401, "UNAUTHENTICATED")
            return _ok(200, {} if self.chat_channels is None else {"items": list(self.chat_channels)})
        if method == "GET" and path.startswith("/workspaces/") and path.endswith("/members/names"):
            return self._member_names(path.split("/")[2], headers or {})
        if path.startswith("/workspaces/") and path.endswith("/asr-terms"):
            return self._asr_terms(method, path.split("/")[2], body, headers or {})
        if method == "POST" and path.startswith("/workspaces/") and path.endswith("/tasks/similar"):
            return self._similar(path.split("/")[2], body, headers or {})
        if path == "/summaries/claim" or "/summary" in path:
            if (headers or {}).get("X-Service-Token") != self.service_token:
                return _err(401, "UNAUTHENTICATED")
            if method == "POST" and path == "/summaries/claim":
                return self._claim_summary(body)
            if method == "POST":
                return self._summary_requests(path.split("/")[2], body)
            if method == "GET":
                return self._summary_input(path.split("/")[2], headers or {})
            if method == "PUT":
                return self._put_summary(path.split("/")[2], body, headers or {})
        if (method == "POST" and path in ("/meetings", "/extractions")) or method == "PATCH":
            if (headers or {}).get("X-Service-Token") != self.service_token:   # 봇 쓰기 경로의 토큰 검사(#179)
                return _err(401, "UNAUTHENTICATED")
        if method == "POST" and path == "/meetings":
            self._n += 1
            mid = f"m{self._n}"
            self.meetings[mid] = {"meeting_id": mid, "workspace_id": body["workspace_id"], "status": "created",
                                  "title": body.get("title"), "source": body.get("source"),
                                  "started_at": body.get("started_at")}
            return _ok(201, {"meeting_id": mid, "workspace_id": body["workspace_id"], "status": "created",
                             "started_at": "2026-09-19T00:00:00+00:00"})
        if method == "POST" and path == "/extractions":
            return self._create_extraction(body)
        if method == "POST" and path.startswith("/meetings/") and path.endswith("/sources"):
            return self._sources(path.split("/")[2], body, headers or {})
        if method == "PATCH" and path.startswith("/meetings/"):
            _, _, mid, action = path.split("/")
            m = self.meetings.get(mid)
            if m is None:
                return _err(404, "MEETING_NOT_FOUND", {"meeting_id": mid})
            if action == "stage":
                return self._stage(m, mid, body)
            if action == "end":
                if m["status"] in self.ENDED:
                    return _err(409, "MEETING_ALREADY_ENDED", {"meeting_id": mid, "status": m["status"]})
                m["status"] = "processing"
                return _ok(202, {"meeting_id": mid, "status": "processing", "ended_at": "2026-09-19T00:10:00+00:00"})
            if action == "fail":
                if m["status"] in ("done", "failed"):
                    return _err(409, "MEETING_ALREADY_ENDED", {"meeting_id": mid, "status": m["status"]})
                m["status"] = "failed"
                m["failed_stage"] = body["failed_stage"]
                return _ok(200, {"meeting_id": mid, "status": "failed", "failed_stage": body["failed_stage"]})
        return _Resp(404, None, "not found")

    # 단계 순서 (backend 의 처리 단계). 앞으로만 간다
    STAGES = ("stt", "sources", "extract", "handoff")

    def _stage(self, m: dict, mid: str, body: dict):
        """PATCH /meetings/{id}/stage. processing 회의에서 앞으로 가는 단계만 적용하고, 아니면 200 applied False."""
        if self.stage_fail is not None:
            return _err(self.stage_fail, "MEETING_NOT_FOUND" if self.stage_fail == 404 else "INTERNAL_ERROR")
        stage = body["stage"]
        old = m.get("stage")
        applied = m["status"] == "processing" and (old is None or self.STAGES.index(stage) > self.STAGES.index(old))
        if applied:
            m["stage"] = stage
            m["stt"] = body.get("stt") if stage == "stt" else None
        elif m["status"] == "processing" and old == stage == "stt" and body.get("stt") is not None:
            applied = m.get("stt") != body["stt"]
            m["stt"] = dict(body["stt"])
        return _ok(200, {"meeting_id": mid, "status": m["status"], "processing_stage": m.get("stage"),
                         "stt": m.get("stt"), "applied": applied})

    def _create_extraction(self, body: dict):
        fields = [{"loc": ["body", "items", i, "evidence_speaker_member_id"], "msg": "String should have at most 36 characters"}
                  for i, it in enumerate(body.get("items") or [])
                  if len(it.get("evidence_speaker_member_id") or "") > MEMBER_ID_MAX]
        if fields:                      # 요청 검증은 회의 확인보다 먼저다
            return _err(400, "INVALID_REQUEST", {"fields": fields})
        mid = body["meeting_id"]
        m = self.meetings.get(mid)
        if m is None:
            return _err(404, "MEETING_NOT_FOUND", {"meeting_id": mid})
        if m["workspace_id"] != body["workspace_id"]:
            return _err(400, "WORKSPACE_MISMATCH")
        if m["status"] != "processing":
            if m["status"] == "done" and mid in self.extractions:   # 멱등: 기존 것을 돌려준다
                e = self.extractions[mid]
                return _ok(201, {"extraction_id": e["extraction_id"], "meeting_id": mid, "item_count": len(e["saved"])})
            return _err(409, "MEETING_NOT_PROCESSING", {"meeting_id": mid, "status": m["status"]})
        m["status"] = "done"
        eid = f"e-{mid}"
        saved = [i for i in body["items"] if self._accepts(i)]
        self.extractions[mid] = {"extraction_id": eid, "items": body["items"], "saved": saved,
                                 "transcript_path": body.get("transcript_path"), "model_name": body.get("model_name")}
        return _ok(201, {"extraction_id": eid, "meeting_id": mid, "item_count": len(saved)})

    def _accepts(self, item: dict) -> bool:
        """BE 는 잘못된 항목 하나로 요청 전체를 실패시키지 않고 그 항목만 건너뛴다 (extractions.py)."""
        if item.get("action") == "update":
            return item.get("target_task_id") in self.tasks
        return bool((item.get("task_title") or "").strip())

    def _sources(self, mid: str, body: dict, headers: dict):
        """토큰 → 요청 검사(seq 겹침은 400) → 회의 → failed 는 409 MEETING_FAILED → 없는 seq 만 넣는다."""
        if headers.get("X-Service-Token") != self.service_token:
            return _err(401, "UNAUTHENTICATED")
        if self.sources_fail:
            return _err(*self.sources_fail)
        segments = body.get("segments") or []
        fields = _segment_problems(segments)
        if fields:
            return _err(400, "INVALID_REQUEST", {"fields": fields})
        m = self.meetings.get(mid)
        if m is None:
            return _err(404, "MEETING_NOT_FOUND", {"meeting_id": mid})
        if m["status"] == "failed":
            return _err(409, "MEETING_FAILED", {"meeting_id": mid, "status": "failed"})
        # 요청에 처음 나온 순서로, 중복 없이. 틀린 ID 가 하나라도 있으면 아무것도 저장하지 않는다(이미 저장된 seq 도 본다)
        active = {x["member_id"] for x in self.members.get(m["workspace_id"], []) if not x.get("deleted")}
        asked = list(dict.fromkeys(s["speaker_member_id"] for s in segments if s.get("speaker_member_id")))
        unknown = [x for x in asked if x not in active]
        if unknown:
            return _err(400, "INVALID_REQUEST", {"member_ids": unknown})
        by_uid = {x["discord_user_id"]: x["member_id"] for x in self.members.get(m["workspace_id"], [])
                  if x.get("discord_user_id") and not x.get("deleted")}
        saved = self.sources.setdefault(mid, {})
        names = body.get("speaker_names") or {}
        new = [s for s in sorted(segments, key=lambda s: s["seq"]) if s["seq"] not in saved]
        for s in new:
            saved[s["seq"]] = {**s, "speaker_name": names.get(s.get("speaker")),
                               "member_id": s.get("speaker_member_id") or by_uid.get(s.get("speaker"))}
        ends = [round(s["end"] * 1000) for s in saved.values()]
        return _ok(201, {"meeting_id": mid, "inserted": len(new), "skipped": len(segments) - len(new),
                         "duration_ms": max(ends) if ends else None})

    def _guild_workspace(self, guild_id: str, headers: dict):
        if headers.get("X-Service-Token") != self.service_token:
            return _err(401, "UNAUTHENTICATED")
        if guild_id not in self.guilds:
            return _err(409, "INTEGRATION_NOT_CONNECTED", {"provider": "discord", "guild_id": guild_id})
        return _ok(200, {"guild_id": guild_id, "workspace_id": self.guilds[guild_id]})

    def _member_names(self, workspace_id: str, headers: dict):
        if headers.get("X-Service-Token") != self.service_token:
            return _err(401, "UNAUTHENTICATED")
        if workspace_id not in self.workspaces:
            return _err(404, "WORKSPACE_NOT_FOUND", {"workspace_id": workspace_id})
        return _ok(200, {"items": list(self.members.get(workspace_id, []))})

    def _asr_terms(self, method: str, workspace_id: str, body: dict, headers: dict):
        if headers.get("X-Service-Token") != self.service_token:
            return _err(401, "UNAUTHENTICATED")
        if workspace_id not in self.workspaces:
            return _err(404, "WORKSPACE_NOT_FOUND", {"workspace_id": workspace_id})
        words = self.asr_terms.setdefault(workspace_id, set())
        titles = self.asr_titles.setdefault(workspace_id, [])
        if method == "GET":
            return _ok(200, {"words": sorted(words), "pending_titles": list(titles)})
        new = set(body.get("words") or []) - words
        words |= new
        gone = set(body.get("absorbed_title_ids") or [])
        self.asr_titles[workspace_id] = [t for t in titles if t["title_id"] not in gone]
        return _ok(200, {"added": len(new), "absorbed": len(titles) - len(self.asr_titles[workspace_id])})

    def _similar(self, workspace_id: str, body: dict, headers: dict):
        if headers.get("X-Service-Token") != self.service_token:
            return _err(401, "UNAUTHENTICATED")
        if workspace_id not in self.workspaces:
            return _err(404, "WORKSPACE_NOT_FOUND", {"workspace_id": workspace_id})
        if self.embedding_down:
            return _err(502, "EMBEDDING_UNAVAILABLE", {"reason": "임베딩 API 호출 실패"})
        items = [c for word, cands in self.similar.items() if word in body["text"] for c in cands]
        return _ok(200, {"items": items})

    def _claim_summary(self, body: dict):
        only = body.get("extraction_ids")
        for row in self.summaries.values():
            eligible = row["requested"] and row["attempts"] < 2 and not row["leased"]
            if eligible and (only is None or row["extraction_id"] in only):
                row["attempts"] += 1
                row["leased"] = True
                row["claim_token"] = secrets.token_urlsafe(32)
                return _ok(200, {"extraction_id": row["extraction_id"], "meeting_id": row["meeting_id"],
                                 "workspace_id": row["workspace_id"], "attempt": row["attempts"],
                                 "claim_token": row["claim_token"], "identity_epoch": row["identity_epoch"]})
        return _ok(200, None)

    def _summary_row(self, extraction_id: str) -> dict | None:
        return next((r for r in self.summaries.values() if r["extraction_id"] == extraction_id), None)

    def _summary_input(self, extraction_id: str, headers: dict):
        row = self._summary_row(extraction_id)
        if row is None:
            return _err(404, "EXTRACTION_NOT_FOUND", {"extraction_id": extraction_id})
        if "X-Privacy-Epoch" in headers and headers["X-Privacy-Epoch"] != str(row["identity_epoch"]):
            return _err(409, "PRIVACY_VERSION_CHANGED")
        keys = ("extraction_id", "meeting_id", "workspace_id", "title", "started_at", "source", "members", "asr_terms",
                "lines", "items", "topics", "decisions", "identity_epoch")
        return _ok(200, {k: row[k] for k in keys})

    def _put_summary(self, extraction_id: str, body: dict, headers: dict):
        row = self._summary_row(extraction_id)
        if row is None:
            return _err(404, "EXTRACTION_NOT_FOUND", {"extraction_id": extraction_id})
        if self.summary_put_fail:
            status, code = self.summary_put_fail
            return _err(status, code)
        if headers.get("X-Privacy-Epoch") != str(row["identity_epoch"]):
            return _err(409, "PRIVACY_VERSION_CHANGED")
        if _summary_problems(body):                  # SummaryWriteRequest 가 받지 않는 본문
            return _err(422, "VALIDATION_ERROR", {"problems": _summary_problems(body)})
        if not row["requested"] or not row["leased"] or body.get("claim_token") != row["claim_token"]:
            return _ok(200, {"extraction_id": extraction_id, "meeting_id": row["meeting_id"], "applied": False,
                             "topic_count": 0, "decision_count": 0})
        row.update(saved=body, requested=False, attempts=0, leased=False)
        return _ok(200, {"extraction_id": extraction_id, "meeting_id": row["meeting_id"], "applied": True,
                         "topic_count": len(body["topics"]),
                         "decision_count": sum(len(t["decisions"]) for t in body["topics"])})

    def _summary_requests(self, workspace_id: str, body: dict):
        if workspace_id not in self.workspaces:
            return _err(404, "WORKSPACE_NOT_FOUND", {"workspace_id": workspace_id})
        meeting_ids, include_all = body.get("meeting_ids"), body.get("include_all", False)
        if include_all == (meeting_ids is not None):
            return _err(422, "VALIDATION_ERROR")
        rows = [r for r in self.summaries.values() if r["workspace_id"] == workspace_id
                and (include_all or r["meeting_id"] in meeting_ids)]
        missing = sorted(set(meeting_ids or []) - {r["meeting_id"] for r in rows})
        if missing:
            return _err(404, "MEETING_NOT_FOUND", {"meeting_ids": missing})
        items = []
        for row in rows:
            state = self._summary_state(row, bool(body.get("force")))
            marks = state == "requested" or (state == "awaiting_approval" and not row["requested"])
            if marks and not body.get("dry_run", True):
                row.update(requested=True, attempts=0, leased=False)
            items.append({"meeting_id": row["meeting_id"], "extraction_id": row["extraction_id"], "title": row["title"],
                          "started_at": row["started_at"], "state": state, "chars": row["chars"]})
        return _ok(200, {"items": items})

    @staticmethod
    def _summary_state(row: dict, force: bool) -> str:
        if row["blocked"]:
            return row["blocked"]
        if row["requested"] and row["leased"]:
            return "queued"
        if force:
            return "requested"
        if row["requested"]:
            return "queued" if row["attempts"] < 2 or row["leased"] else "gave_up"
        return "done" if row["saved"] is not None else "requested"

    def _uploads(self, method: str, path: str, headers: dict, body: dict | None = None):
        """토큰 → 대기 목록·claim·파일. 오류 코드는 uploads.py 와 같다."""
        if headers.get("X-Service-Token") != self.service_token:
            return _err(401, "UNAUTHENTICATED")
        if method == "GET" and path == "/uploads/pending":
            items = [u["item"] for mid, u in self.uploads.items()
                     if not u["claimed"] and self.meetings[mid]["status"] == "processing"]
            return _ok(200, {"items": items})
        if method == "GET" and path == "/uploads/assigned":   # parts[2] 분기보다 먼저(assigned 는 회의 ID 가 아니다)
            rows = sorted((u for mid, u in self.uploads.items()
                           if self.meetings[mid]["status"] == "processing" and u["speakers_assigned"] is not None
                           and not u["resumed"]), key=lambda u: u["speakers_assigned"])
            return _ok(200, {"items": [{"meeting_id": u["item"]["meeting_id"], "workspace_id": u["item"]["workspace_id"],
                                        "title": u["item"]["title"], "started_at": u["item"]["started_at"],
                                        "mapping": dict(u["mapping"]), "assigned_at": f"assign-{u['speakers_assigned']}"}
                                       for u in rows]})
        parts = path.split("/")      # ["", "uploads", mid, action]
        mid, action = parts[2], parts[3] if len(parts) > 3 else ""
        u = self.uploads.get(mid)
        if method == "PATCH" and action == "claim":
            if u is None:
                return _err(404, "MEETING_NOT_FOUND", {"meeting_id": mid})
            status = self.meetings[mid]["status"]
            if status != "processing":
                return _err(409, "MEETING_ALREADY_ENDED", {"meeting_id": mid, "status": status})
            if u["claimed"]:
                return _err(409, "MEETING_PROCESSING_IN_PROGRESS", {"meeting_id": mid})
            u["claimed"] = True
            if self.claim_lost:
                import requests
                raise requests.ConnectionError("claim 응답을 받지 못했다")
            return _ok(200, {"meeting_id": mid, "status": "processing"})
        if method == "PATCH" and action == "resume":
            return self._resume(mid, u)
        if method == "POST" and action == "speakers":
            return self._report_speakers(mid, u, body or {})
        if method == "GET" and action == "file":
            if u is None or u["audio"] is None:
                return _err(404, "MEETING_NOT_FOUND", {"meeting_id": mid})
            return _Resp(200, None, raw=u["audio"], break_after=self.file_break_after)
        return _Resp(404, None, "not found")

    def _resume(self, mid: str, u: dict | None):
        """404 → ENDED(done·failed) → 이미 resume 했고 processing 이면 200 같은 mapping → 그 밖은 409 SPEAKERS_NOT_ASSIGNED.
        speaker_assignment.resume_upload 의 판정 순서다. 클래스 상수 ENDED 는 processing 을 포함해 여기 쓰지 않는다."""
        if u is None:
            return _err(404, "MEETING_NOT_FOUND", {"meeting_id": mid})
        status = self.meetings[mid]["status"]
        if status in ("done", "failed"):
            return _err(409, "MEETING_ALREADY_ENDED", {"meeting_id": mid, "status": status})
        first = u["speakers_assigned"] is not None and not u["resumed"] and status == "processing"
        retry = u["resumed"] and status == "processing"
        if not (first or retry):
            return _err(409, "SPEAKERS_NOT_ASSIGNED", {"meeting_id": mid, "status": status})
        u["resumed"] = True
        if self.resume_lost:
            import requests
            raise requests.ConnectionError("resume 응답을 받지 못했다")
        return _ok(200, {"meeting_id": mid, "status": status, "mapping": dict(u["mapping"])})

    def _report_speakers(self, mid: str, u: dict | None, body: dict):
        """토큰(_uploads 가 먼저) → 400 검증 → processing·가져감·미보고면 awaiting_speakers 로 200 → 404 → done·failed 는
        ENDED → 안 가져갔으면 UPLOAD_NOT_CLAIMED → 정규화한 내용이 같으면 200(status 는 현재 값) → SPEAKERS_ALREADY_REPORTED
        (details.labels 이름순). speaker_assignment.report_speakers 의 판정 순서다."""
        fields = _speakers_problems(body.get("speakers"))
        if fields:
            return _err(400, "INVALID_REQUEST", {"fields": fields})
        normalized = normalize_speakers(body["speakers"])
        if u is not None:
            m = self.meetings[mid]
            if m["status"] == "processing" and u["claimed"] and not u["reported"]:
                m["status"] = "awaiting_speakers"
                u["speakers"], u["reported"] = normalized, True
                return self._speakers_response(mid, m["status"])
        if u is None:
            return _err(404, "MEETING_NOT_FOUND", {"meeting_id": mid})
        status = self.meetings[mid]["status"]
        if status in ("done", "failed"):
            return _err(409, "MEETING_ALREADY_ENDED", {"meeting_id": mid, "status": status})
        if not u["claimed"]:
            return _err(409, "UPLOAD_NOT_CLAIMED", {"meeting_id": mid, "status": status})
        stored = u["speakers"] or []
        if u["reported"] and stored == normalized:
            return self._speakers_response(mid, status)
        return _err(409, "SPEAKERS_ALREADY_REPORTED",
                    {"meeting_id": mid, "status": status, "labels": [s["label"] for s in stored]})

    def _speakers_response(self, mid: str, status: str):
        if self.speakers_lost:
            import requests
            raise requests.ConnectionError("라벨 보고 응답을 받지 못했다")
        return _ok(200, {"meeting_id": mid, "status": status})


def _summary_problems(body: dict) -> list[str]:
    """SummaryWriteRequest 의 제약 가운데 봇이 어길 수 있는 것."""
    problems = []
    if not body.get("overview"):
        problems.append("overview")
    if not isinstance(body.get("key_points"), list):
        problems.append("key_points")
    for topic in body.get("topics") or []:
        if topic.get("topic_id") is None and topic.get("name") is None:
            problems.append("topic_id, name")
        if len(topic.get("name") or "") > 100:
            problems.append("name")
        if len(topic.get("item_ids") or []) > 500:
            problems.append("item_ids")
    return problems


def normalize_speakers(speakers: list[dict]) -> list[dict]:
    """BE 의 normalize_speakers 와 같다: 라벨 이름순, 샘플 (start, end) 순, 숫자는 float."""
    return sorted(({"label": s["label"], "total_sec": float(s["total_sec"]),
                    "samples": sorted(({"start": float(x["start"]), "end": float(x["end"])} for x in s.get("samples") or []),
                                      key=lambda x: (x["start"], x["end"]))} for s in speakers),
                  key=lambda s: s["label"])


MEMBER_ID_MAX = 36


def _segment_problems(segments: list[dict]) -> list[dict]:
    """schemas/source.py(TranscriptCreateRequest) 의 검증을 BE 400 의 details.fields 모양({loc, msg})으로."""
    out: list[dict] = []
    for i, s in enumerate(segments):
        at = ["body", "segments", i]
        if s["seq"] < 0:
            out.append({"loc": at + ["seq"], "msg": "Input should be greater than or equal to 0"})
        if len(s.get("speaker_member_id") or "") > MEMBER_ID_MAX:
            out.append({"loc": at + ["speaker_member_id"], "msg": "String should have at most 36 characters"})
    seqs = [s["seq"] for s in segments]
    dup = sorted({q for q in seqs if seqs.count(q) > 1})
    if dup:
        out.append({"loc": ["body"], "msg": f"Value error, 한 요청 안에 seq가 겹친다: {dup}"})
    return out


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _speakers_problems(speakers) -> list[dict]:
    """schemas/upload.py(SpeakersReportRequest) 의 검증. BE 400 의 details.fields 모양({loc, msg})으로 돌려준다."""
    if not isinstance(speakers, list) or not speakers:
        return [{"loc": ["body", "speakers"], "msg": "List should have at least 1 item"}]
    out: list[dict] = []
    for i, s in enumerate(speakers):
        at = ["body", "speakers", i]
        if not isinstance(s, dict):
            out.append({"loc": at, "msg": "Input should be an object"})
            continue
        label = s.get("label")
        if not isinstance(label, str) or not 1 <= len(label) <= 64:
            out.append({"loc": at + ["label"], "msg": "label 은 1~64자 문자열이어야 한다"})
        elif not label.strip():
            out.append({"loc": at + ["label"], "msg": "label 은 공백만으로 이루어질 수 없습니다"})
        if not _num(s.get("total_sec")) or s["total_sec"] < 0:
            out.append({"loc": at + ["total_sec"], "msg": "total_sec 는 0 이상의 유한한 수여야 한다"})
        for j, x in enumerate(s.get("samples") or []):
            xs = at + ["samples", j]
            if not isinstance(x, dict) or not _num(x.get("start")) or x["start"] < 0:
                out.append({"loc": xs + ["start"], "msg": "start 는 0 이상의 유한한 수여야 한다"})
            elif not _num(x.get("end")):
                out.append({"loc": xs + ["end"], "msg": "end 는 유한한 수여야 한다"})
            elif x["end"] <= x["start"]:
                out.append({"loc": xs, "msg": "end 는 start 보다 커야 합니다"})
    labels = [s.get("label") for s in speakers if isinstance(s, dict) and isinstance(s.get("label"), str)]
    if len(set(labels)) != len(labels):
        out.append({"loc": ["body", "speakers"], "msg": "label 이 중복되었습니다"})
    return out
