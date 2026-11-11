"""웹 녹음 업로드 파일을 저장한다. 저장소는 `UPLOAD_STORAGE`(local 기본 | s3)로 고른다.

local 은 회의 하나에 폴더 하나(`UPLOAD_DIR/{meeting_id}/`)이고, s3 는 키 `{UPLOAD_S3_PREFIX}{meeting_id}/{파일명}`이다.
어느 쪽이든 녹음을 `audio.<확장자>`에 원본 그대로 둔다. 참석자·파일 정보는 DB(`meeting_upload`)에 둔다.
s3 자격은 boto3 기본 체인(인스턴스 역할 등)에 맡기고 AWS 키 환경변수를 코드에서 읽지 않는다.

업로드 API는 녹음을 다 쓴 뒤에 회의 행과 `meeting_upload`을 커밋한다. 저장 도중 서버가 죽으면 주인 없는
폴더만 남고, 녹음 없는 업로드 회의는 생기지 않는다.
"""
import contextlib
import functools
import logging
import os
import re
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

logger = logging.getLogger(__name__)

# 실행 위치와 상관없이 backend/uploads다(git이 무시한다). 운영 이미지는 UPLOAD_DIR=/data/uploads다
DEFAULT_UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
DEFAULT_MAX_BYTES = 700 * 1024 * 1024  # 아이폰 음성 메모 무손실 3시간(약 675MB)이 들어가는 값. AI 는 3시간까지만 처리한다
CHUNK_BYTES = 1024 * 1024
# 원래 파일명에서 확장자만 가져다 쓴다. 이 모양이 아니면 `bin`으로 저장한다(경로 조작 방지).
_EXTENSION = re.compile(r"[a-z0-9]{1,10}")


def _is_mp3(head: bytes) -> bool:
    # ID3 태그로 시작하거나, 태그 없이 MP3 프레임 동기 비트(11비트 모두 1)로 시작한다
    return head.startswith(b"ID3") or (len(head) >= 2 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)


# 받는 확장자(프론트 uploadPolicy와 같다)와 그 파일이 시작하는 모양. 실제로 재생되는지는 AI가 디코딩할 때 본다.
_SIGNATURES = {
    "wav": lambda head: head[:4] == b"RIFF" and head[8:12] == b"WAVE",
    "mp3": _is_mp3,
    "m4a": lambda head: head[4:8] == b"ftyp",
    "ogg": lambda head: head[:4] == b"OggS",
    "webm": lambda head: head[:4] == b"\x1a\x45\xdf\xa3",
}
SUPPORTED_EXTENSIONS = list(_SIGNATURES)
# 재생 응답의 Content-Type. 확장자를 늘릴 때 _SIGNATURES 와 같이 늘린다(tests 가 키가 같은지 본다).
PLAYBACK_CONTENT_TYPES = {
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "webm": "audio/webm",
}
_HEAD_BYTES = 12
STORAGE_MODES = ("local", "s3")
DEFAULT_S3_PREFIX = "meetings/"
DEFAULT_AWS_REGION = "ap-northeast-2"
DEFAULT_PLAYBACK_URL_TTL_SECONDS = 3600
_S3_DELETE_BATCH = 1000


def upload_dir() -> Path:
    return Path(os.getenv("UPLOAD_DIR") or DEFAULT_UPLOAD_DIR)


def max_bytes() -> int:
    return int(os.getenv("UPLOAD_MAX_BYTES") or DEFAULT_MAX_BYTES)


def meeting_dir(meeting_id: str) -> Path:
    return upload_dir() / meeting_id


def _extension(original_filename: str | None) -> str:
    name = original_filename or ""
    return name.rsplit(".", 1)[1].lower() if "." in name else ""


def audio_filename(original_filename: str | None) -> str:
    """저장할 녹음 파일명. 원래 이름은 확장자만 쓰고 나머지는 버린다."""
    extension = _extension(original_filename)
    return f"audio.{extension if _EXTENSION.fullmatch(extension) else 'bin'}"


def is_supported_audio(original_filename: str | None, fileobj: BinaryIO) -> bool:
    """받는 확장자이고, 파일 첫 부분이 그 형식의 모양인지. 확장자만 바꾼 다른 파일과 빈 파일을 막는다."""
    matches = _SIGNATURES.get(_extension(original_filename))
    if matches is None:
        return False
    position = fileobj.tell()
    fileobj.seek(0)
    head = fileobj.read(_HEAD_BYTES)
    fileobj.seek(position)
    return matches(head)


