"""녹음 세션의 플랫폼 비종속 부분. 매니페스트 상태, 저장 뒤 전사·추출·BE 인계, 남은 회의 회수.

discord 이름은 여기 없다. capture/discord_adapter.py 가 이 함수들을 부르고, 봇이 죽은 뒤에도
같은 함수로 남은 회의를 마저 처리할 수 있다.

매니페스트 recordings/session_<회의ID>.json. 회의 ID 는 <guild>_<ts> 다 (서버 둘이 같은 초에 시작해도 다르다).
필드는 recording_store.write_manifest 와 같고 아래를 더한다.
  status        recording | saved | transcribed | partial | extracted | handed_off | failed
  stages        단계별 완료 시각 {"transcribed": iso, "extracted": iso, "handed_off": iso}
  failed_units  partial 일 때 실패한 줄 [{"speaker", "start_ms", "end_ms", "error"}]. 다음 실행이 이 구간만 다시 보낸다
  failed_stage  failed 일 때 어느 단계인지. stt | extract | handoff
  error         failed 일 때 예외 한 줄
  started_at    녹음 시작 벽시계(UTC ISO). 트랙 안의 위치는 이 시각부터 흐른 monotonic 시간이다
  timezone      회의가 열린 시간대. "내일" 같은 상대 날짜의 기준일은 이 시간대의 시작 날짜다
  guild_id, voice_channel_id, text_channel_id, workspace_id   어느 서버의 어느 방 회의인지. 복구 범위와 게시 채널
  transcript    전사가 끝나면 회의록 경로
  tasks         할일 추출까지 됐으면 그 결과 파일 경로
  be            BE 인계 상태 {"meeting_id", "status", "extraction_id", ...}. capture/handoff.py 가 쓴다
  claimed_by, claimed_at   누가 언제부터 이 회의를 처리 중인지 보여 주는 표시. 누가 처리할지는 회의 잠금
                (session_<회의ID>.lock 의 OS 파일 잠금)만 정한다. 놓으면 지운다
  recovery      단계를 닫지 못한 실행의 횟수와 다음 시도 {"attempts", "next_at"}, 또는 포기
                {"attempts", "gave_up_at", "failed_stage"}. partial 재전사 횟수(retry_runs)와 따로 센다

process_session 이 마지막으로 끝난 단계 다음부터 실행한다. /stop 뒤 처리, 봇 안의 복구 루프, /recover 가
같은 함수를 쓰므로 어디서 죽어도 같은 경로로 이어진다. 전사에서 실패한 줄이 있으면 완료로 닫지 않고
partial 로 두며, 다음 실행이 그 줄만 다시 보낸다. 할일 추출(extract/, #30)과 BE 인계는 설정이
없으면 그 단계에서 멈추고 매니페스트는 그 앞 상태로 남는다.

복구 한 바퀴(recover_pass)는 recovery_targets 로 대상을 고르고 recover_one 으로 회의 하나씩 회의 잠금을 잡고
돌린다. 봇과 워커(capture/worker.py)가 같은 함수를 쓴다.
실패는 recovery.attempts 로 세어 다음 시도를 미루고(두 배씩), RECOVERY_MAX_ATTEMPTS 에 닿으면 포기하며
그때 처음 BE 에 fail 을 보낸다. 기본값과 근거는 decision_log/0013.
"""

from __future__ import annotations

import asyncio
import fcntl
import functools
import json
import os
import socket
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import soundfile as sf

from shared.config import TRANSCRIPTS_DIR, settings
from shared.config import today as config_today
from shared.schemas import now_iso

STATUS_RECORDING = "recording"
STATUS_SAVED = "saved"
STATUS_TRANSCRIBED = "transcribed"
STATUS_PARTIAL = "partial"        # 전사는 돌았는데 실패한 줄이 남았다. failed_units 에 구간이 있다
STATUS_EXTRACTED = "extracted"
STATUS_HANDED_OFF = "handed_off"
STATUS_FAILED = "failed"

STAGES = (STATUS_TRANSCRIBED, STATUS_EXTRACTED, STATUS_HANDED_OFF)
# partial 회의를 추출·인계로 넘기기 전에 실패 구간을 다시 보내는 횟수. 상한에 닿으면 빠진 구간을 둔 채 간다
PARTIAL_RETRY_MAX = int(os.environ.get("MM_PARTIAL_RETRY_MAX", "3"))
# 매니페스트와 BE 의 failed_stage 에 적는 이름
FAILED_STAGE = {STATUS_TRANSCRIBED: "stt", STATUS_EXTRACTED: "extract", STATUS_HANDED_OFF: "handoff"}
# 자동 복구. #83 의 retry_runs·PARTIAL_RETRY_MAX 와 따로 센다. 기본값의 근거는 decision_log/0013
RECOVERY_INTERVAL_S = float(os.environ.get("MM_RECOVERY_INTERVAL_S", "60"))    # 봇 안 복구 루프의 주기. 0 이면 끈다
RECOVERY_MAX_ATTEMPTS = int(os.environ.get("MM_RECOVERY_MAX_ATTEMPTS", "5"))   # 이만큼 실패하면 포기하고 BE 에 fail
RECOVERY_BACKOFF_S = float(os.environ.get("MM_RECOVERY_BACKOFF_S", "60"))      # 첫 실패 뒤 기다림. 실패마다 두 배
RECOVERY_BACKOFF_CEIL_S = 3600.0                                                # 두 배로 늘려도 한 시간에서 멈춘다
# 끊긴 녹음의 마지막 트랙 쓰기가 이보다 오래됐으면 회의가 끝났다고 보고 재시작 안내를 하지 않는다. 잠정값이다
RESUME_NOTICE_WINDOW_S = 3600.0


