"""py-cord VoiceClient 의 알려진 결함을 막는 얇은 상속.

녹음기 둘(capture/discord_adapter.py 와 capture/realtime/adapter.py)이 같은 클래스를 쓴다.
"""

from __future__ import annotations

from discord.utils import MISSING
from discord.voice import VoiceClient
from discord.voice.state import VoiceConnectionState


class _KeyForwardingState(VoiceConnectionState):
    """연결 상태의 secret_key 가 바뀌는 순간 복호화기에도 넣는다.

    재연결하면 게이트웨이가 session_description 으로 새 키를 주고 VoiceWebSocket.load_secret_key 가
    이 객체의 secret_key 를 갈아끼운다 (voice/gateway.py:438-442). 그런데 설치본에는 그 키를
    AudioReader.update_secret_key (voice/receive/reader.py:138) 에 전달하는 코드가 없어서, 녹음 중
    재연결이 일어나면 복호화기가 낡은 키로 모든 패킷을 버린다. 실시간 Cog 는 발화 시작 이벤트에서
    갱신했는데 그건 그 Cog 에만 있었다. 여기서 하면 어느 Cog 가 쓰든 같다.

    소스로 확인한 것이고, 실제 재연결에서 패킷이 이어지는지는 실제 디스코드 서버에 봇을 붙여 녹음 중에
    음성 채널의 지역을 바꿔(재협상이 일어난다) 그 뒤 트랙에 샘플이 쌓이는지로 본다. 아직 안 했다.
    """

    _secret_key = MISSING

    @property
    def secret_key(self):
        return self._secret_key

    @secret_key.setter
    def secret_key(self, value) -> None:
        self._secret_key = value
        reader = getattr(self.client, "_reader", None)
        if reader and value:   # MISSING 은 falsy 다. 녹음 전에는 넘길 곳이 없다
            reader.update_secret_key(bytes(value))


class SafeVoiceClient(VoiceClient):
    """`_remove_ssrc` 의 가드 없는 `self._reader` 접근을 막는다.

    discord.VoiceClient 가 아니라 discord.voice.VoiceClient 를 상속한다. 앞의 이름은
    2.7 부터 DeprecationWarning 을 내는 별칭이고 3.0 에서 사라진다 (discord/__init__.py:106-112).

    py-cord 2.8.2.dev91+g10a5e8cf1 (PR #3159) 기준. voice/client.py:319-324 는 바로 위
    destroy_decoder 호출과 달리 self._reader 가드가 없어서, 녹음 중이 아닐 때 사람이 나가면
    MISSING 에 대한 AttributeError 가 난다 (utils.py:148-159). 그 예외는 _poll_ws 가 안 잡고
    (voice/state.py:766-768) _runner 태스크가 죽는데, is_connected() 는 True 로 남는다.
    그 뒤로 speaking(op 5) 이 안 와 _ssrc_to_id 가 영영 비고 (voice/client.py:222-226)
    패킷은 DEBUG 로그 한 줄로 버려진다 (voice/receive/reader.py:252-256). 오디오 0건 무증상.

    라이브러리 private 메서드를 덮는다. 설치본을 올리면 여기가 먼저 깨져야 하고,
    /selftest 의 _connection._runner.done() 단계가 그걸 잡는다.
    """

    def create_connection_state(self) -> VoiceConnectionState:
        return _KeyForwardingState(self, hook=self._recv_hook)

    def _remove_ssrc(self, *, user_id: int) -> None:
        ssrc = self._id_to_ssrc.pop(user_id, None)
        if not ssrc:
            return
        reader = getattr(self, "_reader", None)
        if reader:  # MISSING 은 falsy 다
            reader.speaking_timer.drop_ssrc(ssrc)
        self._ssrc_to_id.pop(ssrc, None)
