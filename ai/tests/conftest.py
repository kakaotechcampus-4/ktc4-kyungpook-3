import pytest

import judge.pipeline as pipeline
from jev import NullJev


@pytest.fixture(autouse=True)
def _no_real_jev(monkeypatch):
    """.env 에 JEV_API_KEY 가 있어도 테스트는 실제 Jev 를 부르지 않는다(비용·비결정성). 근거 검증은 None →
    inferred. 응답이 필요한 테스트는 pipeline.get_jev 를 FakeJev 로 다시 바꿔 끼운다."""
    monkeypatch.setattr(pipeline, "get_jev", lambda: NullJev())
