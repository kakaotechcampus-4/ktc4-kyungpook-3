"""디스코드 음성 수신 진입점.

py-cord 는 write(data, user) 를 봇의 asyncio 이벤트 루프에서 부른다 (소켓 리더
스레드는 콜백을 `loop.create_task` 로 넘길 뿐 직접 부르지 않는다). 여기서 무거운
일을 하면 게이트웨이 하트비트와 슬래시 응답까지 밀리고, 하트비트가 밀리면 음성
연결이 끊긴다. write 안에서는 잡음 필터, PCM 변환, 재정렬, session.feed (VAD +
큐 put) 까지만 한다. 파일 IO, 모델 호출, 큐 대기는 여기서 하지 않는다.

발화 위치는 도착 시각이 정한다. now_ms 를 주입할 수 있어 오프라인 리플레이가
같은 코드로 시간축을 재현한다. 실제 봇은 monotonic 을 쓴다.

WaveSink 를 쓰지 않는 이유는 녹음이 끝난 뒤에야 오디오를 통째로 주기 때문이다.
발화 도중에 꺼낼 훅이 없어 실시간 경로를 올릴 수 없다.

discord.sinks.Sink 를 직접 상속한다. py-cord 가 받는 바로 그 객체를 오프라인
하니스가 검증해야 하므로 여기서 상속을 끊지 않는다.
"""

from __future__ import annotations

import statistics
import threading
import time

import discord

from capture.audio import pcm_to_mono16k
from capture.timeline import Reorderer, is_noise_packet

GAP_MS = 60  # 20ms 패킷 세 개. 이보다 벌어지면 화자 하나가 끊긴 것으로 센다


