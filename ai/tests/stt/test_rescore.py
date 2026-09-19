"""저장된 전사로 재채점. 정답을 고치면 CER 이 그에 맞게 움직이고 나머지 필드는 그대로다."""

from stt.eval.rescore import rescore


def test_rescore_recomputes_cer_from_saved_hyp_only():
    result = {"cer": 0.5, "wall_s": 12.3, "hyp_by_speaker": {"a": "안녕하세요 반갑습니다", "b": "네"}}
    out = rescore({"a": "안녕하세요 반갑습니다", "b": "네"}, result)
    assert out["cer"] == 0.0 and out["cer_by_speaker"] == {"a": 0.0, "b": 0.0}
    assert out["wall_s"] == 12.3                      # 채점 밖 필드는 손대지 않는다
    worse = rescore({"a": "안녕하세요 반갑습니다", "b": "네 맞아요"}, result)
    assert worse["cer"] > 0.0 and worse["cer_by_speaker"]["a"] == 0.0
    assert result["cer"] == 0.5                       # 원본은 그대로