def utcnow() -> datetime:
    """다음 시도 시각과 처리 중인 시간을 재는 시계. 테스트가 바꿔 끼운다."""
    return datetime.now(timezone.utc)


class NullSession:
    """StreamingSink 가 요구하는 session 자리. 회의 중 전사가 없으니 받은 조각을 버린다."""

    def feed(self, *args, **kwargs) -> None:
        return None


def manifest_path(recordings_dir: Path, session) -> Path:
    return recordings_dir / f"session_{session}.json"


def save_manifest(path: Path, manifest: dict) -> None:
    """임시 파일에 쓴 뒤 바꿔 끼운다. 쓰는 도중 죽어도 반쯤 쓰인 JSON 이 남지 않는다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _load(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def _parse_time(raw: str) -> datetime:
    dt = datetime.fromisoformat(raw)
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


class MeetingLock:
    """회의 하나의 OS 파일 잠금(flock). 쥔 프로세스가 죽으면 OS 가 푼다.

    잠금 파일은 지우지 않는다. 지우면 다른 쪽이 새로 만든 파일에 잠금을 잡아 둘이 동시에 쥘 수 있다.
    flock 은 한 기계의 로컬 파일시스템에서만 서로를 막는다(NFS, EFS, S3 에 두면 소용없다).
    """

    def __init__(self, fd: int) -> None:
        self._fd: int | None = fd

    def release(self) -> None:
        if self._fd is None:
            return
        try:
            fcntl.flock(self._fd, fcntl.LOCK_UN)
        finally:
            os.close(self._fd)
            self._fd = None


def try_lock(manifest: Path) -> MeetingLock | None:
    """회의 잠금을 기다리지 않고 잡는다. 남이 쥐고 있으면 None. manifest 는 session_<회의ID>.json 의 경로다.

    같은 프로세스라도 따로 연 파일끼리는 부딪힌다. 그래서 봇의 루프와 /recover 도 이것으로 서로를 막는다.
    """
    lock = manifest.with_suffix(".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        return None
    return MeetingLock(fd)


def is_locked(manifest: Path) -> bool:
    """누가 이 회의 잠금을 쥐고 있나. 잡아 보고 바로 놓는다. 쥔 쪽의 잠금은 그대로다(flock 은 여는 것마다 따로다)."""
    lock = try_lock(manifest)
    if lock is None:
        return True
    lock.release()
    return False


def write_status(recordings_dir: Path, session, *, status: str, entries: list[dict],
                 guild: str | None, channel: str | None, library_version: str | None,
                 started_at: str | None, meeting_dir: str, transcript: str | None = None,
                 extra: dict | None = None) -> tuple[Path, dict]:
    """매니페스트를 통째로 다시 쓴다. 녹음 시작과 저장 완료 때 부른다. 그 뒤 단계는 process_session 이 쓴다.

    앞의 다섯 필드는 recording_store.write_manifest 와 같은 계약이다.
    """
    manifest = {
        "session": str(session),
        "guild": guild,
        "channel": channel,
        "recorded_at": now_iso(),
        "library_version": library_version,
        "speakers": entries,
        "status": status,
        "started_at": started_at,
        "meeting_dir": meeting_dir,
    }
    if transcript is not None:
        manifest["transcript"] = transcript
    if extra:
        manifest.update(extra)
    path = manifest_path(recordings_dir, session)
    save_manifest(path, manifest)
    return path, manifest


@functools.lru_cache(maxsize=None)
def _backend(kind: str, model: str):
    from stt import batch as B
    return B.make_backend(kind, model, "chunk")


def backend_from_env() -> tuple[object, str, int]:
    """(백엔드, 모델 이름, 워커 수). MM_STT_BACKEND=local|elice, MM_STT_MODEL 로 고른다.

    같은 설정이면 같은 객체다. 로컬 모델을 세션마다 다시 올리지 않는다.
    """
    from stt import batch as B
    kind = os.environ.get("MM_STT_BACKEND", "local")
    model = os.environ.get("MM_STT_MODEL", "large-v3-turbo")
    return _backend(kind, model), ("elice" if kind == "elice" else model), B.default_workers(kind)


def meeting_date(manifest: dict) -> date:
    """상대 날짜의 기준일. 회의 시작 시각을 회의 시간대의 날짜로 바꾼다.

    처리하는 날이 아니라 회의한 날이다. 9/16 회의를 9/17 에 복구해도 "내일" 은 9/17 이다.
    """
    tz = ZoneInfo(manifest.get("timezone") or settings().meeting_timezone)
    raw = manifest.get("started_at") or manifest.get("recorded_at")
    if not raw:
        return config_today()
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).date()


def meeting_title(manifest: dict) -> str:
    return f"{manifest.get('channel') or '회의'} {meeting_date(manifest).isoformat()}"


def failed_units(lines) -> list[dict]:
    """전사가 끝내 실패한 줄. 화자와 구간과 이유. 이 구간만 다시 보낼 수 있다."""
    return [{"speaker": ln.speaker_id, "start_ms": ln.start_ms, "end_ms": ln.end_ms, "error": ln.error}
            for ln in lines if ln.final and ln.error]


def _wavs_and_names(recordings_dir: Path, manifest: dict) -> tuple[list[Path], dict[str, str]]:
    wavs = [recordings_dir / e["file"] for e in manifest["speakers"]]
    names = {str(e["user_id"]): e["display_name"] for e in manifest["speakers"]}
    return wavs, names


def transcribe_session(recordings_dir: Path, manifest: dict, *, backend, model_name: str, workers: int,
                       gate=None, transcripts_dir: Path | None = None) -> dict:
    """매니페스트의 트랙을 chunk 모드로 전사해 회의록까지 쓴다. 스레드에서 부른다.

    산출물은 셋이다. transcripts/ 의 파일당 json 과 session_<회의ID>.transcript.json (BE 계약),
    session_<회의ID>.lines.json (실패한 줄까지 든 줄 목록. 재전사용), 회의 디렉토리의
    transcript.md / transcript.jsonl (사람이 읽는 대본).
    """
    from stt.transcribe import run_session
    from stt.transcript_writer import write_transcript

    wavs, names = _wavs_and_names(recordings_dir, manifest)
    run = run_session(wavs, names, backend, mode="chunk", model_name=model_name, gate=gate, workers=workers,
                      out_dir=transcripts_dir or TRANSCRIPTS_DIR, session_id=str(manifest["session"]))
    meeting_dir = recordings_dir / manifest["meeting_dir"]
    md = write_transcript(run["lines"], meeting_dir, manifest["meeting_dir"])
    return {"markdown": md["markdown"], "jsonl": md["jsonl"], "failed": md["failed"],
            "transcript_json": run["transcript_json"], "summary": run["summary"], "lines": run["lines"],
            "failed_units": failed_units(run["lines"])}


def retry_failed(recordings_dir: Path, manifest: dict, *, backend, model_name: str,
                 transcripts_dir: Path | None = None) -> dict:
    """failed_units 의 구간만 화자 wav 에서 잘라 다시 보내고 회의록과 계약 파일을 다시 쓴다."""
    from stt.transcribe import retry_failed_lines
    from stt.transcript_writer import write_transcript

    wavs, names = _wavs_and_names(recordings_dir, manifest)
    out = retry_failed_lines(wavs, names, backend, model_name=model_name, mode="chunk",
                             out_dir=transcripts_dir or TRANSCRIPTS_DIR, session=str(manifest["session"]))
    md = write_transcript(out["lines"], recordings_dir / manifest["meeting_dir"], manifest["meeting_dir"])
    return {"markdown": md["markdown"], "jsonl": md["jsonl"], "failed": out["still_failed"],
            "retried": out["retried"], "transcript_json": out["transcript_json"], "lines": out["lines"],
            "failed_units": failed_units(out["lines"])}


def discover_tracks(recordings_dir: Path, manifest: dict, name_of=None) -> list[dict]:
    """녹음 중에 죽어 speakers 가 비어 있는 회의. 회의 디렉토리의 <uid>_<ts>.wav 를 다시 찾는다.

    쓰다 만 wav 는 헤더의 길이 필드가 0 이지만 soundfile 은 파일 끝까지 읽는다 (테스트로 확인).
    읽을 수 없거나 비어 있는 파일은 뺀다. name_of(uid) 가 있으면 표시 이름을 채우고 없으면 uid 다.
    """
    mdir = recordings_dir / manifest.get("meeting_dir", "")
    entries: list[dict] = []
    if not manifest.get("meeting_dir") or not mdir.is_dir():
        return entries
    for p in sorted(mdir.glob("*.wav")):
        uid, _, _ts = p.stem.partition("_")
        try:
            info = sf.info(str(p))
            dur = info.frames / info.samplerate if info.samplerate else 0.0
        except Exception:  # noqa: BLE001 - 깨진 파일은 복구 대상이 아니다
            continue
        if dur <= 0:
            continue
        name = (name_of(uid) if name_of is not None else None) or uid
        entries.append({"user_id": uid, "display_name": name, "file": f"{mdir.name}/{p.name}",
                        "duration_sec": round(dur, 2)})
    return entries


def pending_sessions(recordings_dir: Path, *, guild_id=None, exclude=None) -> list[Path]:
    """끝까지 가지 않은 매니페스트. 봇이 죽었거나 어느 단계가 실패했거나 설정이 없어 멈춘 회의가 여기 남는다.

    guild_id 를 주면 그 서버의 회의만. exclude 는 봇이 지금 들고 있는 회의 ID(녹음 중·후처리 중)라 건너뛴다.
    녹음 중에 죽어 speakers 가 빈 회의는 디렉토리에 트랙이 있으면 든다. 빠진 구간을 둔 채 인계까지 간
    partial 회의는 재시도 상한을 올리면 다시 든다.
    """
    return [p for p, _ in _pending(recordings_dir, guild_id=guild_id, exclude=exclude)]


def _queue_key(path: Path) -> tuple[int, str]:
    """처리 순서. 회의 ID 끝의 시작 초(<guild>_<ts>) 순이고 같으면 파일 이름 순이다. 먼저 시작한 회의가 먼저다."""
    tail = path.stem.rsplit("_", 1)[-1]
    return (int(tail) if tail.isdigit() else 2**63, path.name)


def _pending(recordings_dir: Path, *, guild_id=None, exclude=None):
    skip = set(exclude or ())
    for p in sorted(recordings_dir.glob("session_*.json"), key=_queue_key):
        m = _load(p)
        if m is None or m.get("session") in skip:
            continue
        if guild_id is not None and str(m.get("guild_id")) != str(guild_id):
            continue
        if _is_pending(recordings_dir, m):
            yield p, m


def _is_pending(recordings_dir: Path, m: dict) -> bool:
    """끝까지 가지 않았고 돌릴 트랙이 있는 회의인가. 목록(pending_sessions)과 잡은 뒤의 재확인(recover_one)이 같이 쓴다."""
    if m.get("status") == STATUS_HANDED_OFF:
        if not (m.get("partial") and m.get("retry_runs", 0) < PARTIAL_RETRY_MAX):
            return False
    if m.get("speakers"):
        return all((recordings_dir / e["file"]).exists() for e in m["speakers"])
    return m.get("status") == STATUS_RECORDING and bool(discover_tracks(recordings_dir, m))


class Claims:
    """복구가 회의를 잡는다. 누가 처리할지는 회의 잠금(try_lock)만 정한다.

    잡으면 매니페스트에 claimed_by·claimed_at 을 적는다. /recover 가 누가 몇 분째 처리 중인지 보여 주는 데만 쓰고
    누가 처리할지 정하는 데는 쓰지 않는다. 죽은 프로세스가 남긴 표시는 잠금이 풀려 있으니 무시된다.
    같은 프로세스의 루프와 /recover 도, 봇과 워커도 이 잠금으로 서로를 막는다.
    """

    def __init__(self, owner: str | None = None) -> None:
        self.owner = owner or f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
        self._locks: dict[str, MeetingLock] = {}

    def holder(self, path: Path, manifest: dict) -> dict | None:
        """이 회의를 지금 누가 처리 중인가 {claimed_by, claimed_at, since_s, mine}. 잠금이 풀려 있으면 None."""
        mine = str(manifest.get("session")) in self._locks
        if not mine and not is_locked(path):
            return None
        at = manifest.get("claimed_at")
        since = max(0, int((utcnow() - _parse_time(at)).total_seconds())) if at else None
        return {"claimed_by": manifest.get("claimed_by"), "claimed_at": at, "since_s": since, "mine": mine}

    def acquire(self, path: Path) -> dict | None:
        """잡는다. 잡았으면 방금 읽은 매니페스트(표시가 적힌 것), 남이 쥐고 있거나 읽을 수 없으면 None.

        잠금을 먼저 잡고 매니페스트를 읽는다. process_session 은 이 dict 를 통째로 저장하므로 표시가 같이 남는다.
        다 쓰면 release 로 놓는다.
        """
        lock = try_lock(path)
        if lock is None:
            return None
        m = _load(path)
        if m is None:
            lock.release()
            return None
        m["claimed_by"] = self.owner
        m["claimed_at"] = _iso(utcnow())
        save_manifest(path, m)
        self._locks[str(m.get("session"))] = lock
        return m

    def release(self, path: Path, manifest: dict) -> None:
        """놓는다. manifest 는 acquire 가 준 dict 다. 마지막 상태에서 표시만 지우고 저장한 뒤 잠금을 푼다."""
        lock = self._locks.pop(str(manifest.get("session")), None)
        try:
            if manifest.get("claimed_by") == self.owner:
                manifest.pop("claimed_by", None)
                manifest.pop("claimed_at", None)
                save_manifest(path, manifest)
        finally:
            if lock is not None:
                lock.release()


def backoff_s(attempts: int) -> float:
    """attempts 번째 실패 뒤 다음 시도까지 기다리는 초. RECOVERY_BACKOFF_S 에서 두 배씩 늘고 한 시간에서 멈춘다."""
    return min(RECOVERY_BACKOFF_S * 2 ** max(0, attempts - 1), RECOVERY_BACKOFF_CEIL_S)


def _count_failure(manifest: dict, handoff, failed_stage: str) -> dict:
    """이번 실행이 단계를 닫지 못했다(failed 또는 partial). 실패 횟수를 올리고 다음 시도 시각을 적는다.

    RECOVERY_MAX_ATTEMPTS 에 닿으면 포기한다. 루프는 더 돌리지 않고, 이때 처음으로 BE 에 fail 을 보낸다.
    사람이 /recover 로 포기한 회의를 다시 돌렸다 또 실패하면 곧바로 다시 포기한다(그 사이 BE 에 새 회의가
    생겼으면 그것도 failed 로 닫힌다).
    """
    state = manifest.setdefault("recovery", {})
    state["attempts"] = state.get("attempts", 0) + 1
    now = utcnow()
    if state["attempts"] >= RECOVERY_MAX_ATTEMPTS:
        state.pop("next_at", None)
        state["gave_up_at"] = _iso(now)
        state["failed_stage"] = failed_stage
        if handoff is not None:
            handoff.fail(manifest, failed_stage)
    else:
        state.pop("gave_up_at", None)                  # 상한을 올렸으면 포기를 거두고 다시 돈다
        state.pop("failed_stage", None)
        state["next_at"] = _iso(now + timedelta(seconds=backoff_s(state["attempts"])))
    return state


def process_session(recordings_dir: Path, manifest: dict, *, backend, model_name: str, workers: int,
                    gate=None, transcripts_dir: Path | None = None, extractor=None, handoff=None,
                    name_of=None) -> dict:
    """마지막으로 끝난 단계 다음부터 전사 → 추출 → BE 인계를 돈다. 스레드에서 부른다.

    extractor(transcript, speaker_names, today) 와 handoff(capture.handoff.Handoff) 는 None 이면
    설정이 없는 것이다. 그 단계에서 멈추고 result["skipped"] 에 이유를 적는다. 전사에서 실패한 줄이
    있으면 partial 로 두고 멈춘다. 다음 실행이 그 줄만 다시 보내고, 그래도 남으면 그 줄이 빠진 채
    다음 단계로 간다 (구간은 failed_units 에 남는다). 어느 단계가 예외를 내면 매니페스트를 failed 로
    쓰고 돌아온다. 다음 실행이 그 단계부터 다시 한다.

    단계를 닫지 못한 실행(failed, partial)은 recovery.attempts 를 하나 올리고 recovery.next_at 에 다음 시도
    시각을 적는다. 단계가 닫히면 recovery 를 지운다. RECOVERY_MAX_ATTEMPTS 에 닿으면 포기하고
    (recovery.gave_up_at) 그때 처음 BE 에 fail 을 보낸다. 그 전에는 BE 회의가 processing 으로 남는다.

    돌려주는 dict: session, status, ran(이번에 끝낸 단계), skipped, error, failed_stage,
    transcribe({markdown, failed, summary, lines}), retried(다시 보낸 줄 수), tasks(목록), be, speakers(명),
    text_channel_id(결과를 올릴 채널), attempts, gave_up, retry_in_s(이번 실패로 잡힌 다음 시도까지 초).
    """
    tdir = transcripts_dir or TRANSCRIPTS_DIR
    path = manifest_path(recordings_dir, manifest["session"])
    stages = manifest.setdefault("stages", {})
    result = {"session": manifest["session"], "status": manifest.get("status"), "ran": [], "skipped": {},
              "error": None, "failed_stage": None, "transcribe": None, "retried": 0, "tasks": None, "be": None,
              "speakers": len(manifest.get("speakers") or []), "text_channel_id": manifest.get("text_channel_id"),
              "partial": False, "missing_units": 0, "attempts": 0, "gave_up": False, "retry_in_s": None}
    stage = None
    counted = False

    def save() -> None:
        save_manifest(path, manifest)

    def finish(name: str) -> None:
        stages[name] = now_iso()
        manifest["status"] = name
        manifest.pop("error", None)
        manifest.pop("failed_stage", None)
        manifest.pop("recovery", None)                 # 단계가 닫혔다. 실패 횟수는 다음 단계에서 새로 센다
        result["ran"].append(name)
        save()

    try:
        if not manifest.get("speakers"):
            # 녹음 중에 죽은 회의다. 트랙을 디렉토리에서 다시 찾는다
            stage = STATUS_TRANSCRIBED
            entries = discover_tracks(recordings_dir, manifest, name_of=name_of)
            if not entries:
                raise FileNotFoundError(f"트랙이 없다: {manifest.get('meeting_dir')}")
            manifest["speakers"] = entries
            manifest["status"] = STATUS_SAVED
            manifest["recovered_tracks"] = True
            result["speakers"] = len(entries)
            save()

        if handoff is not None:
            # 녹음이 끝났으니 BE 회의를 processing 으로 돌린다. 여기서 실패해도 전사는 하고 인계 단계가 다시 부른다
            try:
                handoff.end(manifest, title=meeting_title(manifest))
            except Exception as e:  # noqa: BLE001
                manifest.setdefault("be", {})["error"] = f"{type(e).__name__}: {e}"
            save()

        if STATUS_TRANSCRIBED not in stages:
            stage = STATUS_TRANSCRIBED
            out = transcribe_session(recordings_dir, manifest, backend=backend, model_name=model_name,
                                     workers=workers, gate=gate, transcripts_dir=tdir)
            manifest["transcript"] = str(Path(out["markdown"]).relative_to(recordings_dir))
            manifest["transcript_json"] = str(out["transcript_json"]) if out["transcript_json"] else None
            result["transcribe"] = {"markdown": out["markdown"], "failed": out["failed"],
                                    "summary": out["summary"], "lines": len(out["lines"])}
            if out["failed_units"]:
                # 실패한 줄이 있다. 완료로 닫지 않는다. 다음 실행이 이 구간만 다시 보낸다
                stages[STATUS_TRANSCRIBED] = now_iso()
                manifest["failed_units"] = out["failed_units"]
                manifest["status"] = STATUS_PARTIAL
                manifest.pop("error", None)
                manifest.pop("failed_stage", None)
                result["ran"].append(STATUS_PARTIAL)
                _count_failure(manifest, handoff, FAILED_STAGE[STATUS_TRANSCRIBED])
                counted = True
                save()
                result["status"] = STATUS_PARTIAL
                return result
            finish(STATUS_TRANSCRIBED)
        elif manifest.get("failed_units"):
            # 지난번에 실패한 줄만 다시 보낸다. 상한 전에는 partial 로 두고 다음 시도를 기다린다.
            # 상한에 닿으면 빠진 구간을 둔 채 추출·인계로 간다. 구간은 매니페스트에 남는다
            stage = STATUS_TRANSCRIBED
            out = retry_failed(recordings_dir, manifest, backend=backend, model_name=model_name, transcripts_dir=tdir)
            manifest["retry_runs"] = manifest.get("retry_runs", 0) + 1
            manifest["transcript_json"] = str(out["transcript_json"]) if out["transcript_json"] else None
            result["transcribe"] = {"markdown": out["markdown"], "failed": out["failed"], "summary": None,
                                    "lines": len(out["lines"])}
            result["retried"] = out["retried"]
            result["ran"].append("retried")
            changed = out["retried"] > out["failed"]          # 이번에 살아난 줄이 있다
            if out["failed_units"]:
                manifest["failed_units"] = out["failed_units"]
                if out["failed"] >= len(out["lines"]) or manifest["retry_runs"] < PARTIAL_RETRY_MAX:
                    # 한 줄도 못 살렸거나 아직 상한 전이다. 완료로 닫지 않고 다음 시도를 기다린다
                    manifest["status"] = STATUS_PARTIAL
                    _count_failure(manifest, handoff, FAILED_STAGE[STATUS_TRANSCRIBED])
                    counted = True
                    save()
                    result["status"] = STATUS_PARTIAL
                    return result
                manifest["partial"] = True
            else:
                manifest.pop("failed_units", None)
                manifest.pop("partial", None)
            if changed and (STATUS_EXTRACTED in stages or STATUS_HANDED_OFF in stages):
                # 회의록이 바뀌었다. 옛 회의록으로 뽑은 할일과 인계는 무효다. 다시 뽑고 다시 보낸다
                stages.pop(STATUS_EXTRACTED, None)
                stages.pop(STATUS_HANDED_OFF, None)
                manifest.pop("tasks", None)
                manifest["reextracted"] = True
            manifest["status"] = STATUS_TRANSCRIBED
            manifest.pop("recovery", None)             # 전사 단계가 닫혔다
            save()

        if STATUS_EXTRACTED not in stages:
            if extractor is None:
                result["skipped"][STATUS_EXTRACTED] = "LLM 설정 없음"
                result["status"] = manifest["status"]
                return result
            stage = STATUS_EXTRACTED
            tasks_path = extract_after_transcription(tdir, manifest, extractor=extractor)
            if tasks_path is None:
                raise FileNotFoundError(f"전사 계약 파일이 없다: session_{manifest['session']}.transcript.json")
            manifest["tasks"] = str(tasks_path)
            result["tasks"] = json.loads(tasks_path.read_text(encoding="utf-8"))
            finish(STATUS_EXTRACTED)

        if STATUS_HANDED_OFF not in stages:
            if handoff is None:
                result["skipped"][STATUS_HANDED_OFF] = "BE 설정 없음"
                result["status"] = manifest["status"]
                return result
            stage = STATUS_HANDED_OFF
            be = handoff.register(manifest, transcripts_dir=tdir, model_name=model_name, title=meeting_title(manifest))
            result["be"] = dict(be)
            finish(STATUS_HANDED_OFF)
    except Exception as e:  # noqa: BLE001 - 어느 단계가 죽어도 매니페스트에 남기고 돌아온다
        manifest["status"] = STATUS_FAILED
        manifest["failed_stage"] = FAILED_STAGE.get(stage, stage or "unknown")
        manifest["error"] = f"{type(e).__name__}: {e}"
        result.update(error=manifest["error"], failed_stage=manifest["failed_stage"])
        # BE 에는 포기할 때만 알린다. 그 전에는 processing 으로 두고 다음 시도를 기다린다
        _count_failure(manifest, handoff, manifest["failed_stage"])
        counted = True
        save()
    finally:
        result["status"] = manifest["status"]
        result["partial"] = bool(manifest.get("partial"))
        result["missing_units"] = len(manifest.get("failed_units") or [])
        state = manifest.get("recovery") or {}
        result["attempts"] = state.get("attempts", 0)
        result["gave_up"] = bool(state.get("gave_up_at"))
        result["retry_in_s"] = backoff_s(state["attempts"]) if counted and state.get("next_at") else None
    return result


def interrupted_recording(manifest: dict, *, since: str) -> bool:
    """since(이 프로세스가 뜬 시각, ISO) 전에 시작돼 recording 으로 남은 회의. 녹음 중에 봇이 죽었다 다시 뜬 것이다.

    봇이 들고 있는 회의는 복구 목록에서 이미 빠진다. 이 프로세스가 시작한 녹음이 recording 으로 남는 것은 트랙을
    닫다 예외가 난 경우라 재시작 안내 대상이 아니다.
    """
    return manifest.get("status") == STATUS_RECORDING and _started_before(manifest, since)


def _started_before(manifest: dict, since: str) -> bool:
    raw = manifest.get("started_at") or manifest.get("recorded_at")
    return raw is None or _parse_time(raw) < _parse_time(since)


def recently_cut(recordings_dir: Path, manifest: dict) -> bool:
    """녹음이 끊긴 지 얼마 안 됐나. 회의 디렉토리에서 가장 늦게 쓴 wav 가 RESUME_NOTICE_WINDOW_S 안이면 그렇다.

    봇이 오래 꺼져 있다 뜨면 회의는 이미 끝났으니 "이어서 기록하려면" 안내가 소용없다. 처리는 그대로 한다.
    """
    mdir = recordings_dir / (manifest.get("meeting_dir") or "")
    if not manifest.get("meeting_dir") or not mdir.is_dir():
        return False
    newest = max((p.stat().st_mtime for p in mdir.glob("*.wav")), default=None)
    return newest is not None and utcnow().timestamp() - newest <= RESUME_NOTICE_WINDOW_S


def interrupted_meetings(recordings_dir: Path, *, since: str, guild_id=None, exclude=None) -> list[tuple[Path, dict]]:
    """재시작 안내를 올릴 회의. since(이 봇이 뜬 시각) 전에 시작돼 녹음 중에 끊겼고 끊긴 지 얼마 안 된 회의.

    잠금이 풀린 recording 으로 남은 회의와, 워커가 먼저 집어 트랙을 되찾은(recovered_tracks) 회의를 다 본다.
    봇이 다시 뜨는 몇 초 사이에 워커가 먼저 처리를 시작하는 일이 흔하다. 서버가 적힌 것만 본다. 읽기만 한다.
    """
    skip = set(exclude or ())
    out = []
    for p in sorted(recordings_dir.glob("session_*.json"), key=_queue_key):
        m = _load(p)
        if m is None or m.get("session") in skip or not m.get("guild_id"):
            continue
        if guild_id is not None and str(m.get("guild_id")) != str(guild_id):
            continue
        if interrupted_recording(m, since=since):
            if not _is_pending(recordings_dir, m) or is_locked(p):
                continue
        elif not (m.get("recovered_tracks") and _started_before(m, since)):
            continue
        if recently_cut(recordings_dir, m):
            out.append((p, m))
    return out


def _due(manifest: dict, now: datetime) -> bool:
    """루프가 이번 바퀴에 돌릴 때인가. 다음 시도 시각 전이면 아니다. 포기한 회의는 BE 에 fail 이 안 닿았을 때만이다.

    recovery 가 없는 failed 는 자동 복구가 생기기 전의 실패다. 그때 BE 에 바로 fail 을 보냈으니 포기한 회의처럼
    두고 사람이 /recover 로 돌린다. 루프가 쓸어 가면 BE 에 새 회의가 줄줄이 생기고 원격 전사가 다시 과금된다.
    """
    if "recovery" not in manifest and manifest.get("status") == STATUS_FAILED:
        return False
    state = manifest.get("recovery") or {}
    if state.get("gave_up_at"):
        be = manifest.get("be") or {}
        return bool(be.get("meeting_id")) and be.get("status") not in ("failed", "done")
    nxt = state.get("next_at")
    return not nxt or now >= _parse_time(nxt)


def recovery_targets(recordings_dir: Path, *, claims: Claims, guild_id=None, exclude=None,
                     manual: bool = False) -> tuple[list[tuple[Path, dict]], list[dict]]:
    """이번 바퀴에 돌릴 회의 [(경로, 매니페스트)] 와, 남이 잡고 있어 건너뛸 회의 [{session, busy, claimed_by, ...}].

    manual 은 사람이 친 /recover 다. 다음 시도 시각을 기다리지 않고 포기한 회의도 한 번 더 돌린다. 루프는 시각이
    안 됐거나 포기한 회의를 뺀다. 포기했는데 BE 에 fail 이 닿지 않은 회의만 그 fail 을 다시 보내려고 넣는다.
    exclude 는 봇이 지금 들고 있는 회의(녹음 중·후처리 중)다.
    """
    now = utcnow()
    due, busy = [], []
    for p, m in _pending(recordings_dir, guild_id=guild_id, exclude=exclude):
        who = claims.holder(p, m)
        if who is not None:
            busy.append({"session": m.get("session"), "busy": True, **who})
        elif manual or _due(m, now):
            due.append((p, m))
    return due, busy


def recover_one(recordings_dir: Path, path: Path, *, claims: Claims, manual: bool = False, backend,
                model_name: str, workers: int, gate=None, transcripts_dir: Path | None = None, extractor=None,
                handoff=None, name_of=None) -> dict | None:
    """회의 하나를 잡아 돌리고 놓는다. 루프와 /recover 가 회의마다 지나는 경로다. 스레드에서 부른다.

    목록을 만든 뒤 시간이 흘렀으니(세마포어를 기다렸다) 회의 잠금을 먼저 잡고 매니페스트를 다시 읽어 아직 할 일인지
    본다. 그 사이 남이 잡았으면 {"session", "busy": True, claimed_by, claimed_at, since_s, mine}, 끝났거나
    루프가 돌릴 때가 아니면 None, 돌렸으면 process_session 의 결과다. 루프가 포기한 회의를 만나면 돌리지 않고
    포기 때 BE 에 닿지 못한 fail 만 다시 보낸다.
    """
    m = claims.acquire(path)
    if m is None:
        cur = _load(path)
        who = claims.holder(path, cur) if cur is not None else None
        return {"session": cur.get("session"), "busy": True, **who} if who is not None else None
    try:
        if not _is_pending(recordings_dir, m) or not (manual or _due(m, utcnow())):
            return None
        state = m.get("recovery") or {}
        if not manual and state.get("gave_up_at"):
            if handoff is not None:
                handoff.fail(m, state.get("failed_stage") or m.get("failed_stage") or "unknown")
            return None                                # 바뀐 be 는 아래 release 가 표시를 지우며 같이 저장한다
        return process_session(recordings_dir, m, backend=backend, model_name=model_name, workers=workers, gate=gate,
                               transcripts_dir=transcripts_dir, extractor=extractor, handoff=handoff, name_of=name_of)
    finally:
        claims.release(path, m)


def queue_ahead(recordings_dir: Path, session, *, exclude=None) -> int:
    """워커가 이 회의보다 먼저 처리할 회의 수. 워커의 루프 바퀴와 같은 목록(recovery_targets 에서 서버가 적힌 것)과
    순서(시작 시각)를 쓴다. 지금 처리 중인(잠금이 걸린) 회의도 센다. 봇이 녹음 중인 회의는 exclude 로 뺀다."""
    mine = _queue_key(manifest_path(recordings_dir, session))
    due, busy = recovery_targets(recordings_dir, claims=Claims(owner="queue"), exclude=exclude)
    ahead = sum(1 for p, m in due if m.get("guild_id") and _queue_key(p) < mine)
    return ahead + sum(1 for b in busy if _queue_key(manifest_path(recordings_dir, b["session"])) < mine)


async def recover_pass(recordings_dir: Path, *, claims: Claims, sem: asyncio.Semaphore, stt_factory, gate_factory,
                       extractor_factory, handoff_factory, transcripts_dir: Path | None = None, guild_id=None,
                       exclude=None, manual: bool = False, name_of_for=None, stop=None, on_start=None,
                       on_result=None) -> tuple[list[dict], list[dict]]:
    """복구 한 바퀴. 봇(capture/discord_adapter.py)의 루프와 /recover, 워커(capture/worker.py)가 같이 쓴다.

    대상은 바퀴를 시작할 때 정한다(recovery_targets). 모든 서버를 보는 바퀴(guild_id=None)는 서버가 적히지 않은
    옛 매니페스트를 뺀다. 서버별 /recover 도 집지 못하던 것이다. 회의마다 sem 을 잡고 recover_one 을 스레드에서
    돌린다. stop() 이 참이 되면 새 회의를 집지 않는다. on_start(매니페스트)는 처리 직전에, on_result(결과)는 처리
    뒤에 부른다. 돌려주는 것은 (돌린 회의의 결과, 남이 잡고 있어 건너뛴 회의)다.
    """
    due, busy = recovery_targets(recordings_dir, claims=claims, guild_id=guild_id, exclude=exclude, manual=manual)
    if guild_id is None:
        due = [(p, m) for p, m in due if m.get("guild_id")]
    results = []
    for path, m in due:
        if stop is not None and stop():
            break
        backend, model_name, workers = stt_factory()
        async with sem:
            if stop is not None and stop():
                break
            if on_start is not None:
                on_start(m)
            r = await asyncio.to_thread(recover_one, recordings_dir, path, claims=claims, manual=manual,
                                        backend=backend, model_name=model_name, workers=workers, gate=gate_factory(),
                                        transcripts_dir=transcripts_dir, extractor=extractor_factory(),
                                        handoff=handoff_factory(), name_of=name_of_for(m) if name_of_for else None)
        if r is None:
            continue
        if r.get("busy"):
            busy.append(r)
            continue
        results.append(r)
        if on_result is not None:
            await on_result(r)
    return results, busy


def recover(recordings_dir: Path, *, backend, model_name: str, workers: int, gate=None,
            transcripts_dir: Path | None = None, extractor=None, handoff=None, guild_id=None,
            name_of=None, exclude=None, claims: Claims | None = None, manual: bool = True) -> list[dict]:
    """끝까지 가지 않은 회의를 마지막 단계 다음부터 마저 돌린다. 회의마다 process_session 의 결과.

    한 바퀴다. recovery_targets 로 고르고 recover_one 으로 하나씩 돌린다. 봇의 루프와 /recover 는 같은 두
    함수를 회의마다 후처리 세마포어를 잡고 부른다(capture/discord_adapter.py). 기본은 사람이 친 /recover 와
    같다. 다음 시도 시각을 기다리지 않고 포기한 회의도 돌린다. 남이 잡고 있는 회의는 건너뛴다.

    guild_id 를 주면 그 서버의 회의만 본다. exclude 는 봇이 지금 들고 있는 회의 ID 다. 녹음 중인 wav 를 집어 가면 안 된다.
    """
    claims = claims or Claims()
    due, _ = recovery_targets(recordings_dir, claims=claims, guild_id=guild_id, exclude=exclude, manual=manual)
    done = []
    for p, _m in due:
        r = recover_one(recordings_dir, p, claims=claims, manual=manual, backend=backend, model_name=model_name,
                        workers=workers, gate=gate, transcripts_dir=transcripts_dir, extractor=extractor,
                        handoff=handoff, name_of=name_of)
        if r is not None and not r.get("busy"):
            done.append(r)
    return done


def build_extractor():
    """extract_tasks 를 부를 함수를 만든다. 모듈이나 LLM 설정이 없으면 None.

    extract/ 는 다른 담당의 모듈이라 여기서는 부르기만 한다. 설정은 shared.config 의 LLM_* 다.
    """
    try:
        from openai import OpenAI
        from extract.llm import extract_tasks
        from shared.config import settings
    except ImportError:
        return None
    cfg = settings()
    if not getattr(cfg, "llm_api_key", "") or getattr(cfg, "llm_mode", "") == "off":
        return None
    client = OpenAI(base_url=getattr(cfg, "llm_base_url", "") or None, api_key=cfg.llm_api_key)

    def run(transcript, speaker_names, today):
        return extract_tasks(transcript, client=client, model=cfg.llm_model, today=today, speaker_names=speaker_names)

    return run


def extract_after_transcription(transcripts_dir: Path, manifest: dict, *, extractor=None,
                                today: date | None = None) -> Path | None:
    """전사 결과(Transcript)에서 할일을 뽑아 transcripts/session_<회의ID>.tasks.json 에 쓴다.

    extractor(transcript, speaker_names, today) -> list[ExtractedTask]. 없으면 build_extractor() 로 만들고,
    그것도 없으면 아무것도 안 하고 None 을 돌려준다. today 는 회의 날짜다 (meeting_date). 회의록은 이미
    나와 있으므로 여기서 실패해도 전사 결과는 그대로다.
    """
    from shared.schemas import Transcript

    ts = manifest["session"]
    src = transcripts_dir / f"session_{ts}.transcript.json"
    if not src.exists():
        return None
    extractor = extractor or build_extractor()
    if extractor is None:
        return None
    transcript = Transcript.from_dict(json.loads(src.read_text(encoding="utf-8")))
    names = {str(e["user_id"]): e["display_name"] for e in manifest["speakers"]}
    tasks = extractor(transcript, names, today or meeting_date(manifest))
    out = transcripts_dir / f"session_{ts}.tasks.json"
    out.write_text(json.dumps([t.to_dict() if hasattr(t, "to_dict") else t for t in tasks],
                              ensure_ascii=False, indent=2), encoding="utf-8")
    return out
