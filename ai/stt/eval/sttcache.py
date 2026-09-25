"""같은 오디오 조각을 같은 백엔드·설정으로 다시 부르지 않게 하는 캐시와 호출별 기록.

민감도 측정은 상수 하나를 흔들 때마다 회의 전체를 다시 전사한다. 그런데 많은 값에서 모델에 가는
조각은 기본값 때와 똑같다(예: 정렬본에서 TURN_GAP_S 2~8초). 조각의 내용 해시로 결과를 저장해 두면
그 조각은 다시 계산하지 않는다. 로컬 디코딩이 같은 입력에 같은 결과를 낸다는 것을 먼저 확인한 뒤에만
로컬 캐시를 믿는다. 원격 API 는 같은 입력에도 결과가 다를 수 있어서, 잡음 폭을 재는 반복은 read=False
로 매번 보낸다.

calls 에 호출마다 오디오 길이, 걸린 시간(캐시 적중이면 처음 잰 값), 적중 여부, 오류를 남긴다. API
상수(STALL_S, RETRIES, 타임아웃)의 근거인 지연 분포가 이 기록에서 나온다. fingerprint() 는 이번 실행에서
모델에 간 조각들의 해시를 순서와 무관하게 하나로 묶은 값이다. 값이 같으면 모델 입력이 같았다는 뜻이라,
"그 상수가 이 데이터에서 발동했나" 를 이것으로 가른다.

저장 위치는 레포 밖이어야 한다(회의 음성의 전사가 들어 있다). 예: ~/.cache/mm-stt-eval
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from pathlib import Path

import numpy as np

from stt.backend import SttResult, Word

VERSION = "1"


class CachedStt:
    def __init__(self, inner, cache_dir: Path | None, *, key_extra: str = "", read: bool = True):
        self.inner = inner
        self.name = getattr(inner, "name", type(inner).__name__)
        self.reclip_unmapped = getattr(inner, "reclip_unmapped", False)
        self.cache_dir = Path(cache_dir) if cache_dir is not None else None
        self.key_extra = key_extra
        self.read = read
        self.calls: list[dict] = []
        self._lock = threading.Lock()

    def key(self, samples: np.ndarray, sample_rate: int) -> str:
        h = hashlib.sha256(f"{VERSION}|{self.name}|{self.key_extra}|{sample_rate}|".encode())
        h.update(np.ascontiguousarray(samples, dtype=np.float32).tobytes())
        return h.hexdigest()

    def _path(self, k: str) -> Path | None:
        return None if self.cache_dir is None else self.cache_dir / k[:2] / f"{k}.json"

    def _log(self, **kw) -> None:
        with self._lock:
            self.calls.append(kw)

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> SttResult:
        k = self.key(samples, sample_rate)
        audio_s = len(samples) / sample_rate
        path = self._path(k)
        if path is not None and self.read and path.exists():
            d = json.loads(path.read_text(encoding="utf-8"))
            self._log(hash=k, audio_s=audio_s, dt=d["dt"], cached=True, error=None)
            return SttResult(text=d["text"], words=[Word(**w) for w in d["words"]])
        t0 = time.monotonic()
        try:
            r = self.inner.transcribe(samples, sample_rate)
        except Exception as e:
            self._log(hash=k, audio_s=audio_s, dt=time.monotonic() - t0, cached=False, error=type(e).__name__)
            raise
        dt = time.monotonic() - t0
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
            tmp.write_text(json.dumps({"text": r.text, "dt": dt, "audio_s": audio_s, "backend": self.name,
                                       "words": [{"text": w.text, "start_s": w.start_s, "end_s": w.end_s}
                                                 for w in r.words]}, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, path)
        self._log(hash=k, audio_s=audio_s, dt=dt, cached=False, error=None)
        return r

    def fingerprint(self) -> str:
        with self._lock:
            hs = sorted(c["hash"] for c in self.calls)
        return hashlib.sha256("|".join(hs).encode()).hexdigest()[:16]
