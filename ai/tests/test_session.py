import threading
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
    lines = []
    s = Session(final_stt=FakeStt("끝"), on_line=lines.append, workers=1)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    elapsed = s.close(timeout_s=10.0)
    assert elapsed < 10.0
    # 시한 안에 돌아온 것만으로는 부족하다. 돌아온 시점에 줄이 나와 있어야 한다.
    assert any(ln.final and ln.text == "끝" for ln in lines)


def test_leaving_speaker_keeps_last_words():
    """퇴장하면 그 화자만 flush 한다. 마지막 발언이 사라지면 안 된다.

    close() 도 flush 하므로 close() 뒤에 보면 flush_speaker 가 아무 일도 안 해도
    통과한다. close() 전에 줄이 나왔는지를 본다.
    """
    lines = []
    s = Session(final_stt=FakeStt("마지막"), on_line=lines.append, workers=1)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    s.flush_speaker("kim")

    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        if any(ln.final and ln.speaker_id == "kim" for ln in lines):
            break
        time.sleep(0.05)
    assert any(ln.final and ln.speaker_id == "kim" for ln in lines)
    s.close()


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


def test_same_speaker_within_gap_shares_turn():
    """3초 안에 이어 말하면 한 턴이다. 발화 둘이 메시지 하나로 묶여야 한다."""
    lines = []
    s = Session(final_stt=FakeStt(), on_line=lines.append, workers=1)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    feed_packets(s, "kim", "김환", tone(1_000), 2_000)
    s.close()

    finals = [ln for ln in lines if ln.final]
    assert len(finals) == 2
    assert finals[0].turn_id == finals[1].turn_id


def test_same_speaker_after_gap_gets_new_turn():
    """9초를 쉬면 다른 턴이다. 같은 화자라고 무한정 붙이면 안 된다."""
    lines = []
    s = Session(final_stt=FakeStt(), on_line=lines.append, workers=1)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    feed_packets(s, "kim", "김환", tone(1_000), 10_000)
    s.close()

    finals = [ln for ln in lines if ln.final]
    assert len(finals) == 2
    assert finals[0].turn_id != finals[1].turn_id


def test_turns_follow_speech_order_not_completion_order():
    """턴은 전사가 끝난 순서가 아니라 말한 순서로 정해져야 한다.

    워커가 셋이면 앞 발화가 느린 API 에 걸린 사이 뒷 발화가 먼저 끝난다. 턴을 전사
    완료 시점에 정하면 뒷 발화가 턴을 먼저 받고, 뒤늦게 도착한 앞 발화가 9초 떨어진
    발화와 한 턴으로 묶인다. 첫 호출만 느리게 만들어 그 역전을 강제한다.
    """

    class SlowFirstStt:
        name = "slow-first"

        def __init__(self):
            self.calls = 0
            self._lock = threading.Lock()

        def transcribe(self, samples, sample_rate):
            with self._lock:
                self.calls += 1
                nth = self.calls
            if nth == 1:
                time.sleep(0.6)
            return SttResult(text=f"{nth}번째", words=[])

    lines = []
    s = Session(final_stt=SlowFirstStt(), on_line=lines.append, workers=3)
    feed_packets(s, "kim", "김환", tone(1_000), 0)
    feed_packets(s, "kim", "김환", tone(1_000), 10_000)
    s.close()

    finals = sorted((ln for ln in lines if ln.final), key=lambda ln: ln.seq)
    assert len(finals) == 2
    assert finals[0].turn_id != finals[1].turn_id
    assert finals[0].seq == 1 and abs(finals[0].start_ms - 0) <= 40
    assert finals[1].seq == 2 and abs(finals[1].start_ms - 10_000) <= 40
