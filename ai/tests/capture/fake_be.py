"""BE 회의 API 를 흉내 낸다. 상태 전이와 409 응답이 backend/app/api/meetings.py, extractions.py 와 같다.
유사 task 검색(similar_tasks.py)은 서비스 토큰과 워크스페이스를 보고 401, 404, 502 를 같은 봉투로 낸다.

requests.Session 자리에 넣는다. 부른 순서를 calls 에 남기고 회의와 추출 결과를 메모리에 둔다.
"""

from __future__ import annotations


class _Resp:
    def __init__(self, status: int, body: dict | None, text: str = ""):
        self.status_code = status
        self._body = body
        self.text = text

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
        self._n = 0

    def request(self, method: str, url: str, json=None, timeout=None, headers=None):
        if self.down:
            import requests
            raise requests.ConnectionError("BE 가 꺼져 있다")
        path = url.split("/api/v1", 1)[1]
        self.calls.append((method, path, json))
        self.headers.append(dict(headers or {}))
        self.timeouts.append(timeout)
        body = json or {}
        if method == "POST" and path.startswith("/workspaces/") and path.endswith("/tasks/similar"):
            return self._similar(path.split("/")[2], body, headers or {})
        if method == "POST" and path == "/meetings":
            self._n += 1
            mid = f"m{self._n}"
            self.meetings[mid] = {"meeting_id": mid, "workspace_id": body["workspace_id"], "status": "created",
                                  "title": body.get("title")}
            return _ok(201, {"meeting_id": mid, "workspace_id": body["workspace_id"], "status": "created",
                             "started_at": "2026-09-19T00:00:00+00:00"})
        if method == "POST" and path == "/extractions":
            return self._create_extraction(body)
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

    def _similar(self, workspace_id: str, body: dict, headers: dict):
        if headers.get("X-Service-Token") != self.service_token:
            return _err(401, "UNAUTHENTICATED")
        if workspace_id not in self.workspaces:
            return _err(404, "WORKSPACE_NOT_FOUND", {"workspace_id": workspace_id})
        if self.embedding_down:
            return _err(502, "EMBEDDING_UNAVAILABLE", {"reason": "임베딩 API 호출 실패"})
        items = [c for word, cands in self.similar.items() if word in body["text"] for c in cands]
        return _ok(200, {"items": items})
