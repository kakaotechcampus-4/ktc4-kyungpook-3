"""BE 회의 API 를 흉내 낸다. 상태 전이와 409 응답이 backend/app/api/meetings.py, extractions.py 와 같다.

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
        self.down = False          # True 면 연결 오류처럼 군다
        self._n = 0

    def request(self, method: str, url: str, json=None, timeout=None):
        if self.down:
            import requests
            raise requests.ConnectionError("BE 가 꺼져 있다")
        path = url.split("/api/v1", 1)[1]
        self.calls.append((method, path, json))
        body = json or {}
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
                return _ok(201, {"extraction_id": e["extraction_id"], "meeting_id": mid, "item_count": len(e["items"])})
            return _err(409, "MEETING_NOT_PROCESSING", {"meeting_id": mid, "status": m["status"]})
        m["status"] = "done"
        eid = f"e-{mid}"
        self.extractions[mid] = {"extraction_id": eid, "items": body["items"],
                                 "transcript_path": body.get("transcript_path"), "model_name": body.get("model_name")}
        return _ok(201, {"extraction_id": eid, "meeting_id": mid, "item_count": len(body["items"])})