def file_size(fileobj: BinaryIO) -> int:
    position = fileobj.tell()
    fileobj.seek(0, os.SEEK_END)
    size = fileobj.tell()
    fileobj.seek(position)
    return size


def storage_mode() -> str:
    """`UPLOAD_STORAGE` 값(local 기본 | s3). 다른 값이면 설정 오류라 ValueError."""
    mode = (os.getenv("UPLOAD_STORAGE") or "local").strip().lower()
    if mode not in STORAGE_MODES:
        raise ValueError(f"unknown UPLOAD_STORAGE: {mode}")
    return mode


def _s3_bucket() -> str:
    bucket = (os.getenv("UPLOAD_S3_BUCKET") or "").strip()
    if not bucket:
        raise ValueError("UPLOAD_S3_BUCKET is required when UPLOAD_STORAGE=s3")
    return bucket


def _s3_prefix() -> str:
    prefix = os.getenv("UPLOAD_S3_PREFIX")
    prefix = DEFAULT_S3_PREFIX if prefix is None else prefix.strip()
    # 접두어 뒤에 `/`가 없으면 `recm1/`처럼 붙어 버리므로 붙여 준다
    return prefix if not prefix or prefix.endswith("/") else f"{prefix}/"


def playback_url_ttl_seconds() -> int:
    """presigned URL 유효 시간(초). 값이 양의 정수가 아니면 경고를 남기고 기본값을 쓴다.

    잘못된 값 하나로 s3 재생이 전부 500 이 되지 않게 한다(`meeting_audio.retention()` 과 같은 방식).
    """
    raw = os.getenv("UPLOAD_PLAYBACK_URL_TTL_SECONDS")
    if not raw:
        return DEFAULT_PLAYBACK_URL_TTL_SECONDS
    try:
        seconds = int(raw)
    except ValueError:
        seconds = 0
    if seconds <= 0:
        logger.warning(
            "UPLOAD_PLAYBACK_URL_TTL_SECONDS 는 양의 정수여야 합니다(받은 값=%r). 기본 %d초를 씁니다.",
            raw, DEFAULT_PLAYBACK_URL_TTL_SECONDS,
        )
        return DEFAULT_PLAYBACK_URL_TTL_SECONDS
    return seconds


@functools.lru_cache(maxsize=1)
def _s3_client():
    # 로컬 모드와 테스트가 boto3 import 비용을 내지 않도록 여기서 가져온다. 테스트는 이 함수를 바꿔 끼운다
    import boto3
    from botocore.config import Config

    region = os.getenv("AWS_REGION") or DEFAULT_AWS_REGION
    # 리전 endpoint 와 가상 호스트 방식을 정해 두어야 presigned URL 이 `<bucket>.s3.<region>.amazonaws.com` 이 된다
    # (지정하지 않으면 전역 `<bucket>.s3.amazonaws.com` 이라 배포 안내의 CSP 출처와 어긋난다).
    # S3 가 느릴 때 요청·정리 워커가 오래 붙잡히지 않도록 시간 제한과 재시도를 줄인다
    return boto3.client(
        "s3",
        region_name=region,
        endpoint_url=f"https://s3.{region}.amazonaws.com",
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "virtual"},
            connect_timeout=5,
            read_timeout=30,
            retries={"max_attempts": 2},
        ),
    )


def _s3_meeting_prefix(meeting_id: str) -> str:
    # 빈 값이나 경로 조각이면 prefix 가 다른 회의(전체)를 가리키게 되므로 거른다
    if not meeting_id or meeting_id in {".", ".."} or "/" in meeting_id or "\\" in meeting_id:
        raise ValueError("unsafe meeting storage path")
    return f"{_s3_prefix()}{meeting_id}/"


def _s3_key(meeting_id: str, filename: str) -> str:
    # 파일명만 쓴다. 저장된 값이 이상해도 회의 prefix 밖을 가리키지 않는다
    return f"{_s3_meeting_prefix(meeting_id)}{Path(filename).name}"


def _as_oserror(exc: Exception) -> OSError:
    return exc if isinstance(exc, OSError) else OSError(f"s3 storage error: {exc}")


def _is_missing(exc: Exception) -> bool:
    code = str(getattr(exc, "response", {}).get("Error", {}).get("Code", ""))
    return code in {"404", "NoSuchKey", "NotFound"}


