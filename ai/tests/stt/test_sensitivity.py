"""민감도 측정(stt/eval/sensitivity.py)의 순수 로직: 행렬 전개, 판정, 근거 표."""

from stt.eval import constants as C
from stt.eval import sensitivity as S


# ─────────────────────────────────────────── 행렬 전개
def test_plan_sweep_moves_one_constant_at_a_time_and_skips_the_default():
    c = C.BY_PATH["stt.batch.TURN_GAP_S"]
    got = S.plan_sweep([c])
    assert [s.id for s in got] == ["TURN_GAP_S=0.5", "TURN_GAP_S=1", "TURN_GAP_S=2", "TURN_GAP_S=5", "TURN_GAP_S=8"]
    assert got[0].overrides == (("stt.batch.TURN_GAP_S", 0.5),) and got[0].group == "const:stt.batch.TURN_GAP_S"


def test_plan_sweep_filters_by_priority_and_name():
    ids = {s.id for s in S.plan_sweep(C.REGISTRY, priorities=(C.P_GATE,))}
    assert "ENABLED=False" in ids and not any(i.startswith("TURN_GAP_S") for i in ids)
    only = S.plan_sweep(C.REGISTRY, only={"TAIL_PAD_S"})
    assert {s.group for s in only} == {"const:stt.batch.TAIL_PAD_S"}


def test_setting_ids_are_unique_across_the_whole_plan():
    plan = S.full_plan("local")
    ids = [s.id for s in plan]
    assert len(ids) == len(set(ids)) and ids[0] == "base"


# ─────────────────────────────────────────── 판정
V = [0.5, 1.0, 2.0, 3.0, 5.0, 8.0]


def test_classify_flat_when_every_value_is_inside_the_noise_band():
    got = S.classify(V, 3.0, {v: 40 + (v % 2) for v in V}, noise=2)
    assert got["label"] == S.FLAT and (got["flat_lo"], got["flat_hi"]) == (0.5, 8.0)


def test_classify_cliff_when_the_neighbour_of_the_default_jumps():
    series = {v: 40 for v in V}
    series[2.0] = 48
    assert S.classify(V, 3.0, series, noise=2)["label"] == S.CLIFF


def test_classify_slope_when_only_far_values_move():
    series = {v: 40 for v in V}
    series[0.5] = 55
    got = S.classify(V, 3.0, series, noise=2)
    assert got["label"] == S.SLOPE and (got["flat_lo"], got["flat_hi"]) == (1.0, 8.0)


def test_classify_counts_a_crashing_value_as_a_change():
    series = {v: 40 for v in V}
    series[5.0] = None
    got = S.classify(V, 3.0, series, noise=2, errors={5.0})
    assert got["label"] == S.CLIFF and got["errors"] == [5.0]


def test_inactive_when_model_input_and_lines_never_change():
    fps = {v: ("same-input", "same-lines") for v in V}
    assert S.inactive(fps, 3.0)
    fps[1.0] = ("same-input", "other-lines")
    assert not S.inactive(fps, 3.0)


# ─────────────────────────────────────────── 근거 표
def test_evidence_rows_cover_every_registered_constant_and_say_what_was_not_measured():
    rows = S.evidence_rows(C.REGISTRY, verdicts={})
    by = {r["상수"]: r for r in rows}
    assert len(rows) == len(C.REGISTRY)
    assert by["stt.batch.TURN_GAP_S"]["측정 결과와 범위"] == "아직 안 잼"
    assert by["capture.timeline.REORDER_WINDOW"]["근거 종류"] == C.NOT_HERE
    assert "실서버" in by["capture.timeline.REORDER_WINDOW"]["다시 잴 조건"]


def test_evidence_rows_print_the_measured_verdict_per_backend_and_data():
    v = {"stt.batch.TURN_GAP_S": [{"backend": "local/turbo", "group": "정렬본", "label": S.FLAT,
                                   "flat_lo": 0.5, "flat_hi": 8.0, "noise": 3, "metric": "오류 글자"}]}
    row = {r["상수"]: r for r in S.evidence_rows(C.REGISTRY, verdicts=v)}["stt.batch.TURN_GAP_S"]
    assert "local/turbo 정렬본: 평탄 0.5~8 (오류 글자, 잡음 폭 3)" in row["측정 결과와 범위"]


