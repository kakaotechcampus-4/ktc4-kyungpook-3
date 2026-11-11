"""extract/golden_set/*.json 으로 추출기(extract/llm.py)를 채점한다.

실행 (ai/ 디렉토리 안에서 — openai 설치 + LLM_API_KEY 필요):
  python -m extract.eval_golden_set                 # 채점
  python -m extract.eval_golden_set -v              # + 틀린 항목을 정답과 나란히
  python -m extract.eval_golden_set --n-samples 3   # + self-consistency(호출 3배, recall 약 1%p)
  python -m extract.eval_golden_set --set all --runs 3 --out result.json   # + judge 화자 세트, 3회 반복, JSON 저장

--set 은 golden(기본, extract 골든셋) / speaker(judge/golden_set/speaker_dev·speaker_test 를 이 추출기로) / all.
어느 세트든 "-- 1인칭 (정답 first) --" 에 정답이 first 인 문장이 다른 타입으로 분류된 수를 따로 센다.
speaker 세트는 이 1인칭 집계에만 넣는다. 케이스별 줄·-v 불일치도 찍지 않고 P/R·타입·담당자·마감 합계(시나리오별·전체)에도 넣지 않는다.
speaker 정답엔 담당자 언급·마감이 없고 should_flag 는 legacy is_task 와 뜻이 달라 합치면 수치가 틀린다.
speaker 세트엔 기준일이 없어 SPEAKER_REFERENCE_DATE 로 고정한다.

채점 방법 (extract/golden_set/README.md 참고):
  각 케이스의 turns 를 extract.text.split_sentences 로 쪼갠 문장 하나하나를 "탐지 대상"으로 보고,
  정답(is_task)과 예측(추출됐는지)을 비교해 Precision/Recall/F1 을 낸다. 탐지된 문장에 한해서만
  담당자(assignee_mention)·마감(due_date) 일치율도 잰다 — 탐지 자체가 틀린 문장의 필드 정확도는
  의미가 없어서 분모에서 뺀다.

  예측 항목을 정답 문장에 매칭하는 기준은 "예측의 source_sentence/evidence_span 이 정답 문장에
  포함되거나(부분 인용 허용, LLM 용) 반대로 포함되는(완전 일치, 규칙 기반 용) 경우"다.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Callable

from extract.text import split_sentences
from shared.schemas import ExtractedTask, Transcript, TranscriptSegment

CASES_DIR = Path(__file__).resolve().parent / "golden_set"
_JUDGE_GOLDEN_DIR = Path(__file__).resolve().parent.parent / "judge" / "golden_set"
SPEAKER_DIRS: tuple[Path, ...] = (_JUDGE_GOLDEN_DIR / "speaker_dev", _JUDGE_GOLDEN_DIR / "speaker_test")
SPEAKER_REFERENCE_DATE = date(2026, 11, 9)  # speaker 세트엔 날짜가 없다. 이 세트는 1인칭 집계에만 쓰고 마감은 재지 않는다


@dataclass
class GoldSentence:
    text: str
    is_task: bool
    assignee_type: str | None = None  # first|second|thirdname|thirdpronoun|thirdrole|group|none
    assignee_mention: str | None = None
    assignee_resolved: str | None = None  # second/thirdpronoun 을 문맥으로 풀었을 때 기대하는 이름
    due_date: str | None = None
    task_keywords: list[str] = field(default_factory=list)


@dataclass
class GoldCase:
    case_id: str
    scenario: str
    description: str
    reference_date: date
    speaker_names: dict[str, str]
    transcript: Transcript
    sentences: list[GoldSentence]  # split_sentences 결과와 1:1, 순서대로 대응
    from_speaker_set: bool = False  # judge 화자 세트 케이스면 True. 1인칭 집계에만 넣고 P/R·필드 합계에는 안 넣는다


def load_case(path: Path) -> GoldCase:
    data = json.loads(path.read_text(encoding="utf-8"))
    segments = [
        TranscriptSegment(speaker=t["speaker"], start=float(i), end=float(i) + 0.9, text=t["text"])
        for i, t in enumerate(data["turns"])
    ]
    transcript = Transcript(segments=segments, source="meeting")

    actual_sentences = [s for seg in segments for s in split_sentences(seg.text)]
    expected_texts = [e["sentence"] for e in data["expected"]]
    if actual_sentences != expected_texts:
        raise ValueError(
            f"{path.name}: expected 의 문장 목록이 실제 split_sentences 결과와 다릅니다.\n"
            f"  실제 ({len(actual_sentences)}개): {actual_sentences}\n"
            f"  기대 ({len(expected_texts)}개): {expected_texts}"
        )

    sentences = [
        GoldSentence(
            text=e["sentence"],
            is_task=e["is_task"],
            assignee_type=e.get("assignee_type"),
            assignee_mention=e.get("assignee_mention"),
            assignee_resolved=e.get("assignee_resolved"),
            due_date=e.get("due_date"),
            task_keywords=e.get("task_keywords", []),
        )
        for e in data["expected"]
    ]
    return GoldCase(
        case_id=data["case_id"],
        scenario=data["scenario"],
        description=data["description"],
        reference_date=date.fromisoformat(data["reference_date"]),
        speaker_names=data.get("speaker_names", {}),
        transcript=transcript,
        sentences=sentences,
    )


def load_all_cases() -> list[GoldCase]:
    return [load_case(p) for p in sorted(CASES_DIR.glob("*.json"))]


def load_speaker_case(path: Path, group: str) -> GoldCase:
    """judge 화자 세트(speaker_dev/test) 케이스를 GoldCase 로 읽는다(from_speaker_set=True).

    정답은 should_flag(→is_task)와 assignee_type 뿐이다. should_flag 는 legacy is_task 와 뜻이 달라
    run 이 P/R·필드 합계에는 넣지 않고 1인칭 집계에만 쓴다. 문장 목록은 split_sentences 와 맞추지 않는다
    (match_predictions 가 포함관계로 맞춘다).
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    segments = [
        TranscriptSegment(speaker=t["speaker"], start=float(i), end=float(i) + 0.9, text=t["text"])
        for i, t in enumerate(data["turns"])
    ]
    speakers = list(dict.fromkeys(t["speaker"] for t in data["turns"]))
    return GoldCase(
        case_id=f"{group}/{data['case_id']}",
        scenario=data["scenario"],
        description=data["description"],
        reference_date=SPEAKER_REFERENCE_DATE,
        speaker_names={sp: sp for sp in speakers},
        transcript=Transcript(segments=segments, source="meeting"),
        sentences=[
            GoldSentence(text=e["text"], is_task=e["should_flag"], assignee_type=e.get("assignee_type"))
            for e in data["expected"]
        ],
        from_speaker_set=True,
    )