def save_audio(meeting_id: str, fileobj: BinaryIO, filename: str, *, overwrite: bool = False) -> int:
    """녹음을 `filename`으로 저장하고 크기를 돌려준다. 실패하면 OSError 를 올린다.

    `overwrite=False`(처음 저장)이면 실패할 때 회의 폴더(S3 prefix)째 지우고, local 은 이미 있는 폴더를
    다른 회의 것으로 보고 거절한다(FileExistsError).
    `overwrite=True`(같은 회의에 다시 저장)이면 실패해도 이전 녹음을 그대로 둔다. 새 녹음은 완성된 뒤에야 바꿔 끼운다.
    """
    if storage_mode() == "s3":
        return _save_audio_s3(meeting_id, fileobj, filename, overwrite=overwrite)
    target = meeting_dir(meeting_id)
    # 이미 있는 폴더면 다른 회의 것이다. 실패해도 지우지 않도록 try 밖에서 만든다.
    existed = target.exists()
    target.mkdir(parents=True, exist_ok=overwrite)
    # 다시 저장할 때는 임시 파일에 다 쓴 뒤 os.replace 로 바꿔 끼운다. 쓰다 실패해도 이전 녹음은 그대로다
    written = target / (f".{filename}.tmp" if overwrite else filename)
    try:
        fileobj.seek(0)
        with open(written, "wb") as out:
            shutil.copyfileobj(fileobj, out, CHUNK_BYTES)
            out.flush()
            os.fsync(out.fileno())
        size = written.stat().st_size
        if overwrite:
            os.replace(written, target / filename)
        return size
    except BaseException:
        if overwrite:
            written.unlink(missing_ok=True)
            if not existed:
                with contextlib.suppress(OSError):
                    target.rmdir()  # 이번에 만든 빈 폴더만 치운다
        else:
            remove_upload(meeting_id)
        raise


def _save_audio_s3(meeting_id: str, fileobj: BinaryIO, filename: str, *, overwrite: bool) -> int:
    bucket = _s3_bucket()
    key = _s3_key(meeting_id, filename)
    content_type = PLAYBACK_CONTENT_TYPES.get(_extension(filename), "application/octet-stream")
    try:
        fileobj.seek(0)
        size = file_size(fileobj)
        # 같은 키로 올리면 S3 가 업로드가 끝난 뒤에야 바꾼다. 실패하면 이전 객체가 남는다
        _s3_client().upload_fileobj(fileobj, bucket, key, ExtraArgs={"ContentType": content_type})
        return size
    except BaseException as exc:
        if not overwrite:
            remove_upload(meeting_id)
        if isinstance(exc, Exception):
            raise _as_oserror(exc) from exc
        raise


def save_upload(meeting_id: str, fileobj: BinaryIO, original_filename: str | None) -> tuple[str, int]:
    """녹음을 저장하고 (저장 파일명, 크기)를 돌려준다. 실패하면 만든 것을 지우고 예외를 다시 던진다."""
    stored_filename = audio_filename(original_filename)
    return stored_filename, save_audio(meeting_id, fileobj, stored_filename)


def audio_path(meeting_id: str, stored_filename: str) -> Path:
    # 파일명만 쓴다. 저장된 값이 이상해도 회의 폴더 밖을 가리키지 않는다
    return meeting_dir(meeting_id) / Path(stored_filename).name


def local_audio_path(meeting_id: str, filename: str) -> Path | None:
    """local 모드에서 녹음 파일이 있으면 경로, 아니면 None. s3 모드는 항상 None."""
    if storage_mode() != "local":
        return None
    path = audio_path(meeting_id, filename)
    return path if path.is_file() else None


def audio_exists(meeting_id: str, filename: str) -> bool:
    if storage_mode() == "local":
        return local_audio_path(meeting_id, filename) is not None
    # 설정·경로 오류(ValueError)는 S3 오류(OSError)와 구분해 try 밖에서 만든다
    bucket, key = _s3_bucket(), _s3_key(meeting_id, filename)
    try:
        _s3_client().head_object(Bucket=bucket, Key=key)
    except Exception as exc:
        if _is_missing(exc):
            return False
        raise _as_oserror(exc) from exc
    return True


