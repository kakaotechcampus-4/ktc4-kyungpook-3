"""/selftest 가 단계마다 무엇을 보고 무엇을 안내하는지 확인한다.

리포트 문자열 자체가 이 기능의 산출물이다. 단계가 OK 로 뜨는 것만 보면 "고장난 상태를
고장났다고 말하는가" 를 놓치므로, 감지기마다 정상 세계와 그 감지기가 존재하는 이유인
고장 세계를 짝으로 돌린다.

py-cord 대역은 실물이 하는 일 중 판정에 걸리는 것만 흉내낸다. 특히 stop_recording 이
_reader 를 지우는 것 (voice/client.py:788-790) 은 반드시 흉내내야 한다 — 안 그러면
reader.error 를 stop 뒤에 읽는 코드가 테스트에서만 통과한다.
"""

from __future__ import annotations

import asyncio

import numpy as np
import pytest

import capture.selftest as selftest
import stt.elice as elice_mod
from capture.selftest import CAUSES, PCM_20MS_BYTES, SelfTest, _NullSession, _ProbeSink
from stt.backend import SttError, SttResult
from tests.replay import ReplayTrack, replay

GUILD_ID = 42
SR = 16_000


# ------------------------------------------------------------------ SelfTest 자체


def test_report_lists_every_step():
    t = SelfTest()
    t.record("슬래시 명령 등록", True, "guild=카테캠테스트")
    t.record("오디오 수신", False, "패킷 0건")
    out = t.report()
    assert "슬래시 명령 등록" in out and "오디오 수신" in out
    assert "guild=카테캠테스트" in out and "패킷 0건" in out


def test_all_ok_false_when_any_step_failed():
    t = SelfTest()
    t.record("a", True, "")
    t.record("b", False, "")
    assert t.all_ok() is False


def test_all_ok_true_when_everything_passed():
    t = SelfTest()
    t.record("a", True, "")
    assert t.all_ok() is True


def test_every_step_name_has_a_cause_line():
    """단계 이름을 새로 만들고 CAUSES 에 안 넣으면 실패해도 안내가 안 붙는다."""
    t = SelfTest()
    for step in CAUSES:
        t.record(step, False, "")
    out = t.report()
    assert out.count("↳") == len(CAUSES)


def test_failed_audio_step_names_dave_or_intents():
    t = SelfTest()
    t.record("오디오 수신", False, "패킷 0건")
    assert "DAVE" in t.report() or "인텐트" in t.report()


def test_informational_step_does_not_fail_the_run():
    """진행 중 회의에서 아직 아무도 말하지 않은 경우."""
    t = SelfTest()
    t.record("오디오 수신", True, "아직 발화 없음", info=True)
    assert t.all_ok() is True
    assert "아직 발화 없음" in t.report()


def test_null_session_accepts_feed_without_transcribing():
    s = _NullSession()
    s.feed("7", "김환", [0.0] * 320, 0)
    s.flush_speaker("7")
    assert s.fed == 1


def test_probe_sink_counts_packet_sizes():
    """20ms 패킷은 3840바이트다. 다른 값이 섞이면 pcm_to_mono16k 의 전제가 깨진다."""
    probe = _ProbeSink()
    replay([ReplayTrack(user_id=7, name="김환", samples=_tone(200), ssrc=70)], probe.write)
    assert probe.sizes[PCM_20MS_BYTES] == sum(probe.sizes.values()) > 0
    # 재정렬 창(16패킷)이 차기 전이라 아직 아무것도 안 나갔다. py-cord 는 정지할 때
    # sink.cleanup() 을 부른다 (reader.py:194-197).
    assert probe.session.fed == 0
    probe.cleanup()
    assert probe.session.fed > 0


# ------------------------------------------------------------------ py-cord 대역


