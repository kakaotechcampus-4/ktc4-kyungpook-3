"""녹음 결과 저장 (플랫폼 비종속 부분).

discord_adapter 가 sink 에서 꺼낸 (user_id, raw bytes) 를 받아
  recordings/{user_id}_{ts}.wav        화자별 wav
  recordings/session_{ts}.json         세션 매니페스트 (user_id ↔ 표시 이름, 파일, 길이)
로 저장합니다. discord 모듈에 의존하지 않으므로 단위 테스트가 가능합니다.
"""

from __future__ import annotations

import io
import json
import time
import wave
from dataclasses import dataclass
from pathlib import Path

# Discord 음성 디코더 출력 포맷 (py-cord OpusDecoder 상수와 동일)
PCM_RATE = 48000
PCM_CHANNELS = 2
PCM_SAMPLE_WIDTH = 2  # 16-bit


def key_to_user_id(key) -> int | None:
    """sink.audio_data 의 key: py-cord 2.6 은 int(user_id), 2.9 는 Member/User 객체(또는 None)."""
    if key is None:
        return None
    if isinstance(key, int):
        return key
    uid = getattr(key, "id", None)
    return int(uid) if uid is not None else None


def to_wav_bytes(raw: bytes) -> bytes:
    """WaveSink 가 이미 WAV 로 포맷했으면 그대로, 아직 raw PCM 이면 헤더를 붙입니다."""
    if raw[:4] == b"RIFF":
        return raw
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(PCM_CHANNELS)
        w.setsampwidth(PCM_SAMPLE_WIDTH)
        w.setframerate(PCM_RATE)
        w.writeframes(raw)
    return buf.getvalue()


def wav_duration_sec(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as w:
            rate = w.getframerate()
            return w.getnframes() / rate if rate else 0.0
    except wave.Error:
        return 0.0


@dataclass
class Track:
    user_id: str
    display_name: str
    raw: bytes


def write_manifest(entries: list[dict], recordings_dir: Path, *, ts: int,
                    guild: str | None, channel: str | None,
                    library_version: str | None) -> tuple[Path, dict]:
    """매니페스트를 저장하고 (매니페스트 경로, 매니페스트 dict) 를 반환합니다."""
    recordings_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "session": str(ts),
        "guild": guild,
        "channel": channel,
        "recorded_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)),
        "library_version": library_version,
        "speakers": entries,
    }
    manifest_path = recordings_dir / f"session_{ts}.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path, manifest


def save_session(tracks: list[Track], recordings_dir: Path, *, ts: int | None = None,
                 guild: str | None = None, channel: str | None = None,
                 library_version: str | None = None) -> tuple[Path, dict]:
    """화자별 wav + 매니페스트를 저장하고 (매니페스트 경로, 매니페스트 dict) 를 반환합니다.

    빈 트랙은 건너뜁니다. 저장된 화자가 0명이어도 매니페스트는 남깁니다(문제 진단용).
    """
    ts = int(time.time()) if ts is None else ts
    recordings_dir.mkdir(parents=True, exist_ok=True)

    entries: list[dict] = []
    for t in tracks:
        if not t.raw:
            continue
        path = recordings_dir / f"{t.user_id}_{ts}.wav"
        path.write_bytes(to_wav_bytes(t.raw))
        entries.append({
            "user_id": str(t.user_id),
            "display_name": t.display_name,
            "file": path.name,
            "duration_sec": round(wav_duration_sec(path), 2),
        })

    return write_manifest(entries, recordings_dir, ts=ts, guild=guild, channel=channel,
                           library_version=library_version)
