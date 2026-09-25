"""재배치 합성 회의. 정렬본의 실제 목소리 조각을 다시 놓아 정렬본에 없는 상황을 만든다.

정렬본(meeting-01/02-aligned)은 각자 대본을 읽은 녹음이라 같은 화자 클립 사이 쉼이 0.4~0.8초로
고르고, 화자 교대 직후·끼어들기·짧은 대답·긴 침묵 뒤 첫 발화·할일과 마감이 다른 줄로 갈리는 경우가
없다. 그래서 TURN_GAP_S 같은 턴 기준을 흔들어도 정렬본에서는 아무것도 안 바뀐다. 여기서는 그런
상황을 조각 재배치로 만든다. **목소리는 진짜, 배치와 시간축은 합성이다.** 결과는 "재배치 합성"
으로 따로 묶어 읽고, 실녹음 검증은 D6 골든셋에서 한다.

조각은 정답 대본의 글자열(앵커)로 고른다. 앵커가 가리키는 단어들의 시각은 로컬 전사의 단어
시각이고, 전사를 정답에 글자 정렬해 어느 단어가 앵커에 드는지 정한다. 자르는 자리는 단어 경계
근처에서 가장 조용한 10ms 로 옮긴다. 조각의 정답은 앵커 글자열 그대로다. 단어 시각이 틀리면 조각
가장자리 음절 하나가 잘리거나 이웃 음절이 딸려 올 수 있다(합성 결과마다 적는다).

    python -m stt.eval.scenarios build --golden-root "<골든 폴더>" --out <scratchpad>/scenarios --cache <캐시>

wav 는 레포에 넣지 않는다. 만든 폴더는 정렬본과 같은 모양이라 sensitivity 가 그대로 읽는다.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import soundfile as sf

from stt import batch as B
from stt.eval import textmetrics as T
from stt.eval.eval import nospace

SR = 16_000
_WORD = re.compile(r"\w")
EDGE_SEARCH_S = 0.25   # 단어 경계에서 조용한 자리를 찾는 범위
TAIL_S = 2.0           # 마지막 조각 뒤 무음


# ─────────────────────────────────────────────────────────── 순수 로직
def place(pieces: list[tuple[str, float]], durations: list[float]) -> list[tuple[float, float]]:
    """(화자, 앞 조각 끝에서의 간격) 목록을 (시작, 끝) 으로. 음수 간격은 겹침. 한 목소리는 안 겹친다."""
    out, prev_end = [], 0.0
    last_of: dict[str, float] = {}
    for (spk, gap), dur in zip(pieces, durations):
        start = round(prev_end + gap, 3)
        if spk in last_of and start < last_of[spk] - 1e-9:
            raise ValueError(f"{spk} 의 조각이 자기 앞 조각과 겹친다 ({start} < {last_of[spk]})")
        end = round(start + dur, 3)
        out.append((start, end))
        last_of[spk] = end
        prev_end = end
    return out


def raw_positions(raw: str) -> list[int]:
    """정규화 글자 k 번째가 원문 몇 번째 글자인지. 마지막에 원문 길이를 붙인다."""
    return [i for i, ch in enumerate(raw) if _WORD.match(ch)] + [len(raw)]


def anchor_range(raw: str, anchor: str, occurrence: int = 0) -> tuple[int, int]:
    at = -1
    for _ in range(occurrence + 1):
        at = raw.find(anchor, at + 1)
        if at < 0:
            raise ValueError(f"정답에 앵커가 없다: {anchor!r}")
    n0 = sum(1 for ch in raw[:at] if _WORD.match(ch))
    return n0, n0 + sum(1 for ch in anchor if _WORD.match(ch))


def word_spans(ref: str, words: list[str]) -> list[tuple[int, int]]:
    """전사 단어마다 정답의 정규화 글자 구간. 글자 정렬(CER 과 같은 것)을 따른다."""
    hyp = "".join(nospace(w) for w in words)
    pos, _err, _c = T._align(nospace(ref), hyp)
    spans, k = [], 0
    for w in words:
        n = len(nospace(w))
        spans.append((pos[k], pos[k + n]))
        k += n
    return spans


def select_words(spans: list[tuple[int, int]], n0: int, n1: int) -> tuple[int, int] | None:
    idx = [i for i, (a, b) in enumerate(spans) if b > a and n0 <= (a + b) / 2 < n1]
    return (idx[0], idx[-1]) if idx else None


# ─────────────────────────────────────────────────────────── 조각
@dataclass
class Fragment:
    pcm: np.ndarray
    text: str
    src: str
    speaker: str
    src_start: float
    src_end: float


def _quietest(audio: np.ndarray, lo_s: float, hi_s: float) -> float:
    """[lo, hi] 안에서 가장 조용한 10ms 의 가운데."""
    f = SR // 100
    lo, hi = max(0, int(lo_s * SR)), min(len(audio), int(hi_s * SR))
    if hi - lo < f:
        return (lo_s + hi_s) / 2
    frames = audio[lo:lo + (hi - lo) // f * f].reshape(-1, f)
    k = int(np.argmin(np.sqrt(np.mean(frames * frames, axis=1))))
    return (lo + k * f + f // 2) / SR


class Library:
    """원본 회의들의 화자별 조각 사전. 단어 시각은 backend(보통 캐시로 감싼 로컬 모델)에서 온다."""

    def __init__(self, sources: dict[str, Path], backend, *, gate: bool = False):
        self.sources = sources
        self.backend = backend
        self.gate = gate
        self._by: dict[tuple[str, str], dict] = {}

    def speaker(self, src: str, spk: str) -> dict:
        key = (src, spk)
        if key not in self._by:
            session = self.sources[src]
            audio = B.load_track(session / f"{spk}.wav")
            words = []
            for u in B.cut(audio, spk):
                r = self.backend.transcribe(u.pcm, SR)
                words += [(w.text, u.start_ms / 1000 + w.start_s, u.start_ms / 1000 + w.end_s) for w in r.words]
            truth = json.loads((session / "truth_by_speaker.json").read_text(encoding="utf-8"))[spk]
            self._by[key] = {"audio": audio, "words": words, "truth": truth,
                             "spans": word_spans(truth, [w[0] for w in words])}
        return self._by[key]

    def fragment(self, src: str, spk: str, text: str, occurrence: int = 0) -> Fragment:
        d = self.speaker(src, spk)
        n0, n1 = anchor_range(d["truth"], text, occurrence)
        sel = select_words(d["spans"], n0, n1)
        if sel is None:
            raise ValueError(f"{src}/{spk}: 앵커에 해당하는 단어가 없다 {text!r}")
        i, j = sel
        words, audio = d["words"], d["audio"]
        t0, t1 = words[i][1], words[j][2]
        lo = (words[i - 1][2] + t0) / 2 if i > 0 else t0 - EDGE_SEARCH_S
        hi = (t1 + words[j + 1][1]) / 2 if j + 1 < len(words) else t1 + EDGE_SEARCH_S
        a = _quietest(audio, max(lo, t0 - EDGE_SEARCH_S), t0)
        b = _quietest(audio, t1, min(hi, t1 + EDGE_SEARCH_S))
        return Fragment(pcm=audio[int(a * SR):int(b * SR)].copy(), text=text, src=src, speaker=spk,
                        src_start=round(a, 3), src_end=round(b, 3))


# ─────────────────────────────────────────────────────────── 회의 만들기
KNOWN_ISSUES = [
    "목소리는 정렬본(실제 녹음) 조각, 배치와 시간축은 합성이다. 순서·턴 지표는 이 합성 배치 대비다",
    "조각 경계는 로컬 전사의 단어 시각으로 잡았다. 가장자리 음절 하나가 잘리거나 딸려 올 수 있다",
    "트랙의 빈 곳은 0 이다. 실제 배경 소음이 없어 VAD 소음 추정과 말 필터가 실제와 다르게 동작할 수 있다",
]


def build(spec: dict, lib: Library, out_root: Path) -> Path:
    pieces = spec["pieces"]
    frags = [lib.fragment(p["src"], p["speaker"], p["text"], p.get("occurrence", 0)) for p in pieces]
    times = place([(p["speaker"], float(p["gap"])) for p in pieces], [len(f.pcm) / SR for f in frags])
    total = int((max(e for _, e in times) + TAIL_S) * SR)
    out = out_root / spec["name"]
    out.mkdir(parents=True, exist_ok=True)
    canvases: dict[str, np.ndarray] = {}
    for (st, _en), f in zip(times, frags):
        c = canvases.setdefault(f.speaker, np.zeros(total, dtype=np.float32))
        at = int(round(st * SR))
        c[at:at + len(f.pcm)] = f.pcm
    for spk, c in canvases.items():
        sf.write(str(out / f"{spk}.wav"), c, SR, subtype="PCM_16")
    order = sorted(range(len(frags)), key=lambda k: (times[k][0], frags[k].speaker))
    truth = [{"seq": n, "speaker": frags[k].speaker, "text": frags[k].text, "start": times[k][0], "end": times[k][1],
              "src": frags[k].src, "src_start": frags[k].src_start, "src_end": frags[k].src_end}
             for n, k in enumerate(order)]
    by: dict[str, list[str]] = {}
    for t in truth:
        by.setdefault(t["speaker"], []).append(t["text"])
    (out / "truth_aligned.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "truth_by_speaker.json").write_text(json.dumps({k: " ".join(v) for k, v in by.items()},
                                                          ensure_ascii=False, indent=1), encoding="utf-8")
    meta = {"name": spec["name"], "kind": "synthetic-rearranged", "title": spec.get("title", spec["name"]),
            "purpose": spec.get("description", ""),
            "timeline": "합성. 정렬본의 실제 목소리 조각을 다시 놓았다",
            "derived_from": sorted({p["src"] for p in pieces}), "speakers": sorted(canvases),
            "known_issues": KNOWN_ISSUES, "created": date.today().isoformat()}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    if spec.get("expected"):
        (out / "expected_tasks.json").write_text(json.dumps(spec["expected"], ensure_ascii=False, indent=1),
                                                 encoding="utf-8")
    return out
