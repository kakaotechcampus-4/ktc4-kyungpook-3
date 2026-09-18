"""녹음 세션의 플랫폼 비종속 부분. 매니페스트 상태, 저장 뒤 전사·추출·BE 인계, 남은 회의 회수.

discord 이름은 여기 없다. capture/discord_adapter.py 가 이 함수들을 부르고, 봇이 죽은 뒤에도
같은 함수로 남은 회의를 마저 처리할 수 있다.

매니페스트 recordings/session_<ts>.json 은 recording_store.write_manifest 의 필드에 아래를 더한다.
  status        recording | saved | transcribed | extracted | handed_off | failed
  stages        단계별 완료 시각 {"transcribed": iso, "extracted": iso, "handed_off": iso}
  failed_stage  failed 일 때 어느 단계인지. stt | extract | handoff
  error         failed 일 때 예외 한 줄
  started_at    녹음 시작 벽시계(UTC ISO). 트랙 안의 위치는 이 시각부터 흐른 monotonic 시간이다
  timezone      회의가 열린 시간대. "내일" 같은 상대 날짜의 기준일은 이 시간대의 시작 날짜다
  transcript    전사가 끝나면 회의록 경로
  tasks         할일 추출까지 됐으면 그 결과 파일 경로
  be            BE 인계 상태 {"meeting_id", "status", "extraction_id", ...}. capture/handoff.py 가 쓴다

process_session 이 마지막으로 끝난 단계 다음부터 실행한다. /stop 뒤 처리와 /recover 가 같은
함수를 쓰므로 어디서 죽어도 같은 경로로 이어진다. 할일 추출(extract/, #30)과 BE 인계는 설정이
없으면 그 단계에서 멈추고 매니페스트는 그 앞 상태로 남는다.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from capture.recording_store import write_manifest
from shared.config import TRANSCRIPTS_DIR, settings
from shared.config import today as config_today
from shared.schemas import now_iso

STATUS_RECORDING = "recording"
STATUS_SAVED = "saved"
STATUS_TRANSCRIBED = "transcribed"
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


def manifest_path(recordings_dir: Path, ts) -> Path:
    return recordings_dir / f"session_{ts}.json"


def save_manifest(path: Path, manifest: dict) -> None:
    """임시 파일에 쓴 뒤 바꿔 끼운다. 쓰는 도중 죽어도 반쯤 쓰인 JSON 이 남지 않는다."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def write_status(recordings_dir: Path, ts: int, *, status: str, entries: list[dict],
                 guild: str | None, channel: str | None, library_version: str | None,
                 started_at: str | None, meeting_dir: str, transcript: str | None = None,
                 extra: dict | None = None) -> tuple[Path, dict]:
    """매니페스트를 통째로 다시 쓴다. 녹음 시작과 저장 완료 때 부른다. 그 뒤 단계는 process_session 이 쓴다."""
    path, manifest = write_manifest(entries, recordings_dir, ts=ts, guild=guild, channel=channel,
                                    library_version=library_version)
    manifest.update({"status": status, "started_at": started_at, "meeting_dir": meeting_dir})
    if transcript is not None:
        manifest["transcript"] = transcript
    if extra:
        manifest.update(extra)
    save_manifest(path, manifest)
    return path, manifest


def backend_from_env() -> tuple[object, str, int]:
    """(백엔드, 모델 이름, 워커 수). MM_STT_BACKEND=local|elice, MM_STT_MODEL 로 고른다."""
    from stt import batch as B
    kind = os.environ.get("MM_STT_BACKEND", "local")
    model = os.environ.get("MM_STT_MODEL", "large-v3-turbo")
    backend = B.make_backend(kind, model, "chunk")
    return backend, ("elice" if kind == "elice" else model), B.default_workers(kind)


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


