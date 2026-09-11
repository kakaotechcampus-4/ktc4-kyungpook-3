"""패킷 순서와 잡음 패킷을 다룬다.

**발화 위치는 도착 시각이 정한다.** 이 모듈은 시각을 계산하지 않는다.
RTP 타임스탬프는 순서 뒤바뀜을 잡는 데만 쓴다.

왜 RTP 를 위치로 안 쓰나. RTP 는 발신자 클럭이라 화자마다 원점이 다르고 서로
드리프트한다. 도착 시각은 봇 클럭 하나라 화자 간 순서 비교에 구조적으로 유리하고,
우리가 필요한 정밀도는 초 단위인데 네트워크 지터는 수십 ms 다.
Craig(craig.chat) 도 같은 선택을 한다 - 도착 시각으로 위치를 잡고 RTP 는 기록만 한다.

디스코드는 말하지 않는 동안 패킷을 안 보내기도 하지만, Opus 침묵 프레임이나
거의 전부 0인 쓰레기 패킷을 보내기도 한다. py-cord 는 이걸 sink 까지 그대로
넘기므로(`voice/receive/reader.py:261` 은 SSRC 를 모를 때만 버린다) 여기서 거른다.
"""

from __future__ import annotations

OPUS_SILENCE = b"\xf8\xff\xfe"
NOISE_NONZERO_MAX = 1  # 0 이 아닌 바이트가 이 개수 이하면 쓰레기로 본다
REORDER_WINDOW = 16    # 16패킷 = 320ms. Craig 와 같은 크기
HALF_RANGE = 0x80000000


def is_noise_packet(pcm: bytes) -> bool:
    """음성이 아닌 패킷인가. 공백 판정 전에 걸러야 한다."""
    if not pcm:
        return True
    if pcm == OPUS_SILENCE:
        return True
    nonzero = len(pcm) - pcm.count(b"\x00")
    return nonzero <= NOISE_NONZERO_MAX


class Reorderer:
    """짧은 창 안에서 RTP 순서로 정렬한다.

    UDP 에서 순서 뒤바뀜은 정상이다. 과거를 가리키는 패킷을 버리면 실제 음성을
    잃고, 하필 회선이 나쁠 때 더 많이 잃는다. 창을 두고 정렬만 한다.
    """

    def __init__(self, window: int = REORDER_WINDOW) -> None:
        self.window = max(1, window)
        self._buf: list[tuple[int, int, object]] = []  # (정렬키, 도착순번, item)
        self._n = 0
        self._base: int | None = None

    def _key(self, rtp_ts: int | None) -> int:
        """랩어라운드를 편 단조 증가 키. RTP 가 없으면 도착 순번을 쓴다."""
        if rtp_ts is None:
            return self._n
        if self._base is None:
            self._base = rtp_ts
            return 0
        delta = (rtp_ts - self._base) & 0xFFFFFFFF
        if delta > HALF_RANGE:
            delta -= 0x100000000
        return delta

    def push(self, rtp_ts: int | None, item) -> list:
        """패킷을 넣고, 창을 넘쳐 확정된 것들을 순서대로 돌려준다."""
        self._buf.append((self._key(rtp_ts), self._n, item))
        self._n += 1
        if len(self._buf) <= self.window:
            return []
        self._buf.sort(key=lambda x: (x[0], x[1]))
        out = self._buf[: len(self._buf) - self.window]
        self._buf = self._buf[len(self._buf) - self.window :]
        return [x[2] for x in out]

    def flush(self) -> list:
        """창에 남은 것을 전부 순서대로 내보낸다."""
        self._buf.sort(key=lambda x: (x[0], x[1]))
        out = [x[2] for x in self._buf]
        self._buf = []
        return out
