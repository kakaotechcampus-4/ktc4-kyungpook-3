import discord
import numpy as np
import pytest

from capture.streaming_sink import StreamingSink
from capture.timeline import REORDER_WINDOW
from stt.backend import SttResult
from stt.session import Session
from tests.replay import (
    DECODED_SILENCE_FRAME,
    PACKET_MS,
    FakeMember,
    FakePacket,
    FakeVoiceData,
    ReplayTrack,
    _to_discord_bytes,
    replay,
)

SR = 16_000


class FakeStt:
    name = "fake"

    def transcribe(self, samples, sample_rate):
        return SttResult(text="x", words=[])


class FeedCountingSession(Session):
    """sink 가 session.feed 를 실제로 부른 횟수를 센다.

    줄이 안 나온 것과 sink 가 아직 아무것도 안 넘긴 것은 다르다. 재정렬 창이
    잡고 있는지 보려면 넘긴 횟수를 직접 세야 한다.
    """

    def __init__(self, *args, **kwargs):
        self.feeds = 0
        super().__init__(*args, **kwargs)

    def feed(self, speaker_id, speaker_name, samples, offset_ms):
        self.feeds += 1
        super().feed(speaker_id, speaker_name, samples, offset_ms)


def tone(ms, amp=0.3):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def test_sink_write_reaches_session():
    lines = []
    session = Session(final_stt=FakeStt(), on_line=lines.append, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    replay([ReplayTrack(user_id=7, name="김환", samples=tone(1_500), ssrc=70)], sink.write, clock=clock)
    sink.drain()
    session.close()
    assert any(ln.final and ln.speaker_id == "7" for ln in lines)


def test_is_opus_is_false():
    # py-cord 는 is_opus() 가 False 일 때만 디코딩된 48kHz 스테레오 PCM 을 write() 로 넘긴다.
    assert StreamingSink(session=None).is_opus() is False


def test_sink_ignores_empty_pcm():
    session = Session(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session)
    m = FakeMember(1, "A")
    sink.write(FakeVoiceData(FakePacket(0, 1), m, b""), m)
    # 빈 페이로드는 is_noise_packet 에 닿기 전에 write() 가 먼저 돌려보낸다. 잡음으로도 안 센다.
    assert sink.packets == 0
    assert sink.noise_packets == 0
    # 뒤이어 정상 패킷이 세어져야 write() 가 통째로 no-op 인 경우를 잡는다.
    sink.write(FakeVoiceData(FakePacket(960, 1), m, _to_discord_bytes(tone(PACKET_MS))), m)
    session.close()
    assert sink.packets == 1
    assert sink.noise_packets == 0


def test_silence_frame_is_counted_as_noise_not_audio():
    """디스코드가 보내는 Opus 침묵 프레임. py-cord 는 이걸 sink 까지 넘긴다."""
    session = Session(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session)
    m = FakeMember(1, "A")
    sink.write(FakeVoiceData(FakePacket(0, 1), m, DECODED_SILENCE_FRAME), m)
    sink.write(FakeVoiceData(FakePacket(960, 1), m, b"\x00" * 3839 + b"\x01"), m)
    session.close()
    assert sink.packets == 0
    assert sink.noise_packets == 2


def test_cleanup_drains_pending_packets():
    """py-cord 가 stop_recording 뒤에 부르는 cleanup. 재정렬 창을 비워야 한다.

    창 크기만큼만 넣으면 sink 는 아직 session 에 아무것도 넘기지 않는다. cleanup 이
    drain 을 안 하면 화자마다 마지막 발언이 통째로 사라진다. 화자를 둘 두는 이유는
    drain 이 창 하나가 아니라 전부를 비우는지 보기 위해서다.

    창 크기 × 20ms 가 MIN_SPEECH_MS 이상이어야 발화로 확정된다. 지금은 16 × 20 = 320ms
    로 딱 걸쳐 있으니 창을 줄이면 이 테스트부터 깨진다.
    """
    held = REORDER_WINDOW
    lines = []
    session = FeedCountingSession(final_stt=FakeStt(), on_line=lines.append, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    tracks = [
        ReplayTrack(user_id=5, name="박", samples=tone(1_000)[: held * 320], ssrc=50),
        ReplayTrack(user_id=6, name="최", samples=tone(1_000)[: held * 320], ssrc=60),
    ]
    replay(tracks, sink.write, clock=clock)

    assert sink.packets == 2 * held
    assert session.feeds == 0      # 전부 재정렬 창에 잡혀 있다
    assert not [ln for ln in lines if ln.final]
    assert sink.finished is False

    sink.cleanup()
    session.close()

    assert session.feeds == 2 * held
    finals = [ln for ln in lines if ln.final]
    assert {ln.speaker_id for ln in finals} == {"5", "6"}
    assert len(finals) == 2
    assert sink.finished is True


def test_on_samples_sees_everything_session_feed_sees():
    fed, hooked = [], []

    class Rec:
        def feed(self, sid, name, samples, offset_ms):
            fed.append((sid, len(samples), offset_ms))

    clock = {"now_ms": 0}
    sink = StreamingSink(Rec(), now_ms=lambda: clock["now_ms"],
                         on_samples=lambda uid, s, at: hooked.append((str(uid), len(s), at)))
    replay([ReplayTrack(user_id=7, name="김환", samples=tone(1_000), ssrc=70)], sink.write, clock=clock)
    sink.drain()          # 재정렬 창에 남아 있던 것까지
    assert fed and fed == hooked


def test_drain_speaker_hands_the_hook_an_int_uid():
    """훅이 받는 uid 는 write 경로와 같은 int 여야 한다.

    drain_speaker 는 자기 조회에만 int(uid) 를 쓴다. 원본 uid 를 그대로 훅에 넘기면
    문자열로 부른 호출자 하나가 같은 경로에 TrackWriter 를 하나 더 열고, 같은 wav 를
    두 핸들이 동시에 쓴다.
    """
    got = []

    class Rec:
        def feed(self, sid, name, samples, offset_ms):
            pass

    sink = StreamingSink(Rec(), on_samples=lambda uid, s, at: got.append(uid))
    m = FakeMember(7, "A")
    for _ in range(REORDER_WINDOW):
        sink.write(_to_discord_bytes(tone(PACKET_MS)), m)
    sink.drain_speaker("7")
    assert got and all(u == 7 and isinstance(u, int) for u in got)


def test_arrival_time_is_the_position():
    """RTP 원점이 무엇이든 위치는 now_ms 가 정한다."""
    lines = []
    session = Session(final_stt=FakeStt(), on_line=lines.append, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    tr = ReplayTrack(user_id=1, name="A", samples=tone(1_000), start_ms=42_000,
                     ssrc=11, rtp_origin=0xDEADBEEF)
    replay([tr], sink.write, clock=clock)
    sink.drain()
    session.close()
    finals = [ln for ln in lines if ln.final]
    assert len(finals) == 1
    assert 41_500 <= finals[0].start_ms <= 42_500


def test_level_report_verdict_flips_with_peak_rms():
    """verdict 는 peak_rms 값에 실제로 반응해야 한다.

    이전 버전은 verdict 가 두 문자열 중 하나인지만 봐서 삼항 조건의 방향을
    뒤집거나 임계 배수를 바꿔도 통과했다. peak_rms 를 임계 위/아래로 직접
    옮겨 verdict 가 실제로 바뀌는지 본다.
    """
    from stt.vad import SPEECH_RMS

    session = Session(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session)
    session.close()

    sink.peak_rms = SPEECH_RMS * 2.0
    assert sink.level_report()["verdict"] == "정상"

    sink.peak_rms = SPEECH_RMS * 0.5
    assert sink.level_report()["verdict"] == "너무 낮음"


def test_packet_gaps_are_measured_per_speaker():
    """말하다 쉬면 도착 시각이 벌어진다. 그 벌어짐을 화자별로 센다."""
    session = FeedCountingSession(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    pkt = _to_discord_bytes(tone(PACKET_MS))
    for t in (0, 20, 40, 300, 320, 340):       # 40 → 300 사이가 260ms
        clock["now_ms"] = t
        sink.write(pkt, FakeMember(1, "a"))
    session.close()
    r = sink.level_report()
    assert r["gaps"] == 1
    assert r["max_gap_ms"] == 260
    assert r["median_gap_ms"] == 260
    assert r["quiet_packets"] == 0


def test_first_packet_from_a_speaker_is_not_a_gap():
    """직전 패킷이 없는 첫 패킷은 공백이 아니다. 0 에서 재면 5초짜리 공백이 생긴다."""
    session = FeedCountingSession(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session, now_ms=lambda: 5_000)
    sink.write(_to_discord_bytes(tone(PACKET_MS)), FakeMember(1, "a"))
    session.close()
    r = sink.level_report()
    assert r["packets"] == 1
    assert r["gaps"] == 0
    assert r["max_gap_ms"] == 0
    assert r["median_gap_ms"] == 0


def test_two_speakers_do_not_share_a_gap_clock():
    """화자 둘이 번갈아 오면 전체 도착 시각은 촘촘한데 각자는 끊겨 있다.

    시각을 공용으로 하나만 두면 간격이 50ms 라 공백이 0건이 된다. 화자별로 재야
    각자의 100ms 가 보인다.
    """
    session = FeedCountingSession(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    pkt = _to_discord_bytes(tone(PACKET_MS))
    for i, t in enumerate((0, 50, 100, 150, 200, 250)):
        clock["now_ms"] = t
        sink.write(pkt, FakeMember(1 + i % 2, "s"))
    session.close()
    r = sink.level_report()
    assert r["gaps"] == 4
    assert r["max_gap_ms"] == 100


def test_median_gap_is_the_middle_not_the_largest():
    """최대값 하나는 회의 시작 전 대기 같은 것에 쉽게 오염된다. 가운데가 숨 간격을 말한다."""
    session = FeedCountingSession(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    pkt = _to_discord_bytes(tone(PACKET_MS))
    for t in (0, 100, 300, 800):               # 공백 100, 200, 500
        clock["now_ms"] = t
        sink.write(pkt, FakeMember(1, "a"))
    session.close()
    r = sink.level_report()
    assert r["gaps"] == 3
    assert r["max_gap_ms"] == 500
    assert r["median_gap_ms"] == 200


def test_quiet_packets_are_counted_separately_from_noise():
    """디코딩까지 된 진짜 오디오인데 조용한 것. 침묵 프레임과는 다른 숫자여야 한다."""
    from stt.vad import SPEECH_RMS

    session = FeedCountingSession(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session)
    m = FakeMember(1, "a")
    sink.write(_to_discord_bytes(tone(PACKET_MS)), m)                        # 또렷
    sink.write(_to_discord_bytes(tone(PACKET_MS, amp=SPEECH_RMS * 0.4)), m)  # 조용
    r = sink.level_report()
    assert r["quiet_packets"] == 1
    assert r["packets"] == 2
    assert r["noise_packets"] == 0

    sink.write(DECODED_SILENCE_FRAME, m)
    session.close()
    r = sink.level_report()
    assert r["noise_packets"] == 1
    assert r["quiet_packets"] == 1
    assert r["packets"] == 2


def test_dominant_speaker_stats_leave_out_the_other_stream(monkeypatch):
    """방에 스트림이 둘이면 집계 공백은 말하지 않는 쪽 것이 섞여 주 화자를 덮는다.

    음성 패킷이 제일 많은 쪽이 실제로 말한 사람이다. 그 사람의 공백이 0건인데
    집계가 2건이면, 집계를 읽는 해석은 없는 끊김을 있다고 읽는다.
    """
    session = FeedCountingSession(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    pkt = _to_discord_bytes(tone(PACKET_MS))
    talker, other = FakeMember(1, "말한 사람"), FakeMember(2, "거의 조용한 쪽")
    for t in range(0, 200, 20):        # 10패킷, 끊김 없음
        clock["now_ms"] = t
        sink.write(pkt, talker)
    for t in (0, 1500, 2900):          # 공백 1500ms, 1400ms
        clock["now_ms"] = t
        sink.write(pkt, other)
    session.close()

    r = sink.level_report()
    assert r["speakers"] == 2
    assert (r["gaps"], r["max_gap_ms"]) == (2, 1500)    # 집계 키는 그대로 둔다
    assert r["top_packets"] == 10
    assert (r["top_gaps"], r["top_max_gap_ms"], r["top_median_gap_ms"]) == (0, 0, 0)
    assert r["top_gap_sizes"] == []


def test_dominant_speaker_quiet_packets_exclude_the_other_stream():
    """조용한 패킷도 화자별이어야 한다. 섞이면 해석이 다시 흐려진다."""
    from stt.vad import SPEECH_RMS

    session = FeedCountingSession(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    sink = StreamingSink(session)
    loud = _to_discord_bytes(tone(PACKET_MS))
    faint = _to_discord_bytes(tone(PACKET_MS, amp=SPEECH_RMS * 0.4))
    talker, other = FakeMember(1, "말한 사람"), FakeMember(2, "거의 조용한 쪽")
    for _ in range(3):
        sink.write(loud, talker)
    for _ in range(2):
        sink.write(faint, talker)
    for _ in range(4):
        sink.write(faint, other)
    session.close()

    r = sink.level_report()
    assert r["quiet_packets"] == 6      # 집계
    assert r["top_packets"] == 5
    assert r["top_quiet_packets"] == 2


def test_top_gap_sizes_carry_every_gap_of_the_dominant_speaker():
    """숨 크기 공백과 그보다 큰 공백을 나누는 일은 해석 쪽이 한다. 크기 목록이 그 재료다."""
    session = FeedCountingSession(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    clock = {"now_ms": 0}
    sink = StreamingSink(session, now_ms=lambda: clock["now_ms"])
    pkt = _to_discord_bytes(tone(PACKET_MS))
    for t in (0, 200, 700, 2200):      # 공백 200, 500, 1500
        clock["now_ms"] = t
        sink.write(pkt, FakeMember(1, "a"))
    session.close()

    r = sink.level_report()
    assert r["top_gap_sizes"] == [200, 500, 1500]
    assert r["top_gaps"] == 3
    assert r["top_median_gap_ms"] == 500


def test_sink_is_a_pycord_sink():
    sink = StreamingSink(session=None)
    assert isinstance(sink, discord.sinks.Sink)
    assert sink.vc is None
    assert sink.audio_data == {}
    assert sink.finished is False
    # py-cord 가 실제로 부르는 진입점. Filters.init() 이 self.seconds 를 읽으므로
    # super().__init__() 을 건너뛰고 vc/audio_data/finished 만 흉내내면 여기서 죽는다.
    sink.init(object())
    assert sink.vc is not None


def test_write_exception_is_counted_not_raised():
    class Boom:
        def feed(self, *a, **k):
            raise RuntimeError("boom")

        def flush_speaker(self, *a, **k):
            pass

    sink = StreamingSink(Boom())
    m = FakeMember(1, "a")
    # window 안에 있는 동안은 release 가 없어 feed() 가 안 불린다. window + 2 만큼
    # 써야 release 가 두 번 일어나 Boom.feed 가 실제로 두 번 예외를 던진다.
    for _ in range(REORDER_WINDOW + 2):
        sink.write(_to_discord_bytes(tone(PACKET_MS)), m)
    assert sink.write_errors == 2
    assert sink.level_report()["write_errors"] == 2


def test_unattributed_packet_is_counted():
    sink = StreamingSink(session=None)
    sink.write(_to_discord_bytes(tone(PACKET_MS)), None)
    assert sink.unattributed == 1
    assert sink.packets == 0


def test_cleanup_counts_feed_errors_and_finishes():
    """cleanup 이 부르는 drain 은 write() 와 다른 경로다 — write() 의 예외 삼키기가
    이쪽을 지켜주지 않는다. session.feed 가 여기서 죽으면 finished 가 영영 False 로
    남고, py-cord 는 자기 로거에만 기록한 채 넘어간다(reader.py:195-198)."""
    class Boom:
        def feed(self, *a, **k):
            raise RuntimeError("boom")

    sink = StreamingSink(Boom())
    m = FakeMember(1, "a")
    sink.write(_to_discord_bytes(tone(PACKET_MS)), m)  # 재정렬 창에 하나 담아 둔다

    sink.cleanup()

    assert sink.finished is True
    assert sink.feed_errors == 1
    assert sink.level_report()["feed_errors"] == 1


def test_cleanup_finishes_even_if_drain_raises():
    """feed_errors 카운팅과 무관하게, drain() 이 어떤 이유로든 예외를 내도
    finished 는 세팅되어야 한다. drain() 을 직접 오버라이드해 이 경로를 격리한다."""
    class BoomDrain(StreamingSink):
        def drain(self):
            raise RuntimeError("drain boom")

    sink = BoomDrain(session=None)
    with pytest.raises(RuntimeError):
        sink.cleanup()
    assert sink.finished is True
