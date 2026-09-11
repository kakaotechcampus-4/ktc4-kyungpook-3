"""디스코드 음성 수신 진입점.

py-cord 는 소켓 수신 스레드에서 write(data, user) 를 부른다. 여기서 무거운 일을
하면 패킷을 흘린다. 잡음 필터, PCM 변환, 재정렬까지만 하고 나머지는 Session 에 넘긴다.

발화 위치는 도착 시각이 정한다. now_ms 를 주입할 수 있어 오프라인 리플레이가
같은 코드로 시간축을 재현한다. 실제 봇은 monotonic 을 쓴다.

WaveSink 를 쓰지 않는 이유는 녹음이 끝난 뒤에야 오디오를 통째로 주기 때문이다.
발화 도중에 꺼낼 훅이 없어 실시간 경로를 올릴 수 없다.

discord 를 import 하지 않는다. discord.sinks.Sink 와의 결합은 discord_adapter.py 가 한다.
"""

from __future__ import annotations

import threading
import time

from capture.audio import pcm_to_mono16k
from capture.timeline import Reorderer, is_noise_packet


class StreamingSink:
    def __init__(self, session, now_ms=None) -> None:
        self.session = session
        t0 = time.monotonic()
        self.now_ms = now_ms or (lambda: int((time.monotonic() - t0) * 1000))
        self.packets = 0
        self.noise_packets = 0
        self.peak_rms = 0.0
        self._reorder: dict[int, Reorderer] = {}
        self._names: dict[int, str] = {}
        self._lock = threading.Lock()
        self.finished = False
        self.audio_data: dict = {}  # py-cord Sink 인터페이스가 기대하는 속성

    def is_opus(self) -> bool:
        """False 를 주면 py-cord 가 디코딩된 PCM 을 즉시 넘긴다 (router.py:82 경로)."""
        return False

    def write(self, data, user) -> None:
        pcm = getattr(data, "pcm", data)
        uid = getattr(user, "id", user)
        if uid is None or not pcm:
            return
        raw = bytes(pcm)
        if is_noise_packet(raw):
            with self._lock:
                self.noise_packets += 1
            return
        samples = pcm_to_mono16k(raw)
        if samples.size == 0:
            return

        arrival_ms = self.now_ms()
        rtp_ts = getattr(getattr(data, "packet", None), "timestamp", None)
        name = getattr(user, "display_name", None) or str(uid)
        uid = int(uid)

        with self._lock:
            self.packets += 1
            rms = float((samples * samples).mean() ** 0.5)
            self.peak_rms = max(self.peak_rms, rms)
            self._names[uid] = name
            ro = self._reorder.get(uid)
            if ro is None:
                ro = self._reorder[uid] = Reorderer()
            released = ro.push(rtp_ts, (samples, arrival_ms))

        for s, at in released:
            self.session.feed(str(uid), name, s, at)

    def drain_speaker(self, uid: int) -> None:
        """이 화자의 재정렬 창을 비운다. 퇴장 시 flush_speaker 보다 먼저 부른다."""
        with self._lock:
            ro = self._reorder.get(int(uid))
            released = ro.flush() if ro else []
            name = self._names.get(int(uid), str(uid))
        for s, at in released:
            self.session.feed(str(uid), name, s, at)

    def drain(self) -> None:
        """모든 재정렬 창을 비운다. 종료 시 session.close() 보다 먼저 부른다."""
        with self._lock:
            uids = list(self._reorder)
        for uid in uids:
            self.drain_speaker(uid)

    def cleanup(self) -> None:
        """py-cord 가 stop_recording 뒤에 부른다."""
        self.drain()
        self.finished = True

    def level_report(self) -> str:
        from stt.vad import SPEECH_RMS

        verdict = "정상" if self.peak_rms > SPEECH_RMS * 1.5 else "너무 낮음"
        return (
            f"패킷 {self.packets}건 · 잡음 {self.noise_packets}건 · "
            f"최대 RMS {self.peak_rms:.4f} / 임계 {SPEECH_RMS:.4f} → {verdict}"
        )
