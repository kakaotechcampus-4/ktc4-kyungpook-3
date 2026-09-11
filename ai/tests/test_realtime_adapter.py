import asyncio
import json
import threading

import discord
import numpy as np
import pytest

import capture.realtime_adapter as adapter
from capture.realtime_adapter import RealtimeCog, SafeVoiceClient, _TrackPool, required_intents
from stt.backend import SttResult
from stt.speech_gate import SpeechGate
from tests.replay import ReplayTrack, replay

SR = 16_000


def _vc(reader):
    """게이트웨이 없이 _remove_ssrc 만 부르기 위한 최소 인스턴스."""
    vc = SafeVoiceClient.__new__(SafeVoiceClient)
    vc._reader = reader
    vc._id_to_ssrc = {7: 123}
    vc._ssrc_to_id = {123: 7}
    return vc


def test_remove_ssrc_survives_a_missing_reader():
    """녹음 전에 사람이 나가는 경로. 원본은 여기서 AttributeError 를 내고 WS 폴러가 죽는다."""
    vc = _vc(discord.utils.MISSING)
    vc._remove_ssrc(user_id=7)
    assert vc._ssrc_to_id == {}
    assert vc._id_to_ssrc == {}


def test_remove_ssrc_still_drops_the_speaking_timer_entry():
    """가드가 정상 경로까지 건너뛰면 안 된다."""

    class _Timer:
        def __init__(self):
            self.dropped = []

        def drop_ssrc(self, ssrc):
            self.dropped.append(ssrc)

    class _Reader:
        def __init__(self):
            self.speaking_timer = _Timer()

    vc = _vc(_Reader())
    vc._remove_ssrc(user_id=7)
    assert vc._reader.speaking_timer.dropped == [123]
    assert vc._ssrc_to_id == {}


def test_track_pool_writes_one_wav_per_speaker(tmp_path):
    pool = _TrackPool(tmp_path / "42_1700", ts=1700)
    pool.submit(7, np.full(1600, 0.2, dtype=np.float32), 0)
    pool.submit(8, np.full(1600, 0.2, dtype=np.float32), 500)
    pool.submit(7, np.full(1600, 0.2, dtype=np.float32), 1000)
    entries = pool.close()

    assert sorted(e["file"] for e in entries) == ["42_1700/7_1700.wav", "42_1700/8_1700.wav"]
    assert (tmp_path / "42_1700" / "7_1700.wav").exists()
    by_uid = {e["user_id"]: e for e in entries}
    # 7번은 0~0.1초와 1.0~1.1초. 사이는 무음으로 채워진다.
    assert by_uid["7"]["duration_sec"] == pytest.approx(1.1, abs=0.02)
    assert by_uid["8"]["duration_sec"] == pytest.approx(0.6, abs=0.02)
    assert set(by_uid["7"]) == {"user_id", "display_name", "file", "duration_sec"}


def test_track_pool_drops_instead_of_blocking_when_the_queue_is_full(tmp_path):
    """큐가 차면 버리고 센다. submit 은 이벤트 루프에서 불리므로 절대 막히면 안 된다."""
    pool = _TrackPool(tmp_path / "g", ts=1)
    pool._q.put(None)                     # 쓰기 스레드를 먼저 세워 큐가 안 비게 한다
    pool._thread.join(timeout=5)
    assert not pool._thread.is_alive()

    chunk = np.zeros(320, dtype=np.float32)
    for _ in range(pool.QUEUE_MAX):
        pool.submit(7, chunk, 0)
    assert pool.dropped == 0
    pool.submit(7, chunk, 0)              # 여기서 넘친다
    assert pool.dropped == 1

    pool._q.get_nowait()                  # close 의 센티넬 자리를 하나 비운다
    assert pool.close() == []             # 스레드가 죽어 있어도 돌아온다


def test_required_intents_does_not_ask_for_message_content():
    """특권 인텐트를 쓰지도 않으면서 켜면 포털 미설정 시 봇이 기동 즉시 죽는다."""
    i = required_intents()
    assert i.members is True
    assert i.voice_states is True
    assert i.message_content is False


# ----------------------------------------------------------------- Cog 본문
# 게이트웨이 없이 /live 와 _finish_meeting 본문을 돌린다. 아래 대역은 py-cord 가
# 주는 객체 중 이 두 경로가 실제로 읽는 속성만 흉내낸다.

GUILD_ID = 42
ROOM_ID = 99


class _FakeStt:
    name = "fake"

    def transcribe(self, samples, sample_rate):
        return SttResult(text="마지막 발언", words=[])


class _FakeMessage:
    def __init__(self, content):
        self.content = content

    async def edit(self, content):
        self.content = content


class _FakeTextChannel:
    def __init__(self, name="일반"):
        self.name = name
        self.mention = f"#{name}"
        self.sent: list[str] = []

    async def send(self, text):
        self.sent.append(text)
        return _FakeMessage(text)

    def summaries(self) -> list[str]:
        return [m for m in self.sent if m.startswith("⏹")]


class _FakePerms:
    view_channel = True
    connect = True


class _FakeReader:
    """py-cord AudioReader 자리. 리키 리스너가 읽는 것만 흉내낸다.

    실물은 start_recording 이 만들고 stop 때 MISSING 으로 돌아간다
    (voice/client.py:771-773, 788-790). 그래서 이 대역도 녹음 중에만 존재한다.
    """

    def __init__(self, sink=None):
        self.sink = sink
        self.rekeys: list[bytes] = []

    def update_secret_key(self, secret_key):
        self.rekeys.append(secret_key)


