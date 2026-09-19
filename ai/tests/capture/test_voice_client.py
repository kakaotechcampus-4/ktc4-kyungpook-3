"""공용 음성 클라이언트. 재연결로 키가 바뀌면 복호화기에 전달한다. 실제 연결은 안 만든다."""

from discord.utils import MISSING

from capture import voice_client as V


class FakeReader:
    def __init__(self):
        self.keys = []

    def update_secret_key(self, key):
        self.keys.append(key)


class FakeClient:
    _reader = MISSING


def _state(client):
    st = V._KeyForwardingState.__new__(V._KeyForwardingState)   # __init__ 은 소켓 스레드를 띄우므로 건너뛴다
    st.client = client
    return st


def test_new_key_reaches_the_reader_only_while_recording():
    client = FakeClient()
    st = _state(client)
    st.secret_key = [1, 2, 3]                    # 녹음 전. 넘길 곳이 없다
    assert st.secret_key == [1, 2, 3]
    reader = FakeReader()
    client._reader = reader
    st.secret_key = [4, 5, 6]                    # 재연결로 키가 바뀌었다
    assert reader.keys == [bytes([4, 5, 6])]
    st.secret_key = MISSING                      # 연결이 끊겨 키가 비면 넘기지 않는다
    assert reader.keys == [bytes([4, 5, 6])]


def test_safe_voice_client_installs_the_forwarding_state():
    assert V.SafeVoiceClient.create_connection_state is not V.VoiceClient.create_connection_state
    assert issubclass(V._KeyForwardingState, V.VoiceConnectionState)
    assert isinstance(V._KeyForwardingState.__dict__["secret_key"], property)
