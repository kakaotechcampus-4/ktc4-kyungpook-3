"""테스트가 공통으로 쓰는 준비. Jev 대역(자동 적용), 업로드 화자 분리 대역, 합성 오디오, 기본 구간."""
from __future__ import annotations

import numpy as np
import pytest
import soundfile as sf

import judge.pipeline as pipeline
from jev import NullJev
from upload.diarize import Segment

SR = 16000
STARTED = "2026-10-31T01:00:00+00:00"


@pytest.fixture(autouse=True)
def _no_real_jev(monkeypatch):
    """.env 에 JEV_API_KEY 가 있어도 테스트는 실제 Jev 를 부르지 않는다(비용·비결정성). 근거 검증은 None →
    inferred. 응답이 필요한 테스트는 pipeline.get_jev 를 FakeJev 로 다시 바꿔 끼운다."""
    monkeypatch.setattr(pipeline, "get_jev", lambda: NullJev())


GPU_FAILOVER_ENV = ("MM_GPU_FAILOVER", "GPU_STT_BASE_URL", "GPU_STT_API_KEY", "GPU_STT_CA_BUNDLE", "GPU_SWITCH_URL",
                    "GPU_SWITCH_TOKEN", "MM_OPS_CHANNEL_ID")


@pytest.fixture(autouse=True)
def _no_gpu_failover(monkeypatch):
    """.env 에 GPU 전환이 켜져 있어도 테스트의 워커는 지금처럼 돈다. 실제 스위치·GPU 서버를 부르지 않는다."""
    for name in GPU_FAILOVER_ENV:
        monkeypatch.delenv(name, raising=False)


class FakeDiarizer:
    def __init__(self, segments, *, pending_fetches=0):
        self.segments = segments
        self.calls = []
        self.submits = []
        self.min_speakers = []
        self.fetches = []
        self.pending_fetches = pending_fetches  # fetch 가 None(진행 중)을 돌려주는 횟수

    def diarize(self, path):
        self.calls.append(path)
        return list(self.segments)

    def submit(self, path, *, min_speakers=None):
        self.submits.append(path)
        self.min_speakers.append(min_speakers)
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
