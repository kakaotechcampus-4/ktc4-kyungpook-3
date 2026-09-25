"""전사 차이가 할일 추출에 주는 영향. 지민의 extract.llm.extract_tasks 를 호출만 한다.

기준은 정답 전사로 뽑은 할일이다. 같은 입력에도 LLM 결과가 흔들리므로 정답 전사로 세 번 뽑아
두 번 이상 나온 할일을 합의 기준으로 두고, 세 번 중 하나라도 나온 할일을 "아는 할일" 로 둔다.
각 전사에서 뽑은 할일을 이 기준과 짝지어 놓친 할일, 더한 할일, 담당자가 바뀐 것, 마감이 바뀐 것을
센다. 정답 추출 세 번끼리의 차이(하나를 빼고 나머지 둘을 기준으로 잰 값)를 LLM 흔들림으로 두고,
그 폭 안의 차이로는 승부를 말하지 않는다.

담당자는 할일 개수와 별개로 본다. first(1인칭)는 근거 문장을 말한 화자, 이름으로 지목한 것은 그
이름, group 은 "group" 이다. 마감은 LLM 이 계산한 날짜(코드가 검증한 것)를 비교한다. 재배치 합성
회의에는 의도한 할일을 적어 둔 expected_tasks.json 이 있어 담당자·마감 보존을 그 의도에 대고도 잰다.

LLM 호출은 openai SDK 의 chat.completions.parse 와 같은 json_schema(strict) 요청을 requests 로 보낸다.
openai 패키지가 공유 venv 에 없어서다(requirements.txt 에는 있다). 토큰 사용량을 호출마다 남기고
공시 단가로 원을 계산한다.

    python -m stt.eval.extract_diff run --golden-root "<골든>" --golden-root <합성> --out <결과> --yes
    python -m stt.eval.extract_diff report --out <결과>
"""

from __future__ import annotations

import argparse
import copy
import difflib
import json
import os
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import requests

from shared.schemas import Transcript, TranscriptSegment
from stt.eval.eval import nospace

# Google 공시 단가 (https://ai.google.dev/gemini-api/docs/pricing, 2026-09-26 확인). 엘리스 게이트웨이 단가는
# 공개 자료를 찾지 못했다. 환율은 가정값이다
USD_PER_M_TOKENS = {"gemini-2.5-flash-lite": (0.10, 0.40), "gemini-2.5-flash": (0.30, 2.50)}
KRW_PER_USD = 1400.0
ELICE_LLM_BASE = "https://api-cloud-function.elice.io/v1"
REFERENCE_DATE = date(2026, 9, 8)       # 골든 회의 녹음일. 상대 날짜 해석 기준을 모든 전사에 같게 둔다
SIM_MIN = 0.5


# ─────────────────────────────────────────────────────────── LLM 클라이언트
def strict_schema(model_cls) -> dict:
    """openai SDK 가 parse 에서 만드는 strict 스키마와 같은 규칙. 모든 필드 필수, 다른 필드 금지, null 기본값 삭제."""
    s = copy.deepcopy(model_cls.model_json_schema())

    def fix(n):
        if isinstance(n, dict):
            if n.get("type") == "object" and "properties" in n:
                n["additionalProperties"] = False
                n["required"] = list(n["properties"])
            if "default" in n and n["default"] is None:
                n.pop("default")
            for v in n.values():
                fix(v)
        elif isinstance(n, list):
            for v in n:
                fix(v)

    fix(s)
    return s


def usage_krw(usage: list[dict]) -> float:
    total = 0.0
    for u in usage:
        pin, pout = USD_PER_M_TOKENS.get(u["model"], USD_PER_M_TOKENS["gemini-2.5-flash"])
        total += (u["prompt_tokens"] * pin + u["completion_tokens"] * pout) / 1e6 * KRW_PER_USD
    return total


