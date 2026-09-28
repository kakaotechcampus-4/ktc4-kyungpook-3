"""판단 파이프라인(judge/pipeline.py) 실제 API E2E 스크립트 — BE 만 가짜, LLM·임베딩은 실제.

pytest 스위트엔 안 넣는다 — Luna(1단계·Phase 2)·Terra·임베딩을 실제로 호출해서 비용이 들고,
LLM 응답이라 비결정적이다. 한 번 어긋났다고 바로 프롬프트를 고치지 말고 몇 번 더 돌려볼 것.

BE 의 유사 task 검색(#102)은 fixture 의 tasks 로 흉내 낸다 — 제목을 실제 임베딩 API 로 벡터화하고,
BE 와 같은 규칙(코사인 유사도 상위 3개 중 0.4 이상)으로 후보를 돌려준다.

fixture 의 expected 는 "이런 item 이 있어야 한다"는 최소 조건만 적는다. 1단계가 finding 을
어떻게 나눌지는 실행마다 다를 수 있어서 finding 단위가 아니라 최종 item 단위로 본다.

실행 (ai/ 디렉토리 안에서 — TERRA/LUNA/EMBEDDING API 키 필요):
    .venv/bin/python -m judge.eval_pipeline

결과는 runs/pipeline_eval_<fixture>.json 에도 남는다 (.gitignore 대상 — 커밋 안 됨).
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date
from pathlib import Path

from embedding import cosine_similarity, embed
from judge.pipeline import run
from shared.config import AI_ROOT, RUNS_DIR
from shared.schemas import NotionCandidate, Transcript

FIXTURE_DIR = AI_ROOT / "judge" / "golden_set_pipeline"
TOP_K = 3
MIN_SIMILARITY = 0.4  # decision_log 0010


class EmbeddingCandidates:
    """BE 유사 검색 흉내 — fixture 의 tasks 를 실제 임베딩으로 검색한다."""

    def __init__(self, tasks: list[dict]):
        self.tasks = tasks
        self.vectors = [embed(t["title"]) for t in tasks]
        if any(v is None for v in self.vectors):
            raise SystemExit("EMBEDDING_API_KEY 가 없거나 임베딩 호출이 실패했습니다 — .env 를 확인하세요.")

    def similar_tasks(self, workspace_id: str, text: str) -> list[NotionCandidate]:
        query = embed(text)
        if query is None:
            raise RuntimeError("쿼리 임베딩 실패")
        scored = sorted(
            ((cosine_similarity(query, v), t) for v, t in zip(self.vectors, self.tasks)),
            key=lambda pair: pair[0], reverse=True,
        )
        return [NotionCandidate(**t, similarity=round(s, 4)) for s, t in scored[:TOP_K] if s >= MIN_SIMILARITY]


def _matches(exp: dict, item: dict) -> bool:
    if item["action"] != exp["action"]:
        return False
    if "target_task_id" in exp and item["target_task_id"] != exp["target_task_id"]:
        return False
    if "title_contains" in exp and exp["title_contains"] not in (item["task_title"] or ""):
        return False
    return True


_CHECKED_FIELDS = ("due_date", "status", "assignee_raw", "category")


def _check(fixture: dict, items: list[dict]) -> tuple[int, int, list[dict]]:
    """expected 마다 맞는 item 을 찾고, 적힌 필드 값이 같은지 본다."""
    passed = 0
    unmatched = list(items)
    for exp in fixture["expected"]:
        item = next((i for i in unmatched if _matches(exp, i)), None)
        if item is None:
            print(f"  [✗] {exp['note']}\n      → 맞는 item 없음")
            continue
        unmatched.remove(item)
        wrong = {f: (exp[f], item[f]) for f in _CHECKED_FIELDS if f in exp and item[f] != exp[f]}
        if wrong:
            print(f"  [✗] {exp['note']}")
            for f, (want, got) in wrong.items():
                print(f"      {f}: 기대={want!r} 실제={got!r}")
        else:
            passed += 1
            print(f"  [✓] {exp['note']}")
        print(f"      doc_text: {item['doc_text']}")

    for target, why in fixture.get("not_expected_targets", {}).items():
        hit = [i for i in items if i["target_task_id"] == target]
        mark = "✗" if hit else "✓"
        print(f"  [{mark}] {target} 수정 없음 — {why}")
        passed += not hit

    total = len(fixture["expected"]) + len(fixture.get("not_expected_targets", {}))
    extras = [i for i in unmatched if i["target_task_id"] not in fixture.get("not_expected_targets", {})]
    return passed, total, extras


def run_fixture(path: Path) -> None:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    print(f"=== {path.stem} — {fixture['description']}")

    out = run(
        Transcript.from_dict(fixture["transcript"]),
        workspace_id=fixture["workspace_id"],
        today=date.fromisoformat(fixture["meeting_date"]),
        candidates=EmbeddingCandidates(fixture["tasks"]),
    )

    print(f"\n[items {len(out.items)}건]")
    for i in out.items:
        print(
            f"  {i['action']:<6} target={i['target_task_id']} category={i['category']} "
            f"title={i['task_title']!r} due={i['due_date']} status={i['status']} assignee={i['assignee_raw']!r}"
        )
        print(f"         doc_text: {i['doc_text']}")
    print(f"\n[failures {len(out.failures)}건]")
    for f in out.failures:
        print(f"  {f.stage}: {f.finding_text!r} — {f.reason}")

    print("\n[기대 조건]")
    passed, total, extras = _check(fixture, out.items)
    if extras:
        print("\n[기대에 없던 item — 관찰용]")
        for i in extras:
            print(f"  {i['action']} target={i['target_task_id']} doc_text={i['doc_text']!r}")
    print(f"\n{passed}/{total} 통과 (기대에 없던 item {len(extras)}건, 실패 {len(out.failures)}건)\n")

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RUNS_DIR / f"pipeline_eval_{path.stem}.json"
    out_path.write_text(
        json.dumps({"items": out.items, "failures": [asdict(f) for f in out.failures]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"결과 저장: {out_path}")


def main() -> None:
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        run_fixture(path)


if __name__ == "__main__":
    main()
