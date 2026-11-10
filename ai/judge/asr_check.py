"""전사 오인식 검사 — judge 새 항목의 제목 명사 중 워크스페이스 용어 목록에 없는 말을 Jev 로 확인한다.

Jev 근거 검증은 근거 원문에 충실한지만 본다. 근거 문장 자체가 잘못 전사됐으면("진도"가 "짐도"로) 그 말이 제목에
그대로 옮겨져 certain 이 되고 auto 로 반영될 수 있다. 그래서 두 단계로 본다(결정 기록 0051).
1. 의심 단어: 제목의 명사(일반·고유) 중 용어 목록에 없는 말. 목록은 흔한 명사(분석기 빈도 상위 SEED_NOUNS 개 중
   명사) + 업무 용어 파일 + 팀원 이름·별칭 + BE 의 워크스페이스 용어(회의에서 두 사람 이상이 말한 명사, PM 이 승인한
   제목의 명사) + 유사 검색에서 본 기존 태스크 제목의 명사다. 담당자 이름은 BE 가 따로 매칭하므로 보지 않는다.
2. 의심 단어마다 Jev 에 "맞게 적힌 말인가?"를 묻는다(근거 판정과 같은 호출, judge/evidence.py). yes 확률이
   YES_THRESHOLD 미만이면 asr_suspects 로 보내고 BE 가 auto 대신 review 로 보낸다. 호출이 실패하면 check_failed 다.
이 검사는 auto 를 막기만 하고 열지는 않는다.

알려진 한계: 동사·형용사가 틀린 오류는 보지 않는다. 흔한 명사(목록 안)로 틀린 오류는 1단계에서 놓친다.
분석기(kiwipiepy)는 처음 쓸 때 한 번 올린다(약 2초, 메모리 약 300MB).
"""

from __future__ import annotations

import logging
import os
import re
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

TERMS_PATH = Path(__file__).resolve().parent / "asr_terms.txt"
NOUN_TAGS = {"NNG", "NNP"}
_HANGUL = re.compile(r"^[가-힣]+$")
MAX_CANDIDATES = 5
# 교정 후보로 내밀 자모 거리의 상한(거리 / 긴 쪽 자모 수). "애포"↔"배포" 는 1/4 = 0.25
CANDIDATE_MAX_NORM = 0.34
CHECK_FAILED = "check_failed"
TITLE = "title"
# BE 가 받는 asr_suspects 상한(backend schemas/meeting.py). 넘으면 요청 전체가 400 이다
MAX_SUSPECTS = 50
MAX_WORD_LEN = 100
# 초반 기본 목록: 분석기 형태소 번호(대체로 빈도 순) 상위 N 개 중 명사. AI Hub 측정(2026-11-08)에서 N 이 작을수록 더 잡고
# Jev 로 더 많이 보낸다. Jev 는 근거 판정과 같은 호출이라 호출 수는 늘지 않는다
SEED_NOUNS = int(os.environ.get("MM_ASR_SEED_NOUNS") or "1000")
# 근거 판정(judge/evidence.py YES_THRESHOLD)과 같은 0.8 에서 시작한 잠정값. AI Hub 에서 명사 오류 43%·정상 16% 를 막았다
YES_THRESHOLD = float(os.environ.get("MM_ASR_YES_THRESHOLD") or "0.8")

_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_JONG = ["", *"ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"]