def load_speaker_cases() -> list[GoldCase]:
    return [load_speaker_case(p, d.name) for d in SPEAKER_DIRS for p in sorted(d.glob("case_*.json"))]


def _normalize(s: str) -> str:
    return "".join(s.split())


def match_predictions(gold: GoldCase, predictions: list[ExtractedTask]) -> dict[int, ExtractedTask]:
    """예측을 근거 텍스트 포함관계로 정답 문장 인덱스에 매칭한다.

    규칙 기반은 source_sentence 가 원문과 완전히 같고, LLM 은 evidence_span 이 부분 인용일 수 있어서
    포함 관계(양방향)로 매칭한다. 한 문장에 예측이 이미 매칭돼 있으면 먼저 온 것만 채점한다
    (dense_multi_task 케이스처럼 한 문장에 여러 예측이 나올 수 있는 경우, 개수 자체는 안 본다).
    """
    matched: dict[int, ExtractedTask] = {}
    for pred in predictions:
        pred_norm = _normalize(pred.source_sentence)
        if not pred_norm:
            continue
        for i, gs in enumerate(gold.sentences):
            if i in matched:
                continue
            gs_norm = _normalize(gs.text)
            if pred_norm in gs_norm or gs_norm in pred_norm:
                matched[i] = pred
                break
    return matched


_PARTICLES = ("께서", "한테", "에게", "이가", "이", "가", "은", "는", "을", "를", "께")
_HONORIFICS = ("님", "씨", "분")  # BE matching._HONORIFICS 와 같다("분"은 #607 리뷰)


