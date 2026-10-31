"""화자 분리: 경로 -> 구간 목록. 호스팅 API(pyannoteAI) 어댑터와 구간 정리.

pyannoteAI 흐름 (https://docs.pyannote.ai/openapi.json 로 확인):
  POST /v1/media/input {url: media://..} -> {url: 서명된 PUT 주소}
  PUT  서명된 주소 (파일 본문)
  POST /v1/diarize {url: media://..} -> {jobId}
  GET  /v1/jobs/{jobId} 폴링 -> status(succeeded|failed|canceled|...) 와 output.diarization[{speaker,start,end}]
인증은 `Authorization: Bearer <PYANNOTEAI_API_KEY>`.
확인: docs.pyannote.ai/openapi.json 을 2026-10-31 에 받아 url(media://), jobId, status 열거값, output.diarization[{speaker,start,end}] 를 대조했다.
"""

from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

API = "https://api.pyannote.ai"
HTTP_TIMEOUT_S = 60.0
UPLOAD_TIMEOUT_S = 600.0


@dataclass(frozen=True)
class Segment:
    start_s: float
    end_s: float
    label: str


class Diarizer(Protocol):
    @staticmethod
    def _transient(exc: Exception) -> bool:
        """폴링 중 다시 해볼 만한 오류: 연결·시간 초과, 429, 5xx."""
        import requests

        if isinstance(exc, (requests.ConnectionError, requests.Timeout)):
            return True
        code = getattr(getattr(exc, "response", None), "status_code", None)
        return code == 429 or (code is not None and code >= 500)

    def _poll(self, http, url: str, headers: dict) -> dict:
        errors = 0
        while True:
            try:
                r = http.get(url, headers=headers, timeout=HTTP_TIMEOUT_S)
                r.raise_for_status()
                return r.json()
            except Exception as exc:
                if not self._transient(exc) or errors >= self._poll_retries:
                    raise
                errors += 1
                self._sleep(self._poll_s)

    def diarize(self, path: Path) -> list[Segment]: ...


def normalize(segments: list[Segment], total_s: float) -> list[Segment]:
    """끝을 넘는 구간은 자르고, 길이 0 이하는 버리고, 같은 라벨의 겹침·맞닿음은 합친다.
    다른 라벨끼리 겹친 구간은 둘 다 둔다."""
    by_label: dict[str, list[tuple[float, float]]] = {}
    for s in segments:
        a, b = max(0.0, s.start_s), min(total_s, s.end_s)
        if b - a > 0:
            by_label.setdefault(s.label, []).append((a, b))
    out: list[Segment] = []
    for label, spans in by_label.items():
        spans.sort()
        cur_a, cur_b = spans[0]
        for a, b in spans[1:]:
            if a <= cur_b:
                cur_b = max(cur_b, b)
            else:
                out.append(Segment(cur_a, cur_b, label))
                cur_a, cur_b = a, b
        out.append(Segment(cur_a, cur_b, label))
    return sorted(out, key=lambda s: (s.start_s, s.end_s, s.label))


class PyannoteAiDiarizer:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        session=None,
        sleep: Callable[[float], None] = time.sleep,
        poll_s: float = 10.0,
        timeout_s: float = 1800.0,
        poll_retries: int = 5,
    ):
        self._key = api_key
        self._session = session
        self._sleep = sleep
        self._poll_s = poll_s
        self._timeout_s = timeout_s
        self._poll_retries = poll_retries

    def _http(self):
        if self._session is None:
            import requests

            self._session = requests.Session()
        return self._session

    @staticmethod
    def _transient(exc: Exception) -> bool:
        """폴링 중 다시 해볼 만한 오류: 연결·시간 초과, 429, 5xx."""
        import requests

        if isinstance(exc, (requests.ConnectionError, requests.Timeout)):
            return True
        code = getattr(getattr(exc, "response", None), "status_code", None)
        return code == 429 or (code is not None and code >= 500)

    def _poll(self, http, url: str, headers: dict) -> dict:
        errors = 0
        while True:
            try:
                r = http.get(url, headers=headers, timeout=HTTP_TIMEOUT_S)
                r.raise_for_status()
                return r.json()
            except Exception as exc:
                if not self._transient(exc) or errors >= self._poll_retries:
                    raise
                errors += 1
                self._sleep(self._poll_s)

    def diarize(self, path: Path) -> list[Segment]:
        key = self._key or os.environ.get("PYANNOTEAI_API_KEY", "").strip()
        if not key:
            raise RuntimeError("PYANNOTEAI_API_KEY 환경변수가 없습니다.")
        http = self._http()
        headers = {"Authorization": f"Bearer {key}"}
        media = f"media://mm-upload/{uuid.uuid4().hex}"

        r = http.post(f"{API}/v1/media/input", json={"url": media}, headers=headers, timeout=HTTP_TIMEOUT_S)
        r.raise_for_status()
        with open(path, "rb") as fh:
            http.put(r.json()["url"], data=fh, timeout=UPLOAD_TIMEOUT_S).raise_for_status()

        r = http.post(f"{API}/v1/diarize", json={"url": media}, headers=headers, timeout=HTTP_TIMEOUT_S)
        r.raise_for_status()
        job_id = r.json()["jobId"]

        waited = 0.0
        while True:
            body = self._poll(http, f"{API}/v1/jobs/{job_id}", headers)
            status = body.get("status")
            if status == "succeeded":
                return [
                    Segment(float(d["start"]), float(d["end"]), str(d["speaker"]))
                    for d in (body.get("output") or {}).get("diarization", [])
                ]
            if status in ("failed", "canceled"):
                raise RuntimeError(f"pyannoteAI 화자 분리 {status} (job {job_id})")
            if waited >= self._timeout_s:
                raise TimeoutError(f"pyannoteAI 화자 분리가 {self._timeout_s:.0f}초 안에 끝나지 않았다 (job {job_id})")
            self._sleep(self._poll_s)
            waited += self._poll_s
