"""/selftest 가 단계마다 무엇을 보고 무엇을 안내하는지 확인한다.

리포트 문자열 자체가 이 기능의 산출물이다. 단계가 OK 로 뜨는 것만 보면 "고장난 상태를
고장났다고 말하는가" 를 놓치므로, 감지기마다 정상 세계와 그 감지기가 존재하는 이유인
고장 세계를 짝으로 돌린다. 안내 문구가 실패 내용과 맞는지도 같이 본다 — 틀린 안내는
침묵보다 나쁘다.

py-cord 대역은 실물이 하는 일 중 판정에 걸리는 것만 흉내낸다. 반드시 맞춰야 하는 셋이
있다. stop_recording 이 _reader 를 지우고 (voice/client.py:788-790), 정지하면서
sink.cleanup() 을 부르고 (reader.py:194-197), 패킷은 start_recording 안이 아니라 프로브
창 도중에 도착한다. 셋 중 하나라도 어긋나면 잘못된 코드가 테스트를 통과한다.
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


def test_last_step_names_the_most_recent_row():
    """예외로 끝났을 때 어디까지 갔는지 사용자에게 말해 주는 값이다."""
    t = SelfTest()
    assert t.last_step() == ""
    t.record("인텐트", True, "")
    t.record("음성 연결", True, "")
    assert t.last_step() == "음성 연결"


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


def test_report_truncates_when_it_would_not_fit():
    t = SelfTest()
    for i in range(400):
        t.record(f"단계{i}", True, "x" * 40)
    out = t.report()
    assert len(out) <= 2000
    assert "(잘림)" in out


# ------------------------------------------------------------------ py-cord 대역


def _tone(ms: int, amp: float = 0.3) -> np.ndarray:
    t = np.arange(int(SR * ms / 1000)) / SR
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


_DEFAULT = object()


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
        if self._channel.delete_error is not None:
            raise self._channel.delete_error
        self._channel.deleted += 1


class _TextChannel:
    def __init__(self, send_error=None, delete_error=None) -> None:
        self.name = "일반"
        self.sent: list[str] = []
        self.edited = 0
        self.deleted = 0
        self.delete_error = delete_error
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


class _Stats:
    """davey DecryptionStats 대역 (davey/__init__.pyi:131-142)."""

    def __init__(self, successes: int = 0, failures: int = 0) -> None:
        self.successes = successes
        self.failures = failures


class _Dave:
    def __init__(self, ready: bool = True, stats: dict | None = None) -> None:
        self.ready = ready
        self._stats = stats or {}

    def get_decryption_stats(self, user_id, media_type=None):
        """stats 값이 예외면 던진다. davey 는 멤버에 따라 raise 한다."""
        s = self._stats.get(user_id)
        if isinstance(s, Exception):
            raise s
        return s


class _Runner:
    def __init__(self, done: bool = False) -> None:
        self._done = done

    def done(self):
        return self._done


class _Conn:
    def __init__(self, *, runner_done=False, dave=_DEFAULT, downgraded=False, paused=False) -> None:
        self._runner = _Runner(runner_done)
        # dave=None 은 "세션이 아예 없다" 를 뜻해야 한다. 기본값과 구별하려고 센티넬을 쓴다.
        self.dave_session = _Dave() if dave is _DEFAULT else dave
        self.downgraded_dave = downgraded
        self._socket_reader = _SocketReader(paused)


class _VC:
    """VoiceClient 대역.

    실물을 세 군데서 그대로 흉내낸다. stop_recording 이 _reader 를 지우고
    (voice/client.py:788-790), 녹음 중이 아닐 때 부르면 터지고 (client.py:792-793),
    정지하면서 sink.cleanup() 을 부른다 (reader.py:194-197).

    패킷은 start_recording 안에서 바로 흘리지 않고 프로브 창 절반 지점에 예약한다.
    바로 흘리면 run() 의 await asyncio.sleep(PROBE_SECONDS) 를 통째로 지워도 테스트가
    초록으로 남는다.
    """

    def __init__(self, room: _VoiceRoom, *, conn: _Conn | None = None, ssrc_map=None,
                 tracks=(), reader_error=None, start_error=None, recording=False) -> None:
        self.channel = room
        self._connection = conn or _Conn()
        self._ssrc_to_id = dict(ssrc_map or {70: 7})
        self._reader = _Reader() if recording else None
        self._sink = None
        self._deliver = None
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
        if self._tracks:
            self._deliver = asyncio.get_running_loop().call_later(
                selftest.PROBE_SECONDS / 2, replay, self._tracks, sink.write)

    def stop_recording(self):
        if self._reader is None:
            raise RuntimeError("You are not recording")
        self.stops += 1
        self._recording = False
        if self._deliver is not None:
            self._deliver.cancel()
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
        self._meetings = {} if meetings is None else meetings


class _Guild:
    def __init__(self) -> None:
        self.id = GUILD_ID
        self.me = object()


class _VoiceState:
    def __init__(self, room) -> None:
        self.channel = room


class _Author:
    def __init__(self, room) -> None:
        self.voice = None if room is None else _VoiceState(room)


class _Ctx:
    def __init__(self, room, text, vc) -> None:
        self.guild = _Guild()
        self.author = _Author(room)
        self.channel = text
        self.voice_client = vc


class _Line:
    def __init__(self, final: bool) -> None:
        self.final = final


def _meeting(packets=0, finals=0, nonfinals=0):
    """진행 중인 회의 대역. run() 이 읽는 sink.level_report 와 ledger.lines 만 있다."""

    class _Sink:
        def level_report(self):
            return {"packets": packets, "noise_packets": 0,
                    "peak_rms": 0.21 if packets else 0.0, "speech_rms": 0.006}

    class _Ledger:
        lines = [_Line(True)] * finals + [_Line(False)] * nonfinals

    class _Meeting:
        sink = _Sink()
        ledger = _Ledger()

    return _Meeting()


def _world(monkeypatch, *, guild_id="777", intents=None, perms=None, in_voice=True,
           conn=None, tracks=None, reader_error=None, start_error=None, recording=False,
           send_error=None, delete_error=None, meetings=None, has_vc=True, members=None):
    """기본은 전부 정상인 세계. 테스트마다 하나씩만 망가뜨린다."""
    monkeypatch.setenv("DISCORD_GUILD_ID", guild_id)
    monkeypatch.setattr(selftest, "PROBE_SECONDS", 0.05)

    room = _VoiceRoom(perms, members=members or [_Member(7, "김환")])
    if tracks is None:
        tracks = [ReplayTrack(user_id=7, name="김환", samples=_tone(200), ssrc=70)]
    vc = _VC(room, conn=conn, tracks=tracks, reader_error=reader_error,
             start_error=start_error, recording=recording) if has_vc else None
    text = _TextChannel(send_error, delete_error)
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


def _row(report: str, step: str) -> str:
    """단계 한 줄을 꺼낸다. 표시는 'OK  ' 4칸, '실패'·'정보' 2칸으로 폭이 다르다."""
    for ln in _lines(report):
        for mark in ("OK  ", "실패", "정보"):
            if ln.startswith(mark) and ln[len(mark):].lstrip().startswith(step):
                return ln
    raise AssertionError(f"'{step}' 줄이 리포트에 없다:\n{report}")


def _failed(report: str) -> list[str]:
    """실패한 줄만. 'in out' 으로 '실패' 를 찾으면 복호화 실패 카운트 같은 본문에 걸린다."""
    return [ln for ln in _lines(report) if ln.startswith("실패")]


# ------------------------------------------------------------------ 정상 세계


async def test_healthy_world_reports_no_failure(monkeypatch):
    cog, ctx, vc, text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _failed(out) == [], out
    assert vc.starts == 1 and vc.stops == 1
    # 줄이 하나 늘 때마다 잘림에 가까워진다. 잘리는 쪽은 맨 아래 STT 왕복 줄이다.
    assert "(잘림)" not in out


async def test_write_probe_sends_edits_then_deletes(monkeypatch):
    """권한 비트가 맞는데도 못 보내는 경우를 잡으려면 실제로 보내 봐야 한다."""
    cog, ctx, vc, text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert (len(text.sent), text.edited, text.deleted) == (1, 1, 1)
    assert "채널 쓰기" in out and "전송·편집 확인" in out
    assert "확인 메시지 정리" not in out


async def test_undeletable_probe_message_is_flagged_without_failing_the_write(monkeypatch):
    """지우기가 실패해도 쓰기는 된 것이다. 대신 팀 채널에 남은 메시지를 알려야 한다."""
    cog, ctx, _vc, text = _world(monkeypatch, delete_error=PermissionError("Missing Permissions"))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _row(out, "채널 쓰기").startswith("OK")
    assert "확인 메시지를 못 지웠다" in out
    assert text.deleted == 0


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


async def test_dead_poller_does_not_claim_the_connection_is_missing(monkeypatch):
    """연결은 멀쩡히 있고 폴러만 죽은 상태다. '음성 연결이 없어' 는 거짓말이다."""
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(runner_done=True))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "음성 채널에 없어" not in out
    assert "음성 WS 폴러가 죽어 확인 못 함" in out


# ------------------------------------- 앞 단계가 없어 못 본 단계는 실패가 아니다


async def test_missing_voice_connection_prints_no_dave_or_audio_remediation(monkeypatch):
    """/join 을 안 친 사람에게 py-cord 브랜치와 SERVER MEMBERS 를 안내하면 안 된다.

    이 명령이 엉뚱한 길로 보내면 무증상 침묵보다 나쁘다.
    """
    cog, ctx, vc, _text = _world(monkeypatch, has_vc=False)
    assert vc is None and ctx.voice_client is None

    out = await selftest.run(cog, ctx, use_stt=False)

    assert "실패 음성 연결" in out                      # 진짜 원인은 여기 한 줄
    assert _row(out, "DAVE").startswith("정보")
    assert _row(out, "오디오 수신").startswith("정보")
    assert "PR #3159" not in out
    assert "SERVER MEMBERS 인텐트 누락" not in out
    assert "/record 나 /join 을 먼저 실행" in out


async def test_author_not_in_voice_is_information_not_failure(monkeypatch):
    """확인을 못 한 것이지 권한이 없는 것이 아니다. 역할 권한 안내를 붙이면 틀린 안내다."""
    cog, ctx, _vc, _text = _world(monkeypatch, in_voice=False)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _row(out, "음성 채널 권한").startswith("정보")
    assert "음성 채널에 들어가서 다시 실행" in out
    assert "서버 설정 → 역할에서" not in out


async def test_prerequisite_skips_do_not_block_the_paid_stage_on_their_own(monkeypatch,
                                                                          counting_stt):
    """건너뛴 단계가 all_ok() 를 떨어뜨리면 STT 와 무관한 이유로 유료 단계가 막힌다.

    여기서는 진짜 실패가 하나도 없다. 음성 채널에 안 들어갔을 뿐이다.
    """
    cog, ctx, _vc, _text = _world(monkeypatch, in_voice=False)
    out = await selftest.run(cog, ctx, use_stt=True)
    assert _failed(out) == [], out
    assert counting_stt.calls == [16_000]


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


async def test_stale_decryption_key_fails_although_dave_looks_healthy(monkeypatch):
    """재연결로 키가 어긋나면 ready=True · downgraded=False 인 채 실패만 쌓인다.

    통계를 판정에 안 넣으면 이 상태가 OK 로 뜬다. 무음 원인 중 하나가 통째로 안 보인다.
    소스로만 확인했고 실제 재연결로 관측하지는 않았다.
    """
    dave = _Dave(ready=True, stats={7: _Stats(successes=0, failures=40)})
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=dave, downgraded=False))

    out = await selftest.run(cog, ctx, use_stt=False)

    assert "실패 DAVE" in out
    assert "복호화 성공0/실패40" in out
    assert "키가 어긋난 것" in out


async def test_transient_decryption_failure_does_not_fail_dave(monkeypatch):
    """카운터가 누적인지 구간인지 모른다. 실패 0을 요구하면 키 수립 중 한두 건 때문에
    멀쩡한 회의가 영구히 실패로 뜨고 유료 단계까지 닫힌다. 성공이 0인지만 본다.
    """
    dave = _Dave(ready=True, stats={7: _Stats(successes=120, failures=3)})
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=dave))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _row(out, "DAVE").startswith("OK")
    assert "복호화 성공120/실패3" in out


async def test_ready_dave_with_clean_stats_reports_ok(monkeypatch):
    dave = _Dave(ready=True, stats={7: _Stats(successes=120, failures=0)})
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=dave))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "OK   DAVE" in out
    assert "김환 성공120/실패0" in out


async def test_absent_dave_session_fails(monkeypatch):
    """PyPI 정식판이면 세션 자체가 없다. 이때가 py-cord 버전 안내가 맞는 유일한 경우다."""
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=None))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 DAVE" in out
    assert "dave=False ready=False" in out
    assert "PR #3159" in out


_NO_DECRYPTOR = "Failed to get decryption stats: NoDecryptorForUser"


async def test_member_without_decryption_stats_does_not_end_the_command(monkeypatch):
    """멤버 한 명에서 raise 가 나면 명령이 통째로 거기서 끝났다.

    실제 실행에서 '실패 자체 점검' 한 줄만 남고 뒤 단계가 전부 사라졌다.
    """
    dave = _Dave(ready=True, stats={7: ValueError(_NO_DECRYPTOR)})
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=dave))

    out = await selftest.run(cog, ctx, use_stt=False)

    assert _row(out, "DAVE")
    assert "자체 점검" not in out
    assert "NoDecryptorForUser" not in out
    assert "OK   채널 쓰기" in out          # DAVE 뒤 단계까지 실제로 갔다


async def test_a_member_without_stats_does_not_hide_another_members_counts(monkeypatch):
    """통계를 낸 사람이 한 명이라도 있으면 그 수치는 그대로 나와야 한다."""
    dave = _Dave(ready=True, stats={7: ValueError(_NO_DECRYPTOR),
                                    8: _Stats(successes=120, failures=0)})
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=dave),
                                  members=[_Member(7, "김환"), _Member(8, "이준")])

    out = await selftest.run(cog, ctx, use_stt=False)

    assert _row(out, "DAVE").startswith("OK")
    assert "복호화 성공120/실패0" in out
    assert "이준 성공120/실패0" in out
    assert "통계 보고 1/2명" in out


async def test_dave_does_not_pass_when_no_member_reported_stats(monkeypatch):
    """아무도 통계를 안 내면 실패 0건은 '괜찮다' 가 아니라 '못 쟀다' 다.

    OK 로 적으면 복호화를 확인한 적이 없는데 확인한 것처럼 읽힌다.
    """
    dave = _Dave(ready=True, stats={7: ValueError(_NO_DECRYPTOR),
                                    8: ValueError(_NO_DECRYPTOR)})
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=dave),
                                  members=[_Member(7, "김환"), _Member(8, "이준")])

    out = await selftest.run(cog, ctx, use_stt=False)

    row = _row(out, "DAVE")
    assert row.startswith("정보")
    assert "통계 보고 0/2명" in row
    assert "확인하지 못했다" in row
    assert _failed(out) == [], out


async def test_stats_polling_stops_at_the_member_cap(monkeypatch):
    """리포트가 디스코드 2000자 한도에 들어가야 해서 앞쪽 인원만 읽는다."""
    n = selftest.DAVE_STATS_MEMBERS + 2
    dave = _Dave(ready=True, stats={i: _Stats(successes=1, failures=0) for i in range(n)})
    cog, ctx, _vc, _text = _world(monkeypatch, conn=_Conn(dave=dave),
                                  members=[_Member(i, f"사람{i}") for i in range(n)])

    out = await selftest.run(cog, ctx, use_stt=False)

    cap = selftest.DAVE_STATS_MEMBERS
    assert f"통계 보고 {cap}/{cap}명" in out
    assert f"사람{n - 1}" not in out


# ------------------------------------------------------ 감지기: 이벤트 루프 디버그


async def test_loop_debug_mode_is_reported_as_a_failure(monkeypatch):
    """디버그가 켜져 있으면 교차 스레드 create_task 가 패킷마다 터지고 라이브러리가 삼킨다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    asyncio.get_running_loop().set_debug(True)
    try:
        out = await selftest.run(cog, ctx, use_stt=False)
    finally:
        asyncio.get_running_loop().set_debug(False)
    assert "실패 이벤트 루프" in out
    assert "PYTHONASYNCIODEBUG" in out


