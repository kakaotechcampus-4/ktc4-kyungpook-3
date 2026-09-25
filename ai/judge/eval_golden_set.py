"""Terra 1단계(judge.semantic_judge) 골든셋 채점 스크립트.

pytest 스위트엔 안 넣는다 — 실제 Luna API를 호출해서 비용이 들고, LLM 응답이라 매번 100%
같은 결과가 보장되지 않는다. 필요할 때 수동으로 돌리는 용도.

규칙 기반(extract_findings_rules)과 Luna(extract_findings_llm)를 같은 케이스에 나란히
돌려서 정답률을 비교한다 — 정규식이 놓치거나 오탐하는 케이스(question/context-dependent
agreement 등)에서 Luna가 실제로 더 나은지 확인하는 게 이 스크립트의 핵심 목적이다.

실행 (ai/ 디렉토리 안에서 — TERRA_API_KEY/LUNA_API_KEY 필요):
    .venv/bin/python judge/eval_golden_set.py
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from judge.semantic_judge import extract_findings_llm, extract_findings_rules
from llm import get_llm
from shared.schemas import JudgeFinding, Transcript, TranscriptSegment

GOLDEN_SET_DIR = Path(__file__).resolve().parent / "golden_set"
GROUPS = ("short_sentences", "long_sentences")


def _load_cases() -> list[dict]:
    """group(short_sentences/long_sentences)별로 나눠서 불러온다. case 안에 _group을 채워둔다."""
    cases = []
    for group in GROUPS:
        for p in sorted((GOLDEN_SET_DIR / group).glob("case_*.json")):
            case = json.loads(p.read_text(encoding="utf-8"))
            case["_group"] = group
            cases.append(case)
    return cases


def _build_transcript(case: dict) -> Transcript:
    segments = [
        TranscriptSegment(speaker=t["speaker"], start=float(i), end=float(i + 1), text=t["text"], seq=i)
        for i, t in enumerate(case["turns"])
    ]
    return Transcript(segments=segments, source="meeting")


def _anchors(findings: list[JudgeFinding]) -> list[str]:
    """findings 하나당 앵커(근거의 마지막 문장) 하나를 순서대로.

    evidence로 매칭한다 — text는 LLM 경로에서 문맥 반영 요약으로 바뀔 수 있어서
    골든셋의 원문 기준(expected[].text)과 안정적으로 대응하는 건 evidence 쪽이다.
    evidence 는 근거 문장들의 리스트이고, 그중 **마지막(앵커)만** 후보로 센다.
    should_flag 는 "이 발화 자체가 후보인가"를 묻는데, 앞줄들은 후보가 아니라 그 결정을
    뒷받침하려고 딸려온 근거이기 때문이다(예: "~게 어때요?" + "네 그러시죠" 가 한 건으로
    묶이면 후보는 뒤쪽 합의 발화다). 전부 세면 제안·질문이 통째로 오탐으로 잡혀
    실제보다 잡음이 많아 보인다.

    set 이 아니라 list 인 이유는 **중복을 세기 위해서**다. 같은 앵커로 findings 가 두 건
    나오는 건 한 결정이 쪼개졌다는 뜻이고, 그건 indices 도입으로 고치려던 문제 그 자체라
    채점기가 못 보면 고쳤는지 확인할 방법이 없다.
    """
    return [f.evidence[-1] for f in findings if f.evidence]


def _score(case: dict, anchors: list[str]) -> tuple[int, int, list[str]]:
    """라벨마다 맞았는지 세고, **라벨 밖 출력과 중복 출력도 오답으로** 센다.

    라벨만 순회하면 출력 쪽은 아무도 안 본다 — 골든셋에 라벨이 없는 문장을 후보로 내거나
    같은 결정을 두 건으로 쪼개 내도 점수가 그대로다. 둘 다 분모에 더해 점수가 실제로 깎이게 한다.
    """
    labeled = {e["text"] for e in case["expected"]}
    flagged = set(anchors)
    correct, total, mistakes = 0, 0, []

    for exp in case["expected"]:
        total += 1
        was_flagged = exp["text"] in flagged
        if was_flagged == exp["should_flag"]:
            correct += 1
        else:
            mistakes.append(
                f'"{exp["text"]}" — 기대={exp["should_flag"]} 실제={was_flagged} ({exp.get("note", "")})'
            )

    for text in sorted(flagged - labeled):
        total += 1
        mistakes.append(f'"{text}" — 골든셋 라벨에 없는 문장을 후보로 냄')

    for text, n in sorted(Counter(anchors).items()):
        if n > 1:
            total += n - 1
            mistakes.append(f'"{text}" — 같은 앵커로 {n}건 (한 결정이 쪼개졌을 수 있음)')

    return correct, total, mistakes


def main() -> None:
    client = get_llm("luna")
    if client.name == "off":
        print("LUNA_API_KEY(또는 TERRA_API_KEY) 가 없습니다 — .env 에 채워 주세요.")
        return

    cases = _load_cases()
    totals: dict[str, dict[str, int]] = {g: {"r_c": 0, "r_t": 0, "l_c": 0, "l_t": 0} for g in GROUPS}

    for case in cases:
        group = case["_group"]
        transcript = _build_transcript(case)
        counts = case.get("counts_toward_pass_rate", True)

        rules_flagged = _anchors(extract_findings_rules(transcript))
        llm_result = extract_findings_llm(transcript, client)
        llm_flagged = _anchors(llm_result) if llm_result is not None else []

        r_correct, r_total, r_mistakes = _score(case, rules_flagged)
        l_correct, l_total, l_mistakes = _score(case, llm_flagged)

        tag = "" if counts else " (통과율 제외)"
        print(f"\n[{group}/{case['case_id']}] {case['description']}{tag}")
        print(f"  규칙 기반 {r_correct}/{r_total}", *[f"\n    ✗ {m}" for m in r_mistakes])
        print(f"  Luna     {l_correct}/{l_total}", *[f"\n    ✗ {m}" for m in l_mistakes])

        if counts:
            totals[group]["r_c"] += r_correct
            totals[group]["r_t"] += r_total
            totals[group]["l_c"] += l_correct
            totals[group]["l_t"] += l_total

    print("\n" + "=" * 60)
    grand = {"r_c": 0, "r_t": 0, "l_c": 0, "l_t": 0}
    for group in GROUPS:
        g = totals[group]
        if g["r_t"] == 0:
            continue
        print(f"[{group}] 규칙 기반 {g['r_c']}/{g['r_t']} ({g['r_c'] / g['r_t']:.0%})"
              f" · Luna {g['l_c']}/{g['l_t']} ({g['l_c'] / g['l_t']:.0%})")
        for k in grand:
            grand[k] += g[k]

    print("-" * 60)
    print(f"전체 규칙 기반 정답률: {grand['r_c']}/{grand['r_t']} ({grand['r_c'] / grand['r_t']:.0%})")
    print(f"전체 Luna 정답률   : {grand['l_c']}/{grand['l_t']} ({grand['l_c'] / grand['l_t']:.0%})")


if __name__ == "__main__":
    main()