# ─────────────────────────────────────────── 실행 (가짜 백엔드, 합성 톤 회의)
import json  # noqa: E402

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from stt.backend import SttResult, Word  # noqa: E402


class LengthStt:
    """0.5초마다 단어 하나. 마지막 단어에 보낸 길이를 붙여 입력이 바뀌면 전사도 바뀐다."""

    name = "fake/length"

    def transcribe(self, samples, sample_rate):
        d = len(samples) / sample_rate
        ws, t = [], 0.25
        while t < d:
            ws.append(Word("안녕", t - 0.05, t + 0.05))
            t += 0.5
        ws[-1] = Word(f"안녕{d:.1f}.", ws[-1].start_s, ws[-1].end_s)
        return SttResult(text=" ".join(w.text for w in ws), words=ws)


def _tiny(tmp_path):
    s = tmp_path / "tiny-aligned"
    s.mkdir()
    (s / "truth_by_speaker.json").write_text(json.dumps({"a": "안녕하세요. 반갑습니다."}, ensure_ascii=False),
                                             encoding="utf-8")
    (s / "truth_aligned.json").write_text(json.dumps([{"seq": 0, "speaker": "a", "text": "안녕하세요. 반갑습니다.",
                                                       "start": 1.0, "end": 4.0}], ensure_ascii=False), encoding="utf-8")
    (s / "meta.json").write_text(json.dumps({"kind": "real", "timeline": "합성"}, ensure_ascii=False), encoding="utf-8")
    t = np.arange(16_000) / 16_000
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    z = lambda sec: np.zeros(int(16_000 * sec), dtype=np.float32)  # noqa: E731
    sf.write(str(s / "a.wav"), np.concatenate([z(1), tone, z(1.0), tone, z(3)]), 16_000, subtype="PCM_16")
    return s


NO_GATE = {"stt.speech_gate.ENABLED": False}   # 사인파는 silero 가 말로 안 본다


def test_measure_applies_overrides_for_the_whole_run_and_restores_them(tmp_path):
    s = _tiny(tmp_path)
    with C.overrides(NO_GATE):
        base = S.measure(S.BASE, [s], backend_kind="local", backend=LengthStt(), cache_dir=tmp_path / "c")["tiny-aligned"]
        wide = S.measure(S.Setting("CHUNK_GAP_S=1", "const:stt.batch.CHUNK_GAP_S",
                                   overrides=(("stt.batch.CHUNK_GAP_S", 1.0),)),
                         [s], backend_kind="local", backend=LengthStt(), cache_dir=tmp_path / "c")["tiny-aligned"]
    assert base["clips"] == 2 and base["calls"] == 1
    assert round(wide["audio_sent_s"] - base["audio_sent_s"], 1) == 1.6       # 클립 둘 × 0.8초
    assert base["input_fp"] != wide["input_fp"]
    from stt import batch as B
    assert B.CHUNK_GAP_S == 0.2 and B.build_chunks.__defaults__[1] == 0.2


def test_measure_reports_the_d4_metrics_per_session(tmp_path):
    s = _tiny(tmp_path)
    with C.overrides(NO_GATE):
        r = S.measure(S.Setting("TURN_GAP_S=0.5", "const:stt.batch.TURN_GAP_S",
                                overrides=(("stt.batch.TURN_GAP_S", 0.5),)),
                      [s], backend_kind="local", backend=LengthStt(), cache_dir=None)["tiny-aligned"]
    assert r["group"] == "정렬본(시간축 합성)"
    assert r["n_lines"] == 2                     # 1초 쉼에서 줄이 갈린다
    assert r["ref_chars"] == 10 and r["err_chars"] > 0
    assert set(r["punct"]) >= {"ref_ends", "hyp_ends", "matched", "joins", "joins_needing_end_kept"}
    assert set(r["edge"]) >= {"edge_errors", "inner_errors"}
    assert r["calls"] == 1 and r["stt_s"] >= 0 and len(r["clip_lines"]) == 2


