"""웹 녹음 업로드 파일을 디스크에 저장한다.

회의 하나에 폴더 하나(`UPLOAD_DIR/{meeting_id}/`)이고, 녹음을 `audio.<확장자>`에 원본 그대로 둔다.
참석자·파일 정보는 DB(`meeting_upload`)에 둔다.

업로드 API는 녹음을 다 쓴 뒤에 회의 행과 `meeting_upload`을 커밋한다. 저장 도중 서버가 죽으면 주인 없는
폴더만 남고, 녹음 없는 업로드 회의는 생기지 않는다.
"""
import logging
import os
import re
import shutil
from pathlib import Path
from typing import BinaryIO

logger = logging.getLogger(__name__)

# 실행 위치와 상관없이 backend/uploads다(git이 무시한다). 운영 이미지는 UPLOAD_DIR=/data/uploads다
DEFAULT_UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
DEFAULT_MAX_BYTES = 100 * 1024 * 1024
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
_HEAD_BYTES = 12


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


def save_upload(meeting_id: str, fileobj: BinaryIO, original_filename: str | None) -> tuple[str, int]:
    """녹음을 저장하고 (저장 파일명, 크기)를 돌려준다. 실패하면 만든 폴더를 지우고 예외를 다시 던진다."""
    target = meeting_dir(meeting_id)
    # 이미 있는 폴더면 다른 회의 것이다. 실패해도 지우지 않도록 try 밖에서 만든다.
    target.mkdir(parents=True, exist_ok=False)
    try:
        stored_filename = audio_filename(original_filename)
        fileobj.seek(0)
        with open(target / stored_filename, "wb") as out:
            shutil.copyfileobj(fileobj, out, CHUNK_BYTES)
            out.flush()
            os.fsync(out.fileno())
        return stored_filename, (target / stored_filename).stat().st_size
    except BaseException:
        remove_upload(meeting_id)
        raise


def audio_path(meeting_id: str, stored_filename: str) -> Path:
    # 파일명만 쓴다. 저장된 값이 이상해도 회의 폴더 밖을 가리키지 않는다
    return meeting_dir(meeting_id) / Path(stored_filename).name


def remove_upload(meeting_id: str) -> None:
    """회의 폴더를 지운다. 없으면 그냥 넘어가고, 못 지우면 로그만 남긴다. 남은 폴더는 지금은 직접 지워야 한다."""
    try:
        shutil.rmtree(meeting_dir(meeting_id))
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("업로드 폴더를 지우지 못했습니다: meeting_id=%s", meeting_id, exc_info=True)