def transcribe_session(recordings_dir: Path, manifest: dict, *, backend, model_name: str, workers: int,
                       gate=None, transcripts_dir: Path | None = None) -> dict:
    """매니페스트의 트랙을 chunk 모드로 전사해 회의록까지 쓴다. 스레드에서 부른다.

    산출물은 둘이다. transcripts/ 의 파일당 json 과 session_<ts>.transcript.json (BE 계약),
    그리고 회의 디렉토리의 transcript.md / transcript.jsonl (사람이 읽는 대본).
    """
    from stt.transcribe import run_session
    from stt.transcript_writer import write_transcript

    wavs = [recordings_dir / e["file"] for e in manifest["speakers"]]
    names = {str(e["user_id"]): e["display_name"] for e in manifest["speakers"]}
    run = run_session(wavs, names, backend, mode="chunk", model_name=model_name, gate=gate, workers=workers,
                      out_dir=transcripts_dir or TRANSCRIPTS_DIR)
    meeting_dir = recordings_dir / manifest["meeting_dir"]
    md = write_transcript(run["lines"], meeting_dir, manifest["meeting_dir"])
    return {"markdown": md["markdown"], "jsonl": md["jsonl"], "failed": md["failed"],
            "transcript_json": run["transcript_json"], "summary": run["summary"], "lines": run["lines"]}


def pending_sessions(recordings_dir: Path) -> list[Path]:
    """끝까지 가지 않은 매니페스트. 봇이 죽었거나 어느 단계가 실패했거나 설정이 없어 멈춘 회의가 여기 남는다."""
    out = []
    for p in sorted(recordings_dir.glob("session_*.json")):
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if m.get("status") != STATUS_HANDED_OFF and m.get("speakers"):
            if all((recordings_dir / e["file"]).exists() for e in m["speakers"]):
                out.append(p)
    return out


def process_session(recordings_dir: Path, manifest: dict, *, backend, model_name: str, workers: int,
                    gate=None, transcripts_dir: Path | None = None, extractor=None, handoff=None) -> dict:
    """마지막으로 끝난 단계 다음부터 전사 → 추출 → BE 인계를 돈다. 스레드에서 부른다.

    extractor(transcript, speaker_names, today) 와 handoff(capture.handoff.Handoff) 는 None 이면
    설정이 없는 것이다. 그 단계에서 멈추고 result["skipped"] 에 이유를 적는다. 어느 단계가 예외를
    내면 매니페스트를 failed 로 쓰고 BE 에도 알린 뒤 돌아온다. 다음 /recover 가 그 단계부터 다시 한다.

    돌려주는 dict: session, status, ran(이번에 끝낸 단계), skipped, error, failed_stage,
    transcribe({markdown, failed, summary, lines}), tasks(목록), be, speakers(명).
    """
    tdir = transcripts_dir or TRANSCRIPTS_DIR
    path = manifest_path(recordings_dir, manifest["session"])
    stages = manifest.setdefault("stages", {})
    result = {"session": manifest["session"], "status": manifest.get("status"), "ran": [], "skipped": {},
              "error": None, "failed_stage": None, "transcribe": None, "tasks": None, "be": None,
              "speakers": len(manifest.get("speakers", []))}
    stage = None

    def finish(name: str) -> None:
        stages[name] = now_iso()
        manifest["status"] = name
        manifest.pop("error", None)
        manifest.pop("failed_stage", None)
        result["ran"].append(name)
        save_manifest(path, manifest)

    try:
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
            finish(STATUS_TRANSCRIBED)

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
            transcripts_dir: Path | None = None, extractor=None, handoff=None) -> list[dict]:
    """끝까지 가지 않은 회의를 마지막 단계 다음부터 마저 돌린다. 회의마다 process_session 의 결과."""
    done = []
    for p in pending_sessions(recordings_dir):
        m = json.loads(p.read_text(encoding="utf-8"))
        done.append(process_session(recordings_dir, m, backend=backend, model_name=model_name, workers=workers,
                                    gate=gate, transcripts_dir=transcripts_dir, extractor=extractor, handoff=handoff))
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
    """전사 결과(Transcript)에서 할일을 뽑아 transcripts/session_<ts>.tasks.json 에 쓴다.

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
