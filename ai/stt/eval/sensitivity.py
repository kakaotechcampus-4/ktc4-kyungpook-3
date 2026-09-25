"""전사 상수의 민감도 측정. 골든 폴더의 모든 회의에 같은 행렬을 돌리고 판정과 근거 표를 만든다.

상수 목록(stt/eval/constants.py)에서 흔들 값이 있는 상수마다 기본값 주변을 한 번에 하나씩 바꾼다.
나머지는 기본값이다. 운영 코드는 고치지 않고 constants.overrides 로 바꿔 끼운다. 모델에 간 조각은
내용 해시로 캐시해(stt/eval/sttcache.py) 같은 조각을 다시 계산하지 않는다.

회의마다 남기는 것: CER, 절대 오류 글자, 화자별 흩어짐, 삽입, 잃은 발화, 문장 끝 보존(이음 자리 따로),
클립 가장자리 오류, 환각 구절, 줄 수, 호출 수, 보낸 오디오 초, 호출별 전사 시간, 비용, 모델 입력 지문.

판정(상수마다, 데이터 묶음마다, 백엔드마다):
  평탄       모든 값이 잡음 폭 안. 기본값을 방어할 수 있다. 평탄 구간을 적는다
  경사       기본값 바로 옆은 잡음 안인데 먼 값에서 움직인다. 비용과 맞바꾸는 선택으로 적는다
  절벽       기본값 바로 옆 값에서 잡음 폭을 넘는다(실행 오류 포함). 위험으로 표시한다
  발동 안 함 어느 값에서도 모델 입력과 줄 구조가 같다. 이 데이터로는 판정할 수 없다
잡음 폭: 로컬은 들리지 않는 디더(1 LSB) 3회, 원격은 같은 설정 반복의 오류 글자 범위.

사용 (ai/ 안에서):
  .venv/bin/python -m stt.eval.sensitivity run --golden-root "<골든 폴더>" --out <결과> --cache ~/.cache/mm-stt-eval
  .venv/bin/python -m stt.eval.sensitivity run ... --backend elice --yes          # Elice. 예산 장부를 본다
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from stt import batch as B
from stt.eval import constants as C
from stt.eval import golden
from stt.eval import textmetrics as T
from stt.eval.sttcache import CachedStt
from stt.speech_gate import SpeechGate

FLAT, SLOPE, CLIFF, INACTIVE = "평탄", "경사", "절벽", "발동 안 함"

TEAM_TERMS = ("STT", "GPU", "API", "Notion", "Discord", "PM", "BE", "FE", "WER", "CER", "large-v3-turbo", "Whisper")


# ─────────────────────────────────────────────────────────── 행렬
@dataclass(frozen=True)
class Setting:
    id: str
    group: str
    mode: str = "chunk"
    pack_turns: bool = True
    overrides: tuple = ()
    prompt: str = ""              # "" | names | glossary
    dither_seed: int | None = None
    fresh: bool = False           # 캐시를 읽지 않는다(결정성 확인, 원격 반복)


BASE = Setting("base", "base")


def _fmt(v) -> str:
    return f"{v:g}" if isinstance(v, float) else str(v)


def plan_sweep(consts, priorities=(C.P_UNIT, C.P_VAD, C.P_GATE), only: set[str] | None = None) -> list[Setting]:
    out = []
    for c in consts:
        if not c.sweep or c.priority not in priorities or (only and c.name not in only):
            continue
        d = C.current_value(c.path)
        for v in c.sweep:
            if v == d and type(v) is type(d):
                continue
            out.append(Setting(f"{c.name}={_fmt(v)}", f"const:{c.path}", overrides=((c.path, v),)))
    return out


def plan_noise(backend_kind: str) -> list[Setting]:
    if backend_kind == "elice":
        return [Setting(f"rep{i}", "noise", fresh=True) for i in (1, 2)]
    return [Setting("repeat", "noise", fresh=True)] + [Setting(f"dither{s}", "noise", dither_seed=s) for s in (1, 2, 3)]


def plan_units() -> list[Setting]:
    return [Setting("mode=clip", "units", mode="clip"), Setting("mode=turn", "units", pack_turns=False)]


def plan_prompt() -> list[Setting]:
    return [Setting("prompt=names", "prompt", prompt="names"), Setting("prompt=glossary", "prompt", prompt="glossary")]


def full_plan(backend_kind: str, *, priorities=(C.P_UNIT, C.P_VAD, C.P_GATE), only=None,
              prompt: bool = True) -> list[Setting]:
    consts = C.REGISTRY if backend_kind != "elice" else [c for c in C.REGISTRY if c.elice]
    plan = [BASE, *plan_noise(backend_kind), *plan_units(), *plan_sweep(consts, priorities, only)]
    return plan + (plan_prompt() if prompt else [])


# ─────────────────────────────────────────────────────────── 판정
def classify(values, default, series: dict, noise: float, *, errors=()) -> dict:
    """series[v] 가 기본값 대비 noise 를 넘거나 None(실행 실패)이면 움직인 것으로 본다."""
    vals = sorted(values)
    d = vals.index(default)
    base = series[default]
    errs = set(errors)

    def moved(v) -> bool:
        return v in errs or series.get(v) is None or abs(series[v] - base) > noise

    lo = d
    while lo - 1 >= 0 and not moved(vals[lo - 1]):
        lo -= 1
    hi = d
    while hi + 1 < len(vals) and not moved(vals[hi + 1]):
        hi += 1
    changed = [v for v in vals if v != default and moved(v)]
    if not changed:
        label = FLAT
    elif (d > 0 and moved(vals[d - 1])) or (d + 1 < len(vals) and moved(vals[d + 1])):
        label = CLIFF
    else:
        label = SLOPE
    return {"label": label, "flat_lo": vals[lo], "flat_hi": vals[hi], "changed": changed, "errors": sorted(errs)}


def inactive(fingerprints: dict, default) -> bool:
    """값마다 (모델 입력 지문, 줄 구조 지문). 전부 기본값과 같으면 이 데이터에서 발동하지 않은 것이다."""
    return all(fp == fingerprints[default] for fp in fingerprints.values())


# ─────────────────────────────────────────────────────────── 근거 표
def _verdict_text(v: dict) -> str:
    head = f"{v['backend']} {v['group']}: "
    if v.get("text"):
        return head + v["text"]
    if v["label"] == INACTIVE:
        return head + INACTIVE
    s = f"{v['label']} {_fmt(v['flat_lo'])}~{_fmt(v['flat_hi'])} ({v['metric']}, 잡음 폭 {_fmt(v['noise'])})"
    if v.get("errors"):
        s += f", 실행 오류 {', '.join(_fmt(e) for e in v['errors'])}"
    return head + s


def evidence_rows(consts, verdicts: dict[str, list[dict]]) -> list[dict]:
    rows = []
    for c in consts:
        vs = verdicts.get(c.path)
        if vs:
            result = "; ".join(_verdict_text(v) for v in vs)
        elif c.evidence == C.MEASURED:
            result = "아직 안 잼"
        else:
            result = c.source or "-"
        rows.append({"상수": c.path, "값": C.source_value(c.path), "쓰이는 자리": c.scope, "근거 종류": c.evidence,
                     "측정 결과와 범위": result, "결정": c.decision, "다시 잴 조건": c.recheck or "-"})
    return rows


def md_table(rows: list[dict], headers: list[str] | None = None) -> str:
    if not rows:
        return "(없음)\n"
    headers = headers or list(rows[0])
    cell = lambda x: "-" if x is None else str(x).replace("|", "/").replace("\n", " ")  # noqa: E731
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(cell(r.get(h)) for h in headers) + " |" for r in rows]
    return "\n".join(out) + "\n"


# ─────────────────────────────────────────────────────────── 회의와 프롬프트
def group_of(session: Path) -> str:
    """결과를 묶는 데이터 이름. 합성 여부가 이름에 드러나야 한다."""
    mp = session / "meta.json"
    meta = json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {}
    if meta.get("kind") == "synthetic-rearranged":
        return "재배치 합성"
    if "합성" in str(meta.get("timeline", "")):
        return "정렬본(시간축 합성)"
    return {"real": "실녹음"}.get(meta.get("kind"), meta.get("kind") or "기타")


def discover_sessions(roots: list[Path]) -> list[Path]:
    """truth_by_speaker.json, truth_aligned.json, 화자 wav 가 있는 폴더. 뿌리 자체도 본다."""
    out = []
    for root in roots:
        for d in [root, *sorted(p for p in root.iterdir() if p.is_dir())]:
            if (d / "truth_by_speaker.json").exists() and (d / "truth_aligned.json").exists() and any(d.glob("*.wav")):
                out.append(d)
    return out


def _names(session: Path) -> list[str]:
    return list(json.loads((session / "truth_by_speaker.json").read_text(encoding="utf-8")))


def prompt_for(kind: str, session: Path) -> str:
    """회의 참석자 이름(운영에서는 매니페스트의 표시 이름)과 팀 용어. 대본 용어와 겹치는 것이 있어 따로 읽는다."""
    if not kind:
        return ""
    s = f"참석자 {', '.join(_names(session))}."
    return s if kind == "names" else f"{s} 용어 {', '.join(TEAM_TERMS)}."


class _PromptedModel:
    def __init__(self, model, prompt: str):
        self.model, self.prompt = model, prompt

    def transcribe(self, audio, **kw):
        return self.model.transcribe(audio, initial_prompt=self.prompt, **kw)


def set_prompt(backend, text: str) -> None:
    from stt.local import LocalStt

    if isinstance(backend, LocalStt):
        m = backend._load()
        m = m.model if isinstance(m, _PromptedModel) else m
        backend._model = _PromptedModel(m, text) if text else m
    elif hasattr(backend, "set_prompt"):
        backend.set_prompt(text)
    elif text:
        raise ValueError(f"{getattr(backend, 'name', backend)} 는 프롬프트를 받지 않는다")


def dither(seed: int, sigma: float = 3e-5):
    """16비트 1 LSB 크기의 가우스 잡음. 들리지 않는 입력 변화가 결과를 얼마나 흔드는지 잰다."""
    rng = np.random.default_rng(seed)
    return lambda audio, sr: (audio + rng.normal(0.0, sigma, len(audio))).astype(np.float32)


# ─────────────────────────────────────────────────────────── 측정
def merged_lines(lines: list) -> list:
    out = B.merge_turns(lines)
    out.sort(key=lambda ln: (ln.start_ms, ln.speaker_id))
    for i, ln in enumerate(out, 1):
        ln.seq = i
    return out


def _sum(dicts: list[dict], keys) -> dict:
    return {k: sum(d.get(k) or 0 for d in dicts) for k in keys}


def _pct(xs, p):
    return None if not xs else xs[min(len(xs) - 1, int(round((len(xs) - 1) * p)))]


def score_lines(session: Path, lines: list, merged: list, stats, *, backend_kind: str, cached: CachedStt,
                prompt_text: str = "") -> dict:
    m = golden.session_metrics(session, merged, stats, backend_kind=backend_kind)
    truth_by = json.loads((session / "truth_by_speaker.json").read_text(encoding="utf-8"))
    names = list(truth_by)
    errs, puncts, edges = {}, [], []
    halluc = ins = leak = 0
    terms = {"ref_terms": 0, "hit": 0}
    ordered = sorted(lines, key=lambda ln: ln.start_ms)
    for spk, ref in truth_by.items():
        segs = [ln.text for ln in ordered if ln.speaker_id == spk and ln.text]
        hyp = " ".join(segs)
        ce = T.char_errors(ref, hyp)
        errs[spk] = ce
        ins += ce["ins"]
        puncts.append(T.punctuation(ref, segments=segs))
        edges.append(T.edge_errors(ref, segs))
        halluc += T.phrase_excess(ref, hyp)["total"]
        if prompt_text:
            leak += T.phrase_excess(ref, hyp, (*names, *TEAM_TERMS))["total"]
        tr = T.term_recall(ref, hyp, TEAM_TERMS)
        terms["ref_terms"] += tr["ref_terms"]
        terms["hit"] += tr["hit"]
    punct = _sum(puncts, ("ref_ends", "hyp_ends", "matched", "joins", "joins_needing_end", "joins_needing_end_kept",
                          "joins_without_end", "joins_invented_end"))
    edge = _sum(edges, ("edges", "edge_chars", "edge_errors", "inner_chars", "inner_errors"))
    cers = [e["errors"] / e["ref_chars"] for e in errs.values() if e["ref_chars"]]
    calls = list(cached.calls)
    dts = sorted(c["dt"] for c in calls if not c["error"])
    fresh = [c for c in calls if not c["cached"]]
    from stt.elice import whisper_krw
    structure = [[ln.speaker_id, ln.start_ms, ln.end_ms] for ln in merged if ln.text]
    return {
        "session": session.name, "group": group_of(session), **m,
        "err_chars": sum(e["errors"] for e in errs.values()), "ref_chars": sum(e["ref_chars"] for e in errs.values()),
        "err_by_speaker": {k: e["errors"] for k, e in errs.items()},
        "spread_cer": round(max(cers) - min(cers), 4) if cers else None,
        "char_ins": ins, "halluc": halluc, "prompt_leak": leak if prompt_text else None, "terms": terms,
        "punct": punct, "edge": edge,
        "n_lines": len(structure), "n_clip_lines": sum(1 for ln in lines if ln.text),
        "calls": stats.calls, "audio_sent_s": round(stats.audio_sent_s, 2), "clips": stats.clips,
        "turns": stats.turns, "long_splits": stats.long_splits, "unmapped": stats.unmapped,
        "retries": stats.retries,
        "stt_s": round(sum(dts), 2), "stt_p50": None if not dts else round(statistics.median(dts), 2),
        "stt_p95": None if not dts else round(_pct(dts, 0.95), 2),
        "fresh_calls": len(fresh), "cached_calls": len(calls) - len(fresh),
        "fresh_audio_s": round(sum(c["audio_s"] for c in fresh), 2),
        "paid_krw": round(whisper_krw(sum(c["audio_s"] for c in fresh)), 2) if backend_kind == "elice" else 0.0,
        "input_fp": cached.fingerprint(),
        "lines_fp": hashlib.sha256(json.dumps(structure).encode()).hexdigest()[:16],
        "clip_lines": [[ln.speaker_id, ln.start_ms, ln.end_ms, ln.text] for ln in lines],
        "call_log": [{"audio_s": round(c["audio_s"], 2), "dt": round(c["dt"], 3), "cached": c["cached"],
                      "error": c["error"]} for c in calls],
    }


def measure(setting: Setting, sessions: list[Path], *, backend_kind: str, backend, cache_dir: Path | None,
            workers: int | None = None) -> dict[str, dict]:
    """설정 하나를 회의 여럿에 돌린다. 덮어쓰기는 이 설정이 도는 동안에만 걸린다."""
    out: dict[str, dict] = {}
    w = workers if workers is not None else B.default_workers(backend_kind)
    for session in sessions:
        text = prompt_for(setting.prompt, session)
        set_prompt(backend, text)
        cached = CachedStt(backend, cache_dir, key_extra=f"prompt={text}" if text else "", read=not setting.fresh)
        pre = dither(setting.dither_seed) if setting.dither_seed is not None else None
        try:
            with C.overrides(dict(setting.overrides)):
                lines, stats = B.run(golden.session_tracks(session), cached, mode=setting.mode, gate=SpeechGate(),
                                     workers=w, pack_turns=setting.pack_turns, merge=False, preprocess=pre)
                merged = merged_lines(lines)
        except Exception as e:  # 값 하나가 실행을 깨면 그것도 결과다(절벽)
            out[session.name] = {"session": session.name, "group": group_of(session),
                                 "error": f"{type(e).__name__}: {e}"}
            continue
        out[session.name] = score_lines(session, lines, merged, stats, backend_kind=backend_kind, cached=cached,
                                        prompt_text=text)
    set_prompt(backend, "")
    return out


# ─────────────────────────────────────────────────────────── 실행
LEDGER = "ledger.jsonl"


def ledger_total(out: Path) -> float:
    p = out / LEDGER
    if not p.exists():
        return 0.0
    return sum(json.loads(x)["krw"] for x in p.read_text(encoding="utf-8").splitlines() if x.strip())


def ledger_add(out: Path, **entry) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with (out / LEDGER).open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), **entry}, ensure_ascii=False) + "\n")


def build_backend(kind: str, model: str):
    """(결과 폴더 이름, 백엔드). 로컬 모델은 이 프로세스에서 한 번만 올린다."""
    if kind == "elice":
        return "elice", B.make_backend("elice", "", "chunk")
    return f"local-{model}", B.make_backend("local", model, "chunk")


def run_plan(plan: list[Setting], sessions: list[Path], *, out: Path, label: str, kind: str, backend,
             cache_dir: Path | None, workers: int | None, yes: bool, budget: float) -> None:
    d = out / "runs" / label
    d.mkdir(parents=True, exist_ok=True)
    for st in plan:
        path = d / f"{st.id}.json"
        rec = json.loads(path.read_text(encoding="utf-8")) if path.exists() else \
            {"setting": asdict(st), "backend": label, "sessions": {}}
        todo = [s for s in sessions if s.name not in rec["sessions"]]
        if not todo:
            print(f"[skip] {label} {st.id}", flush=True)
            continue
        if kind == "elice":
            est = sum(sum(u.duration_s for u in B.cut(B.load_track(t.path), t.speaker_id))
                      for s in todo for t in golden.session_tracks(s)) * 0.1 * 1.3
            spent = ledger_total(out)
            if not yes:
                print(f"[견적] {st.id}: 약 {est:.0f}원 (누적 {spent:.0f}원). --yes 로 승인")
                return
            if spent + est > budget:
                print(f"[멈춤] {st.id}: 누적 {spent:.0f}원 + 예상 {est:.0f}원 > 상한 {budget:.0f}원", flush=True)
                return
        t0 = time.monotonic()
        res = measure(st, todo, backend_kind=kind, backend=backend, cache_dir=cache_dir, workers=workers)
        rec["sessions"].update(res)
        path.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        paid = sum(r.get("paid_krw") or 0 for r in res.values())
        if kind == "elice":
            ledger_add(out, kind="stt", setting=st.id, krw=paid,
                       audio_s=sum(r.get("fresh_audio_s") or 0 for r in res.values()))
        brief = " ".join(f"{r['session']}:{r.get('err_chars', 'ERR')}" for r in res.values())
        print(f"[run ] {label} {st.id} {time.monotonic() - t0:.0f}s 오류글자 {brief} 원 {paid:.1f}", flush=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="전사 상수 민감도 측정")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--golden-root", type=Path, action="append", required=True, help="정렬본 회의 폴더들의 부모. 여럿")
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--cache", type=Path, default=None, help="전사 캐시 폴더. 레포 밖에 둔다")
    r.add_argument("--backend", choices=["local", "elice"], default="local")
    r.add_argument("--model", default="large-v3-turbo")
    r.add_argument("--plan", default="all", help="all | base | noise | units | sweep | prompt (쉼표로 여럿)")
    r.add_argument("--priority", default="1,2,3", help="흔들 상수 우선순위. 1 전사 단위, 2 VAD, 3 게이트")
    r.add_argument("--only", default="", help="이 상수만 (이름, 쉼표로 여럿)")
    r.add_argument("--session", default="", help="이 회의만 (폴더 이름, 쉼표로 여럿)")
    r.add_argument("--workers", type=int, default=None)
    r.add_argument("--yes", action="store_true", help="유료 실행 승인")
    r.add_argument("--budget", type=float, default=4500.0, help="누적 원 상한. 장부(ledger.jsonl) 기준")
    r.add_argument("--no-prompt", action="store_true")
    a = ap.parse_args(argv)
    sessions = discover_sessions([g.expanduser() for g in a.golden_root])
    if a.session:
        keep = set(a.session.split(","))
        sessions = [s for s in sessions if s.name in keep]
    if not sessions:
        print("정답이 있는 회의 폴더가 없다", file=sys.stderr)
        return 1
    pri = tuple(int(x) for x in a.priority.split(",") if x)
    only = set(x for x in a.only.split(",") if x) or None
    plan = full_plan(a.backend, priorities=pri, only=only, prompt=not a.no_prompt)
    parts = set(a.plan.split(","))
    if "all" not in parts:
        keep = {"base": {"base"}, "noise": {"noise"}, "units": {"units"}, "prompt": {"prompt"}}
        groups = set().union(*(keep.get(x, set()) for x in parts))
        plan = [s for s in plan if s.group in groups or ("sweep" in parts and s.group.startswith("const:"))]
        if "base" not in parts and plan and plan[0].id != "base":
            plan = [BASE, *plan]
    label, backend = build_backend(a.backend, a.model)
    print(f"회의 {len(sessions)}개: {', '.join(s.name for s in sessions)} · 설정 {len(plan)}개 · {label}", flush=True)
    run_plan(plan, sessions, out=a.out.expanduser(), label=label, kind=a.backend, backend=backend,
             cache_dir=a.cache.expanduser() if a.cache else None, workers=a.workers, yes=a.yes, budget=a.budget)
    return 0


if __name__ == "__main__":
    sys.exit(main())