class HttpChat:
    """client.chat.completions.parse(...) 만 흉내 낸다. extract.llm 이 요구하는 것이 그것뿐이다."""

    def __init__(self, base_url: str, api_key: str, *, post=None, timeout: float = 120.0, retries: int = 2,
                 retry_wait_s: float = 3.0):
        self.base_url = base_url.rstrip("/")
        self._key = api_key
        self._post = post or requests.post
        self.timeout, self.retries, self.retry_wait_s = timeout, retries, retry_wait_s
        self.usage: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(parse=self.parse))

    def parse(self, *, model, messages, response_format, temperature=None, max_completion_tokens=None, **extra):
        body = {"model": model, "messages": messages,
                "response_format": {"type": "json_schema", "json_schema": {
                    "name": response_format.__name__, "schema": strict_schema(response_format), "strict": True}}}
        if temperature is not None:
            body["temperature"] = temperature
        if max_completion_tokens:
            body["max_completion_tokens"] = max_completion_tokens
        body.update(extra)
        t0 = time.monotonic()
        for attempt in range(self.retries + 1):
            try:
                r = self._post(f"{self.base_url}/chat/completions", headers={"Authorization": f"Bearer {self._key}"},
                               json=body, timeout=self.timeout)
            except requests.RequestException as e:
                # 예외 이름만 싣는다. 요청 객체를 붙이면 헤더의 키가 로그로 나간다
                if attempt < self.retries:
                    time.sleep(self.retry_wait_s)
                    continue
                raise RuntimeError(f"LLM 요청 실패: {type(e).__name__}") from None
            if r.status_code == 200:
                break
            if (r.status_code >= 500 or r.status_code == 429) and attempt < self.retries:
                time.sleep(self.retry_wait_s)
                continue
            raise RuntimeError(f"LLM {r.status_code}: {str(r.text)[:200]}")
        j = r.json()
        u = j.get("usage") or {}
        self.usage.append({"model": model, "prompt_tokens": int(u.get("prompt_tokens") or 0),
                           "completion_tokens": int(u.get("completion_tokens") or 0), "retries": attempt,
                           "dt": round(time.monotonic() - t0, 3)})
        msg = SimpleNamespace(parsed=None, content=j["choices"][0]["message"]["content"])
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=u)


def default_client() -> tuple[HttpChat, str, str]:
    """(클라이언트, 모델, 설명). LLM_API_KEY 가 있으면 그것을, 없으면 ELICE_API_KEY 로 엘리스 게이트웨이를 쓴다."""
    from shared.config import settings

    cfg = settings()
    if cfg.llm_api_key:
        return HttpChat(cfg.llm_base_url or ELICE_LLM_BASE, cfg.llm_api_key), cfg.llm_model, "LLM_API_KEY"
    key = os.environ.get("ELICE_API_KEY", "")
    if not key:
        raise SystemExit("LLM_API_KEY 도 ELICE_API_KEY 도 없다")
    return HttpChat(ELICE_LLM_BASE, key), cfg.llm_model, "ELICE_API_KEY (api-cloud-function.elice.io)"


# ─────────────────────────────────────────────────────────── 할일 보기
# LLM 이 근거 문장 앞에 줄 머리("[3] 장원준: " 또는 "장원준: ")를 붙여 오는 경우가 있다
_PREFIX = re.compile(r"^\s*(\[\d+\]\s*)?([^:\]\s]{1,10}\s*:\s*)?")


@dataclass
class TaskView:
    text: str
    source: str
    speaker: str | None
    assignee: str | None
    due: str | None
    due_raw: str | None
    type: str


def _name(x: str | None) -> str | None:
    if not x:
        return None
    return nospace(x).removesuffix("님") or None


def _coverage(src: str, seg: str) -> float:
    """src 글자 중 seg 와 겹치는 비율. 긴 턴 안의 짧은 근거도 1 에 가깝게 나온다."""
    blocks = difflib.SequenceMatcher(a=src, b=seg, autojunk=False).get_matching_blocks()
    return sum(b.size for b in blocks) / len(src) if src else 0.0


def _speaker_of(source: str, transcript: Transcript) -> str | None:
    s = nospace(source)
    if not s:
        return None
    for seg in transcript.segments:
        if s in nospace(seg.text):
            return seg.speaker
    best, who = 0.0, None
    for seg in transcript.segments:
        c = _coverage(s, nospace(seg.text))
        if c > best:
            best, who = c, seg.speaker
    return who if best >= 0.7 else None


def view(task, transcript: Transcript) -> TaskView:
    src = _PREFIX.sub("", task.source_sentence or "")
    spk = _speaker_of(src, transcript)
    typ = task.assignee_type or "none"
    if typ == "first":
        who = spk
    elif typ == "group":
        who = "group"
    elif typ == "none":
        who = None
    else:
        who = _name(task.assignee_resolved or task.assignee_mention)
    return TaskView(text=task.task, source=src, speaker=spk, assignee=who, due=task.due_date,
                    due_raw=task.due_raw, type=typ)


