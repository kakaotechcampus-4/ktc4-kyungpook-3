"""capture 테스트가 공통으로 쓰는 준비."""

import pytest


@pytest.fixture(autouse=True)
def default_modes(monkeypatch):
    """기본값으로 돈다. 개발 기기의 .env 에 MM_EXTRACT_PATH=judge 나 MM_DEBUG_REPORT=1 이 있으면 shared.config 가
    그 값을 환경 변수로 올려서, 기본값을 보는 테스트가 깨진다. MM_PIPELINE_MODE 는 처리 기록의 mode 칸에만 남는다.
    다른 값을 보는 테스트는 안에서 setenv 로 다시 정한다."""
    monkeypatch.delenv("MM_PIPELINE_MODE", raising=False)
    monkeypatch.delenv("MM_EXTRACT_PATH", raising=False)
    monkeypatch.delenv("MM_DEBUG_REPORT", raising=False)