def _name_candidates(s: str | None) -> set[str]:
    """이름 표기에서 호칭(님·씨·분)·조사를 뗀 후보들을 만든다.

    BE 의 name_candidates(backend/app/services/matching.py)와 같은 규칙이다. 바꾸면 둘 다 바꾼다.
    BE 는 리스트를 돌려주고 여기서는 같은 원소의 집합이다.

    조사가 붙었는지 아닌지 겉보기로는 알 수 없다 — "하은"의 "은"은 이름의 일부지만 "환은"의
    "은"은 조사다. 그래서 원문부터 조사를 뗀 것까지 **후보를 여럿 두고** 검색한다.
    채점도 같은 기준으로 한다: 후보끼리 겹치면 정답. 단순히 조사를 떼버리면 "하은"이 "하"가 돼서
    멀쩡한 답을 오답 처리하게 된다.
    공백은 한 칸으로 줄이고 후보마다 앞뒤를 지운다("환 님이" → "환"). 호칭은 "님"·"씨"·"분"이다.
    조사를 떼고 "이"로 끝나면 "이"를 한 번 더 뗀 것도 후보다("하은이는" → 하은이는, 하은이, 하은).
    조사는 원문과 원문에서 호칭을 뗀 꼴에서만 뗀다.
    """
    if not s:
        return set()
    base = " ".join(s.split())
    out = {base}

    def add_remainder(form: str) -> None:
        form = form.strip()
        if not form:
            return
        out.add(form)
        if form.endswith("이") and len(form) > 1:
            out.add(form[:-1].strip())

    def without_honorific(form: str) -> str:
        return form[:-1].strip() if form.endswith(_HONORIFICS) else ""

    sources = [base]
    bare = without_honorific(base)
    if bare:
        sources.append(bare)
        add_remainder(bare)
    for form in sources:
        for particle in _PARTICLES:
            if form.endswith(particle) and len(form) > len(particle):
                stripped = form[: -len(particle)].strip()
                add_remainder(stripped)
                bare = without_honorific(stripped)
                if bare:
                    add_remainder(bare)
    return {x for x in out if x}


def _names_match(a: str | None, b: str | None) -> bool:
    ca, cb = _name_candidates(a), _name_candidates(b)
    if not ca and not cb:
        return True  # 둘 다 비어 있으면(first/group/none) 일치로 본다
    return bool(ca & cb)


@dataclass
class ScoreResult:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0
    type_correct: int = 0  # 담당자 호칭 타입(first/thirdname/...) 분류 정확도
    type_total: int = 0
    assignee_correct: int = 0
    assignee_total: int = 0
    due_correct: int = 0
    due_total: int = 0
    keyword_correct: int = 0
    keyword_total: int = 0

    def __add__(self, other: "ScoreResult") -> "ScoreResult":
        return ScoreResult(**{f: getattr(self, f) + getattr(other, f) for f in self.__dataclass_fields__})

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if (self.tp + self.fp) else float("nan")

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if (self.tp + self.fn) else float("nan")

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        if p != p or r != r or (p + r) == 0:
            return float("nan")
        return 2 * p * r / (p + r)

    @property
    def type_accuracy(self) -> float:
        return self.type_correct / self.type_total if self.type_total else float("nan")

    @property
    def assignee_accuracy(self) -> float:
        return self.assignee_correct / self.assignee_total if self.assignee_total else float("nan")

    @property
    def due_accuracy(self) -> float:
        return self.due_correct / self.due_total if self.due_total else float("nan")

    @property
    def keyword_accuracy(self) -> float:
        return self.keyword_correct / self.keyword_total if self.keyword_total else float("nan")


def score_case(gold: GoldCase, predictions: list[ExtractedTask]) -> ScoreResult:
    matched = match_predictions(gold, predictions)
    result = ScoreResult()
    for i, gs in enumerate(gold.sentences):
        pred = matched.get(i)
        if gs.is_task and pred is not None:
            result.tp += 1

            # 담당자 호칭 타입 — gold 에 타입이 적힌 케이스만 채점
            if gs.assignee_type is not None:
                result.type_total += 1
                if pred.assignee_type == gs.assignee_type:
                    result.type_correct += 1

            # 담당자 지목 — second/thirdpronoun 은 '해소된 이름'이 맞는지를 본다.
            # first/group/none 은 이름이 없는 게 정답이므로 둘 다 비어 있으면 정답.
            result.assignee_total += 1
            if gs.assignee_resolved:
                got = pred.assignee_resolved or pred.assignee_mention
                if _names_match(got, gs.assignee_resolved):
                    result.assignee_correct += 1
            elif _names_match(pred.assignee_mention, gs.assignee_mention):
                result.assignee_correct += 1

            result.due_total += 1
            if pred.due_date == gs.due_date:
                result.due_correct += 1
            if gs.task_keywords:
                result.keyword_total += 1
                if all(kw in pred.task for kw in gs.task_keywords):
                    result.keyword_correct += 1
        elif gs.is_task and pred is None:
            result.fn += 1
        elif not gs.is_task and pred is not None:
            result.fp += 1
        else:
            result.tn += 1
    return result