def _sim(a: TaskView, b: TaskView) -> float:
    r = lambda x, y: difflib.SequenceMatcher(a=nospace(x), b=nospace(y), autojunk=False).ratio()  # noqa: E731
    return max(r(a.source, b.source), r(a.text, b.text))


def match(ref: list[TaskView], hyp: list[TaskView]) -> list[tuple[int, int]]:
    cands = sorted(((_sim(a, b), i, j) for i, a in enumerate(ref) for j, b in enumerate(hyp)
                    if (a.speaker is None or b.speaker is None or a.speaker == b.speaker)), reverse=True)
    used_i, used_j, out = set(), set(), []
    for s, i, j in cands:
        if s < SIM_MIN:
            break
        if i not in used_i and j not in used_j:
            used_i.add(i)
            used_j.add(j)
            out.append((i, j))
    return out


def compare(ref: list[TaskView], hyp: list[TaskView]) -> dict:
    pairs = match(ref, hyp)
    return {"ref": len(ref), "hyp": len(hyp), "matched": len(pairs), "missed": len(ref) - len(pairs),
            "added": len(hyp) - len(pairs),
            "assignee_changed": sum(ref[i].assignee != hyp[j].assignee for i, j in pairs),
            "due_changed": sum(ref[i].due != hyp[j].due for i, j in pairs)}


class Reference:
    """정답 전사 추출 여러 번. 두 번 이상 나온 할일이 합의 기준, 한 번이라도 나온 할일이 아는 할일."""

    def __init__(self, runs: list[list[TaskView]]):
        self.runs = runs
        self.clusters: list[list[tuple[int, TaskView]]] = []
        for r, tasks in enumerate(runs):
            reps = [c[0][1] for c in self.clusters]
            pairs = dict((j, i) for i, j in match(reps, tasks))
            for j, t in enumerate(tasks):
                if j in pairs:
                    self.clusters[pairs[j]].append((r, t))
                else:
                    self.clusters.append([(r, t)])
        need = 2 if len(runs) >= 2 else 1
        self.consensus = [c for c in self.clusters if len({r for r, _ in c}) >= need]
        self.known = self.clusters

    @staticmethod
    def _majority(c, attr):
        return Counter(getattr(t, attr) for _, t in c).most_common(1)[0][0]

    def diff(self, hyp: list[TaskView]) -> dict:
        reps = [c[0][1] for c in self.known]
        pairs = match(reps, hyp)
        hit = {i: j for i, j in pairs}
        cons = [k for k, c in enumerate(self.known) if any(c is x for x in self.consensus)]
        matched = [k for k in cons if k in hit]
        return {"ref": len(cons), "hyp": len(hyp), "matched": len(matched), "missed": len(cons) - len(matched),
                "added": len(hyp) - len(pairs),
                "assignee_changed": sum(hyp[hit[k]].assignee != self._majority(self.known[k], "assignee")
                                        for k in matched),
                "due_changed": sum(hyp[hit[k]].due != self._majority(self.known[k], "due") for k in matched)}

    def jitter(self) -> list[dict]:
        """정답 추출 하나를 빼고 나머지로 만든 기준에 뺀 것을 댄 값. LLM 자체의 흔들림이다."""
        return [Reference([x for k, x in enumerate(self.runs) if k != i]).diff(run) for i, run in enumerate(self.runs)]


def check_expected(expected: list[dict], views: list[TaskView]) -> dict:
    found = a_ok = d_ok = 0
    for e in expected:
        key = nospace(e["key"])
        cands = [v for v in views if v.speaker == e["speaker"] and (key in nospace(v.source) or key in nospace(v.text))]
        if not cands:
            continue
        found += 1
        v = cands[0]
        a_ok += v.assignee == e["assignee"]
        if e.get("due_raw") is None:
            d_ok += v.due is None
        else:
            want, got = nospace(e["due_raw"]), nospace(v.due_raw or "")
            d_ok += bool(v.due) and bool(got) and (want in got or got in want)
    return {"expected": len(expected), "found": found, "assignee_ok": a_ok, "due_ok": d_ok}


# ─────────────────────────────────────────────────────────── 전사 만들기
def truth_transcript(session: Path) -> Transcript:
    aligned = json.loads((session / "truth_aligned.json").read_text(encoding="utf-8"))
    segs = [TranscriptSegment(speaker=t["speaker"], start=float(t["start"]), end=float(t["end"]), text=t["text"], seq=i)
            for i, t in enumerate(sorted((t for t in aligned if t.get("start") is not None), key=lambda t: t["start"]), 1)]
    return Transcript(segments=segs)


