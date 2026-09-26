"""재배치 합성 회의. 정렬본의 실제 목소리 조각을 다시 놓아 정렬본에 없는 상황을 만든다.

정렬본(meeting-01/02-aligned)은 각자 대본을 읽은 녹음이라 같은 화자 클립 사이 쉼이 0.4~0.8초로
고르고, 화자 교대 직후·끼어들기·짧은 대답·긴 침묵 뒤 첫 발화·할일과 마감이 다른 줄로 갈리는 경우가
없다. 그래서 TURN_GAP_S 같은 턴 기준을 흔들어도 정렬본에서는 아무것도 안 바뀐다. 여기서는 그런
상황을 조각 재배치로 만든다. **목소리는 진짜, 배치와 시간축은 합성이다.** 결과는 "재배치 합성"
으로 따로 묶어 읽고, 실녹음 검증은 실서버 녹음 골든셋에서 한다.

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
MAX_INNER_GAP_S = 2.0  # 앵커 안 이웃 단어 사이가 이보다 멀면 두 자리에 흩어진 것이다
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
        gaps = [words[k + 1][1] - words[k][2] for k in range(i, j)]
        if gaps and max(gaps) > MAX_INNER_GAP_S:
            raise ValueError(f"{src}/{spk}: 앵커 {text!r} 의 단어가 {max(gaps):.1f}초 떨어진 두 자리에 있다. 앵커를 나눈다")
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


# ─────────────────────────────────────────────────────────── 재배치 합성 시나리오
M1, M2 = "meeting-01-aligned", "meeting-02-aligned"


def _p(speaker, src, text, gap, **kw):
    return {"speaker": speaker, "src": src, "text": text, "gap": gap, **kw}


SPECS = [
    {"name": "rearr-quick-exchange", "title": "교대 직후",
     "description": "0.3초 간격으로 주고받는다. 같은 화자 두 조각 사이에 다른 화자의 짧은 말이 낀다",
     "pieces": [
         _p("윤지민", M1, "지난주에 GPU 서버를 새로 배정받아서 medium 모델 대신 large-v3-turbo로 테스트를 돌려봤는데, "
                        "처리 속도가 이전보다 훨씬 빨라졌습니다.", 1.0),
         _p("김환", M1, "네 맞아요,", 0.3),
         _p("윤지민", M1, "1분짜리 오디오를 전사하는 데 8초 정도밖에 안 걸렸고, 정확도도 준수했습니다.", 0.3),
         _p("최진호", M1, "다음 주에 5명, 그리고 가능하면 7명까지 늘려서 한 번 더 테스트해 보면 좋을 것 같아요.", 0.3),
         _p("유재환", M1, "네 다들 감사합니다.", 0.3),
         _p("최진호", M1, "대신 타이밍 서머리 파일하고 평가 리포트 형식만 정리해 뒀습니다.", 0.3),
         _p("김동우", M1, "그래도 크로스토크 체크리스트 4개 항목 중에서는 3개는 계속 통과했고, "
                        "동시에 말하는 구간에서만 가끔 문제가 있었습니다.", 0.3)]},
    {"name": "rearr-overlap", "title": "끼어들기",
     "description": "앞 사람 말이 끝나기 0.8~1.5초 전에 다음 사람이 시작한다",
     "pieces": [
         _p("장원준", M2, "이번 주에 PM이 할 일 초안을 승인하거나 반려하는 화면의 와이어프레임을 그렸고,", 1.0),
         _p("유재환", M2, "네 다들 감사합니다.", -1.0),
         _p("장원준", M2, "담당자, 마감일, 근거 문장 세 가지가 한눈에 보이도록 배치했습니다.", 0.2),
         _p("김환", M2, "네 맞아요,", -0.8),
         _p("김동우", M2, "저는 화자 분리 쪽을 봤는데요,", 0.3),
         _p("윤지민", M2, "다만 GPU 서버를 24시간 계속 켜 두는 건 비용 문제가 있어서, 필요할 때만 켜는 방식으로 "
                        "바꿔야 할 것 같습니다.", -1.5),
         _p("김동우", M2, "그러니까 3명일 때랑 5명일 때랑 비교해 보니까 확실히 사람이 늘어날수록 침묵 구간에 다른 사람 "
                        "목소리가 살짝 섞이는 경우가 늘어나긴 하더라고요.", 0.3)]},
    {"name": "rearr-short-replies", "title": "짧은 대답",
     "description": "\"네,\", \"네 맞아요,\" 같은 1초 안팎 조각이 긴 발화 사이에 온다",
     "pieces": [
         _p("김동우", M1, "그래도 크로스토크 체크리스트 4개 항목 중에서는 3개는 계속 통과했고, "
                        "동시에 말하는 구간에서만 가끔 문제가 있었습니다.", 1.0),
         _p("윤지민", M1, "네,", 0.5),
         _p("김환", M1, "네 맞아요,", 0.6),
         _p("최진호", M1, "저는 문서화 쪽인데, Notion 연동은 아직 이번 범위가 아니라서 손대지 않았고요,", 1.0),
         _p("유재환", M1, "그럼 시작할까요.", 0.5),
         _p("유재환", M1, "다시 하겠습니다.", 2.5),
         _p("윤지민", M2, "네,", 0.8),
         _p("장원준", M2, "다음 주 수요일까지는 데모 가능한 버전을 공유드릴게요.", 0.6),
         _p("김환", M2, "네 맞아요,", 0.5)]},
    {"name": "rearr-long-silence", "title": "긴 침묵 뒤 첫 발화",
     "description": "모두 75초·40초 말이 없다가 다시 시작한다. 같은 화자의 먼 두 턴이 한 묶음에 채워진다",
     "pieces": [
         _p("윤지민", M2, "네, 저부터 말씀드릴게요.", 2.0),
         _p("최진호", M2, "저는 문서화 쪽인데, Notion 연동은 아직 이번 범위가 아니라서 손대지 않았고요,", 0.5),
         _p("장원준", M2, "저는 승인 화면 쪽 얘기를 짧게 드리겠습니다.", 75.0),
         _p("윤지민", M2, "1분짜리 오디오를 전사하는 데 8초 정도밖에 안 걸렸고, 정확도도 준수했습니다.", 0.5),
         _p("장원준", M2, "백엔드 API 명세가 나오면 바로 연결할 수 있게 목 데이터로 먼저 만들어 두겠습니다.", 0.4),
         _p("최진호", M2, "다음 주에 5명, 그리고 가능하면 7명까지 늘려서 한 번 더 테스트해 보면 좋을 것 같아요.", 40.0)]},
    {"name": "rearr-split-commitment", "title": "할일과 마감이 다른 줄",
     "description": "마감과 할일이 1.5초 쉼으로 갈리거나, 다른 화자의 짧은 말 뒤에 마감이 따로 온다",
     "pieces": [
         _p("김환", M1, "그래서 이번 주 안에", 1.0),
         _p("김환", M1, "통과 기준표를 다시 정리해서 공유드릴게요.", 1.5),
         _p("장원준", M1, "데모 가능한 버전을 공유드릴게요.", 0.8),
         _p("유재환", M1, "네 다들 감사합니다.", 0.3),
         _p("장원준", M1, "다음 주 수요일까지는", 0.3),
         _p("윤지민", M1, "필요할 때만 켜는 방식으로 바꿔야 할 것 같습니다.", 0.8),
         _p("유재환", M1, "다음 회의 전까지 각자 맡은 부분 마무리해서 공유해 주세요.", 0.6),
         _p("장원준", M2, "백엔드 API 명세가 나오면 바로 연결할 수 있게 목 데이터로 먼저 만들어 두겠습니다.", 0.6)],
     "expected": [
         {"speaker": "김환", "key": "통과 기준표", "assignee": "김환", "due_raw": "이번 주 안에"},
         {"speaker": "장원준", "key": "데모", "assignee": "장원준", "due_raw": "다음 주 수요일까지"},
         {"speaker": "유재환", "key": "마무리", "assignee": "group", "due_raw": "다음 회의 전까지"},
         {"speaker": "장원준", "key": "목 데이터", "assignee": "장원준", "due_raw": None}]},
    {"name": "rearr-long-monologue", "title": "30초 넘는 독백",
     "description": "한 화자의 문장들을 0.15초 간격으로 이어 한 턴이 45초 안팎이 된다",
     "pieces": [
         _p("유재환", M1, "네 다들 감사합니다. 정리하면, 속도는 GPU로 개선 여지가 있고, 화자 분리는 인원이 늘어도 아직은 "
                        "견딜 만하고, 정확도는 12퍼센트대로 나쁘지 않은 수준입니다.", 1.0),
         _p("유재환", M1, "다음 회의 전까지 각자 맡은 부분 마무리해서 공유해 주세요.", 0.15),
         _p("유재환", M1, "오늘 회의는 여기서 마치겠습니다.", 0.15),
         _p("유재환", M2, "자, 오늘은 다섯 명이 한 번에 녹음했을 때도 화자 분리가 잘 되는지 확인하는 자리입니다.", 0.15),
         _p("유재환", M2, "순서대로 한 명씩 최근 진행 상황을 공유하고,", 0.15),
         # m02 정렬본은 이 뒤 "저는 마지막에 정리하겠습니다." 가 129초 자리에 있다(정렬 때 3초 넘는 쉼에서 갈렸다)
         _p("유재환", M2, "저는 마지막에 정리하겠습니다.", 0.15),
         _p("유재환", M2, "네 다들 감사합니다. 정리하면, 속도는 GPU로 개선 여지가 있고, 화자 분리는 인원이 늘어도 아직은 "
                        "견딜 만하고, 정확도는 12퍼센트대로 나쁘지 않은 수준입니다.", 0.15),
         _p("김환", M2, "네 맞아요,", 0.5)]},
]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="재배치 합성 회의를 만든다")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--golden-root", type=Path, required=True, help="정렬본 회의 폴더들의 부모")
    b.add_argument("--out", type=Path, required=True, help="만들 곳. 레포 밖")
    b.add_argument("--cache", type=Path, default=None, help="전사 캐시. 민감도 측정과 같은 곳이면 다시 전사하지 않는다")
    b.add_argument("--model", default="large-v3-turbo")
    b.add_argument("--only", default="", help="이 시나리오만 (이름, 쉼표로 여럿)")
    a = ap.parse_args(argv)
    from stt.eval import rawdir as RD
    from stt.eval.sttcache import CachedStt

    RD.check(a.out.expanduser(), out=None)            # 회의 음성 조각이라 공개될 수 있는 레포에는 쓰지 않는다
    if a.cache:
        RD.check(a.cache.expanduser(), out=None)
    root = a.golden_root.expanduser()
    lib = Library({M1: root / M1, M2: root / M2},
                  CachedStt(B.make_backend("local", a.model, "chunk"), a.cache.expanduser() if a.cache else None))
    keep = set(x for x in a.only.split(",") if x)
    for spec in SPECS:
        if keep and spec["name"] not in keep:
            continue
        out = build(spec, lib, a.out.expanduser())
        truth = json.loads((out / "truth_aligned.json").read_text(encoding="utf-8"))
        print(f"{spec['name']}: 조각 {len(truth)}개 · 길이 {max(t['end'] for t in truth):.1f}초 → {out}")
        for t in truth:
            print(f"  {t['start']:6.2f}~{t['end']:6.2f} {t['speaker']:<4} {t['end'] - t['start']:4.2f}초  {t['text'][:40]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