class _FakeVoiceClient:
    def __init__(self, channel):
        self.channel = channel
        self.secret_key: list[int] = []
        self.started: list[tuple] = []
        self.moved: list = []
        self.disconnected = 0
        self._reader = None

    def is_connected(self):
        return True

    def is_recording(self):
        return bool(self.started)

    def start_recording(self, sink, callback, *args):
        self.started.append((sink, callback, args))
        self._reader = _FakeReader(sink)

    def stop_recording(self):
        self.started.clear()
        self._reader = None

    async def move_to(self, channel):
        self.moved.append(channel)
        self.channel = channel

    async def disconnect(self, *, force=False):
        self.disconnected += 1
        # 실제 VoiceClient.disconnect 는 self.stop() 을 거쳐 돌고 있는 리더를 세운다
        # (voice/client.py:381 → 620-622). 남의 회의를 끊으면 그 회의가 그 자리에서 죽는다.
        self.started.clear()
        self._reader = None


class _FakeVoiceChannel:
    def __init__(self, vc_box):
        self.id = ROOM_ID
        self.name = "회의방"
        self.connects = 0
        self._vc_box = vc_box

    def permissions_for(self, member):
        return _FakePerms()

    async def connect(self, *, cls=None):
        # 실제 음성 핸드셰이크처럼 루프에 제어권을 넘긴다. 길드 락이 없으면
        # 같은 길드의 /live 두 번이 여기서 서로를 추월한다.
        self.connects += 1
        await asyncio.sleep(0.01)
        return self._vc_box[0]


class _FakeMember:
    def __init__(self, uid, name, guild=None):
        self.id = uid
        self.display_name = name
        self.guild = guild


class _FakeGuild:
    def __init__(self, members):
        self.id = GUILD_ID
        self.name = "테스트 서버"
        self.me = object()
        self.voice_client = None
        self._members = members

    def get_member(self, uid):
        return self._members.get(uid)


class _FakeVoiceState:
    def __init__(self, channel):
        self.channel = channel


class _FakeAuthor:
    def __init__(self, room):
        self.id = 1
        self.voice = _FakeVoiceState(room)


class _FakeCtx:
    def __init__(self, guild, room, text_channel, command=None):
        self.guild = guild
        self.author = _FakeAuthor(room)
        self.channel = text_channel
        self.voice_client = None
        self.command = command
        self.responses: list[str] = []

    async def defer(self):
        pass

    async def respond(self, text, ephemeral=False):
        self.responses.append(text)


class _FakeBot:
    def __init__(self, guild):
        self._guild = guild
        self.user = _FakeMember(1000, "봇")

    def get_guild(self, guild_id):
        return self._guild if guild_id == self._guild.id else None

    def get_channel(self, channel_id):
        return None

    @property
    def loop(self):
        return asyncio.get_running_loop()


def _tone(ms, amp=0.3):
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def _all_speech(pcm, sample_rate, threshold):
    return [{"start": 0, "end": len(pcm)}]


def _no_speech(pcm, sample_rate, threshold):
    return []


async def _start_one(tmp_path, monkeypatch, sessions_made=None, on_session_saved=None,
                     speech_spans=_all_speech):
    """/live 한 번을 끝까지 돌리고 (cog, ctx, meeting, text_channel, vc) 를 준다.

    말 필터는 켠 채로 두되 판정만 갈아 끼운다. 여기서 흘리는 정현파는 실로가 말이
    아니라고 보므로(말 비율 0.000), 실물 판정을 쓰면 이 파일의 회의가 전부 무음이 된다.
    """

    def _stt_factory():
        if sessions_made is not None:
            sessions_made.append(1)
        return _FakeStt()

    monkeypatch.setattr(adapter, "EliceStt", _stt_factory)
    monkeypatch.setattr(adapter, "SpeechGate", lambda: SpeechGate(speech_spans=speech_spans))
    guild = _FakeGuild({7: _FakeMember(7, "김환")})
    vc_box = []
    room = _FakeVoiceChannel(vc_box)
    vc = _FakeVoiceClient(room)
    vc_box.append(vc)
    guild.voice_client = vc
    text = _FakeTextChannel()
    bot = _FakeBot(guild)
    cog = RealtimeCog(bot, recordings_dir=tmp_path, on_session_saved=on_session_saved)
    ctx = _FakeCtx(guild, room, text)
    await RealtimeCog.live.callback(cog, ctx)
    return cog, ctx, cog._meetings[GUILD_ID], text, vc


async def test_finish_keeps_the_last_utterance_because_the_snapshot_follows_close(
    tmp_path, monkeypatch
):
    """스냅샷은 session.close() **뒤** 여야 한다.

    뒤에 무음이 없는 발화 하나만 흘린다. VAD 는 이걸 확정하지 않으므로 close() 만이
    이 줄을 on_line 으로 내보낸다 (stt/session.py:144-175). 스냅샷을 close() 앞에서
    찍으면 그 줄은 ledger.closed 에 걸려 late 로만 세어지고 회의록에서 통째로 빠진다.
    회의마다 마지막 발언 하나가 조용히 사라지는 자리다.
    """
    cog, _ctx, meeting, _text, _vc = await _start_one(tmp_path, monkeypatch)
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)
    assert meeting.ledger.lines == []      # close() 전에는 확정된 줄이 없다
    meeting.sink.cleanup()                 # py-cord 가 stop_recording 안에서 하는 일

    await cog._finish_meeting(GUILD_ID)

    jsonl = meeting.out_dir / "transcript.jsonl"
    records = [json.loads(x) for x in jsonl.read_text(encoding="utf-8").splitlines()]
    assert [r["text"] for r in records] == ["마지막 발언"]
    assert meeting.ledger.late == 0