class StreamingSink(discord.sinks.Sink):
    """상속받은 audio_data 는 채우지 않는다 — write() 는 실시간 경로로 session.feed
    까지만 넘기고 파일을 쌓지 않는다. 이 sink 를 넘긴 finished_callback 이 다른
    Sink 처럼 audio_data.items() 를 순회해 트랙을 저장하려 하면 조용히 0건이
    된다. 저장은 finished_callback 이 아니라 session.feed 로 이미 흐르고 있다.
    """

    def __init__(self, session, now_ms=None, on_samples=None) -> None:
        super().__init__()
        self.session = session
        t0 = time.monotonic()
        self.now_ms = now_ms or (lambda: int((time.monotonic() - t0) * 1000))
        # 같은 PCM 을 두 번째 소비자에게 넘기는 자리. 기본은 아무 일도 안 한다.
        # 이벤트 루프에서 불리므로 훅은 논블로킹이어야 한다 (voice/state.py:189-198).
        self.on_samples = on_samples or (lambda uid, samples, offset_ms: None)
        self.packets = 0
        self.noise_packets = 0
        self.quiet_packets = 0
        self.write_errors = 0
        self.unattributed = 0
        self.feed_errors = 0
        self.peak_rms = 0.0
        self._reorder: dict[int, Reorderer] = {}
        self._names: dict[int, str] = {}
        self._last_arrival: dict[int, int] = {}
        self._gaps: dict[int, list[int]] = {}
        self._speaker_packets: dict[int, int] = {}
        self._speaker_quiet: dict[int, int] = {}
        # 모듈 최상단에서 읽으면 shared.config 가 .env 를 넣기 전이라 MM_SPEECH_RMS 가 무시된다.
        from stt.vad import SPEECH_RMS
        self._speech_rms = SPEECH_RMS
        self._lock = threading.Lock()
        self.finished = False

    def is_opus(self) -> bool:
        """False 를 주면 py-cord 가 디코딩된 PCM 을 즉시 넘긴다 (router.py:82 경로)."""
        return False

    def write(self, data, user) -> None:
        try:
            self._write(data, user)
        except Exception as exc:
            with self._lock:
                self.write_errors += 1
                first = self.write_errors == 1
            if first:
                print(f"[sink] write 예외: {type(exc).__name__}: {exc}")

    def _write(self, data, user) -> None:
        uid = getattr(user, "id", user)
        if uid is None:
            with self._lock:
                self.unattributed += 1
            return
        pcm = getattr(data, "pcm", data)
        if not pcm:
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
            self._speaker_packets[uid] = self._speaker_packets.get(uid, 0) + 1
            if rms < self._speech_rms:
                self.quiet_packets += 1
                self._speaker_quiet[uid] = self._speaker_quiet.get(uid, 0) + 1
            previous = self._last_arrival.get(uid)
            self._last_arrival[uid] = arrival_ms
            if previous is not None and arrival_ms - previous > GAP_MS:
                self._gaps.setdefault(uid, []).append(arrival_ms - previous)
            self._names[uid] = name
            ro = self._reorder.get(uid)
            if ro is None:
                ro = self._reorder[uid] = Reorderer()
            released = ro.push(rtp_ts, (samples, arrival_ms))

        for s, at in released:
            # session.feed 가 먼저다. 훅이 실패하면 wav 한 조각을 잃지만, feed 를
            # 건너뛰면 전사 줄을 잃는다.
            self.session.feed(str(uid), name, s, at)
            self.on_samples(uid, s, at)

    def drain_speaker(self, uid: int) -> None:
        """이 화자의 재정렬 창을 비운다. 퇴장 시 flush_speaker 보다 먼저 부른다.

        write() 와 달리 이 경로는 py-cord 의 예외 삼키기 대상이 아니라 cleanup()
        에서 직접 불린다. session.feed 가 여기서 죽어도 남은 항목은 계속 흘려보내야
        해서 항목 단위로 감싼다. on_samples 도 같은 try 안이라 훅의 예외까지
        feed_errors 로 세어진다 — 밖으로 내보내면 cleanup() 이 다시 올리고 py-cord 는
        자기 로거에만 남긴다.
        """
        uid = int(uid)
        with self._lock:
            ro = self._reorder.get(uid)
            released = ro.flush() if ro else []
            name = self._names.get(uid, str(uid))
        for s, at in released:
            try:
                self.session.feed(str(uid), name, s, at)
                self.on_samples(uid, s, at)
            except Exception as exc:
                with self._lock:
                    self.feed_errors += 1
                    first = self.feed_errors == 1
                if first:
                    print(f"[sink] feed 예외: {type(exc).__name__}: {exc}")

    def drain(self) -> None:
        """모든 재정렬 창을 비운다. 종료 시 session.close() 보다 먼저 부른다."""
        with self._lock:
            uids = list(self._reorder)
        for uid in uids:
            self.drain_speaker(uid)

    def cleanup(self) -> None:
        """py-cord 가 stop_recording 뒤에 부른다.

        라우터 스레드 또는 이벤트 루프 스레드 어느 쪽에서나 불릴 수 있어 _lock 이 필요하다.
        drain() 이 (drain_speaker 가 못 잡는) 다른 이유로 예외를 내도 finished 는
        세팅돼야 py-cord 의 대기가 안 걸린다.
        """
        try:
            self.drain()
        finally:
            self.finished = True

    def level_report(self) -> dict:
        """수신 통계. top_* 는 음성 패킷이 제일 많은 화자, 즉 실제로 말한 사람 것이다.

        한 방에 스트림이 둘 이상이면 집계 공백에 말하지 않는 쪽의 긴 침묵이 섞여
        말한 사람의 끊김을 덮는다. 집계 키는 다른 호출자를 위해 그대로 둔다.
        """
        from stt.vad import SPEECH_RMS

        verdict = "정상" if self.peak_rms > SPEECH_RMS * 1.5 else "너무 낮음"
        with self._lock:
            per_speaker = {uid: list(g) for uid, g in self._gaps.items()}
            counts = dict(self._speaker_packets)
            quiet = dict(self._speaker_quiet)
        gaps = [g for one in per_speaker.values() for g in one]
        # 같은 패킷 수면 uid 로 가른다. 정하지 않으면 같은 입력이 실행마다 다른 줄을 낸다.
        top = max(counts, key=lambda u: (counts[u], u)) if counts else None
        top_gaps = sorted(per_speaker.get(top, [])) if top is not None else []
        return {
            "packets": self.packets,
            "noise_packets": self.noise_packets,
            "quiet_packets": self.quiet_packets,
            "gaps": len(gaps),
            "max_gap_ms": max(gaps) if gaps else 0,
            "median_gap_ms": round(statistics.median(gaps)) if gaps else 0,
            "speakers": len(counts),
            "top_packets": counts.get(top, 0),
            "top_quiet_packets": quiet.get(top, 0),
            "top_gaps": len(top_gaps),
            "top_max_gap_ms": max(top_gaps) if top_gaps else 0,
            "top_median_gap_ms": round(statistics.median(top_gaps)) if top_gaps else 0,
            "top_gap_sizes": top_gaps,
            "write_errors": self.write_errors,
            "unattributed": self.unattributed,
            "feed_errors": self.feed_errors,
            "peak_rms": self.peak_rms,
            "speech_rms": SPEECH_RMS,
            "verdict": verdict,
        }
