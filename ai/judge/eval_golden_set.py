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
from shared.schemas import SIGNAL_DECISION, JudgeFinding, Transcript, TranscriptSegment

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


def _signal_by_text(findings: list[JudgeFinding]) -> dict[str, str]:
    """앵커 문장 → 그 finding 의 signal. 라벨과 맞춰 축 분류 정확도를 재려고 쓴다."""
    return {f.evidence[-1]: f.signal for f in findings if f.evidence}


def _score_signal(case: dict, signals: dict[str, str]) -> tuple[int, int, list[str]]:
    """**골라낸 것 중에서만** 축 분류가 맞았는지 센다.

    통과 여부(should_flag)와는 다른 질문이다 — 진척 보고를 골라냈어도 decision 으로 분류하면
    문서 갱신 경로로 잘못 가고, 결정을 progress 로 분류하면 문서에 안 써진다. 통과율만 보면
    둘 다 "맞음"으로 보이므로 따로 잰다.

    못 골라낸 문장은 분모에서 뺀다 — 놓친 건 이미 통과율에서 오답으로 잡혔고, 여기서 또 세면
    같은 실패를 두 번 깎는 셈이다.
    """
    correct, total, mistakes = 0, 0, []
    for exp in case["expected"]:
        if not exp["should_flag"]:
            continue
        got = signals.get(exp["text"])
        if got is None:
            continue  # 못 골라낸 문장 — 통과율 쪽에서 이미 오답
        total += 1
        want = exp.get("signal", SIGNAL_DECISION)
        if got == want:
            correct += 1
        else:
            mistakes.append(f'"{exp["text"]}" — signal 기대={want} 실제={got}')
    return correct, total, mistakes


def _assignee_by_text(findings: list[JudgeFinding]) -> dict[str, str | None]:
    """앵커 문장 → 그 finding 의 assignee_type."""
    return {f.evidence[-1]: f.assignee_type for f in findings if f.evidence}


def _score_assignee(case: dict, types: dict[str, str | None]) -> tuple[int, int, list[str]]:
    """담당자 호칭 분류가 맞았는지 — **라벨이 붙은 문장에 한해서만** 센다.

    judge 골든셋은 원래 "이 발화가 후보인가" 하나만 재던 데이터라 담당자 라벨이 없었다.
    한꺼번에 다 붙이는 대신 담당자가 명시적으로 드러난 문장부터 붙였고, 라벨이 없는 문장은
    분모에서 뺀다 — "~하겠습니다"처럼 1인칭 표현 없이 의지만 드러나는 마감 결정문이
    first 인지 none 인지는 사람마다 갈려서, 합의 전에 점수로 만들면 안 된다.
    """
    correct, total, mistakes = 0, 0, []
    for exp in case["expected"]:
        want = exp.get("assignee_type")
        if want is None or not exp["should_flag"]:
            continue
        if exp["text"] not in types:
            continue  # 못 골라낸 문장 — 통과율 쪽에서 이미 오답
        total += 1
        got = types[exp["text"]]
        if got == want:
            correct += 1
        else:
            mistakes.append(f'"{exp["text"]}" — assignee_type 기대={want} 실제={got}')
    return correct, total, mistakes


def _spans(findings: list[JudgeFinding]) -> list[list[str]]:
    """findings 하나당 근거 문장 리스트 하나를, 순서대로.

    evidence로 매칭한다 — text는 LLM 경로에서 문맥 반영 요약으로 바뀔 수 있어서
    골든셋의 원문 기준(expected[].text)과 안정적으로 대응하는 건 evidence 쪽이다.

    스팬 통째로 넘기는 이유는 채점이 **두 가지를 따로 봐야 하기 때문**이다(_score 참고).
    앵커만 추려 넘기면 "근거에는 들어왔지만 앵커가 아닌 문장"을 구분할 수 없다.
    list 인 이유는 중복(같은 결정이 두 건으로 쪼개짐)을 세기 위해서다.
    """
    return [f.evidence for f in findings if f.evidence]