async def test_finish_meeting_runs_once_even_when_called_twice(tmp_path, monkeypatch):
    """/live-stop 과 py-cord 콜백이 겹쳐도 마무리는 한 번이다.

    표에서 pop 으로 꺼내는 것이 그 관문이다. get 으로 바꾸면 두 번째 호출이 트랙을
    다시 닫고 매니페스트와 회의록을 다시 쓰고 종료 요약과 BE 훅을 한 번 더 부른다.

    훅 페이로드도 여기서 같이 본다. capture/run_recorder.py 의 데모 훅이 session 과
    speakers 두 키를 읽으므로 키가 빠지면 동료 스크립트가 KeyError 로 죽는다.
    """
    saved = []

    async def _hook(payload, jsonl_path):
        saved.append((payload, jsonl_path))

    cog, _ctx, meeting, text, vc = await _start_one(tmp_path, monkeypatch, on_session_saved=_hook)
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)
    meeting.sink.cleanup()

    await cog._finish_meeting(GUILD_ID)
    await cog._finish_meeting(GUILD_ID)

    assert len(text.summaries()) == 1
    assert len(saved) == 1
    assert vc.disconnected == 1
    assert GUILD_ID not in cog._meetings

    payload, jsonl_path = saved[0]
    assert payload["session"] == str(meeting.ts)
    assert payload["meeting_id"] == meeting.meeting_id
    assert payload["guild_id"] == GUILD_ID
    # display_name 은 _TrackPool 이 user_id 로 채워 둔 자리를 guild.get_member 가 덮는다
    assert [(s["user_id"], s["display_name"]) for s in payload["speakers"]] == [("7", "김환")]
    assert jsonl_path == meeting.out_dir / "transcript.jsonl"
    assert payload["markdown"] == meeting.out_dir / "transcript.md"


async def test_two_concurrent_records_start_one_meeting(tmp_path, monkeypatch):
    """같은 길드의 /live 두 번이 겹쳐도 회의는 하나다.

    가드(`_meetings.get`)와 표 대입 사이에 connect() 라는 await 가 있다. 길드 락이
    없으면 둘 다 가드를 통과해 세션과 트랙 스레드와 게시 태스크가 두 벌 생기고,
    표에는 나중 것만 남아 앞의 한 벌이 통째로 샌다.
    """
    made: list[int] = []
    cog, ctx1, _meeting, _text, vc = await _start_one(tmp_path, monkeypatch, sessions_made=made)
    # 첫 번째는 이미 끝났다. 여기서부터 두 번을 진짜로 겹친다.
    await cog._finish_meeting(GUILD_ID)
    made.clear()
    vc.started.clear()

    ctx_a = _FakeCtx(ctx1.guild, ctx1.author.voice.channel, _FakeTextChannel())
    ctx_b = _FakeCtx(ctx1.guild, ctx1.author.voice.channel, _FakeTextChannel())
    await asyncio.gather(
        RealtimeCog.live.callback(cog, ctx_a),
        RealtimeCog.live.callback(cog, ctx_b),
    )

    assert len(made) == 1                      # 세션이 한 벌만 만들어졌다
    assert len(vc.started) == 1
    assert len(cog._meetings) == 1
    assert any("이미" in r for r in ctx_b.responses)

    await cog._finish_meeting(GUILD_ID)


async def test_finish_does_not_disconnect_a_meeting_that_started_while_it_waited(
    tmp_path, monkeypatch
):
    """마무리가 기다리는 동안 시작된 다음 회의를 끊지 않는다.

    /live-stop 은 길드 락을 놓은 뒤 _finish_meeting 을 부르고, 그 안의 session.close() 는
    최대 10초, publisher_task 는 최대 8초를 더 기다린다 (publisher.py:115). 그 창 내내
    _meetings 는 비어 있고, stop_recording() 이 _reader 를 MISSING 으로 만들었으므로
    (voice/client.py:788-790) is_recording 도 False 다. 다음 /live 가 두 가드를 전부
    통과해 같은 VoiceClient 로 새 회의를 연다. 옛 코루틴이 깨어나 disconnect(force=True)
    를 부르면 새 회의의 리더가 그 자리에서 죽는다 (voice/client.py:381 → 620-622).
    """
    cog, ctx1, meeting, _text, vc = await _start_one(tmp_path, monkeypatch)
    room = ctx1.author.voice.channel

    gate = threading.Event()
    real_close = meeting.session.close

    def _slow_close(timeout_s):
        gate.wait(5)
        return real_close(timeout_s)

    meeting.session.close = _slow_close

    vc.stop_recording()                       # /live-stop 이 락을 쥔 채 하는 일
    finishing = asyncio.create_task(cog._finish_meeting(GUILD_ID))
    await asyncio.sleep(0.05)
    assert GUILD_ID not in cog._meetings       # 창이 열렸다

    ctx2 = _FakeCtx(ctx1.guild, room, _FakeTextChannel())
    ctx2.voice_client = vc                     # 봇은 아직 방에 있다
    await RealtimeCog.live.callback(cog, ctx2)
    new_meeting = cog._meetings[GUILD_ID]

    gate.set()
    await finishing

    assert cog._meetings.get(GUILD_ID) is new_meeting
    assert vc.disconnected == 0
    assert len(vc.started) == 1                # 새 녹음이 살아 있다

    await cog._finish_meeting(GUILD_ID)