@dataclass
class FirstPersonTally:
    """정답이 first 인 문장이 어떤 타입으로 분류됐는지. 매칭된(탐지된) 문장만 센다."""

    total: int = 0
    by_type: Counter[str] = field(default_factory=Counter)
    mistakes: list[str] = field(default_factory=list)

    def __add__(self, other: "FirstPersonTally") -> "FirstPersonTally":
        return FirstPersonTally(
            total=self.total + other.total,
            by_type=self.by_type + other.by_type,
            mistakes=self.mistakes + other.mistakes,
        )


def tally_first_person(gold: GoldCase, predictions: list[ExtractedTask]) -> FirstPersonTally:
    matched = match_predictions(gold, predictions)
    tally = FirstPersonTally()
    for i, gs in enumerate(gold.sentences):
        pred = matched.get(i)
        if not (gs.is_task and gs.assignee_type == "first") or pred is None:
            continue
        tally.total += 1
        tally.by_type[pred.assignee_type or "None"] += 1
        if pred.assignee_type != "first":
            tally.mistakes.append(f"{gold.case_id}: {gs.text} → {pred.assignee_type} {pred.assignee_mention!r}")
    return tally


def _counts(s: ScoreResult) -> dict[str, int]:
    return {f: getattr(s, f) for f in s.__dataclass_fields__}


def _fmt(x: float) -> str:
    return "  -" if x != x else f"{x * 100:3.0f}%"


def _print_mismatches(case: GoldCase, preds: list[ExtractedTask]) -> None:
    """틀린 것만 정답 옆에 나란히 찍는다 — 점수만 봐선 뭘 고쳐야 할지 모르기 때문."""
    matched = match_predictions(case, preds)
    lines: list[str] = []
    for i, gs in enumerate(case.sentences):
        pred = matched.get(i)
        if gs.is_task and pred is None:
            lines.append(f"      [놓침] {gs.text}")
        elif not gs.is_task and pred is not None:
            lines.append(f"      [오탐] {gs.text}\n             → 뽑힘: {pred.task}")
        elif gs.is_task and pred is not None:
            diffs = []
            if gs.assignee_type is not None and pred.assignee_type != gs.assignee_type:
                diffs.append(f"타입 {gs.assignee_type}→{pred.assignee_type}")
            want = gs.assignee_resolved or gs.assignee_mention
            got = (pred.assignee_resolved or pred.assignee_mention) if gs.assignee_resolved else pred.assignee_mention
            if not _names_match(got, want):
                diffs.append(f"담당자 {want}→{got}")
            if pred.due_date != gs.due_date:
                diffs.append(f"마감 {gs.due_date}→{pred.due_date}")
            if diffs:
                lines.append(f"      [필드] {gs.text}\n             → {', '.join(diffs)}")
    if lines:
        print("\n".join(lines))


