"""Terra 1단계(judge.semantic_judge) 골든셋 채점 스크립트.

pytest 스위트엔 안 넣는다 — 실제 Luna API를 호출해서 비용이 들고, LLM 응답이라 매번 100%
같은 결과가 보장되지 않는다. 필요할 때 수동으로 돌리는 용도.

규칙 기반(extract_findings_rules)과 Luna(extract_findings_llm)를 같은 케이스에 나란히
돌려서 정답률을 비교한다 — 정규식이 놓치거나 오탐하는 케이스(question/context-dependent
agreement 등)에서 Luna가 실제로 더 나은지 확인하는 게 이 스크립트의 핵심 목적이다.

실행 (ai/ 디렉토리 안에서 — TERRA_API_KEY/LUNA_API_KEY 필요):
    .venv/bin/python -m judge.eval_golden_set
    .venv/bin/python -m judge.eval_golden_set --groups speaker_dev,speaker_test --runs 3 --out result.json

LLM 은 temperature 를 바꿀 수 없어(기본 1 고정) 실행마다 결과가 달라진다. 결론을 내기 전에는
--runs 로 여러 번 돌려 실행별 수치를 같이 본다. 호출 실패(None)는 건너뛰지 않고 그 케이스를
전부 놓친 것으로 채점하고, 실패 횟수를 따로 적는다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

from judge import semantic_judge
from judge.semantic_judge import extract_findings_llm, extract_findings_rules, split_sentences
from llm import get_llm
from shared.schemas import JudgeFinding, Transcript, TranscriptSegment

GOLDEN_SET_DIR = Path(__file__).resolve().parent / "golden_set"
GROUPS = ("short_sentences", "long_sentences")
# 1인칭 담당자 화자 검증용. dev 는 프롬프트를 고치며 보는 세트, test 는 고친 뒤 마지막에 한 번만
# 보는 세트다 — 프롬프트를 맞춘 데이터로 성능을 결론 내지 않으려고 나눴다(README 참고).
SPEAKER_GROUPS = ("speaker_dev", "speaker_test")


def _load_cases(groups: tuple[str, ...] = GROUPS) -> list[dict]:
    """group 별로 나눠서 불러온다. case 안에 _group을 채워둔다."""
    cases = []
    for group in groups:
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


_HONORIFICS = ("님", "씨")


def _resolved_person(finding: JudgeFinding) -> str | None:
    """BE 가 이 finding 의 담당자를 누구로 풀게 되는지를 흉내 낸다.

    first 면 BE 는 근거 마지막 줄의 화자(evidence_speaker)로 찾고, 그 밖의 호칭은 원문 호칭이나
    문맥으로 푼 이름으로 찾는다. 판정 보류(None)·group·none 은 담당자가 정해지지 않는다.
    """
    if finding.assignee_type == "first":
        return finding.speaker
    name = finding.assignee_resolved or finding.assignee_raw
    if not name:
        return None
    name = name.strip()
    for h in _HONORIFICS:
        name = name.removesuffix(h)
    return name or None


def _sentence_speakers(case: dict) -> list[str]:
    """전사록 문장 순서(_flatten 과 같은 순서)의 화자 목록. finding.indices 가 이 순서를 가리킨다."""
    return [t["speaker"] for t in case["turns"] for _ in split_sentences(t["text"])]


def _score_speaker(case: dict, findings: list[JudgeFinding]) -> dict[str, list[str]]:
    """`assignee` 라벨이 붙은 문장마다 담당자가 그 사람으로 풀리는지 분류한다.

    assignee_type 분류(_score_assignee)가 맞아도 BE 가 엉뚱한 사람을 찾을 수 있다 — first 는
    근거 **마지막 줄**의 화자로 풀리는데, "제가 맡을게요" 뒤에 다른 사람의 맞장구가 묶이면 그
    사람이 담당자가 된다. 그래서 분류가 아니라 **풀린 사람**을 정답과 비교한다.

      correct    — 정답 사람으로 풀림
      wrong      — 다른 사람으로 풀림 (가장 나쁜 결과: 틀린 담당자가 확정된다)
      unresolved — 담당자가 정해지지 않음 (PM 이 정하게 된다)
      missed     — 그 문장을 근거로 든 finding 이 없음 (통과율 쪽에서도 놓침)

    guard 는 "1인칭인데 근거 화자가 둘 이상"인 finding 수다. 이걸 PM 확인으로 돌리는 안전장치를
    넣는다면 몇 건이 걸리는지(맞은 것까지 포함해) 보려고 같이 센다.
    """
    speakers = _sentence_speakers(case)
    out: dict[str, list[str]] = {"correct": [], "wrong": [], "unresolved": [], "missed": [], "guard": []}
    for exp in case["expected"]:
        want = exp.get("assignee")
        if want is None:
            continue
        covering = [f for f in findings if exp["text"] in f.evidence]
        if not covering:
            out["missed"].append(f'"{exp["text"]}" — 근거로 든 finding 없음 (정답 {want})')
            continue
        # 그 문장이 앵커인 finding 을 먼저 본다 — 앵커가 아니면 다른 결정에 딸려 온 것일 수 있다
        f = next((f for f in covering if f.evidence[-1] == exp["text"]), covering[0])
        got = _resolved_person(f)
        where = f'"{exp["text"]}" — 정답 {want}, 결과 {got} (type={f.assignee_type}, 앵커 "{f.evidence[-1]}")'
        if got is None:
            out["unresolved"].append(where)
        elif got == want:
            out["correct"].append(where)
        else:
            out["wrong"].append(where)
        if f.assignee_type == "first" and len({speakers[i] for i in f.indices if i < len(speakers)}) > 1:
            out["guard"].append(f"{'맞음' if got == want else '틀림'}: {where}")
    return out


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


def _prompt_version() -> str:
    """1단계 프롬프트의 지문. 결과를 어느 프롬프트로 쟀는지 남기려고 쓴다."""
    text = semantic_judge._LUNA_SYSTEM_PROMPT + semantic_judge._luna_user_prompt("")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def _run_once(cases: list[dict], client, *, verbose: bool) -> dict:
    """케이스 전체를 한 번 돈다. 그룹별 집계와 케이스별 오답을 돌려준다."""
    totals: dict[str, dict] = {}
    for case in cases:
        group = case["_group"]
        g = totals.setdefault(group, {"r_c": 0, "r_t": 0, "l_c": 0, "l_t": 0, "a_c": 0, "a_t": 0,
                                      "api_failures": 0, "cases": 0,
                                      "speaker": {k: 0 for k in ("correct", "wrong", "unresolved", "missed", "guard")},
                                      "mistakes": []})
        transcript = _build_transcript(case)
        counts = case.get("counts_toward_pass_rate", True)

        rules_flagged = _spans(extract_findings_rules(transcript))
        llm_result = extract_findings_llm(transcript, client)
        if llm_result is None:
            g["api_failures"] += 1  # 건너뛰지 않는다 — 아래에서 전부 놓친 것으로 채점된다
        findings = llm_result or []
        llm_flagged = _spans(findings)

        r_correct, r_total, r_mistakes = _score(case, rules_flagged)
        l_correct, l_total, l_mistakes = _score(case, llm_flagged)
        a_correct, a_total, a_mistakes = _score_assignee(case, _assignee_by_text(findings))
        sp = _score_speaker(case, findings)

        where = f"{group}/{case['case_id']}"
        if llm_result is None:
            l_mistakes = ["LLM 호출/파싱 실패", *l_mistakes]
        case_mistakes = [*l_mistakes, *a_mistakes, *(f"담당자 {k}: {m}" for k in ("wrong", "unresolved", "missed") for m in sp[k])]
        if case_mistakes:
            g["mistakes"].append({"case": where, "mistakes": case_mistakes})

        if verbose:
            tag = "" if counts else " (통과율 제외)"
            print(f"\n[{where}] {case['description']}{tag}")
            print(f"  규칙 기반 {r_correct}/{r_total}", *[f"\n    ✗ {m}" for m in r_mistakes])
            print(f"  Luna     {l_correct}/{l_total}", *[f"\n    ✗ {m}" for m in l_mistakes])
            if a_total:
                print(f"  담당자    {a_correct}/{a_total}", *[f"\n    ✗ {m}" for m in a_mistakes])
            n = sum(len(sp[k]) for k in ("correct", "wrong", "unresolved", "missed"))
            if n:
                print(f"  담당자 해소 {len(sp['correct'])}/{n}",
                      *[f"\n    ✗ {k}: {m}" for k in ("wrong", "unresolved", "missed") for m in sp[k]])

        if counts:
            g["cases"] += 1
            for k, v in (("r_c", r_correct), ("r_t", r_total), ("l_c", l_correct), ("l_t", l_total),
                         ("a_c", a_correct), ("a_t", a_total)):
                g[k] += v
            for k in g["speaker"]:
                g["speaker"][k] += len(sp[k])
    return totals


def _pct(c: int, t: int) -> str:
    return f"{c}/{t} ({c / t:.0%})" if t else "-"


def _print_summary(runs: list[dict]) -> None:
    print("\n" + "=" * 70)
    groups = list(runs[0])
    for group in groups:
        print(f"[{group}]")
        for i, run in enumerate(runs, 1):
            g = run[group]
            sp = g["speaker"]
            n = sum(sp[k] for k in ("correct", "wrong", "unresolved", "missed"))
            print(f"  run{i}: Luna {_pct(g['l_c'], g['l_t'])} · 규칙 {_pct(g['r_c'], g['r_t'])}"
                  f" · 호칭 {_pct(g['a_c'], g['a_t'])} · 담당자 해소 {_pct(sp['correct'], n)}"
                  f" (틀림 {sp['wrong']} · 보류 {sp['unresolved']} · 놓침 {sp['missed']})"
                  f" · 안전장치 대상 {sp['guard']} · 호출 실패 {g['api_failures']}/{g['cases']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="1단계 골든셋 채점")
    ap.add_argument("--groups", default=",".join(GROUPS), help="쉼표로 구분한 golden_set 하위 디렉토리")
    ap.add_argument("--runs", type=int, default=1, help="같은 조건으로 반복할 횟수")
    ap.add_argument("--out", help="결과를 저장할 JSON 경로")
    ap.add_argument("--label", default="", help="결과 파일에 남길 설명")
    args = ap.parse_args()

    client = get_llm("luna")
    if client.name == "off":
        print("LUNA_API_KEY(또는 TERRA_API_KEY) 가 없습니다 — .env 에 채워 주세요.")
        return

    groups = tuple(g for g in args.groups.split(",") if g)
    cases = _load_cases(groups)
    runs = [_run_once(cases, client, verbose=(args.runs == 1)) for _ in range(max(1, args.runs))]
    _print_summary(runs)

    if args.out:
        meta = {
            "label": args.label,
            "at": datetime.now().isoformat(timespec="seconds"),
            "model": getattr(client, "model", client.name),
            "prompt_version": _prompt_version(),
            "groups": list(groups),
            "runs": len(runs),
            "cases": len(cases),
        }
        Path(args.out).write_text(json.dumps({"meta": meta, "runs": runs}, ensure_ascii=False, indent=2),
                                  encoding="utf-8")
        print(f"\n결과 저장: {args.out} (prompt_version={meta['prompt_version']})")


if __name__ == "__main__":
    main()