def open_audio_stream(meeting_id: str, filename: str) -> tuple[Iterator[bytes], int]:
    """s3 녹음을 `CHUNK_BYTES` 단위로 읽는 이터레이터와 전체 크기. 없으면 FileNotFoundError. s3 모드에서만 쓴다."""
    bucket, key = _s3_bucket(), _s3_key(meeting_id, filename)
    try:
        response = _s3_client().get_object(Bucket=bucket, Key=key)
    except Exception as exc:
        if _is_missing(exc):
            raise FileNotFoundError(filename) from exc
        raise _as_oserror(exc) from exc
    body = response["Body"]

    def chunks() -> Iterator[bytes]:
        try:
            while chunk := body.read(CHUNK_BYTES):
                yield chunk
        finally:
            body.close()

    return chunks(), int(response["ContentLength"])


def presigned_audio_url(
    meeting_id: str, filename: str, content_type: str, max_expires_in: int | None = None
) -> str:
    """브라우저가 S3 에서 바로 받는 임시 주소. 응답 Content-Type 을 `content_type`으로 고정한다.

    유효 시간은 `UPLOAD_PLAYBACK_URL_TTL_SECONDS` 이고, `max_expires_in`(초)이 더 짧으면 그만큼으로 줄인다
    (보관 기간이 끝난 뒤까지 주소가 열려 있지 않게 하려는 값이며 최소 1초).
    """
    bucket, key = _s3_bucket(), _s3_key(meeting_id, filename)
    expires_in = playback_url_ttl_seconds()
    if max_expires_in is not None:
        expires_in = max(1, min(expires_in, max_expires_in))
    try:
        return _s3_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key, "ResponseContentType": content_type},
            ExpiresIn=expires_in,
        )
    except Exception as exc:
        raise _as_oserror(exc) from exc


def remove_audio(meeting_id: str) -> None:
    """회의 녹음을 지운다. 없으면 멱등 성공이고, 지우지 못했거나 남아 있으면 OSError(안전하지 않은 경로는 ValueError).

    s3 모드는 S3 prefix 와 local 폴더(`UPLOAD_DIR/{meeting_id}`, local 기간에 남은 것)를 모두 지운다.
    """
    if storage_mode() == "s3":
        _remove_audio_s3(meeting_id)
    # s3 모드에서도 local 로 운영하던 기간의 녹음 폴더가 남아 있을 수 있어 함께 지운다(없으면 그냥 넘어간다)
    _remove_audio_local(meeting_id)


def _remove_audio_local(meeting_id: str) -> None:
    root = upload_dir().resolve()
    target = root / meeting_id
    if target.resolve().parent != root or target.is_symlink() or target.is_junction():
        raise ValueError("unsafe meeting storage path")
    try:
        shutil.rmtree(target)
    except FileNotFoundError:
        pass
    if target.exists():
        raise OSError("meeting storage remains")


def _remove_audio_s3(meeting_id: str) -> None:
    bucket = _s3_bucket()
    prefix = _s3_meeting_prefix(meeting_id)
    try:
        client = _s3_client()
        token = None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix}
            if token:
                kwargs["ContinuationToken"] = token
            page = client.list_objects_v2(**kwargs)
            keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
            for start in range(0, len(keys), _S3_DELETE_BATCH):
                client.delete_objects(
                    Bucket=bucket,
                    Delete={"Objects": keys[start : start + _S3_DELETE_BATCH], "Quiet": True},
                )
            if not page.get("IsTruncated"):
                break
            token = page["NextContinuationToken"]
        # 삭제 응답의 부분 실패를 믿지 않고 다시 세어 본다
        if client.list_objects_v2(Bucket=bucket, Prefix=prefix).get("Contents"):
            raise OSError("meeting storage remains")
    except Exception as exc:
        raise _as_oserror(exc) from exc


def remove_upload(meeting_id: str) -> None:
    """회의 녹음 제거를 시도한다. 없으면 멱등 성공, 실패는 로그로 남긴다. 반환은 삭제 완료를 보장하지 않는다.

    live failed 업로드는 sweeper가 다음 바퀴에 재시도한다. 회의·공간 삭제는 각 전용 purge가 맡는다.
    저장 실패·DB 미등록 폴더처럼 소유 행이 없는 경우에는 이 재시도 대상이 없다.
    """
    try:
        remove_audio(meeting_id)
    except (OSError, ValueError):
        logger.warning("업로드 녹음을 지우지 못했습니다: meeting_id=%s", meeting_id, exc_info=True)
