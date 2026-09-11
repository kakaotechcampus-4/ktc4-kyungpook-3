import time

import numpy as np

from stt.backend import SttResult
from stt.session import Session

SR = 16_000


class FakeStt:
    name = "fake"

    def __init__(self, text="테스트"):
        self.text = text
        self.calls = 0

    def transcribe(self, samples, sample_rate):
        self.calls += 1
        return SttResult(text=self.text, words=[])


def tone(ms, amp=0.3):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def feed_packets(s, speaker, name, samples, start_ms):
    n = SR * 20 // 1000
    for i in range(0, len(samples) - n + 1, n):
        s.feed(speaker, name, samples[i : i + n], start_ms + i * 1000 // SR)


def test_one_utterance_makes_one_final_line():
    stt = FakeStt("안녕하세요")
    lines = []
    s = Session(final_stt=stt, on_line=lines.append, workers=1)
    feed_packets(s, "kim", "김환", tone(1_500), 0)
    s.close()

    finals = [ln for ln in lines if ln.final]
    assert len(finals) == 1
    assert finals[0].text == "안녕하세요"
    assert finals[0].speaker_name == "김환"
    assert stt.calls == 1


def test_close_returns_elapsed_within_budget():
    """종료 후 회의록까지 10초 목표. 발화 단위로 이미 전사가 끝나 있어
    종료 시점에 남는 것은 진행 중이던 발화 하나뿐이다."""
    s = Session(final_stt=FakeStt(), on_line=lambda _: None, workers=1)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    elapsed = s.close(timeout_s=10.0)
    assert elapsed < 10.0


def test_leaving_speaker_keeps_last_words():
    """퇴장하면 그 화자만 flush 한다. 마지막 발언이 사라지면 안 된다."""
    lines = []
    s = Session(final_stt=FakeStt("마지막"), on_line=lines.append, workers=1)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    s.flush_speaker("kim")
    s.close()
    assert any(ln.final and ln.speaker_id == "kim" for ln in lines)


def test_api_called_once_per_utterance():
    """유료 호출은 발화당 정확히 1번이어야 한다. 최소 과금 단위가 미확인이다."""
    stt = FakeStt()
    s = Session(final_stt=stt, on_line=lambda _: None, workers=1)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    feed_packets(s, "kim", "김환", tone(1_000), 5_000)
    s.close()
    assert stt.calls == 2


def test_long_utterance_yields_one_final():
    stt = FakeStt("최종")
    lines = []
    s = Session(final_stt=stt, on_line=lines.append, workers=1)
    feed_packets(s, "kim", "김환", tone(4_000), 0)
    s.close()
    assert [ln.text for ln in lines if ln.final] == ["최종"]


def test_stt_failure_keeps_the_line():
    class Boom:
        name = "boom"

        def transcribe(self, samples, sample_rate):
            raise RuntimeError("api down")

    lines = []
    s = Session(final_stt=Boom(), on_line=lines.append, workers=1, retries=1)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    s.close()
    finals = [ln for ln in lines if ln.final]
    assert len(finals) == 1
    assert "전사 실패" in finals[0].text


def test_two_speakers_are_independent():
    stt = FakeStt()
    lines = []
    s = Session(final_stt=stt, on_line=lines.append, workers=2)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    feed_packets(s, "yoo", "유재환", tone(1_000), 0)
    s.close()
    speakers = {ln.speaker_id for ln in lines if ln.final}
    assert speakers == {"kim", "yoo"}


def test_close_flushes_in_flight_utterance():
    stt = FakeStt("마지막")
    lines = []
    s = Session(final_stt=stt, on_line=lines.append, workers=1)
    # 무음을 주지 않아 발화가 확정되지 않은 상태로 종료
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    s.close()
    assert any(ln.final and ln.text == "마지막" for ln in lines)


def test_close_waits_for_in_flight_transcription():
    """close() 는 큐가 빈 순간이 아니라 전사가 끝난 순간까지 기다려야 한다.

    큐는 워커가 항목을 꺼낸 순간 비므로, 그 시점에 멈추면 아직 전사 중인 워커를 두고
    close() 가 돌아간다. 그러면 회의록을 쓴 뒤에 on_line 이 불려 마지막 발언이 빠진다.
    가짜 백엔드는 즉시 돌아와 이 차이를 드러내지 못하므로 여기서만 느리게 만든다.
    """

    class SlowStt:
        name = "slow"

        def transcribe(self, samples, sample_rate):
            # 고치기 전 close() 는 join(timeout=1.0) 으로 기다렸다. 그보다 느려야
            # 전사가 끝나기 전에 돌아가는 것이 드러난다.
            time.sleep(1.2)
            return SttResult(text="느림", words=[])

    lines = []
    s = Session(final_stt=SlowStt(), on_line=lines.append, workers=1)
    # 무음을 주지 않아 발화가 진행 중인 채로 종료된다
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    elapsed = s.close(timeout_s=5.0)

    # close() 가 돌아온 시점에 이미 줄이 나와 있어야 한다. 여기서 기다려 주면 안 된다.
    assert any(ln.final and ln.text == "느림" for ln in lines)
    assert elapsed >= 1.2
