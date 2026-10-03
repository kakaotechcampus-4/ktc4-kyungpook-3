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


def _raw_runs(raw, runs):
    d = raw / "runs" / "local-large-v3-turbo"
    d.mkdir(parents=True)
    for sid, rec in runs.items():
        (d / f"{sid}.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")


def test_render_writes_the_tables_for_every_backend_and_group(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    _raw_runs(raw, {sid: _run(sid, [_rec("m1", e)], [("stt.batch.TURN_GAP_S", 1.0)] if sid.startswith("TURN") else [])
                    for sid, e in (("base", 42), ("dither1", 43), ("TURN_GAP_S=1", 42))})
    R.report(out, raw)
    ev = (out / "tables" / "evidence.md").read_text(encoding="utf-8")
    assert "stt.batch.TURN_GAP_S" in ev and "local-large-v3-turbo" in ev
    assert "TURN_GAP_S" in (out / "tables" / "sensitivity.md").read_text(encoding="utf-8")


def test_report_writes_only_tables_and_a_numbers_only_summary_next_to_the_results(tmp_path):
    """결과 폴더(레포 안)에는 표와 숫자 요약만. 전사 원문 필드와 한글 문장이 요약에 없어야 한다."""
    import re
    raw, out = tmp_path / "raw", tmp_path / "out"
    _raw_runs(raw, {sid: _run(sid, [_rec("m1", e, lines_fp=sid)], [("stt.batch.TURN_GAP_S", 1.0)] if sid.startswith("TURN") else [])
                    for sid, e in (("base", 42), ("dither1", 43), ("TURN_GAP_S=1", 50))})
    R.report(out, raw)
    assert {p.name for p in out.iterdir()} == {"tables", "summary.json"}
    text = (out / "summary.json").read_text(encoding="utf-8")
    assert re.search("[가-힣]", text) is None

    def keys(x):
        if isinstance(x, dict):
            for k, v in x.items():
                yield k
                yield from keys(v)
        elif isinstance(x, list):
            for v in x:
                yield from keys(v)
    s = json.loads(text)
    assert not set(keys(s)) & {"text", "note", "lines", "clip_lines", "hyp_by_speaker", "segments", "tasks", "call_log"}
    v = s["verdicts"]["stt.batch.TURN_GAP_S"][0]
    assert (v["group"], v["label"], v["direction"]) == ("aligned", "slope", "worse") or v["label"] in ("flat", "cliff")


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


def test_align_section_says_whether_a_constant_changed_the_audio_or_the_model_input(tmp_path):
    rows = [{"source": "m1", "const": "stt.eval.golden.RUN_GAP_S", "value": v, "session": f"m1-RUN_GAP_S={v:g}",
             "wav": "w", "chunks": "c", "slots": []} for v in (1.0, 3.0, 8.0)]
    rows += [{"source": "m1", "const": "stt.eval.golden.PLACE_GAP_S", "value": v, "session": f"m1-PLACE_GAP_S={v:g}",
              "wav": f"w{v}", "chunks": "c" if v != 0.3 else "c2", "slots": []} for v in (0.3, 1.0, 3.0)]
    (tmp_path / "align_sweep.json").write_text(json.dumps(rows), encoding="utf-8")
    runs = {"local-large-v3-turbo": {"base": _run("base", [
        _rec("m1-PLACE_GAP_S=0.3", 44, group="정렬 변형 PLACE_GAP_S"),
        _rec("m1-PLACE_GAP_S=1", 42, group="정렬 변형 PLACE_GAP_S"),
        _rec("m1-PLACE_GAP_S=3", 42, group="정렬 변형 PLACE_GAP_S")])}}
    md, verdicts = R.align_section(tmp_path, runs)
    assert "wav 같음" in verdicts["stt.eval.golden.RUN_GAP_S"][0]["text"]
    assert "오류 글자 m1 42~44" in verdicts["stt.eval.golden.PLACE_GAP_S"][0]["text"]
    assert "| m1 |" in md


def test_noise_band_uses_every_dither_seed_that_was_run():
    runs = {sid: _run(sid, [_rec("m1", e)]) for sid, e in
            [("base", 42), ("dither1", 42), ("dither2", 44), ("dither3", 42), ("dither7", 48), ("mode=clip", 60)]}
    band = R.noise_band(runs, ALIGNED, "local")
    assert band["err"] == 6 and band["settings"] == ["base", "dither1", "dither2", "dither3", "dither7"]


def test_line_count_is_described_not_judged():
    """줄 수는 많고 적음이 좋고 나쁨이 아니다. 어느 값에서 몇 줄이 되는지만 적는다."""
    runs = {"base": _run("base", [_rec("m1", 42, n_lines=14, lines_fp="a")])}
    for v, n in ((0.5, 21), (1.0, 15), (2.0, 14), (5.0, 14), (8.0, 14)):
        runs[f"TURN_GAP_S={v:g}"] = _run("", [_rec("m1", 42, n_lines=n, lines_fp=f"l{n}")],
                                         [("stt.batch.TURN_GAP_S", v)])
    got = R.constant_verdict(runs, "stt.batch.TURN_GAP_S", ALIGNED, {"err": 5, "lost": 0, "lines": 0})
    assert got["label"] == S.FLAT
    assert got["primary"]["text"] == "줄 수 0.5: 21, 1: 15, 2~8: 14"


def test_verdict_says_whether_the_moving_side_is_better_or_worse():
    runs = {"base": _run("base", [_rec("m1", 94, lost="7/45")])}
    for v, err, lost in ((0.0, 99, "7/45"), (0.05, 96, "7/45"), (0.2, 79, "3/45"), (0.4, 71, "3/45")):
        runs[f"TAIL_PAD_S={v:g}"] = _run("", [_rec("m1", err, lost=lost, fp=f"i{v}")], [("stt.batch.TAIL_PAD_S", v)])
    got = R.constant_verdict(runs, "stt.batch.TAIL_PAD_S", ALIGNED, {"err": 8, "lost": 0})
    assert got["label"] == S.CLIFF and got["direction"] == "개선 쪽"
    assert "절벽(개선 쪽)" in R._verdict_line(got)


def test_stall_line_counts_only_chunk_and_clip_calls(tmp_path, monkeypatch):
    d = tmp_path / "old" / "m1"
    d.mkdir(parents=True)
    for mode, calls, over in (("chunk", 7, 2), ("clip", 15, 1), ("whole", 6, 6)):
        (d / f"score_{mode}_elice.json").write_text(json.dumps({"backend": "elice/whisper-large-v3", "mode": mode,
                                                                "calls": calls, "transcribe_p50_s": 1.0,
                                                                "transcribe_p95_s": 30.0, "calls_over_20s": over,
                                                                "failed": 0, "retries": 0}), encoding="utf-8")
    monkeypatch.setattr(R, "PREVIOUS", tmp_path / "old")
    _md, verdicts = R.latency({})
    assert "chunk·clip 호출 22건 중 20초 넘음 3건" in verdicts["stt.batch.STALL_S"][0]["text"]


def test_align_text_keeps_each_source_separate(tmp_path):
    rows = [{"source": s, "const": "stt.eval.golden.PLACE_GAP_S", "value": v, "session": f"{s}-PLACE_GAP_S={v:g}",
             "wav": f"w{v}", "chunks": "c", "slots": []} for s in ("m1", "m2") for v in (0.3, 1.0)]
    (tmp_path / "align_sweep.json").write_text(json.dumps(rows), encoding="utf-8")
    recs = [_rec(f"{s}-PLACE_GAP_S={v:g}", e, group="정렬 변형 PLACE_GAP_S") for s, e in (("m1", 43), ("m2", 38))
            for v in (0.3, 1.0)]
    _md, verdicts = R.align_section(tmp_path, {"local-large-v3-turbo": {"base": _run("base", recs)}})
    assert "오류 글자는 원본마다 값과 무관하게 같음 (m1 43, m2 38)" in verdicts["stt.eval.golden.PLACE_GAP_S"][0]["text"]


def test_evidence_says_not_yet_measured_on_elice_for_backend_dependent_constants(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    _raw_runs(raw, {sid: _run(sid, [_rec("m1", e, fp=sid)], ov) for sid, e, ov in
                    (("base", 42, []), ("CHUNK_GAP_S=0.4", 45, [("stt.batch.CHUNK_GAP_S", 0.4)]))})
    R.report(out, raw)
    rows = {line.split("|")[1].strip(): line for line in
            (out / "tables" / "evidence.md").read_text(encoding="utf-8").splitlines() if line.startswith("| stt.")}
    assert "elice: 아직 안 잼" in rows["stt.batch.CHUNK_GAP_S"]
    assert "elice" not in rows["stt.batch.TURN_GAP_S"]
