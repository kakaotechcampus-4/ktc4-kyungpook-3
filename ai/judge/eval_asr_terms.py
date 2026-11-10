"""#643 용어 목록 E2E 를 실제 LLM(Luna·Terra·임베딩·Jev)으로 돌린다 — BE 만 메모리로 흉내 낸다.

pytest 에 안 넣는다(비용, 비결정). 한 번 어긋났다고 바로 프롬프트를 고치지 말고 --runs 로 몇 번 돌려 볼 것.
fixture: judge/golden_set_asr_terms/. 1~5회차를 차례로 돌리고(회차마다 PM 승인 제목을 큐에 넣는다) 5회차 뒤 상태를
복사해 6회차 정확본·오인식본을, 빈 상태에서 이력 없는 정확본을 돌린다. fixture 의 findings 는 CI 용이라 쓰지 않는다.

실행 (ai/ 안에서, TERRA/LUNA/EMBEDDING/JEV API 키 필요):
    .venv/bin/python -m judge.eval_asr_terms [--runs N]
결과: runs/asr_terms_eval.json (.gitignore 대상)
"""

from __future__ import annotations

import argparse
import copy
import json
import re
from datetime import date

import judge.pipeline as pipeline
from embedding import embed
from judge.eval_pipeline import EmbeddingCandidates
from shared.config import AI_ROOT, RUNS_DIR
from shared.schemas import Transcript

DIR = AI_ROOT / "judge" / "golden_set_asr_terms"


def approve_titles(items: list[dict], approve: list[dict], prefix: str) -> list[dict]:
    """PM 이 승인한 항목의 제목을 큐에 넣을 행으로. create 항목 중 제목에 title_contains 가 든 것을 찾는다.
    approve 의 title 이 있으면 그것을, 없으면 항목 제목을 쓴다. 못 찾으면 경고하고 건너뛴다."""
    rows = []
    for i, a in enumerate(approve):
        item = next((x for x in items if x["action"] == "create" and a["title_contains"] in (x["task_title"] or "")), None)
        if item is None:
            print(f"  [경고] 승인 '{a['title_contains']}' 와 맞는 create 항목이 없어 건너뜀")
            continue
        rows.append({"title_id": f"{prefix}-{i}", "title": a.get("title", item["task_title"])})
    return rows


class SeriesBe(EmbeddingCandidates):
    """유사 task 검색(임베딩) + 메모리 워크스페이스 용어 목록·승인 제목 큐·팀원."""

    def __init__(self, tasks: list[dict], members: list[dict] | None = None):
        self.words: set[str] = set()
        self.pending: list[dict] = []
        self.members = members or []
        self._cache: dict[str, list[float]] = {}
        self.set_tasks(tasks)

    def set_tasks(self, tasks: list[dict]) -> None:
        for t in tasks:
            if t["title"] not in self._cache:
                v = embed(t["title"])
                if v is None:
                    raise SystemExit("EMBEDDING_API_KEY 가 없거나 임베딩 호출이 실패했습니다 — .env 를 확인하세요.")
                self._cache[t["title"]] = v
        self.tasks = tasks
        self.vectors = [self._cache[t["title"]] for t in tasks]

    def asr_terms(self, ws: str) -> dict:
        return {"words": sorted(self.words), "pending_titles": list(self.pending)}

    def add_asr_terms(self, ws: str, words: list[str], absorbed_title_ids: list[str]) -> dict:
        self.words |= set(words)
        gone = set(absorbed_title_ids)
        self.pending = [p for p in self.pending if p["title_id"] not in gone]
        return {"added": len(words), "absorbed": len(gone)}

    def member_names(self, ws: str) -> list[dict]:
        return self.members


class RecordingJev:
    """Jev 를 감싸 (state, questions, answers) 를 기록한다."""

    def __init__(self, inner):
        self.inner, self.calls = inner, []
        self.name = getattr(inner, "name", "jev")

    def decide(self, state, questions):
        answers = self.inner.decide(state, questions)
        self.calls.append((state, questions, answers))
        return answers

    def evidence_yes(self) -> dict[str, dict]:
        """할 일 제목 → {task, due} yes 확률. state 의 "할 일: <제목>" 줄로 어느 항목인지 맞춘다(같은 제목은 마지막 호출)."""
        out = {}
        for state, qs, ans in self.calls:
            m = re.search(r"^할 일: (.*)$", state, re.M)
            if not m or "task" not in qs:
                continue
            yes = lambda k: (((ans or {}).get(k) or {}).get("probabilities") or {}).get("yes")  # noqa: E731
            out[m.group(1)] = {"task": yes("task"), "due": yes("due")}
        return out

    def asr_questions(self) -> list[dict]:
        """asr 질문마다 {word, yes}. 응답이 없으면 yes 는 None."""
        out = []
        for _, qs, ans in self.calls:
            for k, q in qs.items():
                if k.startswith("asr"):
                    m = re.search(r"'([^']+)'", q["instructions"])
                    p = ((ans or {}).get(k) or {}).get("probabilities") or {}
                    out.append({"word": m.group(1) if m else q["instructions"], "yes": p.get("yes")})
        return out