def _tone(ms: int, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


class _Perms:
    def __init__(self, view_channel: bool = True, connect: bool = True) -> None:
        self.view_channel = view_channel
        self.connect = connect


class _Member:
    def __init__(self, uid: int, name: str) -> None:
        self.id = uid
        self.display_name = name


class _VoiceRoom:
    def __init__(self, perms: _Perms | None = None, members=()) -> None:
        self.id = 99
        self.name = "회의방"
        self.members = list(members)
        self._perms = perms or _Perms()

    def permissions_for(self, me):
        return self._perms


class _Msg:
    def __init__(self, channel: "_TextChannel") -> None:
        self._channel = channel
        self.content = ""

    async def edit(self, content):
        self.content = content
        self._channel.edited += 1

    async def delete(self):
        self._channel.deleted += 1


class _TextChannel:
    def __init__(self, send_error: Exception | None = None) -> None:
        self.name = "일반"
        self.sent: list[str] = []
        self.edited = 0
        self.deleted = 0
        self._send_error = send_error

    async def send(self, text):
        if self._send_error is not None:
            raise self._send_error
        self.sent.append(text)
        return _Msg(self)


class _Router:
    def __init__(self, alive: bool = True) -> None:
        self._alive = alive

    def is_alive(self):
        return self._alive


class _Reader:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.packet_router = _Router()


class _SocketReader:
    def __init__(self, paused: bool = False) -> None:
        self._paused = paused

    def is_paused(self):
        return self._paused


class _Dave:
    def __init__(self, ready: bool = True, stats: dict | None = None) -> None:
        self.ready = ready
        self._stats = stats or {}

    def get_decryption_stats(self, user_id, media_type=None):
        return self._stats.get(user_id)


class _Runner:
    def __init__(self, done: bool = False) -> None:
        self._done = done

    def done(self):
        return self._done


class _Conn:
    def __init__(self, *, runner_done=False, dave=None, downgraded=False, paused=False) -> None:
        self._runner = _Runner(runner_done)
        self.dave_session = _Dave() if dave is None else dave
        self.downgraded_dave = downgraded
        self._socket_reader = _SocketReader(paused)


class _VC:
    """VoiceClient 대역.

    stop_recording 이 _reader 를 지우는 것까지 흉내낸다 (voice/client.py:788-790).
    실물처럼 녹음 중이 아닐 때 stop_recording 을 부르면 터지고 (client.py:792-793),
    정지하면서 sink.cleanup() 을 부른다 (reader.py:194-197) — 그게 재정렬 창을 비운다.
    """

    def __init__(self, room: _VoiceRoom, *, conn: _Conn | None = None, ssrc_map=None,
                 tracks=(), reader_error=None, start_error=None, recording=False) -> None:
        self.channel = room
        self._connection = conn or _Conn()
        self._ssrc_to_id = dict(ssrc_map or {70: 7})
        self._reader = _Reader() if recording else None
        self._sink = None
        self._tracks = list(tracks)
        self._reader_error = reader_error
        self._start_error = start_error
        self._recording = recording
        self.starts = 0
        self.stops = 0

    def is_connected(self):
        return True

    def is_dave_connection(self):
        return self._connection.dave_session is not None

    def is_recording(self):
        return self._recording

    def start_recording(self, sink, callback, *args):
        self.starts += 1
        if self._start_error is not None:
            raise self._start_error
        self._recording = True
        self._reader = _Reader(self._reader_error)
        self._sink = sink
        replay(self._tracks, sink.write)

    def stop_recording(self):
        if self._reader is None:
            raise RuntimeError("You are not recording")
        self.stops += 1
        self._recording = False
        if self._sink is not None:
            self._sink.cleanup()
        self._reader = None


class _Intents:
    def __init__(self, members=True, voice_states=True, message_content=False) -> None:
        self.members = members
        self.voice_states = voice_states
        self.message_content = message_content


class _Bot:
    def __init__(self, intents: _Intents) -> None:
        self.intents = intents


class _Cog:
    def __init__(self, bot: _Bot, meetings=None) -> None:
        self.bot = bot
        self._meetings = meetings or {}


class _Guild:
    def __init__(self) -> None:
        self.id = GUILD_ID
        self.me = object()


class _Author:
    def __init__(self, room) -> None:
        self.voice = None if room is None else _VoiceState(room)


class _VoiceState:
    def __init__(self, room) -> None:
        self.channel = room


class _Ctx:
    def __init__(self, room, text, vc) -> None:
        self.guild = _Guild()
        self.author = _Author(room)
        self.channel = text
        self.voice_client = vc


def _world(monkeypatch, *, guild_id="777", intents=None, perms=None, in_voice=True,
           conn=None, tracks=None, reader_error=None, start_error=None, recording=False,
           send_error=None, meetings=None):
    """기본은 전부 정상인 세계. 테스트마다 하나씩만 망가뜨린다."""
    monkeypatch.setenv("DISCORD_GUILD_ID", guild_id)
    monkeypatch.setattr(selftest, "PROBE_SECONDS", 0.0)

    room = _VoiceRoom(perms, members=[_Member(7, "김환")])
    if tracks is None:
        tracks = [ReplayTrack(user_id=7, name="김환", samples=_tone(200), ssrc=70)]
    vc = _VC(room, conn=conn, tracks=tracks, reader_error=reader_error,
             start_error=start_error, recording=recording)
    text = _TextChannel(send_error)
    cog = _Cog(_Bot(intents or _Intents()), meetings)
    ctx = _Ctx(room if in_voice else None, text, vc)
    return cog, ctx, vc, text


class _CountingStt:
    """유료 호출이 실제로 몇 번 일어났는지 센다."""

    calls: list[int] = []

    def __init__(self, *a, **k) -> None:
        pass

    def transcribe(self, samples, sample_rate):
        _CountingStt.calls.append(len(samples))
        return SttResult(text="테스트", words=[])


@pytest.fixture
def counting_stt(monkeypatch):
    _CountingStt.calls = []
    monkeypatch.setattr(elice_mod, "EliceStt", _CountingStt)
    return _CountingStt


def _lines(report: str) -> list[str]:
    return report.strip("`\n").splitlines()


# ------------------------------------------------------------------ 정상 세계


async def test_healthy_world_reports_no_failure(monkeypatch):
    cog, ctx, vc, text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패" not in out, out
    assert vc.starts == 1 and vc.stops == 1


async def test_write_probe_sends_edits_and_deletes(monkeypatch):
    """권한 비트가 맞는데도 못 보내는 경우를 잡으려면 실제로 보내 봐야 한다."""
    cog, ctx, vc, text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert (len(text.sent), text.edited, text.deleted) == (1, 1, 1)
    assert "채널 쓰기" in out and "전송·편집·삭제 확인" in out


# ------------------------------------------------- 감지기: 음성 WS 폴러 사망


async def test_dead_voice_ws_poller_is_reported_although_is_connected_stays_true(monkeypatch):
    """_runner 가 죽어도 is_connected() 는 True 로 남는다 (voice/state.py:329-330).

    is_connected() 만 보면 이 상태가 통째로 안 보이고, 사용자는 오디오 0건만 본다.
    """
    cog, ctx, vc, _text = _world(monkeypatch, conn=_Conn(runner_done=True))
    assert vc.is_connected() is True

    out = await selftest.run(cog, ctx, use_stt=False)

    assert "실패 음성 연결" in out
    assert "음성 WS 폴러 죽음" in out
    assert CAUSES["음성 연결"][:20] in out


async def test_live_voice_ws_poller_reports_ok(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(runner_done=False))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "OK   음성 연결" in out
    assert "음성 WS 폴러 죽음" not in out


# ------------------------------------------------------------- 감지기: DAVE


async def test_downgraded_dave_fails_even_though_the_session_is_ready(monkeypatch):
    """평문 강등이면 패킷이 와도 우리가 기대한 경로가 아니다."""
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=_Dave(ready=True), downgraded=True))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 DAVE" in out
    assert "downgraded=True" in out
    assert "PR #3159" in out


