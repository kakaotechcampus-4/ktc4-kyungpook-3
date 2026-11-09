"""실제 STT 오류 평가(judge/eval_asr_real.py)의 분류와 집계. Elice 는 부르지 않는다."""

import json

from judge import eval_asr_real as R


def test_clean_form_follows_the_kspon_notation():
    assert R.clean_form("(3회)/(삼 회) 할게요") == "3회 할게요"                      # 철자 쪽
    assert R.clean_form("n/ 어/ 그러니까 (그러니까)/(그니까) 이탤리+ 이탈리아요.") == "그러니까 그러니까 이탈리아요."
    assert R.clean_form("o/무슨 얘기죠?") == "무슨 얘기죠?"
    assert R.clean_form("@/김종필 님이요") is None                                 # 가린 이름
    assert R.clean_form("u/ 그거요") is None                                       # 알아듣지 못함
    assert R.clean_form("가계/가게에서") is None                                     # 풀 수 없는 표기


class _Jev:
    def __init__(self, p):
        self.p, self.calls = p, []

    def decide(self, state, questions):
        self.calls.append(questions)
        return {k: {"probabilities": {"yes": self.p(q["instructions"])}} for k, q in questions.items()}


def test_jev_stage_counts_caught_errors_and_blocked_clean_lines(tmp_path):
    meeting = {"title": "m1", "utts": [
        {"start": 0, "end": 2, "ref": "배포 문서 정리할게요", "speaker": "a"},
        {"start": 2, "end": 4, "ref": "회의록은 제가 쓸게요", "speaker": "b"},
        {"start": 4, "end": 6, "ref": "핀테크볼트 정산 정리할게요", "speaker": "a"},
    ]}
    hyps = {"m1#0": "애포 문서 정리할게요", "m1#1": "회의록은 제가 쓸게요", "m1#2": "핀테크볼트 정산 정리할게요"}
    vocab = R.asr_check.base_vocab()
    jev = _Jev(lambda text: 0.1 if "'애포'" in text else 0.9)   # 애포는 틀렸다, 핀테크볼트는 맞다
    answers = R.ask_jev([meeting], hyps, vocab, tmp_path / "jev.jsonl", 2, jev=jev)
    rows, s = R.evaluate([meeting], hyps, vocab, answers)
    assert s["noun_error_utterances"] == 1 and s["jev_utterances"] == 2
    assert s["threshold_0.8"]["caught"]["k"] == 1                 # 애포
    assert s["threshold_0.8"]["blocked_clean"]["k"] == 0          # 핀테크볼트(0.9)는 통과
    assert s["stage1_only"]["blocked_clean"]["k"] == 1            # Jev 없이는 핀테크볼트도 막는다
    # 다시 돌리면 받은 답을 다시 묻지 않는다
    R.ask_jev([meeting], hyps, vocab, tmp_path / "jev.jsonl", 2, jev=jev)
    assert len(jev.calls) == 2


def test_load_meetings_reads_label_zips_and_keeps_utterances_with_audio(tmp_path):
    import zipfile

    import numpy as np
    import soundfile as sf

    dialogs = [{"speaker": "1", "audioPath": f"KconfSpeech/D20/G02/S1/00000{i}.wav",
                "textPath": f"KconfSpeech/D20/G02/S1/00000{i}.txt"} for i in range(4)]
    with zipfile.ZipFile(tmp_path / "x_label_0.zip", "w") as z:
        z.writestr("D20/G02/S1/S1.json", json.dumps({"dataSet": {"dialogs": dialogs}}))
        for i, t in enumerate(["배포 할게요.", "네.", "@/김종필 님", "음성 없음"]):
            z.writestr(f"D20/G02/S1/00000{i}.txt", t.encode("utf-8"))
    wav = tmp_path / "wav" / "D20" / "G02" / "S1"
    wav.mkdir(parents=True)
    for i, sec in enumerate([2.0, 0.2, 2.0]):                 # 3번은 wav 가 없다(원천 일부만 받음)
        sf.write(wav / f"00000{i}.wav", np.zeros(int(16000 * sec), dtype="float32"), 16000)
    [m] = R.load_meetings(tmp_path, tmp_path / "wav")
    assert m["title"] == "S1"
    assert [(u["ref"], u["speaker"]) for u in m["utts"]] == [("배포 할게요.", "1")]   # 너무 짧은 것·가린 이름은 뺀다
