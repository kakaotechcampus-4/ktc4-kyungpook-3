"""발화를 턴으로 묶는다.

발화는 VAD 경계(침묵 800ms)다. STT 호출 단위이자 계약 단위다.
턴은 같은 화자의 연속 발화 묶음이고 디스코드 메시지 하나에 대응한다.

나누는 이유. 800ms 쉬고 이어 말하면 VAD 는 새 발화로 본다. 그대로 두면 한 문장이
메시지 두 개로 쪼개지고, 추출에서 "그럼 그건 제가 할게요" 의 그건이 앞 발화에 남아
문맥이 끊긴다.
"""

from __future__ import annotations

DEFAULT_GAP_MS = 3_000


class TurnTracker:
    def __init__(self, gap_ms: int = DEFAULT_GAP_MS) -> None:
        self.gap_ms = gap_ms
        self._n = 0
        self._turn_of: dict[str, str] = {}
        self._last_end: dict[str, int] = {}

    def assign(self, speaker_id: str, start_ms: int, end_ms: int) -> str:
        last_end = self._last_end.get(speaker_id)
        turn = self._turn_of.get(speaker_id)
        if turn is None or last_end is None or start_ms - last_end > self.gap_ms:
            self._n += 1
            turn = f"t{self._n}"
            self._turn_of[speaker_id] = turn
        self._last_end[speaker_id] = end_ms
        return turn

    def note_post(self, speaker_id: str) -> None:
        """이 화자의 메시지가 채널에 나갔다. 다른 화자들의 턴은 여기서 끊는다."""
        for other in list(self._turn_of):
            if other != speaker_id:
                self._turn_of.pop(other, None)