def jamo(text: str) -> str:
    """한글 음절을 초성·중성·종성으로 푼다. 한글이 아닌 글자는 그대로 둔다. "배포" → "ㅂㅐㅍㅗ"."""
    out = []
    for ch in text:
        code = ord(ch) - 0xAC00
        if 0 <= code < 11172:
            out += [_CHO[code // 588], _JUNG[(code % 588) // 28], _JONG[code % 28]]
        else:
            out.append(ch)
    return "".join(out)


def edit_distance(a: str, b: str) -> int:
    """레벤슈타인 거리(삽입·삭제·교체 1)."""
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def jamo_distance(a: str, b: str) -> tuple[int, float]:
    """(자모 편집 거리, 긴 쪽 자모 수로 나눈 값)."""
    ja, jb = jamo(a), jamo(b)
    d = edit_distance(ja, jb)
    return d, d / max(len(ja), len(jb), 1)


@lru_cache(maxsize=1)
def load_terms() -> frozenset[str]:
    words = set()
    for line in TERMS_PATH.read_text(encoding="utf-8").splitlines():
        w = line.split("#", 1)[0].strip()
        if w:
            words.add(w)
    return frozenset(words)


@lru_cache(maxsize=1)
def _kiwi():
    from kiwipiepy import Kiwi  # 처음 쓸 때만 올린다(메모리 약 300MB)

    return Kiwi()


def nouns(text: str) -> set[str]:
    """한글로만 된 일반·고유 명사 형태소."""
    return {t.form for t in _kiwi().tokenize(text or "") if t.tag in NOUN_TAGS and _HANGUL.match(t.form)}


@lru_cache(maxsize=4)
def seed_nouns(n: int = SEED_NOUNS) -> frozenset[str]:
    """분석기 형태소 번호 상위 n 개 중 한글 명사. 번호는 대체로 빈도 순이다(시간 253, 대표 360)."""
    kiwi = _kiwi()
    out = set()
    for i in range(n):
        m = kiwi.morpheme(i)
        if str(m.tag) in NOUN_TAGS and m.form and _HANGUL.match(m.form):
            out.add(m.form)
    return frozenset(out)


def term_words(terms: Iterable[str]) -> set[str]:
    """용어를 띄어쓰기와 제목을 쪼개는 방식(형태소)으로도 나눠 안다. 여러 단어 용어("코드 컨벤션")는 통째로는 제목의
    명사와 맞지 않고, 한 단어 용어도 혼자 분석하면 제목 안에서와 다르게 쪼개질 수 있다("리마인드" → 리·마인드)."""
    out = set(terms)
    for w in terms:
        out.update(w.split())
        out |= nouns(w)
    return out


@lru_cache(maxsize=1)
def _terms_vocab() -> frozenset[str]:
    return frozenset(term_words(load_terms()))


def base_vocab() -> set[str]:
    return set(seed_nouns()) | set(_terms_vocab())


def team_nouns(lines: Iterable[tuple[str | None, str]]) -> set[str]:
    """(화자, 발화) 에서 두 사람 이상이 말한 명사. STT 는 한 사람의 같은 발음을 같은 꼴로 거듭 잘못 듣는다."""
    who: dict[str, set[str]] = defaultdict(set)
    for speaker, text in lines:
        if speaker:
            for w in nouns(text):
                who[w].add(speaker)
    return {w for w, s in who.items() if len(s) >= 2}


def suspects(title: str | None, vocab: set[str]) -> list[str]:
    """제목 명사 중 목록에 없는 말."""
    return sorted(w for w in nouns(title or "") if w not in vocab)[:MAX_SUSPECTS]


def candidates(word: str, vocab: Iterable[str]) -> list[str]:
    """발음이 가까운 목록 단어. Jev 가 "이 말을 잘못 적은 것일 수 있다"를 보게 하고 PM 확인 카드에도 싣는다."""
    scored = []
    for c in vocab:
        if c == word or abs(len(c) - len(word)) > 1 or len(c) > MAX_WORD_LEN:
            continue
        d, norm = jamo_distance(word, c)
        if norm <= CANDIDATE_MAX_NORM:
            scored.append((norm, d, c))
    return [c for _, _, c in sorted(scored)[:MAX_CANDIDATES]]


def question(word: str, cands: list[str]) -> dict[str, Any]:
    hint = f" 팀에서 쓰는 발음이 비슷한 말: {', '.join(cands)}." if cands else ""
    return {
        "type": "choice",
        "instructions": f"단어 '{word}'는 근거 원문에서 말한 사람이 실제로 한 말을 맞게 받아 적은 것인가? 음성 인식이 "
                        f"발음이 비슷한 다른 말을 잘못 적었을 수 있다.{hint} 근거 원문의 문맥에 자연스럽게 맞는지로 판단한다.",
        "criteria": {
            "yes": "문맥에 자연스럽고 맞게 적힌 말이다",
            "no": "문맥에 맞지 않아 발음이 비슷한 다른 말을 잘못 적은 것으로 보인다",
            "unclear": "문맥만으로 판단하기 어렵다",
        },
    }


def questions(words: dict[str, list[str]]) -> dict[str, dict[str, Any]]:
    """Jev 질문 키는 asr0, asr1 … (근거 판정의 task·due 와 같은 호출에 들어간다)."""
    return {f"asr{i}": question(w, c) for i, (w, c) in enumerate(words.items())}


def verdict(words: dict[str, list[str]], answers: dict[str, Any] | None,
            threshold: float = YES_THRESHOLD) -> list[dict[str, Any]]:
    """Jev 답에서 asr_suspects. 의심 단어가 없으면 []. 답이 없으면(호출 실패) check_failed 로 막는다."""
    if not words:
        return []
    if answers is None:
        return failed()
    out = []
    for i, (w, c) in enumerate(words.items()):
        try:
            ok = float(answers[f"asr{i}"]["probabilities"]["yes"]) >= threshold
        except (KeyError, TypeError, ValueError):
            ok = False
        if not ok:
            out.append({"word": w[:MAX_WORD_LEN], "source": TITLE, "candidates": c})
    return out


def failed() -> list[dict[str, Any]]:
    """검사를 하지 못했다는 표시. BE 는 비어 있지 않은 asr_suspects 를 auto 차단 사유로 본다."""
    return [{"word": "", "source": CHECK_FAILED, "candidates": []}]
