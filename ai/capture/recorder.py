"""녹음 세션의 플랫폼 비종속 부분. 매니페스트 상태, 저장 뒤 전사·추출·BE 인계, 남은 회의 회수.

discord 이름은 여기 없다. capture/discord_adapter.py 가 이 함수들을 부르고, 봇이 죽은 뒤에도
같은 함수로 남은 회의를 마저 처리할 수 있다.

매니페스트 recordings/session_<회의ID>.json. 회의 ID 는 <guild>_<ts> 다 (서버 둘이 같은 초에 시작해도 다르다).
필드는 recording_store.write_manifest 와 같고 아래를 더한다.
  status        recording | saved | transcribed | partial | extracted | handed_off | failed
  stages        단계별 완료 시각 {"transcribed": iso, "extracted": iso, "handed_off": iso}
  failed_units  partial 일 때 실패한 줄 [{"speaker", "start_ms", "end_ms", "error"}]. /recover 가 이 구간만 다시 보낸다
  failed_stage  failed 일 때 어느 단계인지. stt | extract | handoff
  error         failed 일 때 예외 한 줄
  started_at    녹음 시작 벽시계(UTC ISO). 트랙 안의 위치는 이 시각부터 흐른 monotonic 시간이다
  timezone      회의가 열린 시간대. "내일" 같은 상대 날짜의 기준일은 이 시간대의 시작 날짜다
  guild_id, voice_channel_id, text_channel_id, workspace_id   어느 서버의 어느 방 회의인지. 복구 범위와 게시 채널
  transcript    전사가 끝나면 회의록 경로
  tasks         할일 추출까지 됐으면 그 결과 파일 경로
  be            BE 인계 상태 {"meeting_id", "status", "extraction_id", ...}. capture/handoff.py 가 쓴다

process_session 이 마지막으로 끝난 단계 다음부터 실행한다. /stop 뒤 처리와 /recover 가 같은
함수를 쓰므로 어디서 죽어도 같은 경로로 이어진다. 전사에서 실패한 줄이 있으면 완료로 닫지 않고
partial 로 두며, 다음 실행이 그 줄만 다시 보낸다. 할일 추출(extract/, #30)과 BE 인계는 설정이
없으면 그 단계에서 멈추고 매니페스트는 그 앞 상태로 남는다.
"""

from __future__ import annotations

import functools
import json
import os
import socket
import threading
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
RECOVERY_MAX_ATTEMPTS = int(os.environ.get("MM_RECOVERY_MAX_ATTEMPTS", "5"))   # 이만큼 실패하면 포기하고 BE 에 fail
RECOVERY_BACKOFF_S = float(os.environ.get("MM_RECOVERY_BACKOFF_S", "60"))      # 첫 실패 뒤 기다림. 실패마다 두 배
RECOVERY_BACKOFF_CEIL_S = 3600.0                                                # 두 배로 늘려도 한 시간에서 멈춘다
# 복구 선점의 만료. 선점은 단계가 바뀔 때만 새로 적으므로 가장 긴 단계(로컬 전사)보다 길어야 한다
CLAIM_TTL_S = float(os.environ.get("MM_RECOVERY_CLAIM_TTL_S", "7200"))


def utcnow() -> datetime:
    """선점 만료와 다음 시도 시각을 재는 시계. 테스트가 바꿔 끼운다."""
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


