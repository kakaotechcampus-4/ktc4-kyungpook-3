"""전사 오인식 의심 단어 검사 — judge 새 항목의 근거 발화와 제목에서 "어느 목록에도 없는 말"을 찾는다.

Jev 근거 검증은 근거 원문에 충실한지만 본다. 근거 문장 자체가 잘못 전사됐는지("배포"가 "애포"로)는 보지 않아,
"애포문서 정리"가 certain 으로 auto 반영될 수 있었다. 의심 단어가 있으면 BE 가 auto 대신 review 로 보낸다
(asr_suspects, 결정 기록 2026-11-07 asr-suspect-gate). 이 검사는 auto 를 막기만 하고 열지는 않는다.

두 규칙으로 찾는다. 둘 다 코드만 쓰고 LLM 을 부르지 않는다.
1. 모르는 명사: 형태소 분석기(kiwipiepy)가 사전에 없는 말을 형태 없는 미등록 형태소로 표시한다("애포", "테스뜨").
   업무 용어 파일·기존 태스크 제목·팀원 이름·같은 회의의 다른 발화에 있으면 의심하지 않는다.
2. 업무 용어와 한 끗 차이: 분석기가 아는 형태소로 잘못 쪼갠 경우("티자인" → 티자+이+ㄴ, "기획소" → 기획+소).
   토큰 경계에 맞는 구간이 업무 용어와 자모 하나 차이이고 그 자체로는 아는 낱말이 아니면 의심한다.
의심 단어마다 발음이 가까운 업무 용어를 교정 후보로 최대 5개 붙인다(자모 편집 거리). 팀원 이름은 후보에 넣지 않는다
("티자인"의 후보로 팀원 "이자인"이 나오면 안 된다).

알려진 한계: 오인식이 실제 낱말이면("배포"가 "대표"로) 잡지 못한다. 한글만 보고 영문·숫자는 보지 않는다.
분석기는 처음 쓸 때 한 번 올린다(약 2초, 메모리 약 300MB). 분석이 실패하면 보수적으로 check_failed 를 낸다.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

TERMS_PATH = Path(__file__).resolve().parent / "asr_terms.txt"
MAX_CANDIDATES = 5
# 교정 후보로 내밀 자모 거리의 상한(거리 / 긴 쪽 자모 수). "애포"↔"배포" 는 1/4 = 0.25
CANDIDATE_MAX_NORM = 0.34
# 규칙 2(아는 형태소로 잘못 쪼갬)는 업무 용어와 자모 하나 차이일 때만 본다. 더 넓히면 멀쩡한 말이 걸린다
NEAR_MISS_MAX = 1
NOUN_TAGS = {"NNG", "NNP"}
# 규칙 2 의 구간은 명사 쪽 토큰에서 시작한다. 끝은 어느 토큰이든 된다 — 오인식이 조사·부사로 잘못 쪼개진다
# ("초엔" → 초+에+ㄴ, "권안" → 권+안). 구간이 업무 용어와 자모 하나 차이일 때만 의심하므로 "배포는"은 걸리지 않는다
_SPAN_START_TAGS = {"NNG", "NNP", "NNB", "NR", "XR", "XPN", "SN"}
# 분석기 형태소 번호는 대체로 빈도 순서다(흔한 낱말일수록 작다: 시간 253, 대표 360, 결재 12625, 토스 39970).
# 이보다 큰 드문 낱말 하나("시앙" 63517, "이쓔" 72688)는 업무 용어와 한 끗 차이면 오인식으로 본다
RARE_MORPHEME_ID = 50000
_HANGUL = re.compile(r"^[가-힣]+$")
CHECK_FAILED = "check_failed"
# BE 가 받는 asr_suspects 상한(backend schemas/meeting.py). 넘으면 요청 전체가 400 이라 그 회의 항목이 다 빠진다.
# 게이트는 하나만 있어도 막으므로 잘라도 결과가 같다(#532 리뷰)
MAX_SUSPECTS = 50

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


# 분석기가 조사까지 한 덩어리 미등록어로 잡는 경우가 있다("금요일까지"). 떼고 나면 아는 말이면 오인식이 아니다
_TRAILING = ("께서", "에게서", "한테서", "까지", "부터", "에서", "에게", "한테", "으로", "이랑", "하고", "처럼", "보다",
             "마다", "이나", "랑", "로", "은", "는", "이", "가", "을", "를", "도", "만", "의", "와", "과", "에", "께", "나")


def _explained_by_particle(kiwi, word: str, vocab: "Vocabulary") -> bool:
    for p in _TRAILING:
        rest = word[: -len(p)]
        if word.endswith(p) and len(rest) >= 1:
            if rest in vocab.known:
                return True
            toks = kiwi.tokenize(rest)
            if toks and not any(_is_unknown(kiwi, t) for t in toks):
                return True
    return False


def _knows(kiwi, piece: str, vocab: "Vocabulary") -> bool:
    """piece 가 목록에 있거나 분석기가 아는 명사 하나인가."""
    if piece in vocab.known:
        return True
    toks = kiwi.tokenize(piece)
    return len(toks) == 1 and toks[0].form == piece and toks[0].tag in NOUN_TAGS and not _is_unknown(kiwi, toks[0])


def _core(kiwi, word: str, vocab: "Vocabulary") -> str:
    """붙여 쓴 미등록 복합어에서 아는 앞·뒤 부분을 뗀 나머지. "애포문서" → "애포". 못 떼면 그대로."""
    for i in range(1, len(word) - 1):
        if _knows(kiwi, word[i:], vocab) and len(word[:i]) >= 2:
            return word[:i]
    for i in range(len(word) - 1, 1, -1):
        if _knows(kiwi, word[:i], vocab) and len(word[i:]) >= 2:
            return word[i:]
    return word


def _is_unknown(kiwi, token) -> bool:
    """사전에 없는 말인가. kiwipiepy 는 미등록어를 형태가 빈 일반·고유 명사 형태소로 표시한다."""
    try:
        return kiwi.morpheme(token.id).form == ""
    except Exception:  # noqa: BLE001 - 형태소 표를 못 읽으면 모르는 말로 보지 않는다(규칙 2 가 남는다)
        return False


@dataclass
class Vocabulary:
    """의심 여부와 교정 후보에 쓰는 낱말 모음. known 은 의심하지 않을 말, candidates 는 교정 후보로 내밀 말이다."""

    known: set[str] = field(default_factory=set)
    candidates: set[str] = field(default_factory=set)

    @classmethod
    def build(cls, *, members: Iterable[str] = (), task_titles: Iterable[str] = (),
              other_lines: Iterable[str] = ()) -> "Vocabulary":
        """팀원 이름(known 만), 기존 태스크 제목·같은 회의의 다른 발화(둘 다), 업무 용어 파일(둘 다)."""
        v = cls(set(load_terms()), set(load_terms()))
        for name in members:
            v.known.update(_words(name))
        for text in [*task_titles, *other_lines]:
            for w in _nouns(text):
                v.known.add(w)
                v.candidates.add(w)
        return v


def _words(text: str) -> set[str]:
    return {w for w in re.split(r"\s+", text or "") if w}


def _nouns(text: str) -> set[str]:
    """명사 토큰과, 띄어 쓰지 않은 명사 묶음("배포문서"). 목록 쪽 말이라 모르는 말도 그대로 받는다."""
    kiwi = _kiwi()
    out: set[str] = set()
    run: list[str] = []
    last_pos = None
    for t in kiwi.tokenize(text or ""):
        if t.tag in NOUN_TAGS and _HANGUL.match(t.form):
            out.add(t.form)
            run = run + [t.form] if last_pos == t.word_position and run else [t.form]
            if len(run) > 1:
                out.add("".join(run))
        else:
            run = []
        last_pos = t.word_position
    return out


def _span_candidates(text: str, tokens: list) -> list[tuple[str, bool]]:
    """규칙 2 의 대상 구간: 한 어절 안에서 토큰 경계로 시작·끝나는 2~6자 한글 구간. (구간, 아는 낱말 하나인가)."""
    by_word: dict[int, list] = {}
    for t in tokens:
        by_word.setdefault(t.word_position, []).append(t)
    out = []
    for ts in by_word.values():
        # 어절 첫 자리는 늘 시작이 된다 — 오인식이 관형사·서술격으로 쪼개진다("모둘" → 모+둘, "인터부" → 이+ㄴ+터부)
        starts = sorted({ts[0].start} | {t.start for t in ts if t.tag in _SPAN_START_TAGS})
        ends = sorted({t.start + t.len for t in ts})
        # 흔한 낱말 하나로 분석된 구간은 실제 낱말이라 보지 않는다(오인식이 실제 낱말이면 못 잡는 한계)
        single_known = {t.form for t in ts if t.tag in NOUN_TAGS and t.id < RARE_MORPHEME_ID}
        for s in starts:
            for e in ends:
                piece = text[s:e]
                # 구간 안에 명사 쪽 토큰이 하나는 있어야 한다. 없으면 "하고"(동사·조사)가 "회고"와 한 끗 차이로 걸린다
                has_noun = any(t.tag in _SPAN_START_TAGS and s <= t.start < e for t in ts)
                if 2 <= len(piece) <= 6 and _HANGUL.match(piece) and has_noun:
                    out.append((piece, piece in single_known))
    return out


def _suggest(word: str, vocab: Vocabulary) -> list[str]:
    scored = []
    for c in vocab.candidates:
        if c == word or abs(len(c) - len(word)) > 1:
            continue
        d, norm = jamo_distance(word, c)
        if norm <= CANDIDATE_MAX_NORM:
            scored.append((norm, d, c))
    return [c for _, _, c in sorted(scored)[:MAX_CANDIDATES]]


def find_suspects(text: str, vocab: Vocabulary, source: str) -> list[dict[str, Any]]:
    """한 문장(근거 발화 하나 또는 제목)의 의심 단어. [{"word", "source", "candidates"}]."""
    kiwi = _kiwi()
    tokens = kiwi.tokenize(text or "")
    found: dict[str, list[str]] = {}
    # 규칙 1: 모르는 명사
    for t in tokens:
        w = t.form
        if (t.tag in NOUN_TAGS and len(w) >= 2 and _HANGUL.match(w) and w not in vocab.known
                and _is_unknown(kiwi, t) and not _explained_by_particle(kiwi, w, vocab)):
            w = _core(kiwi, w, vocab)
            if w not in vocab.known:
                found.setdefault(w, _suggest(w, vocab))
    # 규칙 2: 업무 용어와 자모 하나 차이인데 아는 낱말 하나가 아닌 구간
    for piece, is_single_word in _span_candidates(text or "", tokens):
        if piece in found or piece in vocab.known or is_single_word:
            continue
        if any(piece in f or f in piece for f in found):
            continue
        near = [c for c in vocab.candidates
                if c != piece and abs(len(c) - len(piece)) <= 1 and jamo_distance(piece, c)[0] <= NEAR_MISS_MAX]
        if near:
            found[piece] = _suggest(piece, vocab) or near[:MAX_CANDIDATES]
    return [{"word": w, "source": source, "candidates": c} for w, c in found.items()]


def failed() -> list[dict[str, Any]]:
    """검사를 하지 못했다는 표시. BE 는 비어 있지 않은 asr_suspects 를 auto 차단 사유로 본다."""
    return [{"word": "", "source": CHECK_FAILED, "candidates": []}]


def check_item(lines: list[str], title: str | None, vocab: Vocabulary) -> list[dict[str, Any]]:
    """새 항목 하나의 의심 단어. 근거 발화를 먼저 본다 — 초안(Luna)이 제목에서 고쳐 써도 원문의 오인식은 남는다.

    분석이 실패하면 [{"word": "", "source": "check_failed", ...}] 로 auto 를 막고 로그를 남긴다. 조용히 통과시키면
    잘못 전사된 항목이 auto 로 갈 수 있고, 모두 막히는 상황은 로그로 알아본다.
    """
    try:
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for text, source in [*((line, "evidence") for line in lines), (title or "", "title")]:
            for s in find_suspects(text, vocab, source):
                if s["word"] not in seen:
                    seen.add(s["word"])
                    out.append(s)
        return out[:MAX_SUSPECTS]
    except Exception as e:  # noqa: BLE001 - 분석 실패가 항목 전체를 버리게 하지 않는다
        logger.warning("전사 오인식 검사 실패라 auto 를 막는다: %s: %s", type(e).__name__, e)
        return failed()
