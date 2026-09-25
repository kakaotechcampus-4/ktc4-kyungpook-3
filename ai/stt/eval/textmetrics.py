"""CER 옆에 두는 전사 지표. 전부 정답과 전사를 같은 정규화(`eval.nospace`, 공백·부호 제거) 위에서
글자 정렬(jiwer)한 뒤 센다. CER 과 같은 정렬이라 값이 서로 어긋나지 않는다.

  char_errors     절대 오류 글자 수(S+D+I). 정답 약 1,050자 회의에서 CER 0.5%p 는 약 5자다
  sentence_ends   문장 끝(. ? !) 위치. extract.text.split_sentences 가 같은 부호로 문장을 나눈다
  punctuation     정답의 문장 끝이 전사에 남았나(재현율·정밀도). segments 를 주면 클립 이음 자리만 따로
                  센다. 묶음 안 0.2초 이음이 마침표를 지우는지(M12)를 이것으로 본다
  edge_errors     클립 가장자리(VAD 가 자른 자리) 좌우 window 자 안의 오류와 그 밖의 오류
  phrase_excess   정답보다 더 나온 구절 수. 위스퍼의 무음 환각 구절과 프롬프트 누설에 쓴다
  term_recall     정답에 있는 용어가 전사에 남은 비율. 대소문자·공백 무시
"""

from __future__ import annotations

import re

from stt.eval.eval import nospace

HALLUCINATION_PHRASES = ("감사합니다", "시청해주셔서", "구독", "좋아요", "자막", "MBC", "다음영상", "뉴스")

_WORD = re.compile(r"\w")
_ENDS = ".?!"


def _align(rn: str, hn: str) -> tuple[list[int], list[int], dict]:
    """(전사 위치 → 정답 위치, 정답 글자별 오류 수, 편집 수).

    위치 k 는 k 번째 글자 앞 자리다(0..길이). 삽입은 그 자리 뒤 정답 글자에 센다.
    """
    counts = {"sub": 0, "del": 0, "ins": 0}
    if not rn or not hn:
        counts["del"], counts["ins"] = len(rn), len(hn)
        return [0] * (len(hn) + 1), [1] * len(rn), counts
    import jiwer

    pos = [0] * (len(hn) + 1)
    err = [0] * len(rn)
    for ch in jiwer.process_characters(rn, hn).alignments[0]:
        r0, r1, h0, h1 = ch.ref_start_idx, ch.ref_end_idx, ch.hyp_start_idx, ch.hyp_end_idx
        if ch.type in ("equal", "substitute"):
            for t in range(h1 - h0):
                pos[h0 + t] = r0 + t
            if ch.type == "substitute":
                counts["sub"] += r1 - r0
                for r in range(r0, r1):
                    err[r] += 1
        elif ch.type == "insert":
            for h in range(h0, h1):
                pos[h] = r0
            counts["ins"] += h1 - h0
            err[min(r0, len(rn) - 1)] += h1 - h0
        else:  # delete
            counts["del"] += r1 - r0
            for r in range(r0, r1):
                err[r] += 1
    pos[len(hn)] = len(rn)
    return pos, err, counts


def char_errors(ref: str, hyp: str) -> dict:
    rn, hn = nospace(ref), nospace(hyp)
    _pos, _err, c = _align(rn, hn)
    return {"errors": c["sub"] + c["del"] + c["ins"], **c, "ref_chars": len(rn)}


def sentence_ends(text: str) -> list[int]:
    """문장 끝 부호 바로 앞까지의 정규화 글자 수 목록. 이어진 부호는 하나, 숫자 사이 점은 뺀다."""
    out: list[int] = []
    k = 0
    for i, ch in enumerate(text):
        if _WORD.match(ch):
            k += 1
            continue
        if ch not in _ENDS:
            continue
        if ch == "." and 0 < i < len(text) - 1 and text[i - 1].isdigit() and text[i + 1].isdigit():
            continue
        if k > 0 and (not out or out[-1] != k):
            out.append(k)
    return out


def _match(ref: list[int], hyp: list[int], tol: int) -> int:
    """가까운 것부터 일대일로 짝짓는다."""
    pairs = sorted((abs(r - h), i, j) for i, r in enumerate(ref) for j, h in enumerate(hyp) if abs(r - h) <= tol)
    used_r, used_h, n = set(), set(), 0
    for _d, i, j in pairs:
        if i not in used_r and j not in used_h:
            used_r.add(i)
            used_h.add(j)
            n += 1
    return n


def _ratio(a: int, b: int):
    return None if b == 0 else a / b