def run_transcript(record: dict, setting: dict, *, merge: bool = True) -> Transcript:
    """민감도 결과(clip_lines)에서 운영과 같은 줄을 다시 만든다. 병합은 그 설정의 TURN_GAP_S 로."""
    from stt.eval import constants as C
    from stt.eval.sensitivity import merged_lines
    from stt.lines import Line

    lines = [Line(speaker_id=s, speaker_name=s, turn_id="", seq=0, start_ms=a, end_ms=b, text=t, final=True)
             for s, a, b, t in record["clip_lines"]]
    if merge:
        with C.overrides({p: v for p, v in setting.get("overrides", [])}):
            lines = merged_lines(lines)
    else:
        lines.sort(key=lambda ln: (ln.start_ms, ln.speaker_id))
    return Transcript(segments=[TranscriptSegment(speaker=ln.speaker_id, start=ln.start_ms / 1000, end=ln.end_ms / 1000,
                                                  text=ln.text, seq=i) for i, ln in enumerate(lines, 1) if ln.text])


def extract(transcript: Transcript, client: HttpChat, model: str) -> list:
    from extract.llm import extract_tasks

    names = {s.speaker: s.speaker for s in transcript.segments}
    return extract_tasks(transcript, client=client, model=model, today=REFERENCE_DATE, speaker_names=names)


# ─────────────────────────────────────────────────────────── 실행과 표
def _slug(target: str) -> str:
    return target.replace("/", "__").replace(":", "--")


