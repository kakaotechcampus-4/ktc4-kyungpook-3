"""Elice ML API 전사.

  POST /v1/audio/transcriptions
  model=openai/whisper-large-v3, language=ko, file=<multipart>
  응답 {"_result":{"status":"ok"},
        "transcript":{"text":..., "chunks":[{"timestamp":[s,e],"text":...}]}}

단가 ₩6 / 60초 (2026-09 기준). 보낸 오디오 길이만큼 과금된다.
최소 과금 단위는 확인하지 못했다. 그래서 호출을 잘게 쪼개지 않는다.
"""

from __future__ import annotations

import os

import numpy as np
import requests

from capture.audio import to_wav_bytes
from stt.backend import SttError, SttResult, Word

BASE = "https://api-cloud-function.elice.io"
STT_MODEL = "openai/whisper-large-v3"
WHISPER_KRW_PER_SEC = 6 / 60


def whisper_krw(audio_seconds: float) -> float:
    return audio_seconds * WHISPER_KRW_PER_SEC


class EliceStt:
    """Whisper large-v3 (API). 최종 전사용."""

    name = "elice/whisper-large-v3"

    def __init__(self, language: str = "ko", timeout: int = 180, word_timestamps: bool = True):
        self.language = language
        self.timeout = timeout
        self.word_timestamps = word_timestamps

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> SttResult:
        key = os.environ.get("ELICE_API_KEY")
        if not key:
            raise SttError("ELICE_API_KEY 환경변수가 없습니다.")

        wav = to_wav_bytes(samples, sample_rate)
        data = {"model": STT_MODEL, "language": self.language}
        if self.word_timestamps:
            data["return_timestamps"] = "word"

        r = requests.post(
            f"{BASE}/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {key}"},
            files={"file": ("seg.wav", wav, "audio/wav")},
            data=data,
            timeout=self.timeout,
        )
        if r.status_code != 200:
            raise SttError(f"STT {r.status_code}: {r.text[:200]}")
        j = r.json()
        if (j.get("_result") or {}).get("status") != "ok" or not j.get("transcript"):
            raise SttError((j.get("_result") or {}).get("reason") or "stt failed")

        t = j["transcript"]
        words = []
        for c in t.get("chunks") or []:
            ts = c.get("timestamp") or [None, None]
            if ts[0] is None or ts[1] is None:
                continue
            words.append(Word(text=(c.get("text") or "").strip(), start_s=ts[0], end_s=ts[1]))
        return SttResult(text=(t.get("text") or "").strip(), words=words)
