"""줄에 붙은 구간별 지연을 요약하고 줄별로 남긴다.

발화 하나가 화면에 뜨기까지를 겹치지 않는 세 구간으로 나눈다.

  queue       확정된 발화가 큐에 들어가 워커가 집을 때까지
  transcribe  워커가 집어 백엔드가 돌아올 때까지
  publish     줄이 게시기로 넘어가 처음 화면에 뜰 때까지

앞의 둘을 합쳐 재면 안 된다. 워커가 셋이라 발화가 몰리면 대기가 붙는데, 그것을
전사에 합치면 같은 백엔드가 부하에 따라 느려 보인다. 로컬 모델과 API 를 비교하는
수치는 transcribe 뿐이다.

중앙값과 최대를 같이 낸다. 평균 하나는 느린 호출 한 건도, 전 구간에 깔린 비용도
똑같이 가린다. 재지 못한 값은 0 이 아니라 None 이고 "미측정" 으로 적는다 —
0 은 "즉시" 로 읽힌다.

VAD 가 발화를 확정하기까지 걸리는 시간(발화 길이 + SILENCE_HOLD_MS)은 여기 없다.
그건 설정에서 바로 나오는 값이고, 이 세 구간이 그 뒤로 얼마가 더 붙는지를 잰다.
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path

from stt.session import Line

STAGES = ("queue", "transcribe", "publish")
STAGE_LABELS = {"queue": "큐", "transcribe": "전사", "publish": "게시"}


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 3)


def snapshot(lines: list[Line]) -> list[dict]:
    """확정된 줄의 계측값을 await 없이 그 자리에서 뜬다. 아래 함수들은 전부 이걸 받는다.

    줄 객체를 그대로 들고 다니면 안 된다. 종료 경로는 트랙 닫기·매니페스트·회의록으로
    여러 번 await 하고 그동안 게시 태스크가 같은 객체의 publish_s 를 계속 채운다.
    그 사이에 한 턴이 나가면 파일에는 null 이, 몇 줄 뒤의 요약에는 수치가 찍혀 두
    출력이 서로 다른 말을 한다.

    순서와 선별은 transcript.jsonl 과 같게 맞춘다 (stt/transcript_writer.py).
    """
    rows = [
        {
            "seq": ln.seq,
            "speaker": ln.speaker_id,
            "start": ln.start_ms / 1000,
            "end": ln.end_ms / 1000,
            "queue_s": _round(ln.queue_s),
            "transcribe_s": _round(ln.transcribe_s),
            "publish_s": _round(ln.publish_s),
            "_order": (ln.start_ms, ln.speaker_id),
        }
        for ln in lines
        if ln.final
    ]
    rows.sort(key=lambda r: r.pop("_order"))
    return rows


def _measured(rows: list[dict], stage: str) -> list[float]:
    return [r[f"{stage}_s"] for r in rows if r.get(f"{stage}_s") is not None]


def stage_stats(rows: list[dict], stage: str) -> dict | None:
    """잰 값이 하나도 없으면 None. 빈 목록의 중앙값을 0 으로 만들지 않는다."""
    values = _measured(rows, stage)
    if not values:
        return None
    return {"n": len(values), "median_s": statistics.median(values), "max_s": max(values)}


def summarize(rows: list[dict]) -> dict:
    stats: dict = {"lines": len(rows)}
    for stage in STAGES:
        stats[stage] = stage_stats(rows, stage)
    return stats


def format_summary(rows: list[dict]) -> str:
    """종료 요약에 넣는 한 줄. 다른 줄들과 같은 어투로 맞춘다."""
    stats = summarize(rows)
    total = stats["lines"]
    if not total:
        return "지연 미측정 (확정된 발화 없음)"

    parts = []
    for stage in STAGES:
        label = STAGE_LABELS[stage]
        st = stats[stage]
        if st is None:
            parts.append(f"{label} 미측정")
            continue
        span = f"{label} {st['median_s']:.2f}/{st['max_s']:.2f}초"
        parts.append(span if st["n"] == total else f"{span} ({total}건 중 {st['n']}건)")
    return "지연 중앙값/최대 · " + " · ".join(parts)


def write_latency(rows: list[dict], out_dir: Path) -> Path:
    """transcript.jsonl 옆에 지연만 따로 쓴다. seq 로 이어 붙는다.

    transcript.jsonl 안에 넣지 않는다. 그 파일의 레코드는 BE 와 맞춘
    TranscriptSegment 와 같은 모양이고 (stt/transcript_writer.py), 필드를 늘리면
    그 말이 더는 사실이 아니게 된다. 계측은 실행마다 달라지는 진단값이라 계약과
    수명이 다르다.

    순서와 선별은 transcript.jsonl 과 같게 맞춘다. 두 파일을 같은 줄 번호로
    나란히 놓고 볼 수 있어야 한다.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "latency.jsonl"
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return path