def _pending(recordings_dir: Path, *, guild_id=None, exclude=None):
    skip = set(exclude or ())
    for p in sorted(recordings_dir.glob("session_*.json")):
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
    """복구가 회의를 잡았다는 표시. 매니페스트의 claimed_by·claimed_at 과, 이 프로세스가 지금 든 회의 ID.

    같은 프로세스의 루프와 /recover 는 잠금과 held 로 서로를 막는다. 이 배제는 만료와 무관하다. 매니페스트의
    표시는 프로세스가 죽은 뒤에도 남으므로 ttl_s 가 지나면 누구든 다시 잡는다. 긴 전사 중에 자기 선점이 만료되지
    않게 process_session 이 단계를 저장할 때마다 claimed_at 을 새로 적는다. 선점은 복구만 쓴다. /record 와 /stop
    뒤 처리는 봇이 들고 있는 회의라 선점 없이 돈다. 프로세스 사이의 원자성은 1차 범위 밖이다. 두 프로세스가 같은
    순간에 읽고 쓰면 둘 다 잡을 수 있다.
    """

    def __init__(self, owner: str | None = None, ttl_s: float | None = None) -> None:
        self.owner = owner or f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
        self.ttl_s = CLAIM_TTL_S if ttl_s is None else ttl_s
        self._lock = threading.Lock()
        self._held: set[str] = set()

    def holder(self, manifest: dict) -> dict | None:
        """이 회의를 지금 잡고 있는 쪽 {claimed_by, expires_at, expires_in_s, mine}. 아무도 없거나 만료됐으면 None."""
        by, at = manifest.get("claimed_by"), manifest.get("claimed_at")
        expires = _parse_time(at) + timedelta(seconds=self.ttl_s) if at else None
        if str(manifest.get("session")) in self._held:
            return self._who(by or self.owner, expires, mine=True)
        if not by or expires is None or by == self.owner or utcnow() >= expires:
            return None
        return self._who(by, expires, mine=False)

    @staticmethod
    def _who(by: str, expires: datetime | None, *, mine: bool) -> dict:
        left = max(0, int((expires - utcnow()).total_seconds())) if expires is not None else None
        return {"claimed_by": by, "expires_at": _iso(expires) if expires is not None else None,
                "expires_in_s": left, "mine": mine}

    def acquire(self, path: Path) -> dict | None:
        """잡는다. 잡았으면 방금 읽은 매니페스트(선점이 적힌 것), 남이 잡고 있거나 읽을 수 없으면 None.

        process_session 은 이 dict 를 통째로 저장하므로 선점 표시가 같이 남는다. 다 쓰면 release 로 놓는다.
        """
        with self._lock:
            m = _load(path)
            if m is None or self.holder(m) is not None:
                return None
            m["claimed_by"] = self.owner
            m["claimed_at"] = _iso(utcnow())
            save_manifest(path, m)
            self._held.add(str(m.get("session")))
            return m

    def release(self, path: Path, manifest: dict) -> None:
        """놓는다. manifest 는 acquire 가 준 dict 다. process_session 이 고친 마지막 상태에서 선점만 지우고 저장한다."""
        with self._lock:
            try:
                if manifest.get("claimed_by") == self.owner:
                    manifest.pop("claimed_by", None)
                    manifest.pop("claimed_at", None)
                    save_manifest(path, manifest)
            finally:
                self._held.discard(str(manifest.get("session")))


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
    복구가 잡은 회의(claimed_by 가 있다)면 저장할 때마다 claimed_at 을 새로 적는다.

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
        # 복구가 잡은 회의면 저장할 때마다(단계가 바뀔 때마다) 선점 시각을 새로 적는다. 긴 전사 중에 만료되지 않게
        if manifest.get("claimed_by"):
            manifest["claimed_at"] = _iso(utcnow())
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


def _due(manifest: dict, now: datetime) -> bool:
    """루프가 이번 바퀴에 돌릴 때인가. 다음 시도 시각 전이거나 포기한 회의면 아니다."""
    state = manifest.get("recovery") or {}
    if state.get("gave_up_at"):
        return False
    nxt = state.get("next_at")
    return not nxt or now >= _parse_time(nxt)


def recovery_targets(recordings_dir: Path, *, claims: Claims, guild_id=None, exclude=None,
                     manual: bool = False) -> tuple[list[tuple[Path, dict]], list[dict]]:
    """이번 바퀴에 돌릴 회의 [(경로, 매니페스트)] 와, 남이 잡고 있어 건너뛸 회의 [{session, busy, claimed_by, ...}].

    manual 은 사람이 친 /recover 다. 다음 시도 시각을 기다리지 않고 포기한 회의도 한 번 더 돌린다. 루프는 시각이
    안 됐거나 포기한 회의를 뺀다. exclude 는 봇이 지금 들고 있는 회의(녹음 중·후처리 중)다.
    """
    now = utcnow()
    due, busy = [], []
    for p, m in _pending(recordings_dir, guild_id=guild_id, exclude=exclude):
        who = claims.holder(m)
        if who is not None:
            busy.append({"session": m.get("session"), "busy": True, **who})
        elif manual or _due(m, now):
            due.append((p, m))
    return due, busy


def recover_one(recordings_dir: Path, path: Path, *, claims: Claims, manual: bool = False, backend,
                model_name: str, workers: int, gate=None, transcripts_dir: Path | None = None, extractor=None,
                handoff=None, name_of=None) -> dict | None:
    """회의 하나를 잡아 돌리고 놓는다. 루프와 /recover 가 회의마다 지나는 경로다. 스레드에서 부른다.

    목록을 만든 뒤 시간이 흘렀으니(세마포어를 기다렸다) 선점을 먼저 잡고 매니페스트를 다시 읽어 아직 할 일인지
    본다. 그 사이 남이 잡았으면 {"session", "busy": True, claimed_by, expires_at, expires_in_s, mine}, 끝났거나
    루프가 돌릴 때가 아니면 None, 돌렸으면 process_session 의 결과다.
    """
    m = claims.acquire(path)
    if m is None:
        cur = _load(path)
        who = claims.holder(cur) if cur is not None else None
        return {"session": cur.get("session"), "busy": True, **who} if who is not None else None
    try:
        if not _is_pending(recordings_dir, m) or not (manual or _due(m, utcnow())):
            return None
        return process_session(recordings_dir, m, backend=backend, model_name=model_name, workers=workers, gate=gate,
                               transcripts_dir=transcripts_dir, extractor=extractor, handoff=handoff, name_of=name_of)
    finally:
        claims.release(path, m)


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