def _score(case: dict, spans: list[list[str]]) -> tuple[int, int, list[str]]:
    """라벨마다 맞았는지 세고, 라벨 밖 출력과 중복 출력도 오답으로 센다.

    **정답 판정과 앵커 판정을 분리한다.** 골든셋 라벨은 "이 문장이 후보인가"(문장 단위)인데
    판단 단위는 "결정 하나"(스팬)라, 한 기준으로 둘 다 재면 어느 쪽이든 틀린 점수가 나온다.

      should_flag=True  → 근거 **어디에든** 들어왔으면 정답 (그 결정이 2단계로 넘어갔는가)
      should_flag=False → **앵커일 때만** 오답 (잡음을 후보로 세웠는가)

    한 결정이 두 문장에 걸치고 골든셋이 둘 다 True 로 라벨한 경우(long/case_03 의
    "로그인 마감은~" + "담당자는 저로~"), 앵커는 하나뿐이라 앵커 기준으로만 재면 나머지
    하나가 **구조적으로 영원히 놓침**이 된다 — 결정은 멀쩡히 잡았는데도.

    반대로 근거에 딸려온 문장까지 전부 후보로 세면, "~게 어때요?" 같은 제안이 합의와 한 건으로
    묶였을 때 통째로 오탐이 된다(실측 8건). 그래서 오탐 쪽은 앵커로만 잰다.

    여기에 출력 쪽 두 가지를 더 센다. 라벨만 순회하면 골든셋에 라벨이 없는 문장을 후보로 내거나
    같은 결정을 두 건으로 쪼개 내도 점수가 그대로다. 둘 다 분모에 더해 점수가 실제로 깎이게 한다.
    """
    labeled = {e["text"] for e in case["expected"]}
    anchors = [span[-1] for span in spans]
    anchor_set = set(anchors)
    covered = {text for span in spans for text in span}  # 근거 어디에든 등장한 문장
    correct, total, mistakes = 0, 0, []

    for exp in case["expected"]:
        total += 1
        was_flagged = exp["text"] in (covered if exp["should_flag"] else anchor_set)
        if was_flagged == exp["should_flag"]:
            correct += 1
        else:
            mistakes.append(
                f'"{exp["text"]}" — 기대={exp["should_flag"]} 실제={was_flagged} ({exp.get("note", "")})'
            )

    for text in sorted(anchor_set - labeled):
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
    totals: dict[str, dict[str, int]] = {
        g: {"r_c": 0, "r_t": 0, "l_c": 0, "l_t": 0, "s_c": 0, "s_t": 0, "a_c": 0, "a_t": 0}
        for g in GROUPS
    }

    for case in cases:
        group = case["_group"]
        transcript = _build_transcript(case)
        counts = case.get("counts_toward_pass_rate", True)

        rules_flagged = _spans(extract_findings_rules(transcript))
        llm_result = extract_findings_llm(transcript, client)
        llm_flagged = _spans(llm_result) if llm_result is not None else []

        r_correct, r_total, r_mistakes = _score(case, rules_flagged)
        l_correct, l_total, l_mistakes = _score(case, llm_flagged)
        llm_signals = _signal_by_text(llm_result) if llm_result is not None else {}
        s_correct, s_total, s_mistakes = _score_signal(case, llm_signals)
        llm_types = _assignee_by_text(llm_result) if llm_result is not None else {}
        a_correct, a_total, a_mistakes = _score_assignee(case, llm_types)

        tag = "" if counts else " (통과율 제외)"
        print(f"\n[{group}/{case['case_id']}] {case['description']}{tag}")
        print(f"  규칙 기반 {r_correct}/{r_total}", *[f"\n    ✗ {m}" for m in r_mistakes])
        print(f"  Luna     {l_correct}/{l_total}", *[f"\n    ✗ {m}" for m in l_mistakes])

        if s_total:
            print(f"  축 분류   {s_correct}/{s_total}")
            for m in s_mistakes:
                print(f"    ✗ {m}")
        if a_total:
            print(f"  담당자    {a_correct}/{a_total}")
            for m in a_mistakes:
                print(f"    ✗ {m}")

        if counts:
            totals[group]["r_c"] += r_correct
            totals[group]["r_t"] += r_total
            totals[group]["l_c"] += l_correct
            totals[group]["l_t"] += l_total
            totals[group]["s_c"] += s_correct
            totals[group]["s_t"] += s_total
            totals[group]["a_c"] += a_correct
            totals[group]["a_t"] += a_total

    print("\n" + "=" * 60)
    grand = {"r_c": 0, "r_t": 0, "l_c": 0, "l_t": 0, "s_c": 0, "s_t": 0, "a_c": 0, "a_t": 0}
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
    if grand["s_t"]:
        print(f"축 분류(decision/progress): {grand['s_c']}/{grand['s_t']} "
              f"({grand['s_c'] / grand['s_t']:.0%}) — 골라낸 것 중에서만 잼")
    if grand["a_t"]:
        print(f"담당자 호칭 분류          : {grand['a_c']}/{grand['a_t']} "
              f"({grand['a_c'] / grand['a_t']:.0%}) — 라벨이 붙은 문장에 한해서만 잼")


if __name__ == "__main__":
    main()
