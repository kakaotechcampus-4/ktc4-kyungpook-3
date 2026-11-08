import pytest


@pytest.fixture(autouse=True)
def _upload_dir(tmp_path, monkeypatch):
    """녹음 업로드를 테스트마다 임시 폴더에 저장한다. 저장소의 backend/uploads에 파일을 남기지 않는다."""
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))


@pytest.fixture(autouse=True)
def _reset_login_limit():
    """로그인 제한기는 프로세스 메모리에 있으므로 테스트마다 비운다."""
    from app.services import login_limit

    login_limit.reset()
    yield
    login_limit.reset()
