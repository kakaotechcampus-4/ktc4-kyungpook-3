"""전사 한 줄. 실시간·배치 두 경로가 같은 모양을 쓴다.

transcript_writer 가 이 타입만 알면 실시간 세션 없이도 회의록을 쓸 수 있다.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Line:
    """전사 한 줄. 뒤쪽 넷은 계측값이라 위치 인자로 넣지 않는다.

    queue_s       큐에 들어간 뒤 워커가 집을 때까지
    transcribe_s  워커가 집은 뒤 백엔드가 돌아올 때까지. 재시도 대기가 있으면 그것까지 포함한다
    publish_s     게시기에 넘어간 뒤 이 줄이 처음 나갈 때까지. 게시기가 채운다
    submitted_at  게시기가 publish_s 를 계산하려고 적어 두는 monotonic 시각. 파일에 쓰지 않는다
    error         전사가 끝내 실패했으면 그 이유. 그때 text 는 비어 있다. 회의록 파일에는 안
                  들어가고 화면과 종료 요약에만 보인다. 전에는 text 에 "[전사 실패]" 를 넣었는데
                  그러면 회의록과 추출이 그것을 발화로 읽는다.

    아직 재지 못한 값은 None 이다. 0.0 으로 두면 "즉시" 와 구별되지 않는다.
    """

    speaker_id: str
    speaker_name: str
    turn_id: str
    seq: int
    start_ms: int
    end_ms: int
    text: str
    final: bool
    queue_s: float | None = None
    transcribe_s: float | None = None
    publish_s: float | None = None
    submitted_at: float | None = None
    error: str | None = None
