"""녹음 세션의 플랫폼 비종속 부분. 매니페스트 상태, 저장 뒤 배치 전사, 전사 안 된 녹음 회수.

discord 이름은 여기 없다. capture/discord_adapter.py 가 이 함수들을 부르고, 봇이 죽은 뒤에도
같은 함수로 남은 녹음을 마저 전사할 수 있다.

매니페스트 recordings/session_<ts>.json 은 recording_store.write_manifest 의 필드에 셋을 더한다.
  status      recording | saved | transcribed | failed
  started_at  녹음 시작 벽시계(UTC ISO). 트랙 안의 위치는 이 시각부터 흐른 monotonic 시간이다
  transcript  전사가 끝나면 회의록 경로
  tasks       할일 추출까지 됐으면 그 결과 파일 경로

전사 뒤 할일 추출(extract/, #30)을 같은 자리에서 잇는다. LLM 설정이 없으면 건너뛴다.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from capture.recording_store import write_manifest
from shared.config import TRANSCRIPTS_DIR
from shared.schemas import now_iso

STATUS_RECORDING = "recording"
STATUS_SAVED = "saved"
STATUS_TRANSCRIBED = "transcribed"
STATUS_FAILED = "failed"


class NullSession:
    """StreamingSink 가 요구하는 session 자리. 회의 중 전사가 없으니 받은 조각을 버린다."""

    def feed(self, *args, **kwargs) -> None:
        return None


def manifest_path(recordings_dir: Path, ts: int) -> Path:
    return recordings_dir / f"session_{ts}.json"


def write_status(recordings_dir: Path, ts: int, *, status: str, entries: list[dict],
                 guild: str | None, channel: str | None, library_version: str | None,
                 started_at: str | None, meeting_dir: str, transcript: str | None = None) -> tuple[Path, dict]:
    """매니페스트를 통째로 다시 쓴다. 상태가 바뀔 때마다 부른다."""
    path, manifest = write_manifest(entries, recordings_dir, ts=ts, guild=guild, channel=channel,
                                    library_version=library_version)
    manifest.update({"status": status, "started_at": started_at, "meeting_dir": meeting_dir})
    if transcript is not None:
        manifest["transcript"] = transcript
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return path, manifest


def backend_from_env() -> tuple[object, str, int]:
    """(백엔드, 모델 이름, 워커 수). MM_STT_BACKEND=local|elice, MM_STT_MODEL 로 고른다."""
    from stt import batch as B
    kind = os.environ.get("MM_STT_BACKEND", "local")
    model = os.environ.get("MM_STT_MODEL", "large-v3-turbo")
    backend = B.make_backend(kind, model, "chunk")
    return backend, ("elice" if kind == "elice" else model), B.default_workers(kind)


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
    """전사가 안 끝난 매니페스트. 봇이 죽었거나 전사가 실패한 회의가 여기 남는다."""
    out = []
    for p in sorted(recordings_dir.glob("session_*.json")):
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if m.get("status") in (STATUS_RECORDING, STATUS_SAVED, STATUS_FAILED) and m.get("speakers"):
            if all((recordings_dir / e["file"]).exists() for e in m["speakers"]):
                out.append(p)
    return out


def recover(recordings_dir: Path, *, backend, model_name: str, workers: int, gate=None,
            transcripts_dir: Path | None = None) -> list[dict]:
    """남은 회의를 전사하고 매니페스트 상태를 갱신한다. 결과마다 {session, status, markdown|error}."""
    done = []
    for p in pending_sessions(recordings_dir):
        m = json.loads(p.read_text(encoding="utf-8"))
        try:
            out = transcribe_session(recordings_dir, m, backend=backend, model_name=model_name,
                                     workers=workers, gate=gate, transcripts_dir=transcripts_dir)
            m["status"] = STATUS_TRANSCRIBED
            m["transcript"] = str(out["markdown"].relative_to(recordings_dir))
            done.append({"session": m["session"], "status": STATUS_TRANSCRIBED, "markdown": out["markdown"]})
        except Exception as e:  # 한 회의가 실패해도 나머지는 마저 돈다
            m["status"] = STATUS_FAILED
            m["error"] = f"{type(e).__name__}: {e}"
            done.append({"session": m["session"], "status": STATUS_FAILED, "error": m["error"]})
        p.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
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

    def run(transcript, speaker_names):
        return extract_tasks(transcript, client=client, model=cfg.llm_model, speaker_names=speaker_names)

    return run


def extract_after_transcription(transcripts_dir: Path, manifest: dict, *, extractor=None) -> Path | None:
    """전사 결과(Transcript)에서 할일을 뽑아 transcripts/session_<ts>.tasks.json 에 쓴다.

    extractor(transcript, speaker_names) -> list[ExtractedTask]. 없으면 build_extractor() 로 만들고,
    그것도 없으면 아무것도 안 하고 None 을 돌려준다. 회의록은 이미 나와 있으므로 여기서 실패해도
    전사 결과는 그대로다.
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
    tasks = extractor(transcript, names)
    out = transcripts_dir / f"session_{ts}.tasks.json"
    out.write_text(json.dumps([t.to_dict() if hasattr(t, "to_dict") else t for t in tasks],
                              ensure_ascii=False, indent=2), encoding="utf-8")
    return out