def run(targets: list[str], sessions: list[Path], out: Path, *, reps: int, yes: bool, budget: float) -> None:
    from stt.eval.sensitivity import ledger_add, ledger_total

    client, model, how = default_client()
    print(f"추출 모델 {model} · 키 {how}", flush=True)
    for session in sessions:
        d = out / "extract" / session.name
        d.mkdir(parents=True, exist_ok=True)
        if (session / "expected_tasks.json").exists():
            (d / "expected_tasks.json").write_text((session / "expected_tasks.json").read_text(encoding="utf-8"),
                                                   encoding="utf-8")
        for target in targets:
            if target == "truth":
                tr = truth_transcript(session)
            else:
                label, rest = target.split("/", 1)
                sid, _, variant = rest.partition(":")
                p = out / "runs" / label / f"{sid}.json"
                if not p.exists():
                    print(f"[없음] {session.name} {target}", flush=True)
                    continue
                rec = json.loads(p.read_text(encoding="utf-8"))
                r = rec["sessions"].get(session.name)
                if not r or r.get("error"):
                    print(f"[없음] {session.name} {target}", flush=True)
                    continue
                tr = run_transcript(r, rec["setting"], merge=variant != "clip")
            n = reps if target == "truth" else max(1, reps // 3)
            for k in range(n):
                f = d / f"{_slug(target)}__r{k}.json"
                if f.exists():
                    continue
                if not yes:
                    print(f"[견적] 추출 1회 약 1원. --yes 로 승인")
                    return
                if ledger_total(out) > budget:
                    print(f"[멈춤] 누적 {ledger_total(out):.0f}원 > 상한 {budget:.0f}원", flush=True)
                    return
                before = len(client.usage)
                t0 = time.monotonic()
                try:
                    tasks = extract(tr, client, model)
                    err = None
                except Exception as e:  # 케이스 하나가 죽어도 나머지는 계속
                    tasks, err = [], f"{type(e).__name__}: {str(e)[:200]}"
                used = client.usage[before:]
                krw = usage_krw(used)
                f.write_text(json.dumps({"session": session.name, "target": target, "rep": k, "model": model,
                                         "error": err, "tasks": [t.to_dict() for t in tasks],
                                         "segments": [s.to_dict() for s in tr.segments], "usage": used,
                                         "krw": round(krw, 3)}, ensure_ascii=False, indent=1), encoding="utf-8")
                ledger_add(out, kind="llm", setting=f"{session.name} {target} r{k}", krw=round(krw, 3),
                           tokens_in=sum(u["prompt_tokens"] for u in used),
                           tokens_out=sum(u["completion_tokens"] for u in used))
                print(f"[추출] {session.name} {target} r{k} 할일 {len(tasks)} {time.monotonic() - t0:.0f}s "
                      f"{krw:.2f}원{' 오류 ' + err if err else ''}", flush=True)


def _views(path: Path) -> list[TaskView]:
    from shared.schemas import ExtractedTask

    d = json.loads(path.read_text(encoding="utf-8"))
    tr = Transcript(segments=[TranscriptSegment.from_dict(s) for s in d["segments"]])
    return [view(ExtractedTask.from_dict(t), tr) for t in d["tasks"]]


def _intent(expected, views) -> str:
    c = check_expected(expected, views)
    return f"{c['found']}·{c['assignee_ok']}·{c['due_ok']}/{c['expected']}"


def report(out: Path) -> list[dict]:
    """회의·전사마다 놓침/더함/담당자 바뀜/마감 바뀜. 여러 회차면 "/" 로 잇는다.

    첫 줄은 정답 전사 추출끼리의 흔들림 폭(하나를 뺀 나머지 기준, 회차 중 최댓값)이다. 의도한 할일이 있는
    합성 회의는 "찾음·담당자 맞음·마감 맞음/의도 수" 를 같이 적는다.
    """
    rows = []
    root = out / "extract"
    for d in sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []:
        truth = [_views(p) for p in sorted(d.glob("truth__r*.json"))]
        if not truth:
            continue
        ref = Reference(truth)
        jit = ref.jitter()
        ep = d / "expected_tasks.json"
        expected = json.loads(ep.read_text(encoding="utf-8")) if ep.exists() else None
        band = {k: max(j[k] for j in jit) for k in ("missed", "added", "assignee_changed", "due_changed")}
        rows.append({"회의": d.name, "전사": "정답 (흔들림 폭)", "회": len(truth), "합의 할일": len(ref.consensus),
                     "놓침": band["missed"], "더함": band["added"], "담당자 바뀜": band["assignee_changed"],
                     "마감 바뀜": band["due_changed"],
                     "의도": "/".join(_intent(expected, v) for v in truth) if expected else "-"})
        by_target: dict[str, list[Path]] = {}
        for p in sorted(d.glob("*__r*.json")):
            by_target.setdefault(p.name.rsplit("__r", 1)[0], []).append(p)
        for slug, paths in by_target.items():
            if slug == "truth":
                continue
            views = [_views(p) for p in paths]
            diffs = [ref.diff(v) for v in views]
            join = lambda k: "/".join(str(x[k]) for x in diffs)  # noqa: E731
            rows.append({"회의": d.name, "전사": slug.replace("__", "/").replace("--", ":"), "회": len(diffs),
                         "합의 할일": len(ref.consensus), "놓침": join("missed"), "더함": join("added"),
                         "담당자 바뀜": join("assignee_changed"), "마감 바뀜": join("due_changed"),
                         "의도": " / ".join(_intent(expected, v) for v in views) if expected else "-"})
    return rows


def cost(out: Path) -> dict:
    files = list((out / "extract").rglob("*__r*.json")) if (out / "extract").exists() else []
    used = [u for f in files for u in json.loads(f.read_text(encoding="utf-8"))["usage"]]
    return {"calls": len(used), "tokens_in": sum(u["prompt_tokens"] for u in used),
            "tokens_out": sum(u["completion_tokens"] for u in used), "krw": round(usage_krw(used), 2),
            "extractions": len(files)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="전사 차이가 할일 추출에 주는 영향")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--golden-root", type=Path, action="append", required=True)
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--targets", default="truth", help="truth, <결과 폴더>/<설정>[:clip] 를 쉼표로")
    r.add_argument("--session", default="")
    r.add_argument("--reps", type=int, default=3, help="정답 전사 추출 횟수. 다른 전사는 이 수의 1/3")
    r.add_argument("--yes", action="store_true")
    r.add_argument("--budget", type=float, default=4500.0)
    p = sub.add_parser("report")
    p.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    if a.cmd == "report":
        from stt.eval.sensitivity import md_table
        o = a.out.expanduser()
        print(md_table(report(o)))
        print(json.dumps(cost(o), ensure_ascii=False))
        return 0
    from stt.eval.sensitivity import discover_sessions

    sessions = discover_sessions([g.expanduser() for g in a.golden_root])
    if a.session:
        keep = set(a.session.split(","))
        sessions = [s for s in sessions if s.name in keep]
    run([t for t in a.targets.split(",") if t], sessions, a.out.expanduser(), reps=a.reps, yes=a.yes,
        budget=a.budget)
    return 0


if __name__ == "__main__":
    sys.exit(main())