async def test_dave_not_ready_fails(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=_Dave(ready=False)))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 DAVE" in out
    assert "ready=False" in out


async def test_ready_dave_reports_ok_and_carries_decryption_stats(monkeypatch):
    """패킷은 오는데 안 풀리는 경우에 이 통계가 가장 나은 신호다."""
    dave = _Dave(ready=True, stats={7: "복호화 12/12"})
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=dave))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "OK   DAVE" in out
    assert "김환:복호화 12/12" in out


# --------------------------------------------------------- 감지기: 오디오 수신


async def test_audio_stage_reports_ok_when_packets_arrive(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "OK   오디오 수신" in out
    assert "(음성 0, 잡음 0)" not in out


async def test_audio_stage_fails_when_no_packet_arrives_in_the_probe(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, tracks=[])
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 오디오 수신" in out
    assert "패킷 0 (음성 0, 잡음 0)" in out


async def test_probe_window_in_the_report_follows_the_constant(monkeypatch):
    """리포트가 '3초 동안' 을 문자열로 박아 두면 상수를 바꾼 순간 거짓말이 된다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    monkeypatch.setattr(selftest, "PROBE_SECONDS", 1.5)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "1.5초 동안 패킷" in out


async def test_reader_error_is_read_before_stop_recording_wipes_it(monkeypatch):
    """write 예외는 패킷 하나가 아니라 녹음 세션 전체를 끝낸다 (reader.py:273-281).

    그 흔적은 reader.error 뿐인데 stop_recording 이 _reader 를 MISSING 으로 되돌리므로
    (voice/client.py:788-790) 정지 뒤에 읽으면 영영 None 이다. 이 실패 모드가 리포트에
    한 번도 못 뜨게 되는 자리다.
    """
    boom = ValueError("복호화 실패")
    cog, ctx, _vc, _text = _world(monkeypatch, reader_error=boom)

    out = await selftest.run(cog, ctx, use_stt=False)

    assert "실패 오디오 수신" in out
    assert "reader 오류 ValueError: 복호화 실패" in out


async def test_probe_failure_to_start_is_reported_instead_of_crashing(monkeypatch):
    """start_recording 이 터져도 리포트는 나와야 한다. 이 명령의 존재 이유가 그거다."""
    cog, ctx, vc, _text = _world(monkeypatch, start_error=RuntimeError("Already recording audio"))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 오디오 수신" in out
    assert "Already recording audio" in out
    assert vc.stops == 0


async def test_probe_is_skipped_when_the_client_is_already_recording(monkeypatch):
    """두 번째 start_recording 은 ClientException 이다 (voice/client.py:760-761)."""
    cog, ctx, vc, _text = _world(monkeypatch, recording=True)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert vc.starts == 0
    assert "이미 녹음 중이라 프로브를 건너뜀" in out


async def test_running_meeting_with_no_speech_yet_is_not_a_failure(monkeypatch):
    """회의가 막 시작돼 아무도 말하지 않은 순간을 실패로 적으면 엉뚱한 원인이 뜬다."""

    class _Ledger:
        lines: list = []

    class _Sink:
        def level_report(self):
            return {"packets": 0, "noise_packets": 0, "peak_rms": 0.0, "speech_rms": 0.006}

    class _Meeting:
        sink = _Sink()
        ledger = _Ledger()

    cog, ctx, vc, _text = _world(monkeypatch, meetings={GUILD_ID: _Meeting()})
    out = await selftest.run(cog, ctx, use_stt=False)

    assert vc.starts == 0
    assert "아직 발화 없음" in out
    assert "실패 오디오 수신" not in out


# ------------------------------------------------------- 감지기: 인텐트·권한·등록


async def test_missing_members_intent_fails_with_the_portal_instruction(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, intents=_Intents(members=False))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 인텐트" in out
    assert "SERVER MEMBERS" in out


async def test_correct_intents_report_ok(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "OK   인텐트" in out


async def test_blank_guild_id_warns_about_the_one_hour_delay(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, guild_id="")
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 슬래시 명령 등록" in out
    assert "최대 1시간" in out


async def test_missing_voice_permissions_name_the_missing_ones(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, perms=_Perms(view_channel=True, connect=False))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 음성 채널 권한" in out
    assert "없음: 연결" in out


async def test_channel_write_failure_carries_the_exception_message(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, send_error=PermissionError("Missing Permissions"))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 채널 쓰기" in out
    assert "PermissionError: Missing Permissions" in out


# ------------------------------------------------------------------ 유료 호출 게이트


async def test_stt_is_not_called_when_the_option_is_off(monkeypatch, counting_stt):
    """기본값이 무과금이어야 한다. 반복해서 치는 명령이라 매번 부르면 크레딧이 샌다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert counting_stt.calls == []
    assert "stt:True" in out and "0.1원" in out
    assert "실패" not in out


async def test_stt_runs_once_on_a_healthy_run_when_asked(monkeypatch, counting_stt):
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=True)
    assert counting_stt.calls == [16_000]     # 1.0초 = 약 0.1원
    assert "OK   STT 왕복" in out


