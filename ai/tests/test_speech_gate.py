"""말 필터가 전사 앞을 막는지 본다.

배경음악이 에너지 VAD 를 통과해 전사까지 가면 위스퍼가 아무도 하지 않은 문장을
지어낸다. 그 줄은 회의록에서 실제 팀원의 발언으로 남는다.

합성음은 실로가 전부 말이 아니라고 본다 (220Hz 정현파·백색소음 모두 말 비율
0.000). 그래서 이 파일의 통과 케이스는 판정 함수를 갈아 끼워 만든다. 실제 음성이
통과하는지는 골든셋이 있을 때만 도는 맨 아래 테스트가 본다.
"""

import threading
import time

import numpy as np
import pytest

from stt.backend import SttResult
from stt.session import Session
from stt.speech_gate import MIN_SPEECH_RATIO, SpeechGate

SR = 16_000


class FakeStt:
    name = "fake"

    def __init__(self, text="테스트"):
        self.text = text
        self.calls = 0

    def transcribe(self, samples, sample_rate):
        self.calls += 1
        return SttResult(text=self.text, words=[])


def noise(ms, amp=0.05, seed=0):
    n = int(SR * ms / 1000)
    rng = np.random.default_rng(seed)
    return (rng.standard_normal(n) * amp).astype(np.float32)


