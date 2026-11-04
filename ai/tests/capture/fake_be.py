"""BE 회의 API 를 흉내 낸다. 상태 전이와 409 응답이 backend/app/api/meetings.py, extractions.py 와 같다.
유사 task 검색(similar_tasks.py)은 서비스 토큰과 워크스페이스를 보고 401, 404, 502 를 같은 봉투로 낸다.
서버로 워크스페이스 찾기(integrations.py get_discord_guild_workspace)는 토큰을 보고 401, 연결이 없으면 409 다.

requests.Session 자리에 넣는다. 부른 순서를 calls 에 남기고 회의와 추출 결과를 메모리에 둔다.
"""

from __future__ import annotations


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


class FakeBe:
    ENDED = ("processing", "done", "failed")

    def __init__(self):
        self.meetings: dict[str, dict] = {}
        self.extractions: dict[str, dict] = {}
        self.calls: list[tuple[str, str, dict | None]] = []
        self.headers: list[dict] = []        # calls 와 같은 순서. 호출마다 받은 헤더
        self.timeouts: list[float | None] = []
        self.down = False          # True 면 연결 오류처럼 군다
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
        # 봇용 팀원 이름 조회 (backend/app/api/bot_lookups.py). 워크스페이스 → [{member_id, name, discord_user_id, aliases}]
        self.members: dict[str, list[dict]] = {}
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
        self.uploads[meeting_id] = {"item": item, "claimed": False, "audio": audio}
        return item

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
            return self._uploads(method, path, headers or {})
        if method == "GET" and path.startswith("/integrations/discord/guilds/") and path.endswith("/workspace"):
            return self._guild_workspace(path.split("/")[4], headers or {})
        if method == "GET" and path.startswith("/workspaces/") and path.endswith("/members/names"):
            return self._member_names(path.split("/")[2], headers or {})
        if method == "POST" and path.startswith("/workspaces/") and path.endswith("/tasks/similar"):
            return self._similar(path.split("/")[2], body, headers or {})
        if (method == "POST" and path in ("/meetings", "/extractions")) or method == "PATCH":
            if (headers or {}).get("X-Service-Token") != self.service_token:   # 봇 쓰기 경로의 토큰 검사(#179)
                return _err(401, "UNAUTHENTICATED")
        if method == "POST" and path == "/meetings":
            self._n += 1
            mid = f"m{self._n}"
            self.meetings[mid] = {"meeting_id": mid, "workspace_id": body["workspace_id"], "status": "created",
                                  "title": body.get("title")}
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

    def _create_extraction(self, body: dict):
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
        seqs = [s["seq"] for s in segments]
        if len(set(seqs)) != len(seqs) or any(q < 0 for q in seqs):
            return _err(400, "INVALID_REQUEST", {"fields": ["segments"]})
        m = self.meetings.get(mid)
        if m is None:
            return _err(404, "MEETING_NOT_FOUND", {"meeting_id": mid})
        if m["status"] == "failed":
            return _err(409, "MEETING_FAILED", {"meeting_id": mid, "status": "failed"})
        saved = self.sources.setdefault(mid, {})
        names = body.get("speaker_names") or {}
        new = [s for s in sorted(segments, key=lambda s: s["seq"]) if s["seq"] not in saved]
        for s in new:
            saved[s["seq"]] = {**s, "speaker_name": names.get(s.get("speaker"))}
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

    def _similar(self, workspace_id: str, body: dict, headers: dict):
        if headers.get("X-Service-Token") != self.service_token:
            return _err(401, "UNAUTHENTICATED")
        if workspace_id not in self.workspaces:
            return _err(404, "WORKSPACE_NOT_FOUND", {"workspace_id": workspace_id})
        if self.embedding_down:
            return _err(502, "EMBEDDING_UNAVAILABLE", {"reason": "임베딩 API 호출 실패"})
        items = [c for word, cands in self.similar.items() if word in body["text"] for c in cands]
        return _ok(200, {"items": items})

    def _uploads(self, method: str, path: str, headers: dict):
        """토큰 → 대기 목록·claim·파일. 오류 코드는 uploads.py 와 같다."""
        if headers.get("X-Service-Token") != self.service_token:
            return _err(401, "UNAUTHENTICATED")
        if method == "GET" and path == "/uploads/pending":
            items = [u["item"] for mid, u in self.uploads.items()
                     if not u["claimed"] and self.meetings[mid]["status"] == "processing"]
            return _ok(200, {"items": items})
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
        if method == "GET" and action == "file":
            if u is None or u["audio"] is None:
                return _err(404, "MEETING_NOT_FOUND", {"meeting_id": mid})
            return _Resp(200, None, raw=u["audio"], break_after=self.file_break_after)
        return _Resp(404, None, "not found")