def punctuation(ref: str, hyp: str | None = None, *, segments: list[str] | None = None, tol: int = 2) -> dict:
    """정답의 문장 끝이 전사에서 ±tol 자 안에 남았나.

    segments 는 클립마다의 전사를 시간순으로 준 것이다(합치면 hyp). 이음 자리마다 정답에 문장 끝이
    있는지(needing)와 전사에 문장 끝이 있는지를 따로 센다. 필요한 자리에서 남은 것(kept)과 필요
    없는 자리에 생긴 것(invented)이 나온다.
    """
    segs = [s for s in (segments or []) if nospace(s)]
    if hyp is None:
        hyp = " ".join(segs)
    rn, hn = nospace(ref), nospace(hyp)
    pos, _err, _c = _align(rn, hn)
    r_ends, h_ends = sentence_ends(ref), sentence_ends(hyp)
    matched = _match(r_ends, [pos[k] for k in h_ends], tol)
    out = {"ref_ends": len(r_ends), "hyp_ends": len(h_ends), "matched": matched,
           "recall": _ratio(matched, len(r_ends)), "precision": _ratio(matched, len(h_ends))}
    if segments is not None:
        joins, k = [], 0
        for s in segs[:-1]:
            k += len(nospace(s))
            joins.append(k)
        need = need_kept = without = invented = 0
        for j in joins:
            has_ref = any(abs(r - pos[j]) <= tol for r in r_ends)
            has_hyp = any(abs(h - j) <= tol for h in h_ends)
            if has_ref:
                need += 1
                need_kept += has_hyp
            else:
                without += 1
                invented += has_hyp
        out.update({"joins": len(joins), "joins_needing_end": need, "joins_needing_end_kept": need_kept,
                    "joins_without_end": without, "joins_invented_end": invented})
    return out


def edge_errors(ref: str, segments: list[str], window: int = 2) -> dict:
    """클립 가장자리(시작과 끝) 좌우 window 자 안의 오류와 그 밖의 오류. 가장자리는 전사 쪽 클립 경계를
    정답 위치로 옮긴 것이다. 겹치는 창은 한 번만 센다."""
    rn = nospace(ref)
    segs = [nospace(s) for s in segments if nospace(s)]
    pos, err, _c = _align(rn, "".join(segs))
    edges, k = [], 0
    for s in segs:
        edges.append(k)
        k += len(s)
        edges.append(k)
    covered: set[int] = set()
    for p in {pos[h] for h in edges}:
        covered.update(range(max(0, p - window), min(len(rn), p + window)))
    edge_err = sum(err[i] for i in covered)
    inner_err = sum(err) - edge_err
    return {"edges": len(edges), "edge_chars": len(covered), "edge_errors": edge_err,
            "inner_chars": len(rn) - len(covered), "inner_errors": inner_err,
            "edge_rate": _ratio(edge_err, len(covered)), "inner_rate": _ratio(inner_err, len(rn) - len(covered))}


def _cf(s: str) -> str:
    return nospace(s).casefold()


def phrase_excess(ref: str, hyp: str, phrases=HALLUCINATION_PHRASES) -> dict:
    rn, hn = _cf(ref), _cf(hyp)
    out = {p: max(0, hn.count(_cf(p)) - rn.count(_cf(p))) for p in phrases}
    out["total"] = sum(out.values())
    return out


def term_recall(ref: str, hyp: str, terms) -> dict:
    rn, hn = _cf(ref), _cf(hyp)
    ref_n = sum(rn.count(_cf(t)) for t in terms)
    hit = sum(min(rn.count(_cf(t)), hn.count(_cf(t))) for t in terms)
    return {"ref_terms": ref_n, "hit": hit, "recall": _ratio(hit, ref_n)}


def utterance_errors(truth: list[dict], lines, slack_s: float = 0.5) -> dict:
    """정답 발화 단위 오류. 전사 줄(화자, 시작 ms, 끝 ms, 글)을 같은 화자 정답 발화 중 시간이 가장 많이 겹치는
    것에 붙이고 발화마다 오류를 센다. 어느 발화와도 안 겹치는 줄은 전부 삽입으로 센다.

    화자별로 이어 붙인 CER(char_errors)은 단어가 옆 발화로 옮겨 가도 순서가 같으면 오류로 안 센다. 묶음을
    클립으로 되돌릴 때 단어가 다른 화자의 말을 건너 앞 클립으로 붙는 경우가 그렇다. 이 값에서 화자별 오류를
    뺀 것이 발화 경계를 넘어간 글자다.
    """
    by: dict[int, list[tuple[int, str]]] = {i: [] for i in range(len(truth))}
    stray = 0
    for spk, a, b, text in lines:
        if not text:
            continue
        best, hit = 0.0, None
        for i, t in enumerate(truth):
            if t["speaker"] != spk or t.get("start") is None:
                continue
            ov = min(b / 1000, t["end"] + slack_s) - max(a / 1000, t["start"] - slack_s)
            if ov > best:
                best, hit = ov, i
        if hit is None:
            stray += len(nospace(text))
        else:
            by[hit].append((a, text))
    err = sum(char_errors(t["text"], " ".join(x for _, x in sorted(by[i])))["errors"]
              for i, t in enumerate(truth) if t.get("start") is not None)
    return {"utt_err": err + stray, "unassigned_chars": stray}
