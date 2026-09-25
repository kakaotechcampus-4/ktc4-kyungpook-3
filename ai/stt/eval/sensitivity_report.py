"""민감도 결과(runs/<백엔드>/<설정>.json)에서 표를 만든다. 골든셋을 추가하고 run 을 다시 돌린 뒤 이것만
다시 부르면 표가 새로 나온다.

  tables/sensitivity.md  상수마다 값별 지표와 판정
  tables/evidence.md     상수 목록 전체의 근거 표(상수 / 값 / 근거 종류 / 측정 결과와 범위 / 결정 / 다시 잴 조건)
  tables/units.md        단위 모드(clip / 턴마다 묶음 / chunk)와 모델·프롬프트 비교
  tables/noise.md        잡음 폭과 결정성 확인
  tables/latency.md      Elice 호출 지연 분포와 API 상수 위치
  tables/extract.md      전사별 추출 차이
  tables/cost.md         장부 합계
  summary.json           판정 원자료

데이터 묶음(정렬본, 재배치 합성, 실녹음)과 백엔드는 섞지 않는다. 판정도 따로 낸다.
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path

from stt.eval import constants as C
from stt.eval import sensitivity as S

PRIMARY = {"punct": ("punct_err", "문장 끝 오류"), "edge": ("edge_err", "가장자리 오류"), "lost": ("lost", "잃은 발화")}


def _runs_of(values, series) -> str:
    """값이 이어지는 구간마다 같은 수를 묶는다. 예: "0.5: 21, 1: 15, 2~8: 14"."""
    out, i = [], 0
    while i < len(values):
        j = i
        while j + 1 < len(values) and series[values[j + 1]] == series[values[i]]:
            j += 1
        lo, hi = S._fmt(values[i]), S._fmt(values[j])
        out.append(f"{lo if i == j else lo + '~' + hi}: {series[values[i]]}")
        i = j + 1
    return ", ".join(out)
KRW_PER_SEC = 6 / 60


def _kind(label: str) -> str:
    return "elice" if label.startswith("elice") else "local"


def load_runs(out: Path) -> dict[str, dict[str, dict]]:
    runs: dict[str, dict[str, dict]] = {}
    root = out / "runs"
    for d in sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []:
        runs[d.name] = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(d.glob("*.json"))}
    return runs


def _lost(s: str) -> tuple[int, int]:
    k, _, n = str(s).partition("/")
    return int(k or 0), int(n or 0)


def aggregate(run: dict, group: str) -> dict | None:
    recs = [r for r in run["sessions"].values() if r.get("group") == group]
    if not recs:
        return None
    ok = [r for r in recs if not r.get("error")]
    tot = lambda f: sum(f(r) for r in ok)  # noqa: E731
    p = lambda k: tot(lambda r: r["punct"].get(k, 0))  # noqa: E731
    e = lambda k: tot(lambda r: r["edge"].get(k, 0))  # noqa: E731
    err, ref = tot(lambda r: r["err_chars"]), tot(lambda r: r["ref_chars"])
    leak = [r.get("prompt_leak") for r in ok if r.get("prompt_leak") is not None]
    return {
        "n": len(ok), "err": err, "ref": ref, "cer": err / ref if ref else None,
        "lost": tot(lambda r: _lost(r["lost_utterances"])[0]), "n_truth": tot(lambda r: _lost(r["lost_utterances"])[1]),
        "gated": tot(lambda r: r["gated"]), "calls": tot(lambda r: r["calls"]),
        "audio_s": round(tot(lambda r: r["audio_sent_s"]), 1), "stt_s": round(tot(lambda r: r["stt_s"]), 1),
        "halluc": tot(lambda r: r["halluc"]), "char_ins": tot(lambda r: r["char_ins"]),
        "lines": tot(lambda r: r["n_lines"]), "clips": tot(lambda r: r["clips"]), "turns": tot(lambda r: r["turns"]),
        "long_splits": tot(lambda r: r["long_splits"]),
        "spread": max((r["spread_cer"] for r in ok if r.get("spread_cer") is not None), default=None),
        "punct_err": (p("ref_ends") - p("matched")) + (p("hyp_ends") - p("matched")),
        "punct_ref": p("ref_ends"), "punct_matched": p("matched"),
        "join_need": p("joins_needing_end"), "join_kept": p("joins_needing_end_kept"),
        "join_without": p("joins_without_end"), "join_invented": p("joins_invented_end"),
        "edge_err": e("edge_errors"), "edge_chars": e("edge_chars"),
        "inner_err": e("inner_errors"), "inner_chars": e("inner_chars"),
        "paid_krw": round(tot(lambda r: r.get("paid_krw") or 0), 2),
        "moved": tot(lambda r: r.get("moved_chars") or 0),
        "prompt_leak": sum(leak) if leak else None,
        "term_ref": tot(lambda r: (r.get("terms") or {}).get("ref_terms", 0)),
        "term_hit": tot(lambda r: (r.get("terms") or {}).get("hit", 0)),
        "fp": tuple(sorted((r["session"], r["input_fp"], r["lines_fp"]) for r in ok)),
        "errors": sorted(r["session"] for r in recs if r.get("error")),
        "p95": None,
    }


def noise_band(runs: dict[str, dict], group: str, kind: str) -> dict:
    """base 와 잡음 설정(로컬은 dither 씨앗 전부, 원격은 rep 전부)의 범위."""
    prefix = "dither" if kind == "local" else "rep"
    extra = sorted((i for i in runs if i.startswith(prefix) and i[len(prefix):].isdigit()),
                   key=lambda i: int(i[len(prefix):]))
    present = [i for i in ["base", *extra] if i in runs]
    aggs = [a for a in (aggregate(runs[i], group) for i in present) if a]
    keys = ("err", "lost", "punct_err", "edge_err", "lines", "halluc", "moved")
    band = {k: (max(a[k] for a in aggs) - min(a[k] for a in aggs)) if len(aggs) >= 2 else 0 for k in keys}
    band.update({"settings": present, "n": len(aggs), "values": [a["err"] for a in aggs]})
    return band


def _points(runs: dict[str, dict], path: str, group: str) -> dict:
    """{값: 집계}. 기본값 자리는 base 다."""
    pts = {}
    if "base" in runs:
        a = aggregate(runs["base"], group)
        if a:
            pts[C.current_value(path)] = a
    for rec in runs.values():
        ov = rec["setting"].get("overrides") or []
        if len(ov) == 1 and ov[0][0] == path:
            a = aggregate(rec, group)
            if a:
                pts[ov[0][1]] = a
    return pts


def _direction(changed, pts, default, noise, errs) -> str:
    """움직인 값들이 기본값보다 나은 쪽인가 나쁜 쪽인가. 오류 글자와 잃은 발화는 적을수록 낫다."""
    better = worse = False
    for v in changed:
        if v in errs:
            worse = True
            continue
        de = pts[v]["err"] - pts[default]["err"]
        dl = pts[v]["lost"] - pts[default]["lost"]
        better |= de < -noise["err"] or dl < 0
        worse |= de > noise["err"] or dl > 0
    return {(True, False): "개선 쪽", (False, True): "악화 쪽", (True, True): "양쪽"}.get((better, worse), "")


def constant_verdict(runs: dict[str, dict], path: str, group: str, noise: dict) -> dict | None:
    default = C.current_value(path)
    pts = _points(runs, path, group)
    if default not in pts or len(pts) < 2:
        return None
    values = sorted(pts)
    errs = {v for v in values if pts[v]["errors"]}
    if not errs and S.inactive({v: pts[v]["fp"] for v in values}, default):
        return {"label": S.INACTIVE, "values": values, "points": pts, "noise": noise["err"]}
    lost_moved = {v for v in values if abs(pts[v]["lost"] - pts[default]["lost"]) > noise["lost"]}
    got = S.classify(values, default, {v: (None if v in errs else pts[v]["err"]) for v in values}, noise["err"],
                     errors=errs | lost_moved)
    got.update({"errors": sorted(errs), "lost_changed": sorted(lost_moved), "values": values, "points": pts,
                "noise": noise["err"], "metric": "오류 글자·잃은 발화",
                "direction": _direction(got["changed"], pts, default, noise, errs)})
    c = C.BY_PATH[path]
    if c.metric == "lines":
        # 줄 수는 좋고 나쁨이 없다. 어느 값에서 줄이 합쳐지고 갈리는지만 적고, 좋고 나쁨은 추출 표에서 본다
        got["primary"] = {"text": "줄 수 " + _runs_of(values, {v: pts[v]["lines"] for v in values})}
    elif c.metric in PRIMARY:
        key, name = PRIMARY[c.metric]
        pv = S.classify(values, default, {v: (None if v in errs else pts[v][key]) for v in values}, noise.get(key, 0),
                        errors=errs)
        got["primary"] = {**pv, "metric": name, "noise": noise.get(key, 0)}
    return got


# ─────────────────────────────────────────────────────────── 표
def _f(v, nd=2):
    if v is None:
        return "-"
    return f"{v:.{nd}f}" if isinstance(v, float) else str(v)


def _row(v, a: dict, base: dict | None, kind: str) -> dict:
    d = None if base is None else a["err"] - base["err"]
    return {"값": S._fmt(v) if not isinstance(v, str) else v, "오류 글자": a["err"],
            "Δ": "-" if d is None else f"{d:+d}", "CER": f"{a['cer'] * 100:.2f}%" if a["cer"] is not None else "-",
            "화자별 흩어짐": _f(a["spread"]), "삽입 글자": a["char_ins"], "잃은 발화": f"{a['lost']}/{a['n_truth']}",
            "거름": a["gated"], "문장 끝 오류": a["punct_err"],
            "이음 마침표 유지": f"{a['join_kept']}/{a['join_need']}", "이음 마침표 생성": f"{a['join_invented']}/{a['join_without']}",
            "가장자리 오류": f"{a['edge_err']}/{a['edge_chars']}", "턴 경계 넘은 글자": a["moved"],
            "환각 구절": a["halluc"], "용어 재현": f"{a['term_hit']}/{a['term_ref']}",
            "프롬프트 누설": "-" if a["prompt_leak"] is None else a["prompt_leak"], "줄": a["lines"],
            "클립": a["clips"], "호출": a["calls"], "보낸 초": a["audio_s"], "전사 초": a["stt_s"],
            "원": _f(a["audio_s"] * KRW_PER_SEC, 1) if kind == "elice" else "0",
            "실행 오류": ",".join(a["errors"]) or "-"}


def _verdict_line(v: dict) -> str:
    if v["label"] == S.INACTIVE:
        return f"판정 {S.INACTIVE}. 어느 값에서도 모델 입력과 줄 구조가 기본값과 같다"
    label = v["label"] + (f"({v['direction']})" if v.get("direction") else "")
    s = (f"판정 {label}. 평탄 구간 {S._fmt(v['flat_lo'])}~{S._fmt(v['flat_hi'])} "
         f"(오류 글자 잡음 폭 {v['noise']}, 잃은 발화 변화 {', '.join(S._fmt(x) for x in v['lost_changed']) or '없음'})")
    if v.get("errors"):
        s += f". 실행 오류 값 {', '.join(S._fmt(x) for x in v['errors'])}"
    if v.get("primary", {}).get("text"):
        s += f". {v['primary']['text']}"
    elif v.get("primary"):
        p = v["primary"]
        s += f". 주 지표 {p['metric']}: {p['label']}, 평탄 {S._fmt(p['flat_lo'])}~{S._fmt(p['flat_hi'])} (잡음 폭 {p['noise']})"
    return s


def _groups(runs: dict[str, dict]) -> list[str]:
    gs = []
    for rec in runs.values():
        for r in rec["sessions"].values():
            if r.get("group") and r["group"] not in gs:
                gs.append(r["group"])
    return sorted(gs)


def report(out: Path) -> dict:
    all_runs = load_runs(out)
    tables = out / "tables"
    tables.mkdir(parents=True, exist_ok=True)
    verdicts: dict[str, list[dict]] = {}
    summary: dict = {"noise": {}, "verdicts": {}}
    sens = ["# 상수 민감도", "", "상수 하나를 기본값 주변에서 흔들고 나머지는 기본값이다. Δ 는 기본값 대비 오류 글자 차이. "
            "판정 규칙은 `stt/eval/sensitivity.py` 머리말.", ""]
    noise_md = ["# 잡음 폭", ""]
    for label, runs in all_runs.items():
        kind = _kind(label)
        for group in _groups(runs):
            band = noise_band(runs, group, kind)
            summary["noise"][f"{label}|{group}"] = band
            noise_md += [f"{label}, {group}: 설정 {', '.join(band['settings'])} 의 오류 글자 {band['values']} → "
                         f"잡음 폭 {band['err']}자 (잃은 발화 {band['lost']}, 문장 끝 {band['punct_err']}, "
                         f"가장자리 {band['edge_err']}, 줄 {band['lines']})", ""]
    for c in C.REGISTRY:
        if not c.sweep:
            continue
        block = []
        for label, runs in all_runs.items():
            kind = _kind(label)
            for group in _groups(runs):
                band = summary["noise"][f"{label}|{group}"]
                v = constant_verdict(runs, c.path, group, band)
                if v is None:
                    continue
                pr = v.get("primary") or {}
                note = pr.get("text") or (f"{pr['metric']} {pr['label']}{S.range_text(pr['flat_lo'], pr['flat_hi'])}"
                                          if pr else "")
                if v.get("lost_changed"):
                    note = (note + ". " if note else "") + "잃은 발화가 달라진 값 " + ", ".join(
                        S._fmt(x) for x in v["lost_changed"])
                entry = {"backend": label, "group": group,
                         "label": v["label"] + (f"({v['direction']})" if v.get("direction") else ""),
                         "flat_lo": v.get("flat_lo"),
                         "flat_hi": v.get("flat_hi"), "noise": v["noise"], "metric": "오류 글자·잃은 발화",
                         "errors": v.get("errors", []), "note": note}
                verdicts.setdefault(c.path, []).append(entry)
                summary["verdicts"].setdefault(c.path, []).append(
                    {**entry, "lost_changed": v.get("lost_changed", []),
                     "primary": {k: x for k, x in (v.get("primary") or {}).items() if k != "points"} or None})
                base = v["points"][C.current_value(c.path)]
                rows = [_row(x, v["points"][x], base, kind) for x in v["values"]]
                block += [f"{label}, {group}. {_verdict_line(v)}", "", S.md_table(rows)]
        if block:
            sens += [f"## {c.name} (기본 {S._fmt(C.current_value(c.path))})", "", c.affects, "", *block]
    (tables / "sensitivity.md").write_text("\n".join(sens) + "\n", encoding="utf-8")
    (tables / "noise.md").write_text("\n".join(noise_md + determinism(all_runs)) + "\n", encoding="utf-8")
    for c in C.REGISTRY:
        # 백엔드에 따라 갈릴 수 있는 상수는 Elice 결과가 없으면 없다고 적는다. 로컬 판정만 보이면 넓혀 읽기 쉽다
        if c.elice and not any(v["backend"].startswith("elice") for v in verdicts.get(c.path, [])):
            verdicts.setdefault(c.path, []).append({"backend": "elice", "group": "", "text": "아직 안 잼"})
    lat_md, lat_verdicts = latency(all_runs)
    verdicts.update(lat_verdicts)
    al_md, al_verdicts = align_section(out, all_runs)
    verdicts.update(al_verdicts)
    if al_md:
        (tables / "align.md").write_text(al_md, encoding="utf-8")
    (tables / "latency.md").write_text(lat_md, encoding="utf-8")
    ev = S.evidence_rows(C.REGISTRY, verdicts)
    (tables / "evidence.md").write_text(
        "# 상수 근거 표\n\n`python -m stt.eval.sensitivity report` 가 만든다. 측정 결과는 백엔드와 데이터 묶음마다 따로다.\n\n"
        + S.md_table(ev), encoding="utf-8")
    (tables / "units.md").write_text(units(all_runs), encoding="utf-8")
    (tables / "cost.md").write_text(cost(out), encoding="utf-8")
    try:
        from stt.eval import extract_diff as X
        rows = X.report(out)
        if rows:
            (tables / "extract.md").write_text(
                "# 전사별 할일 추출 차이\n\n정답 전사 추출 합의 대비. 여러 회차는 / 로 잇는다. 첫 줄은 LLM 흔들림 폭. "
                "의도는 찾음·담당자 맞음·마감 맞음/의도 수.\n\n" + S.md_table(rows) + "\n" + json.dumps(X.cost(out), ensure_ascii=False)
                + "\n", encoding="utf-8")
    except FileNotFoundError:
        pass
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return summary


def determinism(all_runs: dict[str, dict]) -> list[str]:
    out = ["## 결정성", ""]
    for label, runs in all_runs.items():
        if "base" in runs and "repeat" in runs:
            b, r = runs["base"]["sessions"], runs["repeat"]["sessions"]
            same = [s for s in b if s in r and b[s].get("hyp_by_speaker") == r[s].get("hyp_by_speaker")]
            out += [f"{label}: 캐시 없이 같은 입력을 다시 전사한 회의 {len([s for s in b if s in r])}개 중 전사가 글자까지 같은 회의 "
                    f"{len(same)}개", ""]
    return out


def units(all_runs: dict[str, dict]) -> str:
    md = ["# 단위 모드와 모델", "", "chunk 가 기본(턴을 채운 묶음), mode=turn 은 턴마다 묶음 하나(pack_turns 끔), "
          "mode=clip 은 클립 하나씩. prompt 는 initial_prompt 에 참석자 이름(names)이나 이름+팀 용어(glossary).", ""]
    for label, runs in all_runs.items():
        kind = _kind(label)
        for group in _groups(runs):
            rows = []
            for sid in ("base", "mode=turn", "mode=clip", "prompt=names", "prompt=glossary"):
                if sid in runs:
                    a = aggregate(runs[sid], group)
                    if a:
                        rows.append(_row("chunk" if sid == "base" else sid, a, aggregate(runs["base"], group), kind))
            if rows:
                md += [f"{label}, {group}", "", S.md_table(rows)]
    return "\n".join(md) + "\n"


PREVIOUS = Path(__file__).resolve().parent / "results" / "2026-09-16-batch"


def previous_latency(folder: Path = PREVIOUS) -> list[dict]:
    """이전 결과 폴더(2026-09-16)의 Elice 설정별 지연. 호출별 기록은 없고 p50·p95·20초 넘은 수만 있다."""
    rows = []
    for f in sorted(folder.glob("*/score_*.json")) if folder.exists() else []:
        r = json.loads(f.read_text(encoding="utf-8"))
        if not str(r.get("backend", "")).startswith("elice"):
            continue
        rows.append({"회의": f.parent.name, "설정": r.get("mode", "?") + (f"-{r['tag']}" if r.get("tag") else ""),
                     "호출": r.get("calls"), "p50": r.get("transcribe_p50_s"), "p95": r.get("transcribe_p95_s"),
                     "20초 넘음": r.get("calls_over_20s"), "재시도": r.get("retries"), "실패": r.get("failed")})
    return rows


def latency(all_runs: dict[str, dict]) -> tuple[str, dict]:
    """Elice 호출 지연. 캐시에서 온 것은 빼고 실제로 보낸 호출만. 이전 결과 폴더의 설정별 값도 붙인다."""
    calls = [c for label, runs in all_runs.items() if _kind(label) == "elice"
             for rec in runs.values() for r in rec["sessions"].values() for c in r.get("call_log", [])
             if not c["cached"]]
    retries = sum(r.get("retries") or 0 for label, runs in all_runs.items() if _kind(label) == "elice"
                  for rec in runs.values() for r in rec["sessions"].values())
    md = ["# Elice 호출 지연", ""]
    verdicts: dict[str, list[dict]] = {}
    prev = previous_latency(PREVIOUS)
    if prev:
        # 트랙 통째(whole)는 오디오가 길어 20초를 넘는 것이 당연하다. 멈춤 문턱의 근거는 묶음·클립 호출만 센다
        cc = [r for r in prev if not str(r["설정"]).startswith("whole")]
        n = sum(r["호출"] or 0 for r in cc)
        over = sum(r["20초 넘음"] or 0 for r in cc)
        md += [f"이전 측정(`stt/eval/results/2026-09-16-batch`, 정렬본 두 회의 Elice 설정 {len(prev)}개): 트랙 통째를 뺀 "
               f"chunk·clip 호출 {n}건 중 20초 넘은 호출 {over}건, 재시도 {sum(r['재시도'] or 0 for r in prev)}건, "
               f"실패 {sum(r['실패'] or 0 for r in prev)}건. 설정별 p50·p95 는 아래 표.", "", S.md_table(prev), ""]
        verdicts["stt.batch.STALL_S"] = [{"backend": "elice", "group": "2026-09-16 결과",
                                          "text": f"chunk·clip 호출 {n}건 중 20초 넘음 {over}건 (설정별 p95 "
                                                  f"{min(r['p95'] for r in cc):.1f}~{max(r['p95'] for r in cc):.1f}초)"}]
    ok = sorted(c["dt"] for c in calls if not c["error"])
    fails = [c for c in calls if c["error"]]
    if not calls:
        md.append("이번 측정에서 Elice 로 보낸 호출이 없다.")
        return "\n".join(md) + "\n", verdicts
    if not ok:
        md.append(f"이번 측정에서 보낸 호출 {len(calls)}건이 전부 실패했다(시간 초과 {sum(1 for c in fails if 'Timeout' in str(c['error']))}건).")
        return "\n".join(md) + "\n", verdicts
    from stt.batch import STALL_S
    from stt.elice import EliceStt

    t = EliceStt()
    over = sum(1 for x in ok if x > STALL_S)
    near = max((c["dt"] / t.timeout_for(c["audio_s"]) for c in calls if not c["error"]), default=0)
    pct = lambda p: ok[min(len(ok) - 1, int(round((len(ok) - 1) * p)))]  # noqa: E731
    md += [f"보낸 호출 {len(calls)}건(실패 {len(fails)}건, 재시도 {retries}건). 걸린 시간 p50 {statistics.median(ok):.2f}초, "
           f"p90 {pct(0.9):.2f}초, p95 {pct(0.95):.2f}초, 최대 {ok[-1]:.2f}초. STALL_S({STALL_S:g}초) 넘은 호출 {over}건"
           f"({over / len(ok) * 100:.1f}%). 타임아웃(30초 + 오디오 1초당 0.6초) 대비 가장 오래 걸린 호출은 한도의 "
           f"{near * 100:.0f}%.", ""]
    rows = []
    for lo, hi in ((0, 5), (5, 10), (10, 20), (20, 30), (30, 999)):
        xs = sorted(c["dt"] for c in calls if not c["error"] and lo <= c["audio_s"] < hi)
        if xs:
            rows.append({"오디오 길이": f"{lo}~{hi if hi < 999 else ''}초", "호출": len(xs), "p50": _f(statistics.median(xs)),
                         "최대": _f(xs[-1]), f"{STALL_S:g}초 넘음": sum(1 for x in xs if x > STALL_S)})
    md += [S.md_table(rows), ""]
    txt = f"호출 {len(ok)}건 p50 {statistics.median(ok):.1f}초 p95 {pct(0.95):.1f}초, {STALL_S:g}초 넘음 {over}건"
    verdicts.setdefault("stt.batch.STALL_S", []).append({"backend": "elice", "group": "이번 측정", "text": txt})
    verdicts["stt.elice.EliceStt.TIMEOUT_PER_AUDIO_S"] = [
        {"backend": "elice", "group": "전체", "text": f"가장 오래 걸린 호출이 타임아웃 한도의 {near * 100:.0f}%, 시간 초과 {len(fails)}건"}]
    for p in ("stt.batch.RETRIES", "stt.batch.RETRY_WAIT_S"):
        verdicts[p] = [{"backend": "elice", "group": "전체",
                        "text": f"호출 {len(calls)}건 중 실패 {len(fails)}건, 재시도 {retries}건. 실패율을 가를 만한 표본이 아니다"}]
    return "\n".join(md) + "\n", verdicts


def align_section(out: Path, all_runs: dict[str, dict]) -> tuple[str, dict]:
    """정렬본을 만드는 상수(RUN_GAP_S, PLACE_GAP_S)를 바꿔 다시 만든 정렬본. wav·묶음 입력이 바뀌었나와 기본 설정 전사 오류."""
    p = out / "align_sweep.json"
    if not p.exists():
        return "", {}
    rows = json.loads(p.read_text(encoding="utf-8"))
    err = {}
    for label in sorted(all_runs, key=lambda x: x != "local-large-v3-turbo"):
        base = all_runs[label].get("base")
        for sname, r in (base or {}).get("sessions", {}).items():
            if not r.get("error"):
                err.setdefault(sname, (label, r["err_chars"]))
    table, verdicts = [], {}
    for const in dict.fromkeys(r["const"] for r in rows):
        mine = [r for r in rows if r["const"] == const]
        default = C.current_value(const)
        ref = {r["source"]: r for r in mine if r["value"] == default}
        for r in mine:
            d = ref.get(r["source"])
            e = err.get(r["session"])
            table.append({"원본": r["source"], "상수": const.rsplit(".", 1)[1], "값": S._fmt(r["value"]),
                          "wav": "기본과 같음" if d and d["wav"] == r["wav"] else "다름",
                          "묶음 입력": "기본과 같음" if d and d["chunks"] == r["chunks"] else "다름",
                          "오류 글자": "-" if e is None else f"{e[1]} ({e[0]})"})
        vals = sorted({r["value"] for r in mine})
        rng = f"{S._fmt(vals[0])}~{S._fmt(vals[-1])}"
        if all(ref.get(r["source"]) and ref[r["source"]]["wav"] == r["wav"] for r in mine):
            text = f"{rng} 에서 정렬본 wav 같음 (발동 안 함)"
        else:
            changed = sorted({r["source"] for r in mine if ref.get(r["source"]) and ref[r["source"]]["chunks"] != r["chunks"]})
            per: dict[str, set] = {}
            for r in mine:
                if r["session"] in err:
                    per.setdefault(r["source"], set()).add(err[r["session"]][1])
            if not per:
                tail = ", 전사 안 함"
            elif all(len(x) == 1 for x in per.values()):
                tail = ", 오류 글자는 원본마다 값과 무관하게 같음 (" + ", ".join(
                    f"{k} {next(iter(x))}" for k, x in per.items()) + ")"
            else:
                tail = ", 오류 글자 " + ", ".join(f"{k} {min(x)}~{max(x)}" for k, x in per.items())
            text = f"{rng} 에서 wav 달라짐, 묶음 입력이 달라진 원본 {', '.join(changed) or '없음'}{tail}"
        verdicts[const] = [{"backend": "정렬", "group": "원본 7발화판", "text": text}]
    md = ("# 정렬본을 만드는 상수\n\n원본 골든셋(대본 7발화판)을 상수만 바꿔 다시 정렬했다. 기본값 정렬본은 기존 정렬본과 "
          "바이트까지 같다. 오류 글자는 그 정렬본에 기본 설정을 돌린 값이다.\n\n" + S.md_table(table))
    return md, verdicts


def cost(out: Path) -> str:
    p = out / S.LEDGER
    entries = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.exists() else []
    stt = [e for e in entries if e.get("kind") == "stt"]
    llm = [e for e in entries if e.get("kind") == "llm"]
    return ("# 비용\n\n"
            f"Elice 전사 {len(stt)}건 기록, 보낸 오디오 {sum(e.get('audio_s', 0) for e in stt):.0f}초, "
            f"{sum(e['krw'] for e in stt):.1f}원 (6원/60초).\n\n"
            f"추출 LLM {len(llm)}회, 입력 {sum(e.get('tokens_in', 0) for e in llm)} 토큰, 출력 "
            f"{sum(e.get('tokens_out', 0) for e in llm)} 토큰, {sum(e['krw'] for e in llm):.2f}원 "
            "(gemini-2.5-flash-lite Google 공시 단가 입력 $0.10/1M·출력 $0.40/1M, 1,400원/$ 가정).\n\n"
            f"합계 {sum(e['krw'] for e in entries):.1f}원.\n")