async def test_stt_is_skipped_when_an_earlier_stage_failed(monkeypatch, counting_stt):
    """연결도 안 되는 상태에서 유료 API 를 부를 이유가 없다."""
    cog, ctx, _vc, _text = _world(monkeypatch, intents=_Intents(members=False))
    out = await selftest.run(cog, ctx, use_stt=True)
    assert counting_stt.calls == []
    assert "앞 단계가 실패해 건너뜀" in out


async def test_stt_failure_carries_the_message_not_only_the_class(monkeypatch):
    """elice 의 실패 경로 다섯이 전부 같은 SttError 다. 메시지를 지우면 전부 똑같이 보인다."""

    class _Broken:
        def __init__(self, *a, **k):
            pass

        def transcribe(self, samples, sample_rate):
            raise SttError("ELICE_API_KEY 환경변수가 없습니다.")

    monkeypatch.setattr(elice_mod, "EliceStt", _Broken)
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=True)
    assert "실패 STT 왕복" in out
    assert "SttError: ELICE_API_KEY 환경변수가 없습니다." in out
    assert "ELICE_API_KEY 를 확인한다" in out


# ------------------------------------------------------------------ 안내 문구


async def test_every_failed_step_in_a_run_is_followed_by_a_remediation_line(monkeypatch):
    """실패했는데 다음에 뭘 하면 되는지 안 붙으면 이 명령은 없는 것과 같다.

    run() 이 실제로 쓰는 단계 이름을 CAUSES 에 안 넣으면 여기서 걸린다. CAUSES 를
    순회하는 단위 테스트는 그걸 못 잡는다 — 없는 이름은 순회 대상이 아니다.
    """
    worlds = [
        {"guild_id": "", "intents": _Intents(members=False)},
        {"conn": _Conn(runner_done=True)},
        {"conn": _Conn(dave=_Dave(ready=False))},
        {"tracks": []},
        {"perms": _Perms(view_channel=False, connect=False)},
        {"in_voice": False},
        {"send_error": PermissionError("Missing Permissions")},
        {"reader_error": ValueError("복호화 실패")},
        {"start_error": RuntimeError("not connected to a voice channel")},
    ]
    for kw in worlds:
        cog, ctx, _vc, _text = _world(monkeypatch, **kw)
        lines = _lines(await selftest.run(cog, ctx, use_stt=False))
        failed = [i for i, ln in enumerate(lines) if ln.startswith("실패")]
        assert failed, f"이 세계는 아무것도 실패하지 않았다: {kw}"
        for i in failed:
            assert lines[i + 1].lstrip().startswith("↳"), f"{kw} → 안내 없는 실패: {lines[i]}"


