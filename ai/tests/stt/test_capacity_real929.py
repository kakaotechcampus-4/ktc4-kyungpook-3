"""9/29 실녹음 재전사 채점(stt/eval/capacity/real929.py). 작은 가짜 대본과 줄 파일만 쓴다. 실제 대본·전사는 레포 밖이다."""

import json

import pytest

from stt.eval.capacity import real929 as R

SECRET = "비밀 대본 문장이 새면 안 된다"


def _seg(start, text, seq=0):
    return {"speaker": "1", "start": start, "end": start + 1.0, "text": text, "seq": seq}


def _lines_file(path, segments):
    path.write_text(json.dumps({"segments": segments}, ensure_ascii=False), encoding="utf-8")
    return path


def test_script_drops_comment_and_blank_lines_and_stage_directions(tmp_path):
    p = tmp_path / "script.txt"
    p.write_text("# 읽지 않는 줄\n\n가나다.\n(쉬지 않고) 라마 바사.\n", encoding="utf-8")
    assert R.read_script(p) == ["가나다.", "라마 바사."]


def test_lines_file_is_sorted_by_start_then_seq(tmp_path):
    p = _lines_file(tmp_path / "lines.json", [_seg(5.0, "다", 3), _seg(1.0, "가", 1), _seg(5.0, "나", 2)])
    assert [s["text"] for s in R.load_lines(p)] == ["가", "나", "다"]


def test_cer_counts_substitutions_deletions_insertions_after_nospace_on_both_sides():
    a = R.align(["가나, 다.", "라마"], ["가나다 라"])        # 부호와 띄어쓰기는 세지 않는다. 마 하나가 빠졌다
    assert (a["ref_chars"], a["sub"], a["del"], a["ins"]) == (5, 0, 1, 0)
    assert a["cer"] == pytest.approx(0.2)
    b = R.align(["가나다"], ["가너다바"])
    assert (b["sub"], b["del"], b["ins"]) == (1, 0, 1)
    assert b["cer"] == pytest.approx(2 / 3)


def test_errors_go_to_the_script_line_of_the_aligned_character():
    a = R.align(["가나다", "PR 라마", "바사"], ["가나다", "피알 라마", "바자"])
    assert a["line_errors"] == [0, 2, 1]
    assert a["line_chars"] == [3, 4, 2]


def test_insertion_before_any_script_character_goes_to_the_first_line():
    assert R.align(["가나", "다라"], ["아가나", "다라"])["line_errors"] == [1, 0]


def test_korean_lines_have_no_digits_or_latin_letters():
    assert R.korean_lines(["가나다.", "PR 다섯 개", "2차 리뷰", "네.", "uid 로 남는다"]) == [0, 3]


def test_korean_cer_counts_only_korean_lines():
    ev = R.evaluate(["가나다", "PR 라마", "바사"], [_seg(0.0, "가나다"), _seg(5.0, "피알 라마"), _seg(9.0, "바자")])
    assert (ev["korean_lines"], ev["korean_chars"]) == (2, 5)
    assert ev["korean_cer_aligned"] == pytest.approx(0.2)
    assert ev["cer"] == pytest.approx(3 / 9, abs=1e-4)      # 결과는 소수 넷째 자리까지
    assert ev["lines"] == 3


def test_short_answer_in_its_window_is_present_and_found():
    got = {s["answer"]: s for s in R.short_answers([_seg(188.2, "맞습니다."), _seg(112.0, "네.")])}
    assert (got["맞습니다."]["present"], got["맞습니다."]["found"]) == (True, True)
    assert (got["네."]["present"], got["네."]["found"]) == (True, True)
    assert not got["그렇죠."]["present"] and not got["그렇죠."]["found"]


def test_line_in_window_with_other_words_is_present_but_not_found():
    got = {s["answer"]: s for s in R.short_answers([_seg(353.6, "다른 말이 나왔다")])}
    assert (got["아니요, 아직 안 쟀습니다."]["present"], got["아니요, 아직 안 쟀습니다."]["found"]) == (True, False)


def test_same_words_outside_the_window_do_not_count():
    # 150초는 어느 구간에도 없다. 194.22초는 맞습니다 구간의 끝이자 다음 문장의 시작이라 넣지 않는다
    got = {s["answer"]: s for s in R.short_answers([_seg(150.0, "맞습니다."), _seg(194.22, "맞습니다.")])}
    assert not got["맞습니다."]["present"] and not got["맞습니다."]["found"]


def test_window_is_shifted_one_second_earlier_so_neighbour_starts_that_drift_do_not_flip_the_result():
    # 다음 문장 줄이 다음 클립 시작보다 조금 앞에서 시작해도 남음으로 세지 않는다
    got = {s["answer"]: s for s in R.short_answers([_seg(455.9, "다음 문장"), _seg(123.2, "다음 문장")])}
    assert not got["그렇죠."]["present"] and not got["네."]["present"]
    # 파일 통째 전사는 대답 줄을 앞 말 끝에서 시작한다고 적기도 한다
    got = {s["answer"]: s for s in R.short_answers([_seg(255.6, "그렇죠.")])}
    assert got["음, 그렇죠."]["found"]


def test_filler_before_short_answer_may_be_heard_differently():
    got = {s["answer"]: s for s in R.short_answers([_seg(260.8, "응, 그렇죠.")])}
    assert got["음, 그렇죠."]["found"]


def test_main_writes_numbers_and_short_answers_but_no_script_or_transcript_sentence(tmp_path):
    script = tmp_path / "script.txt"
    script.write_text(f"# 주석\n{SECRET}\n맞습니다.\n", encoding="utf-8")
    server = _lines_file(tmp_path / "server-lines.json", [_seg(36.0, SECRET), _seg(188.2, "맞습니다.")])
    notebook = _lines_file(tmp_path / "notebook-lines.json", [_seg(36.0, "엉뚱한 전사 문장이다")])
    out = tmp_path / "out"
    assert R.main(["--lines", f"server={server}", "--lines", f"notebook={notebook}", "--script", str(script),
                   "--out", str(out)]) == 0
    data = json.loads((out / "real929.json").read_text(encoding="utf-8"))
    md = (out / "real929.md").read_text(encoding="utf-8")
    assert set(data["runs"]) == {"server", "notebook"}
    assert data["runs"]["server"]["cer"] == pytest.approx(0.0)
    assert data["runs"]["server"]["short_found"] == 1
    assert data["notebook_929_doc"]["cer"] == pytest.approx(0.216)
    for text in (json.dumps(data, ensure_ascii=False), md):
        for secret in (SECRET, SECRET.replace(" ", ""), "엉뚱한 전사", "script.txt", "lines.json", str(tmp_path)):
            assert secret not in text
    assert "맞습니다." in md and "21.6%" in md and "방법이 다르다" in md


def test_main_rejects_lines_without_a_name(tmp_path):
    with pytest.raises(SystemExit):
        R.main(["--lines", str(tmp_path / "x.json"), "--script", str(tmp_path / "s.txt"), "--out", str(tmp_path)])
