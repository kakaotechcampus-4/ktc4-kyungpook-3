"""py-cord VoiceClient 의 알려진 결함을 막는 얇은 상속.

녹음기 둘(capture/discord_adapter.py 와 capture/realtime/adapter.py)이 같은 클래스를 쓴다.
"""

from __future__ import annotations

from discord.voice import VoiceClient


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

    def _remove_ssrc(self, *, user_id: int) -> None:
        ssrc = self._id_to_ssrc.pop(user_id, None)
        if not ssrc:
            return
        reader = getattr(self, "_reader", None)
        if reader:  # MISSING 은 falsy 다
            reader.speaking_timer.drop_ssrc(ssrc)
        self._ssrc_to_id.pop(ssrc, None)