def test_group_of_prefers_an_explicit_group_in_meta(tmp_path):
    """정렬 상수를 바꿔 다시 만든 정렬본은 원래 정렬본과 섞이면 안 된다."""
    s = tmp_path / "m01-RUN_GAP_S=5"
    s.mkdir()
    (s / "meta.json").write_text(json.dumps({"kind": "real", "timeline": "합성", "group": "정렬 변형 RUN_GAP_S"},
                                            ensure_ascii=False), encoding="utf-8")
    assert S.group_of(s) == "정렬 변형 RUN_GAP_S"


def test_align_sweep_rebuilds_aligned_sessions_under_their_own_group(tmp_path):
    src = tmp_path / "meeting-x"
    (src / "audio").mkdir(parents=True)
    t = np.arange(16_000) / 16_000
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    z = lambda sec: np.zeros(int(16_000 * sec), dtype=np.float32)  # noqa: E731
    sf.write(str(src / "audio" / "a.wav"), np.concatenate([z(1), tone, z(5), tone, z(1)]), 16_000, subtype="PCM_16")
    sf.write(str(src / "audio" / "b.wav"), np.concatenate([z(2), tone, z(6)]), 16_000, subtype="PCM_16")
    utts = [{"seq": 0, "speaker": "a", "text": "가"}, {"seq": 1, "speaker": "b", "text": "나"},
            {"seq": 2, "speaker": "a", "text": "다"}]
    (src / "truth_utterances.json").write_text(json.dumps(utts, ensure_ascii=False), encoding="utf-8")
    (src / "truth_by_speaker.json").write_text(json.dumps({"a": "가 다", "b": "나"}, ensure_ascii=False), encoding="utf-8")
    (src / "meta.json").write_text(json.dumps({"name": "meeting-x", "kind": "real"}, ensure_ascii=False), encoding="utf-8")
    with C.overrides(NO_GATE):
        made = S.align_sweep([src], tmp_path / "aligned", {"stt.eval.golden.PLACE_GAP_S": (0.5, 1.0)})
    assert [m.name for m in made] == ["meeting-x-aligned-PLACE_GAP_S=0.5", "meeting-x-aligned-PLACE_GAP_S=1"]
    starts = [json.loads((m / "truth_aligned.json").read_text(encoding="utf-8"))[1]["start"] for m in made]
    assert starts[0] < starts[1]
    assert S.group_of(made[0]) == "정렬 변형 PLACE_GAP_S"
    from stt.eval import golden
    assert golden.PLACE_GAP_S == 1.0


def test_rescore_recomputes_text_metrics_from_stored_lines_without_transcribing(tmp_path):
    s = _tiny(tmp_path)
    st = S.Setting("TURN_GAP_S=0.5", "const:stt.batch.TURN_GAP_S", overrides=(("stt.batch.TURN_GAP_S", 0.5),))
    with C.overrides(NO_GATE):
        rec = S.measure(st, [s], backend_kind="local", backend=LengthStt(), cache_dir=None)["tiny-aligned"]
    assert "utt_err" in rec and rec["moved_chars"] >= 0
    broken = {**rec, "err_chars": 999, "n_lines": 99}
    del broken["utt_err"]
    again = S.rescore_record(s, broken, {"overrides": [["stt.batch.TURN_GAP_S", 0.5]]})
    assert again["err_chars"] == rec["err_chars"] and again["n_lines"] == 2 and again["utt_err"] == rec["utt_err"]
    assert again["calls"] == rec["calls"]                 # 전사 통계는 그대로 둔다


def test_plan_noise_takes_a_seed_count():
    assert [s.id for s in S.plan_noise("local", seeds=5)] == ["repeat", "dither1", "dither2", "dither3", "dither4",
                                                              "dither5"]
    assert [s.id for s in S.plan_noise("elice")] == ["rep1", "rep2"]