def feed_packets(s, speaker, name, samples, start_ms=0):
    n = SR * 20 // 1000
    for i in range(0, len(samples) - n + 1, n):
        s.feed(speaker, name, samples[i : i + n], start_ms + i * 1000 // SR)


def all_speech(pcm, sample_rate, threshold):
    return [{"start": 0, "end": len(pcm)}]


def no_speech(pcm, sample_rate, threshold):
    return []


def half_speech(pcm, sample_rate, threshold):
    return [{"start": 0, "end": len(pcm) // 2}]


def boom(pcm, sample_rate, threshold):
    raise RuntimeError("onnx 죽음")


# ------------------------------------------------------------------ 필터 자체
def test_speech_ratio_is_the_fraction_of_samples_marked_speech():
    gate = SpeechGate(speech_spans=half_speech)
    assert gate.speech_ratio(noise(1_000), SR) == pytest.approx(0.5, abs=0.01)


def test_the_cutoff_is_inclusive():
    """0.60 이상이면 통과다. 경계값이 어느 쪽인지 못 박는다."""
    exact = lambda pcm, sr, th: [{"start": 0, "end": int(len(pcm) * MIN_SPEECH_RATIO)}]
    just_under = lambda pcm, sr, th: [{"start": 0, "end": int(len(pcm) * MIN_SPEECH_RATIO) - 1}]
    assert SpeechGate(speech_spans=exact).accepts(noise(1_000), SR) is True
    assert SpeechGate(speech_spans=just_under).accepts(noise(1_000), SR) is False


def test_rejection_is_counted_and_logged_with_duration_and_ratio(capsys):
    gate = SpeechGate(speech_spans=half_speech)
    assert gate.accepts(noise(2_000), SR, tag="kim#4") is False
    assert (gate.rejected, gate.passed, gate.errors) == (1, 0, 0)

    line = capsys.readouterr().out.strip()
    assert "kim#4" in line
    assert "2.00초" in line
    assert "0.50" in line


def test_a_failing_filter_lets_the_utterance_through_and_counts_it(capsys):
    gate = SpeechGate(speech_spans=boom)
    assert gate.accepts(noise(1_000), SR, tag="kim#1") is True
    assert (gate.rejected, gate.errors) == (0, 1)
    assert "RuntimeError" in capsys.readouterr().out


def test_a_disabled_filter_does_not_load_the_model():
    loads = []
    gate = SpeechGate(enabled=False, load_model=lambda: loads.append(1), speech_spans=no_speech)
    assert gate.accepts(noise(1_000), SR) is True
    assert loads == []
    assert (gate.rejected, gate.passed, gate.errors) == (0, 0, 0)


def test_the_model_is_loaded_once_across_many_utterances():
    loads = []
    gate = SpeechGate(load_model=lambda: loads.append(1), speech_spans=all_speech)
    for _ in range(5):
        gate.accepts(noise(400), SR)
    assert len(loads) == 1


def test_the_model_is_loaded_once_even_when_workers_race():
    """lru_cache 는 감싼 함수 호출을 잠그지 않는다. 잠금은 우리 쪽에 있어야 한다."""
    loads = []

    def slow_load():
        time.sleep(0.05)
        loads.append(1)

    gate = SpeechGate(load_model=slow_load, speech_spans=all_speech)
    start = threading.Barrier(8)

    def run():
        start.wait()
        gate.accepts(noise(200), SR)

    threads = [threading.Thread(target=run) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(loads) == 1
    assert gate.passed == 8


def test_making_a_gate_does_not_load_the_model():
    """첫 호출이 432ms 다. 세션을 만드는 자리에서 그 값을 물지 않는다."""
    loads = []
    gate = SpeechGate(load_model=lambda: loads.append(1), speech_spans=all_speech)
    assert gate.model_loaded is False
    assert loads == []


# ------------------------------------------------------------------ 종료 요약
def test_the_summary_names_what_it_dropped():
    gate = SpeechGate(speech_spans=no_speech)
    for _ in range(3):
        gate.accepts(noise(400), SR)
    assert gate.summary() == "말 필터 · 거름 3건 / 검사 3건 · 오류 0건 (말 비율 0.60 미만은 거른다)"


def test_the_summary_says_so_when_the_filter_is_off():
    assert SpeechGate(enabled=False).summary() == "말 필터 꺼짐 (speech_gate.ENABLED)"


# ------------------------------------------------------------------ 세션 배선
def run_one(gate, samples, stt=None):
    stt = stt or FakeStt()
    lines = []
    s = Session(final_stt=stt, on_line=lines.append, workers=1, gate=gate)
    feed_packets(s, "kim", "김환", samples)
    s.close()
    return [ln for ln in lines if ln.final], stt


def test_non_speech_audio_never_reaches_the_backend():
    """실로를 실제로 돌린다. 백색소음의 말 비율은 0.000 이다."""
    gate = SpeechGate()
    finals, stt = run_one(gate, noise(1_500))
    assert stt.calls == 0
    assert finals == []
    assert gate.rejected == 1


def test_turning_the_filter_off_restores_the_old_behaviour():
    """같은 오디오, 꺼진 필터. 전사되고 줄이 나와야 한다."""
    gate = SpeechGate(enabled=False)
    finals, stt = run_one(gate, noise(1_500), FakeStt("안녕하세요"))
    assert stt.calls == 1
    assert [ln.text for ln in finals] == ["안녕하세요"]


def test_speech_reaches_the_backend():
    gate = SpeechGate(speech_spans=all_speech)
    finals, stt = run_one(gate, noise(1_500), FakeStt("안녕하세요"))
    assert stt.calls == 1
    assert [ln.text for ln in finals] == ["안녕하세요"]
    assert (gate.passed, gate.rejected) == (1, 0)


def test_a_session_without_a_gate_transcribes_everything():
    """게이트를 넘기지 않은 세션은 예전 그대로다. 오프라인 테스트와 리플레이가 이 길로 돈다."""
    finals, stt = run_one(None, noise(1_500), FakeStt("안녕하세요"))
    assert stt.calls == 1
    assert len(finals) == 1


def test_a_failing_filter_does_not_eat_the_utterance_in_a_session():
    gate = SpeechGate(speech_spans=boom)
    finals, stt = run_one(gate, noise(1_500), FakeStt("안녕하세요"))
    assert stt.calls == 1
    assert len(finals) == 1
    assert gate.errors == 1


def test_the_filter_does_not_charge_its_cost_to_the_transcribe_stage():
    """게이트 비용은 큐 구간에 들어간다. transcribe_s 는 백엔드만 재는 수치다."""

    def slow_spans(pcm, sample_rate, threshold):
        time.sleep(0.3)
        return all_speech(pcm, sample_rate, threshold)

    finals, _ = run_one(SpeechGate(speech_spans=slow_spans), noise(1_500))
    assert len(finals) == 1
    assert finals[0].transcribe_s < 0.2


# ------------------------------------------------------------------ 실제 음성
def _golden_wav():
    from pathlib import Path

    root = Path.home() / "Desktop" / "카테캠 아이디어톤" / "mm" / "golden" / "meeting-01" / "audio"
    if not root.is_dir():
        return None
    wavs = sorted(root.glob("*.wav"))
    return wavs[0] if wavs else None


@pytest.mark.skipif(_golden_wav() is None, reason="골든셋 오디오가 이 기기에 없다")
def test_real_speech_survives_the_filter():
    """레포 밖 파일이라 없으면 건너뛴다. 있을 때는 실제 사람 목소리로 확인한다.

    파일을 통째로 재지 않는다. 에너지 VAD 가 자른 발화가 게이트에 들어가는 모양이
    실제 경로이고, 파일 전체에는 다른 사람이 말하는 동안의 침묵이 섞여 있다.
    """
    import soundfile as sf

    data, sr = sf.read(str(_golden_wav()), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    gate = SpeechGate()
    finals, stt = run_one(gate, data)
    assert stt.calls > 0
    assert gate.rejected == 0
    assert len(finals) == stt.calls