def run_meeting(be: SeriesBe, m: dict, ws: str) -> dict:
    be.set_tasks(m["tasks"])
    inner = pipeline.get_jev()
    rec = RecordingJev(inner)
    before = set(be.words)
    orig, pipeline.get_jev = pipeline.get_jev, lambda: rec
    try:
        out = pipeline.run(Transcript.from_dict(m["transcript"]), workspace_id=ws,
                           today=date.fromisoformat(m["meeting_date"]), candidates=be)
    finally:
        pipeline.get_jev = orig
    ev = rec.evidence_yes()
    items = [{**i, "jev": ev.get(i.get("task_title"))} for i in out.items]
    return {"date": m["meeting_date"], "items": items, "failures": [str(f) for f in out.failures],
            "new_terms": sorted(be.words - before), "jev_asr": rec.asr_questions()}


def show(name: str, r: dict) -> None:
    print(f"--- {name} ({r['date']})")
    for i in r["items"]:
        head = f"  {i['action']:<6} {i.get('task_title')!r}"
        if i["action"] != "create":
            head += f" target={i.get('target_task_id')} due_date={i.get('due_date')} status={i.get('status')} assignee={i.get('assignee_raw')!r}"
        print(f"{head} task={i.get('task_status', '-')} due={i.get('due_status', '-')} jev(yes)={i.get('jev') or '-'} "
              f"suspects={[(s['word'], s['source']) for s in i.get('asr_suspects') or []]}")
    print(f"  새 용어: {r['new_terms']}")
    for q in r["jev_asr"]:
        print(f"  Jev asr '{q['word']}' yes={q['yes']}")
    if r["failures"]:
        print(f"  실패: {r['failures']}")
    if "approved" in r:
        print(f"  승인 큐: {[a['title'] for a in r['approved']]} (승인 {r['approve_wanted']}건 중 {len(r['approved'])}건 매칭)")


def save(runs: list[dict]) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    (RUNS_DIR / "asr_terms_eval.json").write_text(json.dumps(runs, ensure_ascii=False, indent=2), encoding="utf-8")


def one_run(runs: list[dict] | None = None) -> dict:
    series = json.loads((DIR / "series.json").read_text(encoding="utf-8"))
    ws = series["workspace_id"]
    load = lambda n: json.loads((DIR / f"{n}.json").read_text(encoding="utf-8"))  # noqa: E731
    be = SeriesBe([], series["members"])
    result = {"meetings": {}, "meeting6": {}}
    if runs is not None:
        runs.append(result)   # 회의가 끝날 때마다 저장해 중간에 죽어도 쓴 비용의 결과가 남는다
    for n in range(1, 6):
        name = f"meeting_0{n}"
        m = load(name)
        r = run_meeting(be, m, ws)
        r["approved"] = approve_titles(r["items"], m["approve"], name)
        r["approve_wanted"] = len(m["approve"])
        be.pending += r["approved"]
        show(name, r)
        result["meetings"][name] = r
        if runs is not None:
            save(runs)
    after5 = be
    for label, base, name in [("correct", after5, "meeting_06_correct"), ("misheard", after5, "meeting_06_misheard"),
                              ("no_history", SeriesBe([], series["members"]), "meeting_06_correct")]:
        r = run_meeting(copy.deepcopy(base), load(name), ws)
        show(f"6회차 {label}", r)
        result["meeting6"][label] = r
        if runs is not None:
            save(runs)
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=1)
    n_runs = ap.parse_args().runs
    # 비용을 쓰기 전에 키부터 본다(키 확인은 LLM 을 부르지 않는다)
    try:
        pipeline._check_llm_keys()
    except pipeline.PipelineUnavailableError as e:
        raise SystemExit(str(e))
    if pipeline.get_jev().name == "off":
        raise SystemExit("JEV 키가 없어 오인식 검사가 모두 check_failed 가 된다 — .env 를 확인하세요.")
    runs = []
    for k in range(n_runs):
        print(f"\n==== 실행 {k + 1} ====")
        one_run(runs)
    print("\n[6회차 요약]")
    for k, r in enumerate(runs, 1):
        for label, v in r["meeting6"].items():
            sus = [s["word"] for i in v["items"] for s in i.get("asr_suspects") or []]
            print(f"  실행{k} {label:<10} 의심={sus} Jev asr 질문={[q['word'] for q in v['jev_asr']]}")
    save(runs)
    print(f"결과 저장: {RUNS_DIR / 'asr_terms_eval.json'}")


if __name__ == "__main__":
    main()
