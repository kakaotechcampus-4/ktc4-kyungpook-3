"""capture 테스트가 공통으로 쓰는 준비."""

import pytest


@pytest.fixture(autouse=True)
def default_modes(monkeypatch):
    """봇 모드와 옛 추출 경로, 곧 기본값으로 돈다. 개발 기기의 .env 에 MM_PIPELINE_MODE=worker 나
    MM_EXTRACT_PATH=judge 가 있으면 shared.config 가 그 값을 환경 변수로 올려서, 기본값을 보는 테스트가 깨진다.
    다른 값을 보는 테스트는 안에서 setenv 로 다시 정한다.

    진행 표시(MM_PROGRESS)만 기본과 달리 끈다. 결과 메시지의 순서를 보는 테스트에 진행 메시지가 섞이지 않게
    하려는 것이고, 진행 표시를 보는 테스트가 안에서 다시 켠다."""
    monkeypatch.delenv("MM_PIPELINE_MODE", raising=False)
    monkeypatch.delenv("MM_EXTRACT_PATH", raising=False)
    monkeypatch.setenv("MM_PROGRESS", "off")