async def test_bot_kicked_from_the_room_keeps_the_last_reorder_window(tmp_path, monkeypatch):
    """봇이 방에서 쫓겨나는 경로에도 마지막 재정렬 창이 회의록과 wav 에 들어간다.

    이 경로에는 stop_recording() 이 없다. py-cord 는 같은 이벤트를 받아 자기 태스크에서
    disconnect → reader.stop() → sink.cleanup() 로 내려가지만 (state.py:1909 대 1928),
    그쪽은 안에서 여러 번 await 하고 이쪽은 pop 과 get_guild 뿐이라 이쪽이 먼저 끝난다.
    _finish_meeting 이 스스로 드레인하지 않으면 화자마다 16패킷(320ms)이 사라진다.
    뒤늦게 도착한 cleanup 의 feed 는 이미 멈춘 워커 큐로, on_samples 는 이미 join 된
    트랙 스레드로 들어가 둘 다 조용히 버려진다.
    """
    saved = []

    async def _hook(payload, jsonl_path):
        saved.append(payload)

    cog, ctx, meeting, _text, _vc = await _start_one(tmp_path, monkeypatch, on_session_saved=_hook)
    room = ctx.author.voice.channel
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)
    assert meeting.sink.finished is False      # py-cord 의 cleanup 은 아직 안 돌았다

    bot_member = _FakeMember(cog.bot.user.id, "봇", guild=ctx.guild)
    await cog.on_voice_state_update(bot_member, _FakeVoiceState(room), _FakeVoiceState(None))

    records = [
        json.loads(x)
        for x in (meeting.out_dir / "transcript.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(records) == 1
    # 1.2초 = 60패킷 × 20ms. 마지막 창 16개가 빠지면 0.88 이 된다.
    assert records[0]["end"] == pytest.approx(1.2, abs=0.02)
    assert saved[0]["speakers"][0]["duration_sec"] == pytest.approx(1.2, abs=0.02)


async def test_person_leaving_drains_the_window_before_flushing_the_speaker(tmp_path, monkeypatch):
    """퇴장한 사람의 재정렬 창을 비운 **뒤** 에 진행 중 발화를 확정한다.

    순서가 반대이거나 드레인이 빠지면 창에 남은 꼬리 16패킷이 이미 닫힌 VAD 로 들어가
    새 발화를 하나 더 연다. 회의록에 0.88초짜리와 0.32초짜리 두 줄이 생기고, 사람이
    한 번 말한 것이 두 번 말한 것으로 남는다.
    """
    cog, ctx, meeting, _text, _vc = await _start_one(tmp_path, monkeypatch)
    room = ctx.author.voice.channel
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)

    leaver = _FakeMember(7, "김환", guild=ctx.guild)
    await cog.on_voice_state_update(leaver, _FakeVoiceState(room), _FakeVoiceState(None))

    # flush_speaker 가 확정한 발화는 STT 워커를 거쳐 on_line 으로 온다. 고정 대기 대신
    # 실제 도착을 기다린다. flush_speaker 가 없으면 여기서 아무것도 안 오고, 뒤의
    # session.close() 가 대신 확정해 같은 회의록이 나온다 — 이 단언이 그 차이를 잡는다.
    for _ in range(200):
        if meeting.ledger.lines:
            break
        await asyncio.sleep(0.01)
    assert len(meeting.ledger.lines) == 1      # 퇴장 시점에 확정됐다. close() 전이다.

    await cog._finish_meeting(GUILD_ID)

    records = [
        json.loads(x)
        for x in (meeting.out_dir / "transcript.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(records) == 1
    assert records[0]["end"] == pytest.approx(1.2, abs=0.02)


async def test_speaking_update_rekeys_the_decryptor_when_the_key_changed(tmp_path, monkeypatch):
    """재연결로 음성 키가 바뀌면 복호화기를 갱신한다.

    설치본에는 update_secret_key 호출자가 없고 (reader.py:138-139, 370-371) 복호화기는
    start_recording 시점의 키로 box 를 한 번 만든다 (reader.py:126-128). 재연결 경로는
    disconnect(cleanup=False) 라 reader 가 살아남으므로, 이 리스너가 없으면 회의 중반에
    음성 서버가 한 번 끊긴 뒤 모든 패킷이 CryptoError 가 된다 — 예외도 메시지도 없이
    오디오만 0건이다.

    실제 재연결을 일으켜 관측한 것은 아니다. 리스너가 키 변화에 반응한다는 것까지만 본다.
    """
    cog, ctx, meeting, _text, vc = await _start_one(tmp_path, monkeypatch)
    assert meeting.secret_key == b""           # connect 시점의 키
    assert vc._reader.rekeys == []

    vc.secret_key = [1, 2, 3, 4]               # 새 session_description 이 키를 갈아끼웠다
    speaker = _FakeMember(7, "김환", guild=ctx.guild)
    await cog.on_member_speaking_state_update(speaker, 70, None)

    assert vc._reader.rekeys == [bytes([1, 2, 3, 4])]
    assert meeting.secret_key == bytes([1, 2, 3, 4])

    await cog._finish_meeting(GUILD_ID)


async def test_speaking_update_does_not_rekey_when_the_key_is_unchanged(tmp_path, monkeypatch):
    """같은 키로는 다시 갱신하지 않는다.

    이 리스너는 발화가 시작될 때마다 온다. 매번 box 를 새로 만들면 회의 내내 불필요한
    재생성이 쌓이고, 무엇보다 "키가 바뀌었다" 라는 신호가 의미를 잃는다.
    """
    cog, ctx, meeting, _text, vc = await _start_one(tmp_path, monkeypatch)
    vc.secret_key = [9, 9, 9]
    speaker = _FakeMember(7, "김환", guild=ctx.guild)

    await cog.on_member_speaking_state_update(speaker, 70, None)
    assert len(vc._reader.rekeys) == 1          # 첫 발화에서 한 번

    for _ in range(3):                          # 그 뒤 발화마다 같은 이벤트가 온다
        await cog.on_member_speaking_state_update(speaker, 70, None)
    assert len(vc._reader.rekeys) == 1          # 더는 안 부른다
    assert meeting.secret_key == bytes([9, 9, 9])

    await cog._finish_meeting(GUILD_ID)


async def test_finish_still_writes_the_transcript_when_the_final_drain_raises(
    tmp_path, monkeypatch
):
    """마지막 드레인이 깨져도 회의는 끝까지 나온다. 대신 요약이 그 사실을 말한다.

    이 시점에 pop 은 이미 끝났다. 예외가 _finish_meeting 밖으로 나가면 회의록·wav·
    매니페스트·요약이 한꺼번에 사라지고 표에도 없어 아무도 다시 시도하지 못한다.
    꼬리 320ms 를 잃는 쪽이 회의 전체를 잃는 쪽보다 낫다. drain_speaker 가 항목마다
    예외를 잡는데도 이 경로가 가능하다는 것은 Task 7b 가 feed_errors 를 만들면서
    이미 확인했다.
    """
    cog, _ctx, meeting, text, _vc = await _start_one(tmp_path, monkeypatch)
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)

    def _boom():
        raise RuntimeError("drain boom")

    meeting.sink.cleanup = _boom

    await cog._finish_meeting(GUILD_ID)

    records = [
        json.loads(x)
        for x in (meeting.out_dir / "transcript.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [r["text"] for r in records] == ["마지막 발언"]

    summary = text.summaries()
    assert len(summary) == 1
    assert "드레인 실패" in summary[0]
    assert "RuntimeError" in summary[0]


async def test_join_refuses_to_move_while_an_untracked_recording_is_live(tmp_path, monkeypatch):
    """표에는 없는데 리더가 살아 있는 상태에서 /live-join 이 방을 옮기면 안 된다.

    녹음 중 채널 이동은 destroy_all_decoders 를 순회 중 변경으로 깨뜨린다
    (voice/receive/router.py:116-119). _meetings 검사만으로는 이 상태를 못 잡는다.
    """
    monkeypatch.setattr(adapter, "EliceStt", _FakeStt)
    guild = _FakeGuild({})
    vc_box = []
    room = _FakeVoiceChannel(vc_box)
    other = _FakeVoiceChannel(vc_box)
    other.id = ROOM_ID + 1
    vc = _FakeVoiceClient(other)               # 봇은 다른 방에 있다
    vc.started.append(("sink", None, ()))      # 표에 없는 녹음이 돌고 있다
    vc_box.append(vc)
    guild.voice_client = vc
    cog = RealtimeCog(_FakeBot(guild), recordings_dir=tmp_path)
    ctx = _FakeCtx(guild, room, _FakeTextChannel())
    ctx.voice_client = vc

    await RealtimeCog.live_join.callback(cog, ctx)

    assert vc.moved == []
    assert any("녹음" in r for r in ctx.responses)


# ------------------------------------------------- 인터랙션이 죽은 뒤의 명령
# 첫 실전 실행에서 /live-join 이 여기서 터졌다. defer 가 3초 시한을 넘겨 10062 를 받았고,
# 사용자는 "애플리케이션이 응답하지 않았습니다" 만, 터미널은 트레이스백 25줄을 봤다.


class _FakeResponse:
    status = 404
    reason = "Not Found"


def _unknown_interaction() -> discord.NotFound:
    """응답 시한이 지난 인터랙션에 defer 를 걸면 오는 것 (errors.py:119-160, 170-174)."""
    return discord.NotFound(_FakeResponse(), {"code": 10062, "message": "Unknown interaction"})


def _bare_cog(tmp_path, monkeypatch, command):
    monkeypatch.setattr(adapter, "EliceStt", _FakeStt)
    guild = _FakeGuild({})
    vc_box = []
    room = _FakeVoiceChannel(vc_box)
    vc = _FakeVoiceClient(room)
    vc_box.append(vc)
    guild.voice_client = vc
    cog = RealtimeCog(_FakeBot(guild), recordings_dir=tmp_path)
    return cog, _FakeCtx(guild, room, _FakeTextChannel(), command=command), vc, room


async def test_a_dead_interaction_ends_the_command_without_raising(tmp_path, monkeypatch, capsys):
    """defer 가 10062 로 실패하면 명령은 그 자리에서 끝난다.

    가드가 없으면 NotFound 가 콜백 밖으로 나가 py-cord 기본 핸들러의 트레이스백이 되고
    (bot.py:1403-1412) 디스코드에는 아무 말도 안 간다. 여기서는 핸들러를 거치지 않고
    콜백을 직접 부른다 — 핸들러를 태우면 가드를 지워도 같은 로그가 나와 이 단언이
    아무것도 잡지 못한다.
    """
    cog, ctx, vc, room = _bare_cog(tmp_path, monkeypatch, RealtimeCog.live_join)

    async def _expired():
        raise _unknown_interaction()

    ctx.defer = _expired

    await RealtimeCog.live_join.callback(cog, ctx)

    assert ctx.responses == []                 # 죽은 토큰으로는 보낼 수 있는 것이 없다
    assert room.connects == 0                  # 본문이 아예 안 돌았다
    assert vc.moved == []
    assert cog._meetings == {}

    logged = capsys.readouterr().out
    assert "/live-join" in logged                   # 어느 명령이었는지 로그가 말한다
    assert "만료" in logged
    assert logged.count("\n") == 1             # 한 줄이다. 트레이스백이 아니다


async def _invoke(cog, command, ctx):
    """py-cord 가 명령을 부르고 예외를 핸들러로 넘기는 경로를 그대로 옮긴 것.

    콜백이 낸 예외는 ApplicationCommandInvokeError 로 싸이고 (commands/core.py:126-150),
    bot.py:1301-1307 이 그것을 dispatch_error 로 넘기면 core.py:474-478 이 **오버라이드된**
    cog_command_error 만 부른다. 그 조회를 여기서도 그대로 해야 핸들러를 지웠을 때
    아무도 안 불리고 테스트가 깨진다 — cog.cog_command_error 를 직접 부르면 베이스의
    빈 코루틴(cog.py:518)이 대신 받아 사보타지가 조용히 지나간다.
    """
    try:
        await command.callback(cog, ctx)
    except discord.ApplicationCommandError as e:
        err = e
    except Exception as e:
        err = discord.ApplicationCommandInvokeError(e)
    else:
        return
    local = type(cog)._get_overridden_method(cog.cog_command_error)
    if local is not None:
        await local(ctx, err)


async def test_a_failure_after_defer_is_told_to_the_user_in_discord(tmp_path, monkeypatch):
    """defer 가 성공한 뒤 터진 예외는 디스코드에서 사용자가 읽는다.

    핸들러가 없으면 py-cord 는 stderr 에 트레이스백만 찍고 인터랙션에는 응답하지 않는다
    (bot.py:1403-1412). 사용자 화면에는 "응답하지 않았습니다" 만 남고 원인은 터미널을
    보고 있던 사람만 안다. 이 봇이 없애려는 실패가 정확히 그 모양이다.
    """
    cog, ctx, _vc, room = _bare_cog(tmp_path, monkeypatch, RealtimeCog.live_join)

    def _boom(member):
        raise RuntimeError("권한 조회 실패")

    room.permissions_for = _boom

    await _invoke(cog, RealtimeCog.live_join, ctx)

    assert len(ctx.responses) == 1
    told = ctx.responses[0]
    assert "/live-join" in told                     # 어느 명령이 실패했는지
    assert "RuntimeError" in told              # 무엇이 터졌는지
    assert "권한 조회 실패" in told


async def test_the_handler_never_answers_an_interaction_that_is_already_gone(
    tmp_path, monkeypatch, capsys
):
    """죽은 인터랙션에는 핸들러도 보내지 않는다.

    보내려고 하면 그 send 가 같은 예외를 내고, 이번에는 핸들러 안이라 받아 줄 곳이 없다.
    여기서는 명령 본문의 respond 가 10062 를 내도록 두고 핸들러가 또 보내는지만 본다
    (실제 디스코드가 이 자리에서 정확히 어떤 코드를 주는지는 확인하지 않았다).
    """
    cog, ctx, _vc, _room = _bare_cog(tmp_path, monkeypatch, RealtimeCog.live_join)
    ctx.author.voice = None                    # 첫 respond 까지만 가는 경로
    attempts: list[str] = []

    async def _gone(text, ephemeral=False):
        attempts.append(text)
        raise _unknown_interaction()

    ctx.respond = _gone

    await _invoke(cog, RealtimeCog.live_join, ctx)

    # 명령 본문이 한 번 보내려다 10062 를 받았다. 핸들러가 또 보내면 두 번이 된다.
    assert len(attempts) == 1
    assert ctx.responses == []
    logged = capsys.readouterr().out
    assert "/live-join" in logged
    assert "만료" in logged


async def test_manifest_is_written_even_with_no_speakers(tmp_path, monkeypatch):
    """아무도 말하지 않아도 매니페스트는 남는다.

    무음 회의를 나중에 진단할 때 그 회의가 실제로 열렸다는 유일한 기록이다
    (capture/recording_store.py:86 의 save_session 이 갖고 있던 성질).
    """
    cog, _ctx, meeting, _text, _vc = await _start_one(tmp_path, monkeypatch)

    await cog._finish_meeting(GUILD_ID)

    manifest = tmp_path / f"session_{meeting.ts}.json"
    assert manifest.exists()
    data = json.loads(manifest.read_text(encoding="utf-8"))
    assert data["speakers"] == []
    assert data["session"] == str(meeting.ts)


def test_write_manifest_and_save_session_write_the_same_bytes(tmp_path, monkeypatch):
    """우리가 뽑아낸 write_manifest 가 동료의 save_session 과 같은 파일을 낸다.

    같지 않으면 매니페스트 형식이 두 벌이 되고 stt/transcribe.py 가 한쪽만 읽는다.
    save_session 쪽은 동료의 tests/test_recording_store.py 가 따로 못박고 있다.

    recorded_at 은 ts 가 아니라 "매니페스트를 쓴 시각"이라서 save_session 과 write_manifest 가
    now_iso() 를 각각 부른다. 초 단위로 잘리므로 대개 같은 값이 나오지만 초 경계에 걸치면
    갈라진다. 시각을 고정해서 비교한다 — 여기서 재려는 건 시계가 아니라 매니페스트 형식이다.
    """
    from capture import recording_store
    from capture.recording_store import Track, save_session, write_manifest

    frozen = "2023-11-14T22:13:20+00:00"
    monkeypatch.setattr(recording_store, "now_iso", lambda: frozen)

    raw = b"\x00\x00" * 3200
    p1, m1 = save_session([Track("7", "김환", raw)], tmp_path / "a", ts=1700000000,
                          guild="g", channel="c", library_version="v")
    entries = [{"user_id": "7", "display_name": "김환", "file": "7_1700000000.wav",
                "duration_sec": m1["speakers"][0]["duration_sec"]}]
    p2, m2 = write_manifest(entries, tmp_path / "b", ts=1700000000, guild="g", channel="c",
                            library_version="v")

    assert m1 == m2
    assert p1.read_text(encoding="utf-8") == p2.read_text(encoding="utf-8")
    assert m1["recorded_at"] == frozen


def test_manifest_recorded_at_is_utc_iso8601(tmp_path):
    """recorded_at 형식은 now_iso() 의 UTC ISO8601 이다. BE 의 DateTime(timezone=True) 와
    경계에서 어긋나지 않게 맞춘 것이라, 예전 time.localtime 형식으로 되돌아가면 여기서 걸린다.
    위 테스트는 시각을 고정하므로 형식은 이쪽에서 진짜 now_iso() 로 확인한다."""
    from datetime import datetime, timedelta

    from capture.recording_store import write_manifest

    _, m = write_manifest([], tmp_path, ts=1700000000, guild=None, channel=None,
                          library_version=None)

    parsed = datetime.fromisoformat(m["recorded_at"])
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() == timedelta(0)


async def test_stop_summary_carries_the_stage_latencies(tmp_path, monkeypatch):
    """종료 요약에 구간별 지연 한 줄이 있어야 한다. 그게 없으면 "체감 10초" 를
    수치와 맞춰 볼 자리가 어디에도 없다."""
    cog, _ctx, meeting, text, _vc = await _start_one(tmp_path, monkeypatch)
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)
    meeting.sink.cleanup()

    await cog._finish_meeting(GUILD_ID)

    latency = [x for x in text.summaries()[0].splitlines() if x.startswith("지연")]
    assert len(latency) == 1
    assert "큐 " in latency[0] and "전사 " in latency[0] and "게시 " in latency[0]

    rows = [
        json.loads(x)
        for x in (meeting.out_dir / "latency.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(rows) == 1
    assert rows[0]["queue_s"] is not None and rows[0]["transcribe_s"] is not None
    assert rows[0]["seq"] == 1


async def test_stop_summary_says_how_many_utterances_the_speech_filter_dropped(
    tmp_path, monkeypatch
):
    """열 건을 지운 회의는 지웠다고 말해야 한다. 조용히 거르는 필터가 이 프로젝트가
    내내 싸워 온 실패 방식이다."""
    cog, _ctx, meeting, text, _vc = await _start_one(
        tmp_path, monkeypatch, speech_spans=_no_speech
    )
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)
    meeting.sink.cleanup()

    await cog._finish_meeting(GUILD_ID)

    filtered = [x for x in text.summaries()[0].splitlines() if x.startswith("말 필터")]
    assert filtered == [
        "말 필터 · 거름 1건 / 검사 1건 · 오류 0건 (말 비율 0.60 미만은 거른다)"
    ]
    # 거른 발화는 회의록에도 없어야 한다. 요약에만 세고 줄은 남기면 의미가 없다.
    assert (meeting.out_dir / "transcript.jsonl").read_text(encoding="utf-8") == ""


async def test_stop_summary_reports_the_filter_even_when_it_dropped_nothing(
    tmp_path, monkeypatch
):
    cog, _ctx, meeting, text, _vc = await _start_one(tmp_path, monkeypatch)
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(1_200), ssrc=70)], meeting.sink.write)
    meeting.sink.cleanup()

    await cog._finish_meeting(GUILD_ID)

    filtered = [x for x in text.summaries()[0].splitlines() if x.startswith("말 필터")]
    assert filtered == [
        "말 필터 · 거름 0건 / 검사 1건 · 오류 0건 (말 비율 0.60 미만은 거른다)"
    ]


async def test_stop_summary_says_unmeasured_when_nobody_spoke(tmp_path, monkeypatch):
    """발화가 없으면 0.00 초가 아니라 못 쟀다고 적는다. 0 은 즉시로 읽힌다."""
    cog, _ctx, meeting, text, _vc = await _start_one(tmp_path, monkeypatch)

    await cog._finish_meeting(GUILD_ID)

    latency = [x for x in text.summaries()[0].splitlines() if x.startswith("지연")]
    assert latency == ["지연 미측정 (확정된 발화 없음)"]
    assert (meeting.out_dir / "latency.jsonl").read_text(encoding="utf-8") == ""


# ------------------------------------------------ 두 녹음기가 한 연결을 두고 만날 때
# 봇 계정은 길드마다 음성 연결이 하나이고 그 연결의 리더도 하나다
# (voice/client.py:759-773). 동료의 /record 가 잡고 있는 연결에 우리가 start_recording 을
# 걸면 py-cord 가 ClientException("Already recording audio") 를 낸다 (client.py:759-760).


def _foreign_vc(room):
    """동료의 WaveSink 가 잡고 있는 연결."""
    vc = _FakeVoiceClient(room)
    vc.start_recording(discord.sinks.WaveSink(), lambda *a: None)
    return vc


def _ours_vc(room):
    """우리 StreamingSink 가 잡고 있는데 표에는 없는 연결."""
    from capture.streaming_sink import StreamingSink

    vc = _FakeVoiceClient(room)
    vc.start_recording(StreamingSink(_NullSessionStub()), lambda *a: None)
    return vc


class _NullSessionStub:
    def feed(self, speaker_id, speaker_name, samples, offset_ms):
        pass

    def flush_speaker(self, speaker_id):
        pass


def test_holds_other_recorder_is_false_on_an_idle_connection():
    assert adapter.holds_other_recorder(None) is False
    assert adapter.holds_other_recorder(_FakeVoiceClient(object())) is False


def test_holds_other_recorder_tells_our_sink_from_the_other_one():
    assert adapter.holds_other_recorder(_foreign_vc(object())) is True
    assert adapter.holds_other_recorder(_ours_vc(object())) is False


def test_holds_other_recorder_counts_an_unreadable_sink_as_the_other_one():
    """sink 를 못 읽으면 남의 것으로 센다. 남의 녹음을 우리가 멈추는 쪽이 더 나쁘다."""
    vc = _FakeVoiceClient(object())
    vc.started.append(("sink", None, ()))      # 리더 없이 녹음 중으로만 보이는 상태
    assert adapter.holds_other_recorder(vc) is True


def _cog_with(tmp_path, monkeypatch, vc):
    monkeypatch.setattr(adapter, "EliceStt", _FakeStt)
    guild = _FakeGuild({})
    vc_box = [vc]
    room = _FakeVoiceChannel(vc_box)
    guild.voice_client = vc
    cog = RealtimeCog(_FakeBot(guild), recordings_dir=tmp_path)
    ctx = _FakeCtx(guild, room, _FakeTextChannel())
    ctx.voice_client = vc
    return cog, ctx, room


async def test_live_refuses_while_the_other_recorder_holds_the_connection(tmp_path, monkeypatch):
    room_box = []
    vc = _foreign_vc(_FakeVoiceChannel(room_box))
    cog, ctx, _room = _cog_with(tmp_path, monkeypatch, vc)
    before = list(vc.started)

    await RealtimeCog.live.callback(cog, ctx)

    assert vc.started == before                # 우리 sink 를 걸지 않았다
    assert _room.connects == 0                 # 새로 연결하지도 않았다
    assert cog._meetings == {}
    said = " ".join(ctx.responses)
    assert "우리 것이 아닌 녹음" in said        # 무엇이 돌고 있는지
    assert "/record" in said and "/stop" in said   # 누구 것이고 무엇으로 끝내는지


async def test_live_refuses_even_while_the_connection_is_reconnecting(tmp_path, monkeypatch):
    """is_connected() 가 False 인 동안에도 리더는 살아 있을 수 있다.

    재연결은 disconnect(cleanup=False) 라 _reader 가 남고, is_connected() 는 상태 기계가
    connected 일 때만 True 다 (voice/state.py:329-330). 이때 connect() 로 흘려보내면
    VoiceClient 가 이미 있어서 ClientException("Already connected to a voice channel.") 이
    되고 (abc.py:2077-2078), 사용자는 남의 녹음이 돌고 있다는 사실을 못 듣는다.
    """
    room_box = []
    vc = _foreign_vc(_FakeVoiceChannel(room_box))
    vc.is_connected = lambda: False
    cog, ctx, _room = _cog_with(tmp_path, monkeypatch, vc)

    await RealtimeCog.live.callback(cog, ctx)

    assert _room.connects == 0
    assert cog._meetings == {}
    assert "우리 것이 아닌 녹음" in " ".join(ctx.responses)


async def test_live_join_refuses_while_the_other_recorder_holds_the_connection(
    tmp_path, monkeypatch
):
    room_box = []
    vc = _foreign_vc(_FakeVoiceChannel(room_box))
    cog, ctx, _room = _cog_with(tmp_path, monkeypatch, vc)

    await RealtimeCog.live_join.callback(cog, ctx)

    assert vc.moved == []
    assert _room.connects == 0
    said = " ".join(ctx.responses)
    assert "우리 것이 아닌 녹음" in said
    assert "/stop" in said


async def test_live_stop_does_not_stop_the_other_recorder(tmp_path, monkeypatch):
    """표에 회의가 없다고 남의 리더를 세우면 동료의 녹음이 우리 명령으로 끝난다."""
    room_box = []
    vc = _foreign_vc(_FakeVoiceChannel(room_box))
    cog, ctx, _room = _cog_with(tmp_path, monkeypatch, vc)

    await RealtimeCog.live_stop.callback(cog, ctx)

    assert vc.is_recording() is True            # 남의 녹음은 그대로 돈다
    said = " ".join(ctx.responses)
    assert "우리 것이 아닌 녹음" in said
    assert "/stop" in said


async def test_live_stop_still_clears_our_own_untracked_recording(tmp_path, monkeypatch):
    """우리 sink 인데 표에 없는 상태는 여전히 우리가 푼다. 안 그러면 봇 재시작 말고 길이 없다."""
    room_box = []
    vc = _ours_vc(_FakeVoiceChannel(room_box))
    cog, ctx, _room = _cog_with(tmp_path, monkeypatch, vc)

    await RealtimeCog.live_stop.callback(cog, ctx)

    assert vc.is_recording() is False
    assert any("표에 없는 녹음을 정지" in r for r in ctx.responses)


async def test_live_starts_when_nothing_else_holds_the_connection(tmp_path, monkeypatch):
    """가드가 빈 연결까지 막으면 우리 쪽이 아예 안 돈다."""
    cog, _ctx, meeting, _text, vc = await _start_one(tmp_path, monkeypatch)

    assert adapter.holds_other_recorder(vc) is False
    assert meeting.sink is vc.started[0][0]

    await cog._finish_meeting(GUILD_ID)


# ------------------------------------------------------------------- 명령 이름
async def test_realtime_commands_are_registered_under_the_new_names():
    """py-cord 는 겹치는 명령 이름을 걸러 주지 않는다.

    같은 이름 둘을 서로 다른 Cog 로 붙여 보면 pending_application_commands 에 둘 다 그대로
    남아 디스코드 등록 요청으로 나간다. 디스코드가 그때 무엇을 하는지는 확인하지 못했다.
    이름이 안 겹치게 하는 것은 우리 몫이라 여기서 못박는다.
    """
    bot = discord.Bot(intents=required_intents())
    bot.add_cog(RealtimeCog(bot))

    names = sorted(c.name for c in bot.pending_application_commands)
    assert names == ["live", "live-join", "live-stop", "selftest"]
    assert not ({"end", "join", "leave", "record", "stop"} & set(names))


async def test_both_cogs_fit_on_one_bot():
    """Bot.add_cog 는 클래스 이름을 키로 쓰고 (cog.py:681-687) 겹치면 ClientException 이다.

    end 는 RecordingCog 쪽 명령이다. 이 목록은 RecordingCog 가 명령을 늘릴 때마다 같이
    늘어난다 — 여기서 재려는 건 목록의 내용이 아니라 두 Cog 의 이름이 안 겹친다는 것이다.
    """
    from capture.discord_adapter import RecordingCog

    bot = discord.Bot(intents=required_intents())
    bot.add_cog(RecordingCog(bot))
    bot.add_cog(RealtimeCog(bot))

    names = sorted(c.name for c in bot.pending_application_commands)
    assert names == ["end", "join", "leave", "live", "live-join", "live-stop", "record",
                     "selftest", "stop"]
    assert len(names) == len(set(names))
