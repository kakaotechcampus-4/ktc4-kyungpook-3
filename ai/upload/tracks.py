"""오디오를 읽어 16k mono 로 맞추고, 화자 라벨마다 원본 길이의 가상 트랙 wav 를 쓴다."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import soundfile as sf

from upload.diarize import Segment

SR = 16000


def load_mono_16k(path: Path) -> tuple[np.ndarray, float]:
    """(float32 mono 16k 배열, 길이 초). 채널은 평균, 16k 가 아니면 resample_poly."""
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    audio = data.mean(axis=1)
    if sr != SR:
        from math import gcd

        from scipy.signal import resample_poly

        g = gcd(SR, sr)
        audio = resample_poly(audio, SR // g, sr // g).astype(np.float32)
    return audio, len(audio) / SR


def speaker_label_id(label: str) -> str:
    """밑줄을 빼 wav 이름 규칙({id}_{ts}.wav)을 깨지 않게 한다.
    숫자만 남으면 플랫폼 uid 와 겹칠 수 있어 S 를 붙인다."""
    ident = re.sub(r"[^0-9A-Za-z]", "", label.replace("_", ""))
    if not ident:
        raise ValueError(f"화자 라벨에서 쓸 수 있는 글자가 없다: {label!r}")
    return f"S{ident}" if ident.isdigit() else ident


def write_virtual_tracks(audio: np.ndarray, segments: list[Segment], out_dir: Path, ts: str) -> list[dict]:
    """라벨당 {id}_{ts}.wav (PCM_16 16k mono, 원본과 같은 프레임 수). 자기 구간만 원본, 나머지 0.
    구간이 없는 라벨은 파일을 만들지 않는다. 반환은 speakers 항목 목록."""
    out_dir.mkdir(parents=True, exist_ok=True)
    labels: dict[str, list[Segment]] = {}
    for s in segments:
        labels.setdefault(s.label, []).append(s)
    n = len(audio)
    ids: dict[str, str] = {}
    for label in labels:
        uid = speaker_label_id(label)
        if uid in ids:
            raise ValueError(f"서로 다른 화자 라벨이 같은 id {uid!r} 로 접힌다: {ids[uid]!r}, {label!r}")
        ids[uid] = label
    entries: list[dict] = []
    for label, segs in labels.items():
        track = np.zeros(n, dtype=np.float32)
        for s in segs:
            a, b = max(0, int(round(s.start_s * SR))), min(n, int(round(s.end_s * SR)))
            if b > a:
                track[a:b] = audio[a:b]
        uid = speaker_label_id(label)
        name = f"{uid}_{ts}.wav"
        sf.write(str(out_dir / name), track, SR, subtype="PCM_16")
        entries.append({"user_id": uid, "display_name": label, "file": name, "duration_sec": n / SR})
    return entries
