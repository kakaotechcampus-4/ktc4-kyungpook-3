"""민감도 결과 표(stt/eval/sensitivity_report.py). 실행 결과 파일 모양의 가짜 기록으로 잰다."""

import json

from stt.eval import sensitivity as S
from stt.eval import sensitivity_report as R

ALIGNED = "정렬본(시간축 합성)"


def _rec(session, err, *, group=ALIGNED, lost="0/7", fp="i", lines_fp="l", calls=7, audio=138.0, **kw):
    base = {"session": session, "group": group, "err_chars": err, "ref_chars": 760, "lost_utterances": lost,
            "gated": 0, "calls": calls, "audio_sent_s": audio, "stt_s": 50.0, "halluc": 0, "char_ins": 1,
            "n_lines": 7, "clips": 15, "turns": 7, "long_splits": 0, "spread_cer": 0.1,
            "punct": {"ref_ends": 20, "hyp_ends": 21, "matched": 19, "joins": 8, "joins_needing_end": 5,
                      "joins_needing_end_kept": 5, "joins_without_end": 3, "joins_invented_end": 1},
            "edge": {"edge_errors": 3, "edge_chars": 100, "inner_errors": 5, "inner_chars": 660},
            "input_fp": fp, "lines_fp": lines_fp, "paid_krw": 0.0, "fresh_audio_s": 0.0,
            "hyp_by_speaker": {"a": "안녕"}, "call_log": []}
    base.update(kw)
    return base


def _run(sid, recs, overrides=()):
    return {"setting": {"id": sid, "overrides": list(overrides)}, "sessions": {r["session"]: r for r in recs}}


def test_aggregate_sums_a_group_and_keeps_errors_visible():
    run = _run("x", [_rec("m1", 42, lost="1/7"), _rec("m2", 38), _rec("s1", 5, group="재배치 합성"),
                     {"session": "m3", "group": ALIGNED, "error": "ValueError: 빈 구간"}])
    a = R.aggregate(run, ALIGNED)
    assert (a["err"], a["ref"], a["lost"], a["calls"]) == (80, 1520, 1, 14)
    assert a["punct_err"] == 2 * ((20 - 19) + (21 - 19)) and a["errors"] == ["m3"]
    assert R.aggregate(run, "재배치 합성")["err"] == 5


def test_noise_band_is_the_range_over_the_noise_settings():
    runs = {sid: _run(sid, [_rec("m1", e1), _rec("m2", e2)]) for sid, e1, e2 in
            [("base", 42, 38), ("dither1", 42, 38), ("dither2", 42, 43), ("dither3", 42, 38)]}
    band = R.noise_band(runs, ALIGNED, "local")
    assert band["err"] == 5 and band["lost"] == 0 and band["settings"] == ["base", "dither1", "dither2", "dither3"]


def test_constant_verdict_marks_a_constant_that_never_changed_the_model_input():
    runs = {"base": _run("base", [_rec("m1", 42)])}
    for v in (5.0, 10.0, 20.0, 25.0):
        runs[f"LONG_SPLIT_FROM_S={v:g}"] = _run("", [_rec("m1", 42)], [("stt.batch.LONG_SPLIT_FROM_S", v)])
    got = R.constant_verdict(runs, "stt.batch.LONG_SPLIT_FROM_S", ALIGNED, {"err": 5, "lost": 0})
    assert got["label"] == S.INACTIVE


def test_constant_verdict_uses_error_characters_and_lost_utterances():
    runs = {"base": _run("base", [_rec("m1", 42)])}
    for v, err, lost in ((0.5, 42, "0/7"), (1.0, 43, "0/7"), (2.0, 44, "0/7"), (5.0, 42, "2/7"), (8.0, 42, "2/7")):
        runs[f"TURN_GAP_S={v:g}"] = _run("", [_rec("m1", err, lost=lost, lines_fp=f"l{v}")],
                                         [("stt.batch.TURN_GAP_S", v)])
    got = R.constant_verdict(runs, "stt.batch.TURN_GAP_S", ALIGNED, {"err": 5, "lost": 0})
    assert got["label"] == S.CLIFF and got["flat_lo"] == 0.5 and got["flat_hi"] == 3.0
    assert got["lost_changed"] == [5.0, 8.0]


def test_render_writes_the_tables_for_every_backend_and_group(tmp_path):
    d = tmp_path / "runs" / "local-large-v3-turbo"
    d.mkdir(parents=True)
    for sid, e in (("base", 42), ("dither1", 43), ("TURN_GAP_S=1", 42)):
        ov = [("stt.batch.TURN_GAP_S", 1.0)] if sid.startswith("TURN") else []
        (d / f"{sid}.json").write_text(json.dumps(_run(sid, [_rec("m1", e)], ov), ensure_ascii=False), encoding="utf-8")
    R.report(tmp_path)
    ev = (tmp_path / "tables" / "evidence.md").read_text(encoding="utf-8")
    assert "stt.batch.TURN_GAP_S" in ev and "local-large-v3-turbo" in ev
    assert "TURN_GAP_S" in (tmp_path / "tables" / "sensitivity.md").read_text(encoding="utf-8")


def test_previous_latency_reads_elice_rows_from_an_older_results_folder(tmp_path):
    d = tmp_path / "2026-09-16-batch" / "meeting-01-aligned"
    d.mkdir(parents=True)
    (d / "score_chunk_elice.json").write_text(json.dumps({"backend": "elice/whisper-large-v3", "mode": "chunk", "tag": "",
                                                          "calls": 7, "transcribe_p50_s": 30.33, "transcribe_p95_s": 37.39,
                                                          "calls_over_20s": 7, "failed": 0, "retries": 2}), encoding="utf-8")
    (d / "score_chunk_local-small.json").write_text(json.dumps({"backend": "local/small", "calls": 7}), encoding="utf-8")
    rows = R.previous_latency(tmp_path / "2026-09-16-batch")
    assert rows == [{"회의": "meeting-01-aligned", "설정": "chunk", "호출": 7, "p50": 30.33, "p95": 37.39,
                     "20초 넘음": 7, "재시도": 2, "실패": 0}]
