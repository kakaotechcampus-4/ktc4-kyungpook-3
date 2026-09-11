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
# 기준점을 다시 잡는 문턱. 정상적인 순서 뒤바뀜은 창 16패킷(약 15,360틱)에 지터를
# 더한 정도라 5분과는 자릿수가 다르다. 이보다 멀면 같은 스트림이 아니라고 본다.
REANCHOR_TICKS = 48_000 * 300


def is_noise_packet(pcm: bytes) -> bool:
    """음성이 아닌 패킷인가. 공백 판정 전에 걸러야 한다.

    실제 PCM 경로에서는 디스코드 침묵 프레임도 Cloudflare 쓰레기 패킷도 디코딩되면
    거의 전부 0이라 nonzero <= 1 분기 하나로 걸러진다 (3바이트 원문 그대로는 오지
    않는다, 실측). OPUS_SILENCE 와의 직접 비교는 그래서 운영 경로에서는 죽어 있지만,
    오프라인 리플레이 하니스(tests/replay.py)가 침묵 프레임을 이 3바이트 상수로
    흉내내 그대로 write() 에 흘리므로 하니스 호환을 위해 남긴다.
    """
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
        self._last_key = 0

    def _key(self, rtp_ts: int | None) -> tuple[int, bool]:
        """정렬 키와, 스트림이 새로 시작됐는지 여부를 돌려준다.

        키는 기준점에서의 부호 있는 델타다. 단조 증가하지 않고 음수도 될 수 있다.
        순서가 뒤바뀐 패킷은 앞 패킷보다 작은 키를 받고, 그게 정렬의 목적이다.
        랩어라운드는 32비트 안에서 델타를 계산해 편다.

        RTP 를 못 읽으면 마지막으로 계산한 키를 그대로 쓴다. 도착 순번을 쓰면
        (1씩 증가) 실제 RTP 델타(20ms 당 960씩 증가)와 자릿수가 달라 그 패킷이
        진짜 음성 앞으로 끼어든다. 같은 키를 쓰면 `(키, 도착순번)` 튜플이 그
        패킷을 바로 앞 패킷 뒤에 놓는다.

        직전 패킷의 키로부터 `REANCHOR_TICKS` 보다 크게 점프하면 다른 스트림으로 본다.
        화자가 나갔다 들어오면 RTP 원점이 무관한 난수로 바뀌고, 32비트 래핑도 같이
        잡는다. 정상적인 순서 뒤바뀜은 창보다 작은 범위라 이 점프를 트리거하지 않는다.

        `_base` `_last_key` 를 바꾸므로 `push` 한 번에 정확히 한 번만 부른다.
        """
        if rtp_ts is None:
            return self._last_key, False
        if self._base is None:
            self._base = rtp_ts
            self._last_key = 0
            return 0, False
        delta = (rtp_ts - self._base) & 0xFFFFFFFF
        if delta > HALF_RANGE:
            delta -= 0x100000000
        jump = abs(delta - self._last_key)
        if jump > REANCHOR_TICKS:
            self._base = rtp_ts
            self._last_key = 0
            return 0, True
        self._last_key = delta
        return delta, False

    def push(self, rtp_ts: int | None, item) -> list:
        """패킷을 넣고, 창을 넘쳐 확정된 것들을 순서대로 돌려준다."""
        key, new_stream = self._key(rtp_ts)
        out: list = self.flush() if new_stream else []
        self._buf.append((key, self._n, item))
        self._n += 1
        if len(self._buf) <= self.window:
            return out
        self._buf.sort(key=lambda x: (x[0], x[1]))
        cut = len(self._buf) - self.window
        out += [x[2] for x in self._buf[:cut]]
        self._buf = self._buf[cut:]
        return out

    def flush(self) -> list:
        """창에 남은 것을 전부 순서대로 내보낸다."""
        self._buf.sort(key=lambda x: (x[0], x[1]))
        out = [x[2] for x in self._buf]
        self._buf = []
        return out