def run(
    label: str,
    extract_fn: Callable[[GoldCase], list[ExtractedTask]],
    *,
    cases: list[GoldCase] | None = None,
    verbose: bool = False,
) -> dict:
    if cases is None:
        cases = load_all_cases()
    print(f"\n=== {label} ===")
    print(f"  {'case':<22}{'시나리오':<18}{'P':>5}{'R':>5}{'F1':>5}{'타입':>7}{'담당자':>7}{'마감':>7}")
    by_scenario: dict[str, ScoreResult] = {}
    overall = ScoreResult()
    first_person = FirstPersonTally()
    errors = 0
    for case in cases:
        try:
            preds = extract_fn(case)
        except Exception as e:  # 케이스 하나가 API 에러(예: LengthFinishReasonError)로 죽어도 나머지는 계속
            print(f"  {case.case_id:<22}{case.scenario:<18} ERROR: {e!r}")
            errors += 1
            continue
        first_person = first_person + tally_first_person(case, preds)
        if case.from_speaker_set:
            # speaker 세트는 1인칭 집계에만 넣는다. 정답에 담당자 언급·마감이 없어 케이스별 P/R 과 불일치 출력은
            # 가짜 숫자라 찍지도 않는다(#607 리뷰)
            continue
        s = score_case(case, preds)
        overall = overall + s
        by_scenario[case.scenario] = by_scenario.get(case.scenario, ScoreResult()) + s
        print(
            f"  {case.case_id:<22}{case.scenario:<18}{_fmt(s.precision):>5}{_fmt(s.recall):>5}"
            f"{_fmt(s.f1):>5}{_fmt(s.type_accuracy):>7}{_fmt(s.assignee_accuracy):>7}{_fmt(s.due_accuracy):>7}"
        )
        if verbose:
            _print_mismatches(case, preds)

    print("\n  -- 시나리오별 --")
    for scenario, s in sorted(by_scenario.items()):
        print(
            f"  {scenario:<40}{_fmt(s.precision):>5}{_fmt(s.recall):>5}"
            f"{_fmt(s.f1):>5}{_fmt(s.type_accuracy):>7}{_fmt(s.assignee_accuracy):>7}{_fmt(s.due_accuracy):>7}"
        )

    print(
        f"\n  -- 전체 -- P={_fmt(overall.precision)} R={_fmt(overall.recall)} F1={_fmt(overall.f1)} "
        f"타입={_fmt(overall.type_accuracy)} 담당자={_fmt(overall.assignee_accuracy)} 마감={_fmt(overall.due_accuracy)}"
    )

    print("\n  -- 1인칭 (정답 first) --")
    print(f"  탐지된 {first_person.total}문장 · 분류: {dict(first_person.by_type)} · 오분류 {len(first_person.mistakes)}")
    for m in first_person.mistakes:
        print(f"    {m}")
    if errors:
        print(f"  호출 실패로 건너뛴 케이스 {errors}개")

    return {
        # 콘솔의 정확도를 파일만으로 다시 계산할 수 있게 셈을 모두 남긴다(#607 리뷰)
        "overall": _counts(overall),
        "by_scenario": {scenario: _counts(s) for scenario, s in sorted(by_scenario.items())},
        "first_person": {
            "total": first_person.total,
            "by_type": dict(first_person.by_type),
            "mistakes": list(first_person.mistakes),
        },
        "errors": errors,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="extract 골든셋 채점")
    ap.add_argument("--n-samples", type=int, default=1,
                    help="self-consistency 반복 횟수 (기본 1). 3 으로 올리면 호출이 3배인데 recall 은 약 1%%p 오른다")
    ap.add_argument("-v", "--verbose", action="store_true", help="틀린 항목을 정답과 나란히 출력 (--runs 1 일 때만)")
    ap.add_argument("--set", dest="case_set", choices=("golden", "speaker", "all"), default="golden",
                    help="golden=extract 골든셋(기본), speaker=judge 화자 세트(speaker_dev·speaker_test), all=둘 다")
    ap.add_argument("--runs", type=int, default=1, help="같은 조건으로 반복할 횟수 (기본 1)")
    ap.add_argument("--out", help="결과를 저장할 JSON 경로")
    args = ap.parse_args()

    try:
        from openai import OpenAI
    except ImportError:
        print("openai 가 설치돼 있지 않습니다 (pip install openai).")
        return 1

    from shared.config import settings

    cfg = settings()
    if not cfg.llm_api_key:
        print("LLM_API_KEY(또는 GEMINI_API_KEY) 가 없습니다 — .env 에 채워 주세요.")
        return 1

    from extract import llm as llm_extract

    cases: list[GoldCase] = []
    if args.case_set in ("golden", "all"):
        cases += load_all_cases()
    if args.case_set in ("speaker", "all"):
        cases += load_speaker_cases()

    client = OpenAI(base_url=cfg.llm_base_url or None, api_key=cfg.llm_api_key)
    n_runs = max(1, args.runs)
    runs = [
        run(
            f"{cfg.llm_model} (n_samples={args.n_samples}, set={args.case_set}, run {i + 1}/{n_runs})",
            lambda case: llm_extract.extract_tasks(
                case.transcript,
                client=client,
                model=cfg.llm_model,
                today=case.reference_date,
                speaker_names=case.speaker_names,
                n_samples=args.n_samples,
            ),
            cases=cases,
            verbose=args.verbose and n_runs == 1,
        )
        for i in range(n_runs)
    ]

    if args.out:
        meta = {
            "model": cfg.llm_model,
            "n_samples": args.n_samples,
            "set": args.case_set,
            "runs": n_runs,
            "date": date.today().isoformat(),
        }
        Path(args.out).write_text(json.dumps({"meta": meta, "runs": runs}, ensure_ascii=False, indent=2),
                                  encoding="utf-8")
        print(f"\n결과 저장: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