async def test_report_fits_in_a_discord_message(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert len(out) <= 2000


def test_report_truncates_when_it_would_not_fit():
    t = SelfTest()
    for i in range(400):
        t.record(f"단계{i}", True, "x" * 40)
    out = t.report()
    assert len(out) <= 2000
    assert "(잘림)" in out


# ------------------------------------------------------------------ 어댑터 배선


async def test_selftest_command_is_registered_on_the_cog():
    # discord.Bot() 은 만들 때 이벤트 루프를 찾는다. 동기 테스트에는 루프가 없다.
    import discord

    import capture.discord_adapter as adapter

    bot = discord.Bot(intents=adapter.required_intents())
    bot.add_cog(adapter.RecordingCog(bot))
    names = sorted(c.name for c in bot.pending_application_commands)
    assert names == ["join", "leave", "record", "selftest", "stop"]


def test_selftest_command_defers_before_the_probe():
    """3초 프로브가 인터랙션 시한 3초를 넘긴다. defer 가 없으면 응답이 통째로 NotFound 다."""
    import inspect

    import capture.discord_adapter as adapter

    src = inspect.getsource(adapter.RecordingCog.selftest.callback)
    assert "ctx.defer()" in src
    assert src.index("ctx.defer()") < src.index("st.run(")


async def test_selftest_command_passes_the_stt_flag_through(monkeypatch):
    """옵션이 본문까지 안 내려가면 유료 호출 게이트 전체가 무의미하다."""
    import capture.discord_adapter as adapter

    seen = []

    async def _fake_run(cog, ctx, use_stt=False):
        seen.append(use_stt)
        return "리포트"

    monkeypatch.setattr(selftest, "run", _fake_run)

    class _Followup:
        def __init__(self):
            self.sent = []

        async def send(self, text):
            self.sent.append(text)

    class _C:
        def __init__(self):
            self.followup = _Followup()
            self.deferred = 0

        async def defer(self):
            self.deferred += 1

    ctx = _C()
    await adapter.RecordingCog.selftest.callback(object(), ctx, stt=True)
    assert seen == [True]
    assert ctx.deferred == 1
    assert ctx.followup.sent == ["리포트"]

    await adapter.RecordingCog.selftest.callback(object(), _C())
    assert seen == [True, False]


def test_probe_sink_does_not_transcribe():
    """프로브에 진짜 Session 을 붙이면 워커 스레드 3개가 뜨고 유료 API 를 부른다."""
    probe = _ProbeSink()
    assert isinstance(probe.session, _NullSession)
    assert not hasattr(probe.session, "final_stt")


def test_probe_seconds_is_three():
    """리포트 문구가 '3초 동안' 이라고 말한다. 상수와 문구가 어긋나면 리포트가 거짓말한다."""
    assert selftest.PROBE_SECONDS == 3.0
    assert asyncio.iscoroutinefunction(selftest.run)
