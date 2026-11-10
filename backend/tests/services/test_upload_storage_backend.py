"""녹음 저장소 백엔드(local|s3). S3 는 tests/fake_s3.py 의 가짜로 바꿔서 실제 AWS 를 부르지 않는다."""
from io import BytesIO

import pytest

from app.services import upload_storage
from tests.fake_s3 import FakeS3

M4A = b"\x00\x00\x00\x18ftypM4A " + b"x" * 100


@pytest.fixture
def fake(monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr(upload_storage, "_s3_client", lambda: fake)
    return fake


@pytest.fixture
def s3_env(monkeypatch):
    monkeypatch.setenv("UPLOAD_STORAGE", "s3")
    monkeypatch.setenv("UPLOAD_S3_BUCKET", "b")


def test_s3_save_puts_key_and_content_type(fake, s3_env):
    result = upload_storage.save_upload("m1", BytesIO(M4A), "a.m4a")

    assert result == ("audio.m4a", len(M4A))
    stored = fake.objects[("b", "meetings/m1/audio.m4a")]
    assert stored["content_type"] == "audio/mp4"
    assert stored["body"] == M4A


def test_s3_remove_deletes_all_under_prefix(fake, s3_env):
    fake.put("b", "meetings/m1/audio.m4a", b"1")
    fake.put("b", "meetings/m1/extra.bin", b"2")
    fake.put("b", "meetings/m2/audio.m4a", b"3")

    upload_storage.remove_audio("m1")

    assert fake.keys("b") == ["meetings/m2/audio.m4a"]


def test_s3_remove_raises_when_objects_remain(fake, s3_env):
    fake.put("b", "meetings/m1/audio.m4a", b"1")
    fake.fail_next = "delete_objects"

    with pytest.raises(OSError):
        upload_storage.remove_audio("m1")


def test_s3_remove_raises_when_delete_silently_leaves_objects(fake, s3_env, monkeypatch):
    # delete_objects 가 예외 없이 끝나도 다시 list 해서 남아 있으면 실패다
    fake.put("b", "meetings/m1/audio.m4a", b"1")
    monkeypatch.setattr(fake, "delete_objects", lambda Bucket, Delete: {"Errors": [{"Key": "x"}]})

    with pytest.raises(OSError, match="meeting storage remains"):
        upload_storage.remove_audio("m1")


def test_s3_save_error_becomes_oserror(fake, s3_env):
    fake.fail_next = "upload_fileobj"

    with pytest.raises(OSError):
        upload_storage.save_upload("m1", BytesIO(M4A), "a.m4a")

    assert fake.keys("b") == []


def test_s3_save_failure_removes_partial_objects(fake, s3_env):
    # 올리다 실패한 뒤 prefix 에 부분 결과가 남았다고 가정하면 지워야 한다
    fake.put("b", "meetings/m1/audio.m4a", b"partial")
    fake.fail_next = "upload_fileobj"

    with pytest.raises(OSError):
        upload_storage.save_audio("m1", BytesIO(M4A), "audio.m4a")

    assert fake.keys("b") == []


def test_s3_prefix_is_configurable(fake, s3_env, monkeypatch):
    monkeypatch.setenv("UPLOAD_S3_PREFIX", "rec/")

    upload_storage.save_upload("m1", BytesIO(M4A), "a.m4a")

    assert fake.keys("b") == ["rec/m1/audio.m4a"]


def test_s3_audio_exists_uses_head_object(fake, s3_env):
    assert upload_storage.audio_exists("m1", "audio.m4a") is False

    fake.put("b", "meetings/m1/audio.m4a", b"1")

    assert upload_storage.audio_exists("m1", "audio.m4a") is True


def test_s3_open_audio_stream_reads_body_in_chunks(fake, s3_env, monkeypatch):
    monkeypatch.setattr(upload_storage, "CHUNK_BYTES", 4)
    fake.put("b", "meetings/m1/audio.m4a", b"0123456789")

    chunks, size = upload_storage.open_audio_stream("m1", "audio.m4a")

    assert size == 10
    assert list(chunks) == [b"0123", b"4567", b"89"]


def test_s3_open_audio_stream_missing_raises_file_not_found(fake, s3_env):
    with pytest.raises(FileNotFoundError):
        upload_storage.open_audio_stream("m1", "audio.m4a")


def test_presigned_url_has_content_type_and_ttl(fake, s3_env, monkeypatch):
    monkeypatch.setenv("UPLOAD_PLAYBACK_URL_TTL_SECONDS", "120")

    url = upload_storage.presigned_audio_url("m1", "audio.m4a", "audio/mp4")

    assert url.startswith("https://fake-s3.example/")
    [call] = fake.presign_calls
    assert call["ClientMethod"] == "get_object"
    assert call["Params"] == {
        "Bucket": "b",
        "Key": "meetings/m1/audio.m4a",
        "ResponseContentType": "audio/mp4",
    }
    assert call["ExpiresIn"] == 120


def test_presigned_url_default_ttl_is_one_hour(fake, s3_env):
    upload_storage.presigned_audio_url("m1", "audio.m4a", "audio/mp4")

    assert fake.presign_calls[0]["ExpiresIn"] == 3600


def test_local_mode_unchanged():
    assert upload_storage.storage_mode() == "local"

    stored, size = upload_storage.save_upload("m1", BytesIO(M4A), "a.m4a")

    path = upload_storage.local_audio_path("m1", stored)
    assert path == upload_storage.upload_dir() / "m1" / "audio.m4a"
    assert size == len(M4A)
    assert upload_storage.audio_exists("m1", stored) is True

    upload_storage.remove_audio("m1")

    assert not (upload_storage.upload_dir() / "m1").exists()
    assert upload_storage.local_audio_path("m1", stored) is None
    assert upload_storage.audio_exists("m1", stored) is False


def test_local_save_refuses_existing_folder_unless_overwrite():
    upload_storage.save_upload("m1", BytesIO(M4A), "a.m4a")

    with pytest.raises(FileExistsError):
        upload_storage.save_upload("m1", BytesIO(M4A), "a.m4a")
    # 실패해도 다른 회의의 기존 폴더는 지우지 않는다
    assert upload_storage.local_audio_path("m1", "audio.m4a") is not None

    size = upload_storage.save_audio("m1", BytesIO(M4A + b"y"), "audio.m4a", overwrite=True)

    assert size == len(M4A) + 1


def test_local_remove_rejects_unsafe_meeting_id():
    with pytest.raises(ValueError):
        upload_storage.remove_audio("../outside")


def test_s3_mode_has_no_local_path(fake, s3_env):
    fake.put("b", "meetings/m1/audio.m4a", b"1")

    assert upload_storage.local_audio_path("m1", "audio.m4a") is None


def test_remove_upload_is_lenient(fake, s3_env):
    fake.put("b", "meetings/m1/audio.m4a", b"1")
    fake.fail_next = "delete_objects"

    upload_storage.remove_upload("m1")  # 예외 없이 로그만 남긴다


def test_unknown_storage_mode_rejected(monkeypatch):
    monkeypatch.setenv("UPLOAD_STORAGE", "gcs")

    with pytest.raises(ValueError):
        upload_storage.storage_mode()


def test_s3_without_bucket_is_rejected(fake, monkeypatch):
    monkeypatch.setenv("UPLOAD_STORAGE", "s3")
    monkeypatch.delenv("UPLOAD_S3_BUCKET", raising=False)

    with pytest.raises(ValueError):
        upload_storage.audio_exists("m1", "audio.m4a")


def test_meeting_deletion_delegates_to_remove_audio(fake, s3_env):
    from app.services import meeting_deletion

    fake.put("b", "meetings/m1/audio.m4a", b"1")

    meeting_deletion.remove_backend_files("m1")

    assert fake.keys("b") == []


class _FailingFile(BytesIO):
    """앞부분만 읽히고 그 뒤 읽기가 실패하는 파일. 복사 도중 실패를 흉내 낸다."""

    def __init__(self, data: bytes):
        super().__init__(data)
        self.reads = 0

    def read(self, size=-1):
        self.reads += 1
        if self.reads > 1:
            raise OSError("disk error")
        return super().read(8)


def test_local_overwrite_failure_keeps_existing_audio():
    upload_storage.save_audio("m1", BytesIO(M4A), "audio.m4a")

    with pytest.raises(OSError):
        upload_storage.save_audio("m1", _FailingFile(M4A + b"new"), "audio.m4a", overwrite=True)

    assert (upload_storage.meeting_dir("m1") / "audio.m4a").read_bytes() == M4A
    assert [p.name for p in upload_storage.meeting_dir("m1").iterdir()] == ["audio.m4a"]


def test_local_overwrite_failure_on_new_meeting_leaves_nothing():
    with pytest.raises(OSError):
        upload_storage.save_audio("m1", _FailingFile(M4A), "audio.m4a", overwrite=True)

    assert not upload_storage.meeting_dir("m1").exists()


def test_s3_overwrite_failure_keeps_existing_audio(fake, s3_env):
    upload_storage.save_audio("m1", BytesIO(M4A), "audio.m4a")
    fake.fail_next = "upload_fileobj"

    with pytest.raises(OSError):
        upload_storage.save_audio("m1", BytesIO(M4A + b"new"), "audio.m4a", overwrite=True)

    assert fake.objects[("b", "meetings/m1/audio.m4a")]["body"] == M4A


def _local_leftover(meeting_id: str) -> None:
    """local 운영 기간에 디스크에 남은 녹음 폴더."""
    folder = upload_storage.meeting_dir(meeting_id)
    folder.mkdir(parents=True)
    (folder / "audio.wav").write_bytes(b"RIFF")


def test_s3_remove_also_deletes_local_leftover_folder(fake, s3_env):
    """local 로 운영하다 s3 로 바꾼 뒤에도, local 기간 녹음 폴더가 S3 객체와 함께 지워진다."""
    _local_leftover("m1")
    fake.put("b", "meetings/m1/audio.m4a", b"1")

    upload_storage.remove_audio("m1")

    assert fake.keys("b") == []
    assert not upload_storage.meeting_dir("m1").exists()


def test_s3_remove_deletes_local_leftover_without_s3_object(fake, s3_env):
    _local_leftover("m1")

    upload_storage.remove_audio("m1")

    assert not upload_storage.meeting_dir("m1").exists()


def test_s3_remove_raises_when_local_leftover_cannot_be_deleted(fake, s3_env, monkeypatch):
    _local_leftover("m1")
    fake.put("b", "meetings/m1/audio.m4a", b"1")

    def locked(path):
        raise PermissionError("temporary file lock")

    monkeypatch.setattr(upload_storage.shutil, "rmtree", locked)

    with pytest.raises(OSError):
        upload_storage.remove_audio("m1")
    assert upload_storage.meeting_dir("m1").exists()


@pytest.fixture
def real_s3_client(tmp_path, monkeypatch):
    """실제 boto3 클라이언트. 더미 자격을 환경변수로 주고 사용자 AWS 설정 파일은 읽지 않는다(네트워크 호출 없음)."""
    for name in ("AWS_PROFILE", "AWS_SESSION_TOKEN", "AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3", "AWS_DEFAULT_REGION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "dummy-secret")
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "no-aws-config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "no-aws-credentials"))
    monkeypatch.setenv("AWS_REGION", "ap-northeast-2")
    upload_storage._s3_client.cache_clear()
    yield upload_storage._s3_client()
    upload_storage._s3_client.cache_clear()


def test_presigned_url_uses_regional_virtual_host(real_s3_client, s3_env, monkeypatch):
    """presigned URL 의 host 는 버킷의 서울 리전 가상 호스트다(배포 안내의 CSP media-src 출처와 같다)."""
    from urllib.parse import urlsplit

    monkeypatch.setenv("UPLOAD_S3_BUCKET", "mm-audio")

    url = upload_storage.presigned_audio_url("m1", "audio.m4a", "audio/mp4")

    parts = urlsplit(url)
    assert parts.scheme == "https"
    assert parts.netloc == "mm-audio.s3.ap-northeast-2.amazonaws.com"
    assert parts.path == "/meetings/m1/audio.m4a"
    assert "X-Amz-Algorithm=AWS4-HMAC-SHA256" in parts.query


def test_s3_client_has_short_timeouts_and_few_retries(real_s3_client):
    config = real_s3_client.meta.config

    assert config.connect_timeout == 5
    assert config.read_timeout == 30
    # botocore 는 max_attempts(재시도 횟수)=2 를 첫 시도 포함 total_max_attempts=3 으로 바꿔 둔다
    assert config.retries["total_max_attempts"] == 3