async def test_loop_debug_off_reports_ok(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "OK   이벤트 루프" in out


# --------------------------------------------------------- 감지기: 오디오 수신


async def test_audio_stage_reports_ok_when_packets_arrive(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "OK   오디오 수신" in out
    assert "(음성 0, 잡음 0)" not in out


async def test_packets_must_arrive_during_the_probe_window_not_before_it(monkeypatch):
    """대역이 프로브 창 절반 지점에 패킷을 넣는다. sleep 을 지우면 0건이 된다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    monkeypatch.setattr(selftest, "PROBE_SECONDS", 0.2)
    out = await selftest.run(cog, ctx, use_stt=False)
    row = _row(out, "오디오 수신")
    assert row.startswith("OK")
    assert "패킷 10 (음성 10, 잡음 0)" in row
    assert "0.2초 동안" in row


async def test_chosen_seconds_reaches_both_the_wait_and_the_report(monkeypatch):
    """둘 중 하나만 닿으면 사용자는 3초라고 적힌 10초 결과를 보거나 그 반대를 본다.

    _world 는 PROBE_SECONDS 를 0.05 로 눌러 둔다. 고른 값이 상수를 실제로 밀어내야
    대기도 문구도 0.3 이 된다.
    """
    import time

    cog, ctx, _vc, _text = _world(monkeypatch)
    t0 = time.monotonic()
    out = await selftest.run(cog, ctx, use_stt=False, seconds=0.3)
    elapsed = time.monotonic() - t0

    row = _row(out, "오디오 수신")
    assert "0.3초 동안" in row
    assert "0.05초" not in row
    assert elapsed >= 0.25, f"{elapsed:.3f}초만 기다렸다 — 대기가 고른 값을 안 읽는다"
    assert "패킷 10 (음성 10, 잡음 0)" in row      # 창 안에 패킷이 실제로 들어왔다


async def test_omitted_seconds_falls_back_to_the_module_constant(monkeypatch):
    """옵션을 안 주면 PROBE_SECONDS 가 기본이다. 그래야 상수를 바꾸면 기본이 따라온다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    monkeypatch.setattr(selftest, "PROBE_SECONDS", 0.12)
    out = await selftest.run(cog, ctx, use_stt=False, seconds=None)
    assert "0.12초 동안" in _row(out, "오디오 수신")


async def test_audio_stage_fails_when_no_packet_arrives_in_the_probe(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, tracks=[])
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 오디오 수신" in out
    assert "패킷 0 (음성 0, 잡음 0)" in out


async def test_reader_error_is_read_before_stop_recording_wipes_it(monkeypatch):
    """write 예외는 패킷 하나가 아니라 녹음 세션 전체를 끝낸다 (reader.py:273-281).

    그 흔적은 reader.error 뿐인데 stop_recording 이 _reader 를 MISSING 으로 되돌리므로
    (voice/client.py:788-790) 정지 뒤에 읽으면 영영 None 이다.
    """
    cog, ctx, _vc, _text = _world(monkeypatch, reader_error=ValueError("복호화 실패"))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _row(out, "sink 전달").startswith("실패")
    assert "reader 오류 ValueError: 복호화 실패" in out


async def test_reader_error_points_at_the_sink_row_not_at_dave_or_intents(monkeypatch):
    """패킷 수로는 수신을 판정할 수 없는 상태다. 여기서 실패로 적으면 엉뚱한 안내가 붙는다."""
    cog, ctx, _vc, _text = _world(monkeypatch, reader_error=ValueError("복호화 실패"))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _row(out, "오디오 수신").startswith("정보")
    assert "아래 sink 전달을 보세요" in out
    assert "SERVER MEMBERS 인텐트 누락" not in out
    assert "write 예외는 패킷 하나가 아니라" in out


async def test_receive_internals_are_read_before_the_probe_stops(monkeypatch):
    """정지하면 _reader 가 사라져 router_alive 가 영영 '-' 다. err 와 같은 함정이다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "router_alive=True" in out
    assert "router_alive=-" not in out


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


# --------------------------------------------------- 감지기: PCM 크기 · sink 전달


async def test_wrong_packet_size_is_a_failure_not_a_note(monkeypatch):
    """전부 잘못된 길이로 와도 정보로만 찍으면 사용자는 아무 신호를 못 받는다."""

    class _Odd:
        pcm = b"\x11\x22" * 400        # 800바이트, 3840 이 아니다

        class packet:
            timestamp = 1

        class source:
            id = 7
            display_name = "김환"

    cog, ctx, vc, _text = _world(monkeypatch, tracks=[])
    monkeypatch.setattr(vc, "_tracks", [])
    orig = vc.start_recording

    def _start(sink, callback, *args):
        orig(sink, callback, *args)
        for _ in range(5):
            sink.write(_Odd, _Odd.source)

    monkeypatch.setattr(vc, "start_recording", _start)

    out = await selftest.run(cog, ctx, use_stt=False)

    assert _row(out, "PCM 크기").startswith("실패")
    assert f"0/5 이 {PCM_20MS_BYTES}바이트" in out
    assert "pcm_to_mono16k" in out


async def test_correct_packet_size_reports_ok(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _row(out, "PCM 크기").startswith("OK")
    assert f"10/10 이 {PCM_20MS_BYTES}바이트" in out


async def test_sink_delivery_fails_when_packets_arrive_but_nothing_is_handed_on(monkeypatch):
    """sink 가 받고도 세션으로 안 넘기면 전사 줄이 통째로 사라진다."""
    cog, ctx, _vc, _text = _world(monkeypatch)

    class _Deaf(selftest._ProbeSink):
        def cleanup(self):
            self.finished = True      # drain 을 건너뛴다 = 세션으로 아무것도 안 간다

    monkeypatch.setattr(selftest, "_ProbeSink", _Deaf)
    out = await selftest.run(cog, ctx, use_stt=False)

    assert _row(out, "sink 전달").startswith("실패")
    assert "sink → session 0건" in out
    assert CAUSES["sink 전달"][:25] in out          # 이름을 바꾸면 안내가 조용히 떨어진다


async def test_sink_delivery_reports_ok_on_a_healthy_probe(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _row(out, "sink 전달").startswith("OK")
    assert "sink → session 10건" in out


# ------------------------------------------------------------ 감지기: 전송 방식


def _clocked_probe(monkeypatch, times):
    """프로브 sink 의 도착 시각을 미리 정한다.

    대역은 패킷을 한 번에 흘리므로 실제 시계로는 전부 같은 순간에 도착한 것이 된다.
    공백이 있는 세계를 만들려면 시각을 직접 쥐어야 한다.
    """

    class _Clocked(selftest._ProbeSink):
        def __init__(self) -> None:
            super().__init__()
            self._times = list(times)
            self._clock = {"now_ms": 0}
            self.now_ms = lambda: self._clock["now_ms"]

        def write(self, data, user):
            if self._times:
                self._clock["now_ms"] = self._times.pop(0)
            super().write(data, user)

    monkeypatch.setattr(selftest, "_ProbeSink", _Clocked)


def _clocked_probe_by_speaker(monkeypatch, times):
    """화자마다 도착 시각을 따로 쥔다. 스트림이 둘인 방은 이렇게만 만들 수 있다."""

    class _Clocked(selftest._ProbeSink):
        def __init__(self) -> None:
            super().__init__()
            self._queues = {uid: list(ts) for uid, ts in times.items()}
            self._clock = {"now_ms": 0}
            self.now_ms = lambda: self._clock["now_ms"]

        def write(self, data, user):
            q = self._queues.get(getattr(user, "id", user))
            if q:
                self._clock["now_ms"] = q.pop(0)
            super().write(data, user)

    monkeypatch.setattr(selftest, "_ProbeSink", _Clocked)


_GAPPY = [0, 20, 40, 300, 320, 340, 600, 620, 640, 660]     # 260ms 공백 둘
_EVEN = [20 * i for i in range(10)]
# 전부 1초를 넘는다. 숨 쉬는 간격이 아니라 말할 차례가 바뀐 자리 쪽이다.
_TURN_GAPS = [0, 20, 40, 1600, 1620, 1640, 2900, 2920, 2940, 2960]
# 숨 크기 둘에 큰 것 하나가 섞인 모양.
_GAPPY_PLUS_TURN = [0, 20, 40, 300, 320, 340, 600, 620, 640, 2300]
_SECOND_STREAM = [0, 1500, 2900]                            # 1500ms, 1400ms 공백


def _two_stream_tracks():
    """말한 사람(또렷하다 조용해짐)과, 거의 말하지 않는 두 번째 스트림."""
    return [ReplayTrack(user_id=7, name="김환",
                        samples=np.concatenate([_tone(100), _tone(100, amp=0.002)]), ssrc=70),
            ReplayTrack(user_id=8, name="둘째", samples=_tone(60, amp=0.002), ssrc=80)]


def _quiet_track():
    """잡음 필터는 통과하지만 RMS 가 임계 아래인 진짜 오디오."""
    return [ReplayTrack(user_id=7, name="김환", samples=_tone(200, amp=0.002), ssrc=70)]


def _mixed_track():
    """또렷한 말 5패킷 뒤에 조용한 5패킷. 말하는 중에 잠깐 조용해진 모양이다."""
    samples = np.concatenate([_tone(100), _tone(100, amp=0.002)])
    return [ReplayTrack(user_id=7, name="김환", samples=samples, ssrc=70)]


async def test_gaps_without_quiet_packets_point_at_min_speech_ms(monkeypatch):
    """온 패킷이 전부 말이면 우리 쪽 임계가 짧은 응답을 죽이고 있는 것이다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    _clocked_probe(monkeypatch, _GAPPY)
    out = await selftest.run(cog, ctx, use_stt=False)
    row = _row(out, "전송 방식")
    assert "공백 2건" in row and "최대 260ms" in row and "중앙값 260ms" in row
    assert "조용한 패킷 0" in row
    assert "MIN_SPEECH_MS" in row
    assert "히스테리시스" not in row


async def test_quiet_packets_without_gaps_point_at_hysteresis(monkeypatch):
    """끊김 없이 오는데 조용한 패킷이 섞이면 경계를 우리가 찾아야 한다."""
    cog, ctx, _vc, _text = _world(monkeypatch, tracks=_mixed_track())
    _clocked_probe(monkeypatch, _EVEN)
    out = await selftest.run(cog, ctx, use_stt=False)
    row = _row(out, "전송 방식")
    assert "공백 0건" in row and "조용한 패킷 5" in row
    assert "히스테리시스" in row
    assert "MIN_SPEECH_MS" not in row


async def test_all_quiet_run_is_a_gain_problem_not_an_answer(monkeypatch):
    """한 패킷도 임계를 못 넘은 실행이다. 여기에 히스테리시스를 고치라고 적으면
    마이크 볼륨 문제를 들고 온 사람을 엉뚱한 코드로 보낸다."""
    cog, ctx, _vc, _text = _world(monkeypatch, tracks=_quiet_track())
    _clocked_probe(monkeypatch, _EVEN)
    out = await selftest.run(cog, ctx, use_stt=False)
    row = _row(out, "전송 방식")
    assert "조용한 패킷 10" in row
    assert "임계 아래" in row and "재지 못했다" in row
    assert "히스테리시스" not in row and "MIN_SPEECH_MS" not in row


async def test_both_signals_together_do_not_pick_a_side(monkeypatch):
    """모순된 관측을 한쪽 근거로 적으면 이 줄이 재는 것보다 나쁜 일을 한다."""
    cog, ctx, _vc, _text = _world(monkeypatch, tracks=_mixed_track())
    _clocked_probe(monkeypatch, _GAPPY)
    out = await selftest.run(cog, ctx, use_stt=False)
    row = _row(out, "전송 방식")
    assert "공백 2건" in row and "조용한 패킷 5" in row
    assert "갈리지 않았다" in row
    assert "MIN_SPEECH_MS" not in row and "히스테리시스" not in row


async def test_silent_probe_says_it_measured_nothing(monkeypatch):
    """프로브 동안 아무도 말하지 않은 실행이 어느 한쪽 근거로 읽히면 안 된다."""
    cog, ctx, _vc, _text = _world(monkeypatch, tracks=[])
    out = await selftest.run(cog, ctx, use_stt=False)
    row = _row(out, "전송 방식")
    assert "재지 못했다" in row and "어느 쪽 근거도 아니다" in row
    assert "MIN_SPEECH_MS" not in row and "히스테리시스" not in row


async def test_cut_short_probe_is_not_evidence_either(monkeypatch):
    """write 예외는 녹음 세션 전체를 끝낸다. 그 뒤 숫자는 3초치가 아니다."""
    cog, ctx, _vc, _text = _world(monkeypatch, reader_error=ValueError("복호화 실패"))
    _clocked_probe(monkeypatch, _GAPPY)
    out = await selftest.run(cog, ctx, use_stt=False)
    row = _row(out, "전송 방식")
    assert "근거가 못 된다" in row
    assert "MIN_SPEECH_MS" not in row and "히스테리시스" not in row


async def test_transmission_row_reads_the_dominant_speaker_not_the_aggregate(monkeypatch):
    """실제 실행 둘이 '갈리지 않았다' 로 나온 이유가 이 세계다.

    거의 말하지 않는 두 번째 스트림의 1.5초 공백이 집계에 섞여 말한 사람의 공백
    0건을 덮었다. 화자별로 읽으면 같은 입력이 한쪽으로 갈린다.
    """
    cog, ctx, _vc, _text = _world(monkeypatch, tracks=_two_stream_tracks())
    _clocked_probe_by_speaker(monkeypatch, {7: _EVEN, 8: _SECOND_STREAM})
    out = await selftest.run(cog, ctx, use_stt=False)

    assert "패킷 13 (음성 13" in _row(out, "오디오 수신")   # 두 스트림이 다 들어왔다
    row = _row(out, "전송 방식")
    assert "화자 2명" in row
    assert "공백 0건" in row and "조용한 패킷 5" in row
    assert "1500" not in row and "1400" not in row          # 집계 공백이 새면 안 된다
    assert "히스테리시스" in row
    assert "갈리지 않았다" not in row


async def test_gaps_too_large_to_be_breaths_are_not_min_speech_evidence(monkeypatch):
    """숨 쉬는 간격은 200~500ms다. 1.5초는 말이 끊긴 게 아니라 차례가 바뀐 자리다.

    건수만 세면 둘이 같은 근거가 되고, 이 줄을 읽는 사람이 VAD 를 엉뚱하게 고친다.
    """
    cog, ctx, _vc, _text = _world(monkeypatch)
    _clocked_probe(monkeypatch, _TURN_GAPS)
    out = await selftest.run(cog, ctx, use_stt=False)
    row = _row(out, "전송 방식")
    assert "공백 2건" in row and "최대 1560ms" in row
    assert "숨 크기 0건" in row
    assert f"{selftest.BREATH_GAP_MS}ms 를 넘어" in row
    assert "MIN_SPEECH_MS" not in row and "히스테리시스" not in row


async def test_one_oversized_gap_does_not_cancel_the_breath_sized_ones(monkeypatch):
    """숨 크기 공백이 충분히 나왔으면 큰 공백 하나가 섞였다고 근거가 없어지지 않는다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    _clocked_probe(monkeypatch, _GAPPY_PLUS_TURN)
    out = await selftest.run(cog, ctx, use_stt=False)
    row = _row(out, "전송 방식")
    assert "공백 3건" in row and "최대 1660ms" in row
    assert "숨 크기 2건" in row
    assert "MIN_SPEECH_MS" in row


async def test_transmission_row_never_fails_the_run(monkeypatch):
    """관측 줄이다. 여기서 판정을 내면 멀쩡한 회의가 실패로 뜬다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    _clocked_probe(monkeypatch, _GAPPY)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _row(out, "전송 방식").startswith("정보")
    assert _failed(out) == [], out


# ------------------------------------------------------------- 진행 중인 회의


async def test_running_meeting_with_no_speech_yet_is_not_a_failure(monkeypatch):
    """회의가 막 시작돼 아무도 말하지 않은 순간을 실패로 적으면 엉뚱한 원인이 뜬다."""
    cog, ctx, vc, _text = _world(monkeypatch, meetings={GUILD_ID: _meeting(packets=0)})
    out = await selftest.run(cog, ctx, use_stt=False)
    assert vc.starts == 0
    assert "아직 발화 없음" in out
    assert _row(out, "오디오 수신").startswith("정보")
    assert _row(out, "VAD 확정").startswith("정보")


async def test_running_meeting_with_packets_reports_levels_and_final_lines(monkeypatch):
    cog, ctx, vc, _text = _world(monkeypatch,
                                 meetings={GUILD_ID: _meeting(packets=250, finals=3, nonfinals=2)})
    out = await selftest.run(cog, ctx, use_stt=False)
    assert vc.starts == 0
    assert _row(out, "오디오 수신").startswith("OK")
    assert "회의 진행 중 · 패킷 250 · 최대 RMS 0.210 (임계 0.006)" in out
    assert _row(out, "VAD 확정").startswith("OK")
    assert "확정 발화 3건" in out          # final=False 두 건은 세지 않는다


async def test_running_meeting_with_packets_but_no_final_line_is_not_a_failure(monkeypatch):
    """발화가 아직 안 끝났거나 워커가 요청 중인 순간이다. 회의 도중 실행은 흔한 일이다."""
    cog, ctx, _vc, _text = _world(monkeypatch,
                                  meetings={GUILD_ID: _meeting(packets=250, nonfinals=4)})
    out = await selftest.run(cog, ctx, use_stt=False)
    assert _row(out, "VAD 확정").startswith("정보")
    assert "아직 확정된 발화 없음" in out
    assert _failed(out) == []


# ------------------------------------------------------- 감지기: 인텐트·권한·등록


async def test_missing_members_intent_fails(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, intents=_Intents(members=False))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 인텐트" in out
    assert "SERVER MEMBERS" in out


async def test_missing_voice_states_intent_fails(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, intents=_Intents(voice_states=False))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 인텐트" in out
    assert "voice_states=False" in out


async def test_message_content_intent_is_a_note_and_does_not_gate_the_paid_stage(monkeypatch,
                                                                                counting_stt):
    """MESSAGE CONTENT 가 켜져 있어도 전사는 된다. 위생 문제라 유료 단계를 막으면 안 된다."""
    cog, ctx, _vc, _text = _world(monkeypatch, intents=_Intents(message_content=True))
    out = await selftest.run(cog, ctx, use_stt=True)
    assert _row(out, "인텐트").startswith("OK")
    assert _row(out, "메시지 본문 인텐트").startswith("정보")
    assert "message_content=True · 전사에는 지장 없지만 꺼 두는 것이 낫다" in out
    assert counting_stt.calls == [16_000]


async def test_message_content_off_carries_no_advisory(monkeypatch):
    """정보 행이라 ok 값은 화면에 안 나온다. 실제로 신호를 지는 것은 이 꼬리말이다."""
    cog, ctx, _vc, _text = _world(monkeypatch, intents=_Intents(message_content=False))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "message_content=False" in out
    assert "꺼 두는 것이 낫다" not in out


async def test_intent_row_says_it_reports_what_the_code_requested(monkeypatch):
    """포털 토글이 아니라 코드가 요청한 값이다. 둘을 헷갈리면 엉뚱한 곳을 고친다."""
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "코드가 요청한 값" in _row(out, "인텐트")


async def test_missing_connect_permission_names_it(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, perms=_Perms(view_channel=True, connect=False))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 음성 채널 권한" in out
    assert "없음: 연결" in out


async def test_missing_view_channel_permission_names_it(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, perms=_Perms(view_channel=False, connect=True))
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 음성 채널 권한" in out
    assert "없음: 채널 보기" in out


async def test_blank_guild_id_warns_about_the_one_hour_delay_and_invite_scope(monkeypatch):
    cog, ctx, _vc, _text = _world(monkeypatch, guild_id="")
    out = await selftest.run(cog, ctx, use_stt=False)
    assert "실패 슬래시 명령 등록" in out
    assert "최대 1시간" in out
    assert "applications.commands" in out


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
    assert "최소 과금 단위는 확인하지 못했다" in out
    assert _failed(out) == []


async def test_stt_runs_once_on_a_healthy_run_when_asked(monkeypatch, counting_stt):
    cog, ctx, _vc, _text = _world(monkeypatch)
    out = await selftest.run(cog, ctx, use_stt=True)
    assert counting_stt.calls == [16_000]     # 1.0초
    assert "OK   STT 왕복" in out
    assert "0.1원 지출" in out                 # 쓴 돈은 기록에 남는다
    assert selftest.COST_CAVEAT in out         # 금액이 나오는 자리마다 같이 간다


async def test_stt_is_skipped_when_an_earlier_stage_failed(monkeypatch, counting_stt):
    """연결도 안 되는 상태에서 유료 API 를 부를 이유가 없다."""
    cog, ctx, _vc, _text = _world(monkeypatch, intents=_Intents(members=False))
    out = await selftest.run(cog, ctx, use_stt=True)
    assert counting_stt.calls == []
    assert "앞 단계가 실패해 건너뜀" in out


async def test_stt_is_blocked_by_a_failing_audio_stage_too(monkeypatch, counting_stt):
    """게이트를 인텐트 하나로만 증명하면 all_ok() 의 info 필터를 넓히는 변형이 그냥 지나간다.

    여기서는 인텐트가 멀쩡하고 오디오 수신만 실패한다.
    """
    cog, ctx, _vc, _text = _world(monkeypatch, tracks=[])
    out = await selftest.run(cog, ctx, use_stt=True)
    assert _row(out, "오디오 수신").startswith("실패")
    assert _row(out, "인텐트").startswith("OK")
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
    # 요청이 나가기 전에 죽은 경우다. 돈을 썼다고 적으면 거짓말이다.
    assert "지출" not in out
    assert "호출을 시도했다" in out
    assert selftest.COST_CAVEAT in out


async def test_stt_round_trip_does_not_block_the_event_loop(monkeypatch):
    """동기 HTTP 왕복을 루프에서 부르면 왕복 내내 음성 하트비트까지 멈춘다.

    전사가 루프에 있는 태스크의 신호를 기다리게 만든다. 스레드로 뺐으면 루프가 계속
    돌아 신호가 오고, 루프에서 그대로 불렀으면 신호를 세울 태스크가 영영 못 돌아
    전사가 대기 시한에 걸린다. 경과 시간으로 재면 run() 의 다른 await 들이 하트비트를
    대신 돌려 줘서 동어반복이 된다.
    """
    import threading

    entered = threading.Event()
    released = threading.Event()

    class _Blocking:
        def __init__(self, *a, **k):
            pass

        def transcribe(self, samples, sample_rate):
            entered.set()
            if not released.wait(timeout=2.0):
                raise SttError("루프가 막혀 해제 신호가 오지 않았다")
            return SttResult(text="해제됨", words=[])

    async def _release():
        # 고정 대기로 풀면 그사이 run() 이 STT 에 닿기 전에 해제가 끝나 버릴 수 있다.
        # 그러면 전사가 루프에 있어도 통과한다. 실제로 들어온 뒤에만 푼다.
        for _ in range(400):
            if entered.is_set():
                released.set()
                return
            await asyncio.sleep(0.005)

    monkeypatch.setattr(elice_mod, "EliceStt", _Blocking)
    cog, ctx, _vc, _text = _world(monkeypatch)

    releaser = asyncio.create_task(_release())
    out = await selftest.run(cog, ctx, use_stt=True)
    await releaser

    assert "OK   STT 왕복" in out
    assert "해제됨" in out


# ------------------------------------------------------------------ 안내 문구


async def test_every_failed_step_in_a_run_is_followed_by_a_remediation_line(monkeypatch):
    """실패했는데 다음에 뭘 하면 되는지 안 붙으면 이 명령은 없는 것과 같다.

    run() 이 실제로 쓰는 단계 이름을 CAUSES 에 안 넣으면 여기서 걸린다. CAUSES 를
    순회하는 단위 테스트는 그걸 못 잡는다 — 없는 이름은 순회 대상이 아니다.
    """
    worlds = [
        {"guild_id": "", "intents": _Intents(members=False)},
        {"intents": _Intents(voice_states=False)},
        {"conn": _Conn(runner_done=True)},
        {"conn": _Conn(dave=_Dave(ready=False))},
        {"conn": _Conn(dave=None)},
        {"conn": _Conn(dave=_Dave(stats={7: _Stats(successes=0, failures=9)}))},
        {"tracks": []},
        {"perms": _Perms(view_channel=False, connect=False)},
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


# ------------------------------------------------------------------ 예외 내성


async def test_an_exception_mid_run_still_returns_the_earlier_rows(monkeypatch):
    """리포트가 통째로 사라지면 사용자는 이 명령이 없애려던 화면을 그대로 본다."""

    class _Boom(dict):
        def get(self, key, default=None):
            raise RuntimeError("표 조회 실패")

    cog, ctx, _vc, _text = _world(monkeypatch, meetings=_Boom())
    out = await selftest.run(cog, ctx, use_stt=False)

    assert "OK   슬래시 명령 등록" in out          # 앞 단계 결과가 살아 있다
    assert "OK   인텐트" in out
    assert "실패 자체 점검" in out
    assert "'이벤트 루프' 다음에서 RuntimeError: 표 조회 실패" in out
    assert "위 단계까지는 실제 결과" in out


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
    assert "_defer(ctx)" in src               # _defer 가 ctx.defer() 를 감싼다
    assert src.index("_defer(ctx)") < src.index("st.run(")


class _FakeCtx:
    """콜백 배선만 보는 인터랙션 대역. defer 와 followup 만 있으면 된다."""

    class _Followup:
        def __init__(self):
            self.sent = []

        async def send(self, text):
            self.sent.append(text)

    def __init__(self):
        self.followup = self._Followup()
        self.deferred = 0

    async def defer(self):
        self.deferred += 1


async def test_selftest_command_passes_the_stt_flag_through(monkeypatch):
    """옵션이 본문까지 안 내려가면 유료 호출 게이트 전체가 무의미하다."""
    import capture.discord_adapter as adapter

    seen = []

    async def _fake_run(cog, ctx, use_stt=False, seconds=None):
        seen.append(use_stt)
        return "리포트"

    monkeypatch.setattr(selftest, "run", _fake_run)
    ctx = _FakeCtx()
    await adapter.RecordingCog.selftest.callback(object(), ctx, stt=True)
    assert seen == [True]
    assert ctx.deferred == 1
    assert ctx.followup.sent == ["리포트"]

    await adapter.RecordingCog.selftest.callback(object(), _FakeCtx())
    assert seen == [True, False]


async def test_selftest_command_passes_the_seconds_option_through(monkeypatch):
    """옵션이 본문까지 안 내려가면 사용자가 고른 길이가 조용히 버려진다."""
    import capture.discord_adapter as adapter

    seen = []

    async def _fake_run(cog, ctx, use_stt=False, seconds=None):
        seen.append(seconds)
        return "리포트"

    monkeypatch.setattr(selftest, "run", _fake_run)
    await adapter.RecordingCog.selftest.callback(object(), _FakeCtx(), seconds=12)
    await adapter.RecordingCog.selftest.callback(object(), _FakeCtx())
    assert seen == [12, None]      # 안 주면 run() 이 PROBE_SECONDS 를 쓴다


async def test_seconds_option_declares_its_range_to_discord():
    """범위는 디스코드가 강제한다. 페이로드에서 빠지면 900초짜리 프로브가 그대로 들어온다.

    discord.Bot() 은 만들 때 이벤트 루프를 찾는다 — 동기 테스트에는 루프가 없다.
    """
    import discord

    import capture.discord_adapter as adapter

    bot = discord.Bot(intents=adapter.required_intents())
    bot.add_cog(adapter.RecordingCog(bot))
    cmd = next(c for c in bot.pending_application_commands if c.name == "selftest")

    opt = next(o for o in cmd.options if o.name == "seconds")
    assert (opt.min_value, opt.max_value) == (1, 15)
    assert opt.required is False
    # 기본값을 설명에 적어 두고 상수와 어긋나게 두면 설명이 거짓말이 된다.
    assert f"기본 {selftest.PROBE_SECONDS:g}초" in opt.description

    payload = next(o for o in cmd.to_dict()["options"] if o["name"] == "seconds")
    assert (payload["min_value"], payload["max_value"]) == (1, 15)


def test_probe_sink_does_not_transcribe():
    """프로브에 진짜 Session 을 붙이면 워커 스레드 3개가 뜨고 유료 API 를 부른다."""
    probe = _ProbeSink()
    assert isinstance(probe.session, _NullSession)
    assert not hasattr(probe.session, "final_stt")


def test_probe_seconds_is_three():
    assert selftest.PROBE_SECONDS == 3.0
    assert selftest.STT_PROBE_SECONDS == 1.0
    assert asyncio.iscoroutinefunction(selftest.run)
