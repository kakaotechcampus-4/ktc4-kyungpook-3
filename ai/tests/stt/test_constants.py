"""상수 목록과 덮어쓰기(stt/eval/constants.py). 모델도 API 도 안 쓴다."""

import pytest

from stt import batch as B
from stt import speech_gate as G
from stt import vad as V
from stt.eval import constants as C
from stt.vad import Utterance

import numpy as np


def _utt(start_ms, end_ms, spk="a"):
    n = int((end_ms - start_ms) * 16)
    return Utterance(speaker_id=spk, pcm=np.zeros(n, dtype=np.float32), sample_rate=16_000,
                     start_ms=start_ms, end_ms=end_ms, seq=0)


def test_overrides_reach_functions_whose_defaults_were_bound_at_definition():
    """group_turns 의 기본 인자는 정의 시점의 3.0 이다. 모듈 속성만 바꾸면 안 바뀐다."""
    utts = [_utt(0, 1000), _utt(1600, 2600)]            # 사이 0.6초
    assert len(B.group_turns(utts)) == 1
    with C.overrides({"stt.batch.TURN_GAP_S": 0.5}):
        assert B.TURN_GAP_S == 0.5
        assert len(B.group_turns(utts)) == 2
        assert len(B.build_chunks(utts, pack_turns=False)) == 2
    assert len(B.group_turns(utts)) == 1


def test_overrides_restore_everything_even_when_the_body_raises():
    before = (B.CHUNK_GAP_S, B.build_chunks.__defaults__)
    with pytest.raises(RuntimeError):
        with C.overrides({"stt.batch.CHUNK_GAP_S": 0.9}):
            assert B.build_chunks.__defaults__[1] == 0.9
            raise RuntimeError("중간 실패")
    assert (B.CHUNK_GAP_S, B.build_chunks.__defaults__) == before


def test_overrides_patch_dataclass_field_and_keyword_only_defaults():
    with C.overrides({"stt.vad.SPEECH_RMS": 0.02, "stt.speech_gate.THRESHOLD": 0.5}):
        assert V.StreamingVAD(speaker_id="x").speech_rms == 0.02
        assert G.SpeechGate().threshold == 0.5
    assert V.StreamingVAD(speaker_id="x").speech_rms == V.SPEECH_RMS
    assert G.SpeechGate().threshold == G.THRESHOLD


def test_overrides_refuse_an_unregistered_path():
    """오타가 조용히 기본값으로 도는 것을 막는다."""
    with pytest.raises(KeyError):
        with C.overrides({"stt.batch.TURN_GAP": 1.0}):
            pass


def test_registered_binds_hold_the_same_value_as_the_module_attribute():
    """상수를 고쳤는데 기본 인자에 옛 값이 남는 일이 없는지. 두 값이 같아야 목록이 맞다."""
    for c in C.REGISTRY:
        for qual, param in c.binds:
            assert C.bound_default(c.module, qual, param) == C.current_value(c.path), (c.path, qual, param)


def test_every_swept_constant_includes_its_current_value():
    for c in C.REGISTRY:
        if c.sweep:
            assert C.current_value(c.path) in c.sweep, c.path


def test_every_numeric_constant_in_scanned_files_is_registered():
    """전사·수신 경로의 이름 붙은 숫자 상수는 전부 목록에 있어야 한다. 새 상수는 한 줄 더한다."""
    missing = C.unregistered_constants()
    assert missing == [], missing


def test_evidence_kind_is_one_of_the_fixed_labels():
    for c in C.REGISTRY:
        assert c.evidence in C.EVIDENCE_KINDS, c.path
