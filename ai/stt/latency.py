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


def _finals(lines: list[Line]) -> list[Line]:
    return [ln for ln in lines if ln.final]


def _measured(lines: list[Line], stage: str) -> list[float]:
    return [v for v in (getattr(ln, f"{stage}_s", None) for ln in lines) if v is not None]


def stage_stats(lines: list[Line], stage: str) -> dict | None:
    """잰 값이 하나도 없으면 None. 빈 목록의 중앙값을 0 으로 만들지 않는다."""
    values = _measured(lines, stage)
    if not values:
        return None
    return {"n": len(values), "median_s": statistics.median(values), "max_s": max(values)}


def summarize(lines: list[Line]) -> dict:
    finals = _finals(lines)
    stats: dict = {"lines": len(finals)}
    for stage in STAGES:
        stats[stage] = stage_stats(finals, stage)
    return stats


def format_summary(lines: list[Line]) -> str:
    """종료 요약에 넣는 한 줄. 다른 줄들과 같은 어투로 맞춘다."""
    stats = summarize(lines)
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


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 3)


def write_latency(lines: list[Line], out_dir: Path) -> Path:
    """transcript.jsonl 옆에 지연만 따로 쓴다. seq 로 이어 붙는다.

    transcript.jsonl 안에 넣지 않는다. 그 파일의 레코드는 BE 와 맞춘
    TranscriptSegment 와 같은 모양이고 (stt/transcript_writer.py), 필드를 늘리면
    그 말이 더는 사실이 아니게 된다. 계측은 실행마다 달라지는 진단값이라 계약과
    수명이 다르다.

    순서와 선별은 transcript.jsonl 과 같게 맞춘다. 두 파일을 같은 줄 번호로
    나란히 놓고 볼 수 있어야 한다.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    finals = sorted(_finals(lines), key=lambda ln: (ln.start_ms, ln.speaker_id))
    path = out_dir / "latency.jsonl"
    with path.open("w", encoding="utf-8") as f:
        for ln in finals:
            f.write(json.dumps({
                "seq": ln.seq,
                "speaker": ln.speaker_id,
                "start": ln.start_ms / 1000,
                "end": ln.end_ms / 1000,
                "queue_s": _round(ln.queue_s),
                "transcribe_s": _round(ln.transcribe_s),
                "publish_s": _round(ln.publish_s),
            }, ensure_ascii=False) + "\n")
    return path
