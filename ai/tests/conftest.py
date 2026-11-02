"""테스트가 공통으로 쓰는 업로드 준비. 화자 분리 대역, 합성 오디오, 기본 구간."""
from __future__ import annotations

import numpy as np
import soundfile as sf

from upload.diarize import Segment

SR = 16000
STARTED = "2026-10-31T01:00:00+00:00"


class FakeDiarizer:
    def __init__(self, segments, *, pending_fetches=0):
        self.segments = segments
        self.calls = []
        self.submits = []
        self.fetches = []
        self.pending_fetches = pending_fetches  # fetch 가 None(진행 중)을 돌려주는 횟수

    def diarize(self, path):
        self.calls.append(path)
        return list(self.segments)

    def submit(self, path):
        self.submits.append(path)
        return f"job-{len(self.submits)}"

    def fetch(self, job_id):
        self.fetches.append(job_id)
        if self.pending_fetches > 0:
            self.pending_fetches -= 1
            return None
        return list(self.segments)


def _audio(tmp_path, secs=12):
    t = np.arange(secs * SR) / SR
    p = tmp_path / "in.wav"
    sf.write(str(p), (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), SR, subtype="PCM_16")
    return p


SEGS = [Segment(1, 3, "SPEAKER_00"), Segment(6, 9, "SPEAKER_01")]
