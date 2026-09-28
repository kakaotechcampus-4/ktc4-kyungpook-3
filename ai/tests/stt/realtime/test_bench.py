"""실시간 비교 도구 stt/realtime/bench.py. 무과금 합성 실행이 끝까지 도는지 본다."""

import json

from stt.realtime import bench


def test_the_free_synthetic_run_writes_one_line_for_the_one_tone(tmp_path):
    """비교 실행은 실시간 폴더를 보관하는 이유 중 하나다 (decision_log/0006). 기본값은 가짜 STT 와 합성 3초라 과금이 없다.

    합성 트랙은 화자 1 의 끊김 없는 3초라 발화 하나, STT 호출 하나여야 한다. 테스트 폴더를 옮긴 뒤
    리플레이 하니스 import 가 깨져 이 명령이 돌지 않았는데, 이 파일을 가리키는 테스트가 없어 몰랐다.
    """
    bench.main(["--no-gate", "--out", str(tmp_path)])

    records = [json.loads(x) for x in (tmp_path / "transcript.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["speaker"] for r in records] == ["1"]
