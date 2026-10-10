"""이름 자리 채점(#195). 정답에 나오는 "이름+님" 이 전사에도 맞게 적혔는지 센다.

CER 로는 이름이 안 보인다. 9/29 실녹음에서 이름은 대본 글자의 1% 라 이름 넷이 다 틀려도 CER 은 0.5pt 남짓 움직인다.
그래서 이름 자리만 따로 센다. 회의에서는 "동우님" 처럼 이름 뒤에 님을 붙여 부르므로 그 꼴만 센다.
프롬프트로 넣은 이름 목록이 전사에 그대로 새는지도 본다(이름+님 셋 이상이 쉼표로 이어진 자리).

    python -m stt.eval.capacity.names --names 동우,재환,원준,지민,환,진호 --script <대본> \
        --lines 힌트없음=<줄 파일> --lines 이름힌트=<줄 파일>
    python -m stt.eval.capacity.names --names ... --expect 동우=1,원준=1 --lines ...
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def _pattern(name: str) -> re.Pattern:
    # 앞 글자가 한글이면 다른 이름의 일부다("재환님" 의 "환님")
    return re.compile(rf"(?<![가-힣]){re.escape(name)}님")


def name_hits(text: str, names: list[str]) -> dict[str, int]:
    return {n: len(_pattern(n).findall(text)) for n in names}


def leaks(text: str, names: list[str]) -> int:
    """프롬프트가 샌 자리 수. 이름+님 셋 이상이 쉼표로 이어진 곳을 하나로 센다."""
    alt = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
    return len(re.findall(rf"(?:(?<![가-힣])(?:{alt})님\s*,\s*){{2,}}(?:{alt})님", text))


def _text(lines_file: Path) -> str:
    return " ".join(s.get("text", "") for s in json.loads(lines_file.read_text(encoding="utf-8"))["segments"])


def report(expected: dict[str, int], lines: dict[str, Path], names: list[str]) -> list[dict]:
    rows = []
    for label, path in lines.items():
        text = _text(path)
        got = name_hits(text, names)
        missed = [n for n in names for _ in range(max(0, expected.get(n, 0) - got[n]))]
        extra = [n for n in names for _ in range(max(0, got[n] - expected.get(n, 0)))]
        rows.append({"label": label, "hit": sum(min(got[n], expected.get(n, 0)) for n in names),
                     "expected": sum(expected.values()), "missed": missed, "extra": extra, "leaks": leaks(text, names)})
    return rows


def _script_text(path: Path) -> str:
    return " ".join(l for l in path.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#"))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="이름 자리 채점")
    ap.add_argument("--names", required=True, help="쉼표로 나눈 부르는 이름")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--script", type=Path, help="대본. '#' 줄은 뺀다")
    src.add_argument("--expect", help="정답 대본이 없을 때 손으로 단 이름 수. 예: 동우=1,원준=1")
    ap.add_argument("--lines", action="append", required=True, help="이름=회의록 줄 파일(lines-*.json)")
    a = ap.parse_args(argv)
    names = [n.strip() for n in a.names.split(",") if n.strip()]
    if a.script:
        expected = {n: c for n, c in name_hits(_script_text(a.script), names).items() if c}
    else:
        expected = {k: int(v) for k, v in (p.split("=") for p in a.expect.split(","))}
    lines = {k: Path(v) for k, v in (p.split("=", 1) for p in a.lines)}
    print("| 전사 | 맞은 이름 자리 | 틀린 이름 | 정답에 없는 이름 | 프롬프트 샘 |")
    print("|---|---|---|---|---|")
    for r in report(expected, lines, names):
        print(f"| {r['label']} | {r['hit']}/{r['expected']} | {', '.join(r['missed']) or '-'} | "
              f"{', '.join(r['extra']) or '-'} | {r['leaks']} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
