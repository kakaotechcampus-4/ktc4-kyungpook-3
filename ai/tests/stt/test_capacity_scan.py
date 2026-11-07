"""워커 한 바퀴의 비용 측정(stt/eval/capacity/scan.py, 결정 기록 0026). 처리할 회의는 없고 모델도 안 쓴다."""

import json

from stt.eval.capacity import scan as S


def test_finished_meetings_are_read_but_nothing_is_processed(tmp_path):
    S.make_finished(tmp_path, 3)
    names = sorted(p.name for p in tmp_path.glob("session_*.json"))
    assert len(names) == 3
    assert {json.loads((tmp_path / n).read_text(encoding="utf-8"))["status"] for n in names} == {"handed_off"}
    row = S.measure(tmp_path, reps=1)
    assert row["manifests"] == 3 and row["processed"] == 0
    assert set(row) >= {"targets_ms", "notice_ms", "worker_pass_ms", "avg_kb"}
