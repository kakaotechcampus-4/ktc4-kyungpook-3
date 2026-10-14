import pytest


@pytest.fixture(autouse=True)
def _upload_dir(tmp_path, monkeypatch):
    """녹음 업로드를 테스트마다 임시 폴더에 저장한다. 저장소의 backend/uploads에 파일을 남기지 않는다."""
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
