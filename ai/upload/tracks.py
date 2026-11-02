"""오디오를 읽어 16k mono 로 맞추고, 화자 라벨마다 원본 길이의 가상 트랙 wav 를 쓴다."""

from __future__ import annotations

import re
from pathlib import Path

import av
import numpy as np
import soundfile as sf

from upload.diarize import Segment

SR = 16000


def _decode_mono_16k(path: Path):
    """PyAV 로 스트리밍 디코딩하며 16k 로 리샘플한다. 프레임 조각(float32 mono)을 낸다."""
    try:
        container = av.open(str(path))
    except (av.error.FFmpegError, OSError, ValueError) as e:
        raise ValueError(f"오디오를 열 수 없다: {path} ({e})") from e
    try:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            raise ValueError(f"오디오 스트림이 없다: {path}")
        resampler = av.AudioResampler(format="fltp", rate=SR)  # 레이아웃은 그대로 둔다: swresample 다운믹스 계수(0.707)를 피하고 직접 평균한다
        try:
            for frame in container.decode(stream):
                for out in resampler.resample(frame):
                    yield out.to_ndarray().mean(axis=0)
            for out in resampler.resample(None):
                yield out.to_ndarray().mean(axis=0)
        except (av.error.FFmpegError, OSError) as e:
            raise ValueError(f"오디오 디코딩에 실패했다: {path} ({e})") from e
    finally:
        container.close()


def load_mono_16k(path: Path) -> tuple[np.ndarray, float]:
    """(float32 mono 16k 배열, 길이 초). PyAV 로 어떤 형식이든 스트리밍 디코딩하고,
    채널은 평균(mono 다운믹스), 16k 로 리샘플한다. 열거나 디코딩하지 못하면 ValueError."""
    chunks = [c.astype(np.float32, copy=False) for c in _decode_mono_16k(path)]
    audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    if len(audio) == 0:
        raise ValueError(f"디코딩된 오디오가 비어 있다: {path}")
    return audio, len(audio) / SR


def to_wav_16k(src: Path, dst: Path) -> float:
    """src 를 16k mono PCM_16 wav 로 dst 에 쓴다. 길이(초)를 돌려준다."""
    audio, total = load_mono_16k(src)
    sf.write(str(dst), audio, SR, subtype="PCM_16")
    return total


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
