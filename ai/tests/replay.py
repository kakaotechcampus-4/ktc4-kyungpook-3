"""녹음 wav 를 실제 디스코드 패킷 흐름처럼 sink 에 흘린다.

디스코드에 들어가지 않고 sink 위쪽 전부를 검증하기 위한 것이다.
py-cord 는 router.py 에서 sink.write(VoiceData, VoiceData.source) 를 부르고,
VoiceData 는 .packet(.timestamp, .ssrc) · .source(.id, .display_name) · .pcm 을 갖는다.

시간축은 sink 가 아니라 여기서 정한다. 이벤트마다 clock["now_ms"] 를 그 슬롯의
회의 시각으로 올린 뒤 sink_write 를 부른다. sink 는 now_ms 를 주입받아 그 값을
도착 시각으로 쓴다. 실제 봇은 monotonic 을 쓴다.

py-cord PR#3159 은 무음 구간에 패킷을 만들지 않지만, 디스코드가 Opus 침묵 프레임을
보내기도 한다(Craig onData:791). emit_silence_frames 로 두 경우를 다 재현한다.
sink 는 is_opus() 가 False 라 이미 디코딩된 PCM 을 받으므로, 침묵 프레임도 원문
오퍼스 바이트가 아니라 디코딩된 모양(DECODED_SILENCE_FRAME)으로 흘린다.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

SR = 16_000
PACKET_MS = 20
RTP_CLOCK_HZ = 48_000
# 디코딩된 침묵 프레임 (20ms 스테레오 48kHz 프레임과 같은 길이 — _to_discord_bytes 참고).
# is_opus() 가 False 인 경로에서 디스코드 침묵 프레임은 이미 이 모양으로 풀려 온다.
DECODED_SILENCE_FRAME = b"\x00" * 3840


@dataclass
class FakePacket:
    timestamp: int
    ssrc: int


@dataclass
class FakeMember:
    id: int
    display_name: str


@dataclass
class FakeVoiceData:
    packet: FakePacket
    source: FakeMember
    pcm: bytes


@dataclass
class ReplayTrack:
    user_id: int
    name: str
    samples: np.ndarray            # 16kHz 모노 float32
    start_ms: int = 0              # 회의 시작 기준 이 트랙의 첫 패킷 시각
    ssrc: int = 0
    rtp_origin: int = 12345        # SSRC 마다 난수인 원점을 흉내낸다
    drop_rate: float = 0.0         # 패킷 유실률
    silent_below: float = 0.0      # 이 RMS 아래면 무음 구간으로 본다
    emit_silence_frames: bool = False  # 무음 구간에 패킷을 안 보내는 대신 침묵 프레임을 보낸다
    shuffle_pairs: bool = False    # 인접 패킷 쌍의 도착 순서를 뒤집는다 (순서 뒤바뀜 재현)


def _to_discord_bytes(mono16k: np.ndarray) -> bytes:
    """16kHz 모노 float32 → 48kHz 스테레오 int16 바이트. pcm_to_mono16k 의 역."""
    up = np.repeat(mono16k, 3)
    i16 = np.clip(up * 32768.0, -32768, 32767).astype("<i2")
    return np.repeat(i16, 2).tobytes()


def replay(tracks: list[ReplayTrack], sink_write, clock: dict | None = None,
           rng_seed: int = 0, pace: bool = False) -> None:
    """pace=True 면 각 이벤트를 그 슬롯 시각까지 기다렸다 넘긴다.

    기본값(False)은 순간 주입이라 테스트가 빠르다. 대신 그때 잰 "첫 줄까지" 는 체감
    지연이 아니라 워커가 큐를 비우는 시간이다. 체감 지연을 재려면 오디오가 실제
    속도로 흘러야 한다.
    """
    rng = np.random.default_rng(rng_seed)
    n = SR * PACKET_MS // 1000

    events = []  # (at_ms, track, rtp, pcm_bytes)
    for tr in tracks:
        for i in range(0, len(tr.samples) - n + 1, n):
            chunk = tr.samples[i : i + n]
            at_ms = tr.start_ms + i * 1000 // SR
            rtp = (tr.rtp_origin + i * RTP_CLOCK_HZ // SR) & 0xFFFFFFFF
            is_silent = tr.silent_below and float(np.sqrt(np.mean(chunk * chunk))) < tr.silent_below
            if is_silent:
                if tr.emit_silence_frames:
                    events.append((at_ms, tr, rtp, DECODED_SILENCE_FRAME))
                continue
            if tr.drop_rate and rng.random() < tr.drop_rate:
                continue
            events.append((at_ms, tr, rtp, _to_discord_bytes(chunk)))

    events.sort(key=lambda e: e[0])
    slots = [e[0] for e in events]

    for tr in tracks:
        if not tr.shuffle_pairs:
            continue
        idx = [k for k, e in enumerate(events) if e[1] is tr]
        for a, b in zip(idx[0::2], idx[1::2]):
            events[a], events[b] = events[b], events[a]

    t0 = time.monotonic()
    for k, (_at, tr, rtp, pcm) in enumerate(events):
        if pace:
            delay = t0 + slots[k] / 1000 - time.monotonic()
            if delay > 0:
                time.sleep(delay)
        if clock is not None:
            clock["now_ms"] = slots[k]
        data = FakeVoiceData(
            packet=FakePacket(timestamp=rtp, ssrc=tr.ssrc or tr.user_id),
            source=FakeMember(id=tr.user_id, display_name=tr.name),
            pcm=pcm,
        )
        sink_write(data, data.source)
