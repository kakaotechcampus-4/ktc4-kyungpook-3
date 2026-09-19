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
from datetime import date, datetime, timezone
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
# 매니페스트와 BE 의 failed_stage 에 적는 이름
FAILED_STAGE = {STATUS_TRANSCRIBED: "stt", STATUS_EXTRACTED: "extract", STATUS_HANDED_OFF: "handoff"}


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


def pending_sessions(recordings_dir: Path, *, guild_id=None) -> list[Path]:
    """끝까지 가지 않은 매니페스트. 봇이 죽었거나 어느 단계가 실패했거나 설정이 없어 멈춘 회의가 여기 남는다.

    guild_id 를 주면 그 서버의 회의만. 녹음 중에 죽어 speakers 가 빈 회의는 디렉토리에 트랙이 있으면 든다.
    """
    out = []
    for p in sorted(recordings_dir.glob("session_*.json")):
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if m.get("status") == STATUS_HANDED_OFF:
            continue
        if guild_id is not None and str(m.get("guild_id")) != str(guild_id):
            continue
        if m.get("speakers"):
            if all((recordings_dir / e["file"]).exists() for e in m["speakers"]):
                out.append(p)
        elif m.get("status") == STATUS_RECORDING and discover_tracks(recordings_dir, m):
            out.append(p)
    return out


def process_session(recordings_dir: Path, manifest: dict, *, backend, model_name: str, workers: int,
                    gate=None, transcripts_dir: Path | None = None, extractor=None, handoff=None,
                    name_of=None) -> dict:
    """마지막으로 끝난 단계 다음부터 전사 → 추출 → BE 인계를 돈다. 스레드에서 부른다.

    extractor(transcript, speaker_names, today) 와 handoff(capture.handoff.Handoff) 는 None 이면
    설정이 없는 것이다. 그 단계에서 멈추고 result["skipped"] 에 이유를 적는다. 전사에서 실패한 줄이
    있으면 partial 로 두고 멈춘다. 다음 실행이 그 줄만 다시 보내고, 그래도 남으면 그 줄이 빠진 채
    다음 단계로 간다 (구간은 failed_units 에 남는다). 어느 단계가 예외를 내면 매니페스트를 failed 로
    쓰고 BE 에도 알린 뒤 돌아온다. 다음 /recover 가 그 단계부터 다시 한다.

    돌려주는 dict: session, status, ran(이번에 끝낸 단계), skipped, error, failed_stage,
    transcribe({markdown, failed, summary, lines}), retried(다시 보낸 줄 수), tasks(목록), be, speakers(명),
    text_channel_id(결과를 올릴 채널).
    """
    tdir = transcripts_dir or TRANSCRIPTS_DIR
    path = manifest_path(recordings_dir, manifest["session"])
    stages = manifest.setdefault("stages", {})
    result = {"session": manifest["session"], "status": manifest.get("status"), "ran": [], "skipped": {},
              "error": None, "failed_stage": None, "transcribe": None, "retried": 0, "tasks": None, "be": None,
              "speakers": len(manifest.get("speakers") or []), "text_channel_id": manifest.get("text_channel_id")}
    stage = None

    def finish(name: str) -> None:
        stages[name] = now_iso()
        manifest["status"] = name
        manifest.pop("error", None)
        manifest.pop("failed_stage", None)
        result["ran"].append(name)
        save_manifest(path, manifest)

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
            save_manifest(path, manifest)

        if handoff is not None:
            # 녹음이 끝났으니 BE 회의를 processing 으로 돌린다. 여기서 실패해도 전사는 하고 인계 단계가 다시 부른다
            try:
                handoff.end(manifest, title=meeting_title(manifest))
            except Exception as e:  # noqa: BLE001
                manifest.setdefault("be", {})["error"] = f"{type(e).__name__}: {e}"
            save_manifest(path, manifest)

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
                save_manifest(path, manifest)
                result["status"] = STATUS_PARTIAL
                return result
            finish(STATUS_TRANSCRIBED)
        elif manifest.get("failed_units"):
            # 지난번에 실패한 줄만 다시 보낸다. 그래도 남으면 그 줄이 빠진 채로 간다. 구간은 매니페스트에 남는다
            stage = STATUS_TRANSCRIBED
            out = retry_failed(recordings_dir, manifest, backend=backend, model_name=model_name, transcripts_dir=tdir)
            manifest["retry_runs"] = manifest.get("retry_runs", 0) + 1
            manifest["transcript_json"] = str(out["transcript_json"]) if out["transcript_json"] else None
            result["transcribe"] = {"markdown": out["markdown"], "failed": out["failed"], "summary": None,
                                    "lines": len(out["lines"])}
            result["retried"] = out["retried"]
            result["ran"].append("retried")
            if out["failed_units"]:
                manifest["failed_units"] = out["failed_units"]
                if out["failed"] >= len(out["lines"]):
                    # 한 줄도 살지 못했다. 회의록이 없으니 더 갈 수 없다. partial 로 두고 다음 시도를 기다린다
                    manifest["status"] = STATUS_PARTIAL
                    save_manifest(path, manifest)
                    result["status"] = STATUS_PARTIAL
                    return result
            else:
                manifest.pop("failed_units", None)
            manifest["status"] = STATUS_TRANSCRIBED
            save_manifest(path, manifest)

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
        if handoff is not None:
            handoff.fail(manifest, manifest["failed_stage"])
        save_manifest(path, manifest)
    result["status"] = manifest["status"]
    return result


def recover(recordings_dir: Path, *, backend, model_name: str, workers: int, gate=None,
            transcripts_dir: Path | None = None, extractor=None, handoff=None, guild_id=None,
            name_of=None) -> list[dict]:
    """끝까지 가지 않은 회의를 마지막 단계 다음부터 마저 돌린다. 회의마다 process_session 의 결과.

    guild_id 를 주면 그 서버의 회의만 본다. 봇의 /recover 는 명령이 온 서버로 제한한다.
    """
    done = []
    for p in pending_sessions(recordings_dir, guild_id=guild_id):
        m = json.loads(p.read_text(encoding="utf-8"))
        done.append(process_session(recordings_dir, m, backend=backend, model_name=model_name, workers=workers,
                                    gate=gate, transcripts_dir=transcripts_dir, extractor=extractor,
                                    handoff=handoff, name_of=name_of))
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
