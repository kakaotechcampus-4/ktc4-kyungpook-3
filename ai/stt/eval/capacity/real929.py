"""9/29 디스코드 실녹음(카페, 혼자 대본 40줄 낭독, 8분 13초)을 다시 전사한 줄 파일을 9/29 노트북 결과와 같은 방법으로 채점한다(#154).

입력은 줄 파일({"segments": [{speaker, start, end, text, seq}]}, runner --save-lines 나 회의록 transcript.json 모양)
여러 개와 대본이다. 대본·전사 문장은 레포 밖에 두고 경로로만 받는다. 결과 폴더에는 숫자와 짧은 대답 문구만 쓴다.
  real929.json  영문 키, 숫자. 짧은 대답마다 문구와 참·거짓
  real929.md    9/29 문서 수치와 나란히 놓은 표

채점
  전체 CER     '#' 줄과 빈 줄을 빼고 괄호 지시문("(쉬지 않고)")을 지운 대본 전체와, 시작 시각 순으로 이은 전사 전체를
               stt.eval.eval.nospace 로 같이 정규화해 글자 편집 거리로 맞춘다. 9/29 정렬 스크립트와 같은 동점 처리라
               치환·삭제·삽입 나눔도 같다
  한국어 줄    숫자·영문이 없는 대본 줄만 센다(9/29 대본에서 20줄 426자). 9/29 문서의 19.7% 는 클립 시각표로 대본 줄과
               회의록 줄을 손으로 맞춘 값이다. 여기서는 위 전체 정렬에서 각 글자의 오류를 그 글자의 대본 줄에 붙인다.
               삽입은 바로 앞 대본 글자의 줄에 붙인다. 빠진 짧은 줄 자리의 글자가 옆 줄로 번질 수 있어 방법이 다르다.
               같은 방법으로 9/29 노트북 회의록도 같이 넣어 견준다. 그 회의록에 걸면 19.72% 로 문서 값과 소수 첫째
               자리까지 같았다. 전체 CER 21.62%, 치환·삭제·삽입 197·61·17, 짧은 대답 남음 1/5 도 문서와 같았다
  짧은 대답    대본의 짧은 대답 5줄 자리에 줄이 남았는지(present)와 그 말이 들어 있는지(found). 9/29 문서의 1/5 는
               "아니요, 아직 안 쟀습니다." 자리에 다른 말로 줄이 남은 것을 센 present 기준이다. found 는 대답이 다음
               문장 줄에 붙어도 그 줄이 구간 안에서 시작하면 센다. 9/29 문서는 파일 통째 전사의 "네" 를 이렇게 붙은 것으로
               따로 적고 세지 않았다

사용 (ai/ 안에서):
  python -m stt.eval.capacity.real929 --lines notebook=<9/29 노트북 transcript.json> --lines server=<서버 줄 파일> \
      --script <대본> --out <결과 폴더>
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from stt.eval.eval import nospace

# (대본 문구, 찾는 말, 구간 시작 초, 구간 끝 초). 구간은 9/29 운영 클립 시각표에서 앞 클립 끝부터 다음 클립 시작까지다
# (notes 목록.md 의 3_빠진구간). 앞 문장 줄은 이 구간보다 먼저, 다음 문장 줄은 구간 끝에서 시작한다.
# "음" 은 "응" 으로 적히기도 해서(9/29 묶음 단어 확률) 찾는 말에서 뺐다. 9/29 비교표도 "응, 그렇죠" 를 살아난 것으로 셌다
SHORT_ANSWERS = (
    ("네.", "네", 107.66, 123.22),
    ("맞습니다.", "맞습니다", 183.18, 194.22),
    ("음, 그렇죠.", "그렇죠", 255.64, 267.34),
    ("아니요, 아직 안 쟀습니다.", "아니요아직안쟀습니다", 349.34, 360.88),
    ("그렇죠.", "그렇죠", 445.48, 455.98),
)
# 구간 양 끝을 1초 앞당겨 쓴다. 구간 끝이 다음 문장 줄의 시작과 딱 같아서, 그 줄이 조금만 앞서 시작해도 남음으로 잘못
# 센다. 파일 통째 전사는 대답 줄을 앞 말이 끝난 자리, 곧 구간 시작 언저리에서 시작한다고 적는다. 9/29 비교 회의록(시각을
# 0.1초 단위로 적은 파일)에 걸면 반올림만으로 양 끝 모두 결과가 뒤집혔다. 대답 소리는 구간 시작에서 4초 넘게, 끝에서
# 5초 넘게 떨어져 있고, 앞 문장 줄은 구간 시작보다 1.9초 넘게 앞서 시작한다
SHIFT_S = 1.0
# 9/29 문서(회의록 검증 결과)의 노트북 수치. 로컬 large-v3-turbo, 묶음과 말 필터. short_found 는 그 문서 짧은 대답 표에서 셌다
NOTEBOOK_929_DOC = {"cer": 0.216, "sub": 197, "del": 61, "ins": 17, "ref_chars": 1272, "korean_cer_clip_table": 0.197,
                    "korean_lines": 20, "korean_chars": 426, "short_present": 1, "short_found": 0, "lines": 34}
_DIRECTION_RE = re.compile(r"\([^)]*\)\s*")
_LATIN_OR_DIGIT_RE = re.compile(r"[0-9A-Za-z]")


# ─────────────────────────────────────────────────────────────── 읽기
def read_script(path: Path) -> list[str]:
    """읽는 줄만. 괄호 지시문은 nospace 가 괄호만 지우고 글자를 남겨서 먼저 지운다."""
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return [_DIRECTION_RE.sub("", ln).strip() for ln in lines if ln.strip() and not ln.startswith("#")]


def load_lines(path: Path) -> list[dict]:
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    return sorted(d["segments"], key=lambda s: (float(s["start"]), int(s.get("seq", 0))))


# ─────────────────────────────────────────────────────────────── 채점
def align(ref_lines: list[str], hyp_texts: list[str]) -> dict:
    """글자 편집 거리 정렬. 9/29 align.py 와 같은 DP 와 동점 처리(대각, 삭제, 삽입 순)."""
    R = [(c, i) for i, ln in enumerate(ref_lines) for c in nospace(ln)]
    H = [c for h in hyp_texts for c in nospace(h)]
    n, m = len(R), len(H)
    prev = list(range(m + 1))
    back = [bytearray(m + 1) for _ in range(n + 1)]
    for j in range(1, m + 1):
        back[0][j] = 2
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        back[i][0] = 1
        rc = R[i - 1][0]
        for j in range(1, m + 1):
            d, u, left = prev[j - 1] + (rc != H[j - 1]), prev[j] + 1, cur[j - 1] + 1
            if d <= u and d <= left:
                cur[j], back[i][j] = d, 0
            elif u <= left:
                cur[j], back[i][j] = u, 1
            else:
                cur[j], back[i][j] = left, 2
        prev = cur
    ops: list[tuple[str, int | None]] = []     # (연산, 대본 글자 위치). 뒤에서부터 쌓는다
    i, j = n, m
    while i or j:
        b = back[i][j]
        if i and j and b == 0:
            ops.append(("M" if R[i - 1][0] == H[j - 1] else "S", i - 1))
            i, j = i - 1, j - 1
        elif i and (j == 0 or b == 1):
            ops.append(("D", i - 1))
            i -= 1
        else:
            ops.append(("I", None))
            j -= 1
    line_errors = [0] * len(ref_lines)
    counts = {"S": 0, "D": 0, "I": 0}
    last = 0
    for op, a in reversed(ops):
        if a is not None:
            last = R[a][1]
        if op != "M":
            counts[op] += 1
            line_errors[last] += 1
    errors = counts["S"] + counts["D"] + counts["I"]
    return {"ref_chars": n, "hyp_chars": m, "sub": counts["S"], "del": counts["D"], "ins": counts["I"],
            "cer": errors / n if n else 0.0, "line_errors": line_errors,
            "line_chars": [len(nospace(ln)) for ln in ref_lines]}


def korean_lines(ref_lines: list[str]) -> list[int]:
    """숫자·영문이 없는 줄. 표기 차이("다섯 개" 와 "5개", "develop" 과 "디벨롭")가 섞이지 않는 줄이다."""
    return [k for k, ln in enumerate(ref_lines) if not _LATIN_OR_DIGIT_RE.search(ln)]


def short_answers(segments: list[dict], answers=SHORT_ANSWERS) -> list[dict]:
    out = []
    for answer, key, lo, hi in answers:
        lo, hi = lo - SHIFT_S, hi - SHIFT_S
        near = [s for s in segments if lo <= float(s["start"]) < hi]
        out.append({"answer": answer, "start_s": lo, "end_s": hi, "present": bool(near),
                    "found": any(key in nospace(s["text"]) for s in near)})
    return out


def evaluate(ref_lines: list[str], segments: list[dict]) -> dict:
    """줄 파일 하나의 숫자. 문장은 넣지 않는다."""
    a = align(ref_lines, [s["text"] for s in segments])
    ko = korean_lines(ref_lines)
    ko_chars = sum(a["line_chars"][k] for k in ko)
    ko_err = sum(a["line_errors"][k] for k in ko)
    short = short_answers(segments)
    return {"cer": round(a["cer"], 4), "sub": a["sub"], "del": a["del"], "ins": a["ins"],
            "ref_chars": a["ref_chars"], "hyp_chars": a["hyp_chars"], "lines": len(segments),
            "korean_lines": len(ko), "korean_chars": ko_chars,
            "korean_cer_aligned": round(ko_err / ko_chars, 4) if ko_chars else None,
            "short_present": sum(s["present"] for s in short), "short_found": sum(s["found"] for s in short),
            "short": short}


# ─────────────────────────────────────────────────────────────── 표
def _pct(x) -> str:
    return "" if x is None else f"{x:.1%}"


def render(runs: dict[str, dict]) -> str:
    doc = NOTEBOOK_929_DOC
    names = list(runs)
    n_short = len(SHORT_ANSWERS)
    head = "| 지표 | 9/29 문서(노트북) | " + " | ".join(names) + " |"
    sep = "|---|---|" + "---|" * len(names)

    def row(label, doc_cell, fn):
        return f"| {label} | {doc_cell} | " + " | ".join(fn(runs[k]) for k in names) + " |"

    out = [
        "# 9/29 실녹음 다시 전사 (#154)",
        "",
        "9/29 디스코드 실녹음(카페, 혼자 대본 40줄 낭독, 8분 13초)을 다시 전사해 9/29 노트북 결과와 같은 대본으로 채점했다. "
        "정규화는 양쪽에 `stt.eval.eval.nospace` 를 걸었다. 만든 명령: `python -m stt.eval.capacity.real929`.",
        "",
        head, sep,
        row("전체 CER", _pct(doc["cer"]), lambda r: _pct(r["cer"])),
        row("치환·삭제·삽입", f"{doc['sub']}·{doc['del']}·{doc['ins']}", lambda r: f"{r['sub']}·{r['del']}·{r['ins']}"),
        row("대본 글자", str(doc["ref_chars"]), lambda r: str(r["ref_chars"])),
        row("숫자·영문 없는 한국어 줄 CER", f"{_pct(doc['korean_cer_clip_table'])} (클립 시각표로 줄 맞춤)",
            lambda r: f"{_pct(r['korean_cer_aligned'])} (글자 정렬로 줄 맞춤)"),
        row("한국어 줄, 글자", f"{doc['korean_lines']}줄 {doc['korean_chars']}자",
            lambda r: f"{r['korean_lines']}줄 {r['korean_chars']}자"),
        row("짧은 대답 자리에 줄이 남음", f"{doc['short_present']}/{n_short}", lambda r: f"{r['short_present']}/{n_short}"),
        row("그 줄에 그 말이 있음", f"{doc['short_found']}/{n_short}", lambda r: f"{r['short_found']}/{n_short}"),
        row("회의록 줄", str(doc["lines"]), lambda r: str(r["lines"])),
        "",
        "한국어 줄 CER 은 방법이 다르다. 9/29 문서는 클립 시각표로 대본 줄과 회의록 줄을 맞췄고, 여기서는 대본 전체와 "
        "전사 전체의 글자 정렬에서 각 글자의 오류를 그 대본 줄에 붙였다. 빠진 짧은 줄 자리의 글자가 옆 줄로 번질 수 있다. "
        "같은 방법으로 잰 열끼리만 견준다.",
        "",
        "## 짧은 대답",
        "",
        f"구간은 9/29 운영 클립 시각표에서 앞 클립 끝부터 다음 클립 시작까지를 {SHIFT_S:g}초 앞당긴 것이다. 구간 끝이 "
        "다음 문장 줄의 시작과 같아서 앞당겼다. 그 안에서 시작한 줄이 있으면 남음, 그 줄에 대답 말이 들어 있으면 "
        "맞음이다. \"음\" 은 \"응\" 으로 적히기도 해서 \"그렇죠\" 만 찾는다.",
        "",
        "| 대본 | 구간(초) | " + " | ".join(names) + " |",
        "|---|---|" + "---|" * len(names),
    ]
    for k, (answer, _, lo, hi) in enumerate(SHORT_ANSWERS):
        cells = []
        for name in names:
            s = runs[name]["short"][k]
            cells.append("맞음" if s["found"] else ("남음, 다른 말" if s["present"] else "없음"))
        out.append(f"| {answer} | {lo - SHIFT_S:.2f}~{hi - SHIFT_S:.2f} | " + " | ".join(cells) + " |")
    return "\n".join(out) + "\n"


# ─────────────────────────────────────────────────────────────── 실행
def _named(value: str) -> tuple[str, Path]:
    name, sep, path = value.partition("=")
    if not sep or not name or not path:
        raise argparse.ArgumentTypeError(f"이름=경로 모양이어야 한다: {value}")
    return name, Path(path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="9/29 실녹음 재전사 채점. real929.json 과 real929.md 를 쓴다")
    ap.add_argument("--lines", type=_named, action="append", required=True, help="이름=줄 파일. 여러 번 줄 수 있다")
    ap.add_argument("--script", type=Path, required=True, help="9/29 대본. 레포 밖")
    ap.add_argument("--out", type=Path, required=True, help="결과 폴더")
    a = ap.parse_args(argv)
    ref = read_script(a.script)
    runs = {name: evaluate(ref, load_lines(path)) for name, path in a.lines}
    a.out.mkdir(parents=True, exist_ok=True)
    data = {"notebook_929_doc": NOTEBOOK_929_DOC, "runs": runs}
    (a.out / "real929.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    (a.out / "real929.md").write_text(render(runs), encoding="utf-8")
    print(f"[real929] {a.out / 'real929.json'}, {a.out / 'real929.md'}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
