"""디스코드 슬래시 명령과 실시간 전사 파이프라인을 잇는다.

"Discord" 라는 이름은 ai/ 안에서 capture/ 밖으로 나가지 않는다 (ai/CLAUDE.md).
봇 프로세스는 여기서 띄우지 않는다. RealtimeCog 와 required_intents() 만 export 하고
backend/bot/main.py 또는 capture/run_realtime.py 가 add_cog 로 붙인다.

capture/discord_adapter.py 의 RecordingCog 와 나란히 놓고 고르라고 만든 두 번째 구현이다.
그쪽은 화자별 wav 를 받아 두고 나중에 오프라인으로 전사하고, 이쪽은 회의 중에 발화마다
전사해 채널에 올린다. 명령 이름이 겹치지 않아 한 봇에 둘 다 붙일 수 있다.

  /live       명령을 친 사람의 음성 채널에 들어가 전사를 시작한다. 줄은 명령을 친 채널에 올라간다
  /live-stop  전사를 끝내고 회의록을 낸 뒤 음성 채널에서 나간다
  /live-join  입장만 (전사는 시작하지 않는다). /selftest 의 수신 프로브가 이 상태를 요구한다
  /selftest   연결·인텐트·권한·DAVE·수신·쓰기를 단계별로 확인한다

봇 계정 하나는 길드마다 음성 연결을 하나만 갖는다. 두 Cog 가 같은 연결을 두고 다투면
리더가 하나뿐이라 오디오가 조용히 어긋난다. 그래서 위 명령은 전부 is_recording(vc) 로
먼저 보고, 우리 것이 아닌 녹음이 돌고 있으면 시작하지도 멈추지도 않는다.

산출물은 recordings/{guild_id}_{ts}/ 아래 transcript.md · transcript.jsonl · latency.jsonl ·
화자별 wav 이고, 매니페스트는 recordings/session_{ts}.json 이다 (stt/transcribe.py 가 찾는 자리).
회의 디렉토리를 오프라인으로 다시 전사할 때는 경로를 직접 준다. 기본 수집이 recordings/ 를
얕게 훑어서 하위 디렉토리를 보지 않는다:  python stt/transcribe.py --audio recordings/<meeting_id>

on_session_saved(payload, jsonl_path) 는 회의록 저장이 끝난 뒤 불린다. payload 는 meeting_id ·
guild_id · session · speakers 와 회의록 경로(markdown, jsonl) 를 담는다. BE 는 여기서 Phase 1/2
호출과 approval_request 생성을 이어 붙이면 된다 — 전사는 이미 끝나 있다.

latency.jsonl 은 발화별 지연이다 = {"seq", "speaker", "start", "end", "queue_s",
"transcribe_s", "publish_s"}. seq 로 transcript.jsonl 과 이어진다. queue_s 는 확정된 발화가
큐에서 기다린 시간, transcribe_s 는 워커가 집어 STT 백엔드가 돌아올 때까지, publish_s 는
게시기로 넘어가 처음 화면에 뜰 때까지이고 셋은 겹치지 않는다. 못 잰 값은 0 이 아니라 null 이다.
transcript.jsonl 은 BE 와 맞춘 계약이라 필드를 늘리지 않고 파일을 나눴다.

DISCORD_CHANNEL_ID 는 이 Cog 가 읽지 않는다. 줄은 /live 를 친 채널(또는 /live channel: 로
고른 채널)에 올라간다.
"""

from __future__ import annotations

import asyncio
import queue
import threading
import time
import traceback
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

import discord
from discord.voice import VoiceClient

from capture.publisher import Publisher
from capture.recording_store import write_manifest
from capture.streaming_sink import StreamingSink
from capture.track_writer import TrackWriter
from shared.config import RECORDINGS_DIR
from stt.elice import EliceStt
from stt.latency import format_summary, snapshot, write_latency
from stt.session import Session
from stt.speech_gate import SpeechGate
from stt.transcript_writer import write_transcript

SessionSavedHook = Callable[[dict, Path], Awaitable[None]]

# 첫 응답이 3초 시한을 넘긴 인터랙션에 무엇이든 보내면 오는 코드 (errors.py:140-143).
UNKNOWN_INTERACTION = 10062


def _command_name(ctx) -> str:
    return getattr(ctx.command, "name", "?")


def _log_interaction_gone(ctx, error: BaseException) -> None:
    print(f"[command] /{_command_name(ctx)}: 봇이 답하기 전에 인터랙션이 만료됐다. "
          f"디스코드에는 아무것도 보낼 수 없어 여기서 끝낸다. 다시 실행하면 대개 된다. "
          f"({type(error).__name__}: {error})", flush=True)


async def _defer(ctx) -> bool:
    """응답 시한 안에 defer 를 넣는다. False 면 부른 쪽은 그 자리에서 끝내야 한다.

    실패하면 토큰이 이미 없어서 respond 도 followup 도 같은 예외를 낸다. 명령을 계속
    진행할 방법이 없으므로 여기서 한 줄만 남기고 돌려보낸다.
    """
    try:
        await ctx.defer()
    except Exception as e:
        _log_interaction_gone(ctx, e)
        return False
    return True


def is_recording(vc) -> bool:
    fn = getattr(vc, "is_recording", None)
    if callable(fn):
        return bool(fn())
    return bool(getattr(vc, "recording", False))


def required_intents() -> discord.Intents:
    """이 Cog 에 필요한 인텐트.

    message_content 는 켜지 않는다. 특권 인텐트인데 (flags.py:1150) 우리는 슬래시 명령만
    쓰고 메시지 본문을 읽지 않는다. 코드에서 켜고 개발자 포털에서 안 켜면 게이트웨이가
    4014 로 끊고 PrivilegedIntentsRequired 로 봇이 기동 즉시 죽는다 (errors.py:239-264).
    members 는 남긴다 — 매니페스트의 표시 이름을 guild.get_member 로 얻는다.
    voice_states 는 default() 에 이미 있지만 요구사항이라 명시한다 (abc.py:2035).
    """
    intents = discord.Intents.default()
    intents.voice_states = True
    intents.members = True
    return intents


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


@dataclass
class _Ledger:
    """확정 줄을 모으는 자리.

    on_line 은 STT 워커 스레드에서 불리고 (stt/session.py:36-41) 종료 경로는 루프에서 돈다.
    closed 는 종료가 스냅샷을 뜬 시점을 알리는 표시다. 그 뒤 도착한 줄은 파일에도 화면에도
    못 들어가므로 late 로 세고 로그만 남긴다. 정밀한 동기화가 아니라 관측용 카운터다 —
    경계에 걸친 한 줄이 어느 쪽으로 세어질지는 보장하지 않는다.
    """

    lines: list = field(default_factory=list)
    closed: bool = False
    late: int = 0


class _TrackPool:
    """화자별 wav 를 전용 스레드에서 쓴다.

    sink.write 는 이벤트 루프에서 돌기 때문에 (voice/state.py:189-198) 거기서 파일 IO 를 하면
    하트비트와 슬래시 응답이 같이 밀린다. sink 는 큐에 넣기만 하고 TrackWriter 인스턴스는
    이 스레드만 만진다.

    큐는 유한하다. 무한 큐는 쓰기가 막히는 순간 그대로 메모리다 (16k float32 = 화자당 초당
    64KB). 넘치면 버리고 dropped 로 센다. 버린 것은 wav 에만 없고 전사에는 있다 —
    session.feed 는 이 큐를 타지 않는다.
    """

    QUEUE_MAX = 4096  # 20ms 패킷 기준 약 80초분

    def __init__(self, out_dir: Path, ts: int) -> None:
        self.out_dir = out_dir
        self.ts = ts
        self.dropped = 0
        self._q: queue.Queue = queue.Queue(maxsize=self.QUEUE_MAX)
        self._writers: dict[int, TrackWriter] = {}
        self._thread = threading.Thread(target=self._run, name="track-writer", daemon=True)
        self._thread.start()

    def submit(self, uid: int, samples, offset_ms: int) -> None:
        """StreamingSink.on_samples 훅. 이벤트 루프에서 불린다. 절대 막히면 안 된다."""
        try:
            self._q.put_nowait((uid, samples, offset_ms))
        except queue.Full:
            self.dropped += 1

    def _run(self) -> None:
        while True:
            item = self._q.get()
            if item is None:
                return
            uid, samples, offset_ms = item
            try:
                w = self._writers.get(uid)
                if w is None:
                    w = self._writers[uid] = TrackWriter(self.out_dir / f"{uid}_{self.ts}.wav")
                w.write_at(samples, offset_ms)
            except Exception as e:
                # 트랙 하나가 깨져도 회의를 끝내는 것이 먼저다. 건수는 close() 가 보고한다.
                print(f"[track] uid={uid} 쓰기 실패: {type(e).__name__}: {e}", flush=True)

    def close(self) -> list[dict]:
        """센티넬을 넣고 스레드를 기다린 뒤 매니페스트 항목을 만든다. 파일 IO 라 스레드에서 부른다.

        display_name 은 자리만 만들어 둔다. 값은 호출자가 guild.get_member 로 채운다.
        """
        try:
            self._q.put(None, timeout=5)
        except queue.Full:
            pass  # 스레드가 이미 죽었다. 아래 join 이 바로 돌아오고 파일은 여기서 닫는다
        self._thread.join(timeout=10)
        entries: list[dict] = []
        for uid, w in sorted(self._writers.items()):
            dur = w.close()
            if dur <= 0:
                continue
            entries.append({
                "user_id": str(uid),
                "display_name": str(uid),
                "file": f"{self.out_dir.name}/{uid}_{self.ts}.wav",
                "duration_sec": round(dur, 2),
            })
        return entries


@dataclass
class _Meeting:
    """한 길드에서 진행 중인 회의 하나.

    channel 은 전사 줄과 종료 요약을 올릴 텍스트 채널이다. 봇이 음성 채널에서 쫓겨나는
    경로에는 ctx 가 없으므로 어디에 올릴지를 회의가 직접 들고 있어야 한다.
    secret_key 는 우리가 복호화기에 마지막으로 적용한 키다. 복호화기는 키를 보관하지 않아
    (reader.py:292-304) 여기서 기억하는 수밖에 없다.
    """

    meeting_id: str
    ts: int
    out_dir: Path
    session: Session
    sink: StreamingSink
    pool: _TrackPool
    publisher: Publisher
    publisher_task: asyncio.Task
    channel: discord.abc.Messageable
    voice_channel_id: int
    ledger: _Ledger
    secret_key: bytes = b""


class RealtimeCog(discord.Cog):
    def __init__(self, bot: discord.Bot, *, recordings_dir: Path = RECORDINGS_DIR,
                 on_session_saved: SessionSavedHook | None = None):
        self.bot = bot
        self.recordings_dir = recordings_dir
        self.on_session_saved = on_session_saved
        self._meetings: dict[int, _Meeting] = {}
        self._locks: dict[int, asyncio.Lock] = {}
        self._tasks: set[asyncio.Task] = set()  # 콜백이 만든 태스크의 강한 참조

    def _lock_for(self, guild_id: int) -> asyncio.Lock:
        """/live 와 /live-stop 본문을 길드마다 직렬화한다.

        가드와 표 대입 사이에 connect() 와 respond() 라는 await 가 있어서, 락이 없으면
        같은 길드의 /live 두 번이 둘 다 가드를 통과한다. asyncio.Lock 은 재진입이 안 되므로
        _finish_meeting 은 이 락을 잡지 않는다 — /live-stop 이 자기 자신을 기다리게 된다.
        콜백·퇴장 경로는 직렬화되지 않는 대신 pop 가드로 멱등하다.
        """
        lock = self._locks.get(guild_id)
        if lock is None:
            lock = self._locks[guild_id] = asyncio.Lock()
        return lock

    def _busy_message(self, meeting: _Meeting) -> str:
        room = self.bot.get_channel(meeting.voice_channel_id)
        name = room.name if room is not None else str(meeting.voice_channel_id)
        return f"이 서버에서는 이미 #{name} 에서 회의가 진행 중입니다. /live-stop 으로 먼저 끝내 주세요."

    async def cog_command_error(self, ctx: discord.ApplicationContext,
                                error: Exception) -> None:
        """이 Cog 의 명령이 낸 예외를 사용자가 보는 자리로 옮긴다.

        py-cord 는 콜백 예외를 ApplicationCommandInvokeError 로 싸서 (commands/core.py:126-150)
        dispatch_error 로 넘기고, 그쪽이 오버라이드된 이 메서드를 부른다 (core.py:474-478,
        cog.py:518). 체크 실패처럼 defer 전에 나는 예외는 안 싸여서 오므로 original 이 없다.

        이 메서드가 생기는 순간 py-cord 기본 핸들러는 아무것도 안 찍고 돌아간다
        (bot.py:1403-1412). 터미널 트레이스백은 그래서 여기서 직접 찍는다.
        """
        err = getattr(error, "original", error)
        if isinstance(err, discord.NotFound) and err.code == UNKNOWN_INTERACTION:
            _log_interaction_gone(ctx, err)
            return
        traceback.print_exception(err)
        try:
            await ctx.respond(f"`/{_command_name(ctx)}` 명령이 실패했습니다: "
                              f"{type(err).__name__}: {err}", ephemeral=True)
        except Exception as e:
            print(f"[command] /{_command_name(ctx)}: 실패를 알리지 못했다 "
                  f"({type(e).__name__}: {e}). 원래 예외는 {type(err).__name__}: {err}",
                  flush=True)

    @discord.Cog.listener()
    async def on_voice_state_update(self, member, before, after) -> None:
        meeting = self._meetings.get(member.guild.id)
        if meeting is None or before.channel is None:
            return
        if before.channel.id != meeting.voice_channel_id:
            return
        if after.channel is not None and after.channel.id == meeting.voice_channel_id:
            return
        if member.id == self.bot.user.id:
            # 봇이 회의 방에서 빠졌다. /live-stop 과 같은 경로로 끝낸다.
            await self._finish_meeting(member.guild.id)
            return
        # 나간 사람의 재정렬 창을 먼저 비우고 진행 중 발화를 확정한다. 순서가 반대면
        # 창에 남은 꼬리가 이미 닫힌 VAD 로 들어간다.
        meeting.sink.drain_speaker(member.id)
        meeting.session.flush_speaker(str(member.id))

    @discord.Cog.listener()
    async def on_member_speaking_state_update(self, member, ssrc, state) -> None:
        """재연결로 음성 키가 바뀌면 복호화기를 갱신한다.

        설치본에는 update_secret_key 호출자가 없다 (reader.py:138-139, 370-371). 복호화기는
        start_recording 시점의 키로 box 를 한 번 만드는데 (reader.py:126-128) load_secret_key 는
        새 session_description 마다 키를 갈아끼운다 (gateway.py:442). 재연결 경로는
        disconnect(cleanup=False) 라 reader 가 살아남으므로 낡은 box 로 전부 CryptoError 가 된다.
        이 리스너는 발화가 시작될 때마다 오므로 갱신이 한 발화 이상 늦지 않는다.
        소스로 확인한 것이고 실제 재연결로 관측하지 않았다.
        """
        meeting = self._meetings.get(member.guild.id)
        if meeting is None:
            return
        vc = member.guild.voice_client
        reader = getattr(vc, "_reader", None) if vc is not None else None
        if not reader:
            return
        key = bytes(vc.secret_key or b"")
        if not key or key == meeting.secret_key:
            return
        reader.update_secret_key(key)
        meeting.secret_key = key
        print("[voice] 음성 세션 키가 바뀌어 복호화기를 갱신했다", flush=True)

    # -------------------------------------------------------------------- /live
    @discord.slash_command(name="live", description="실시간 전사를 시작합니다")
    @discord.guild_only()
    @discord.option("channel", discord.TextChannel, required=False,
                    description="전사를 올릴 텍스트 채널 (기본: 명령을 친 채널)")
    async def live(self, ctx: discord.ApplicationContext,
                   channel: discord.TextChannel | None = None) -> None:
        # 음성 핸드셰이크는 최대 60초다 (abc.py:2026). 인터랙션 응답 시한 3초를 넘기면
        # 토큰이 만료돼 아래 respond 가 전부 NotFound 로 터진다. 첫 줄에 defer 한다.
        if not await _defer(ctx):
            return
        async with self._lock_for(ctx.guild.id):
            await self._start_meeting(ctx, channel)

    async def _start_meeting(self, ctx: discord.ApplicationContext,
                             channel: discord.TextChannel | None) -> None:
        meeting = self._meetings.get(ctx.guild.id)
        if meeting is not None:
            await ctx.respond(self._busy_message(meeting), ephemeral=True)
            return

        voice = getattr(ctx.author, "voice", None)
        if voice is None or voice.channel is None:
            await ctx.respond("먼저 음성 채널에 들어간 뒤 다시 실행해 주세요.", ephemeral=True)
            return
        room = voice.channel

        # 권한이 없으면 connect() 는 403 이 아니라 60초 침묵 뒤 TimeoutError 다
        # (abc.py:2054-2062). 미리 보고 어느 권한이 없는지 그대로 말해 준다.
        perms = room.permissions_for(ctx.guild.me)
        missing = [name for name, ok in (("채널 보기", perms.view_channel),
                                         ("음성 연결", perms.connect)) if not ok]
        if missing:
            await ctx.respond(
                f"`{room.name}` 에 필요한 권한이 없습니다: {', '.join(missing)}. "
                f"서버 설정 → 역할에서 봇 역할에 추가해 주세요.", ephemeral=True)
            return

        vc = ctx.voice_client
        if vc is not None and vc.is_connected():
            if is_recording(vc):
                # 표에는 없는데 리더가 살아 있다. /live-stop 이 이 상태를 푼다.
                await ctx.respond("이 서버에서 이미 녹음이 돌고 있습니다. `/live-stop` 으로 먼저 "
                                  "끝내 주세요.", ephemeral=True)
                return
            if vc.channel.id != room.id:
                # 녹음 중 이동은 destroy_all_decoders 를 깨뜨린다 (router.py:116-119).
                # 여기는 녹음 전이라 안전하다. 단 move_to 는 음성 상태 갱신을 보내고 바로
                # 돌아오므로, 이 줄 다음의 vc.channel 은 아직 옛 방일 수 있다. 아래에서
                # 방 기준은 전부 room 을 쓴다.
                await vc.move_to(room)
        else:
            try:
                vc = await room.connect(cls=SafeVoiceClient)
            except asyncio.TimeoutError:
                await ctx.respond("음성 채널 연결이 60초 안에 끝나지 않았습니다. 봇 역할의 "
                                  "연결 권한과 서버 상태를 확인해 주세요.", ephemeral=True)
                return
            except Exception as e:
                await ctx.respond(f"음성 채널 연결 실패: {type(e).__name__}: {e}", ephemeral=True)
                return

        post_to = channel or ctx.channel
        ts = int(time.time())
        meeting_id = f"{ctx.guild.id}_{ts}"
        out_dir = self.recordings_dir / meeting_id

        async def _send(text: str):
            # Message 객체를 그대로 돌려준다. Publisher 는 이 값을 불투명하게 들고 있다가
            # _edit 에 그대로 넘긴다 (publisher.py:226,228). fetch_message 를 한 번 더 치면
            # 편집 한 번이 HTTP 두 번이 되고 우리 토큰 버킷이 실제 요청률을 절반으로 센다.
            return await post_to.send(text)

        async def _edit(msg, text: str) -> None:
            await msg.edit(content=text)

        publisher = Publisher(_send, _edit)
        ledger = _Ledger()

        def on_line(line):
            # STT 워커 스레드에서 불린다 (stt/session.py:36-41). Publisher.submit 은 그
            # 스레드에서 안전하다고 스스로 계약한다 (publisher.py:13-19).
            if ledger.closed:
                ledger.late += 1
                print(f"[meeting] 마감 뒤 도착한 줄 {ledger.late}건 "
                      f"({line.speaker_name}) — 파일에도 화면에도 안 들어간다", flush=True)
                return
            ledger.lines.append(line)
            publisher.submit(line)

        # 게이트는 여기서 고른다. 백엔드를 고르는 자리와 같다 — stt/session.py 는
        # 게이트를 받지 못하면 예전처럼 전부 전사한다.
        session = Session(final_stt=EliceStt(), on_line=on_line, gate=SpeechGate())
        pool = _TrackPool(out_dir, ts)
        sink = StreamingSink(session, on_samples=pool.submit)
        publisher_task = asyncio.create_task(publisher.run())

        try:
            # 인자를 반드시 하나 이상 넘긴다. reader.py:182 가 `if self.after and self.args:`
            # 라서 빈 튜플이면 콜백이 아예 안 불린다. 동시에 voice/client.py:763-765 는
            # 위치 인자에 대해 "deprecated since 2.7, 3.0 에서 제거" 경고를 띄운다.
            # 둘 다 사실이고, 3.0 으로 올릴 때 이 배선이 조용히 죽는 자리다.
            vc.start_recording(sink, self._on_recording_done, ctx)
        except Exception as e:
            publisher_task.cancel()
            await asyncio.to_thread(session.close, 1.0)
            await asyncio.to_thread(pool.close)
            await ctx.respond(f"녹음을 시작하지 못했습니다: {type(e).__name__}: {e}", ephemeral=True)
            return

        # start_recording 이 성공한 뒤에 표에 넣는다. 먼저 넣으면 위 예외에 길드가 영구
        # "회의 중" 으로 잠기고 워커 스레드 3개와 게시 태스크가 새어 나간다.
        self._meetings[ctx.guild.id] = _Meeting(
            meeting_id=meeting_id, ts=ts, out_dir=out_dir,
            session=session, sink=sink, pool=pool,
            publisher=publisher, publisher_task=publisher_task,
            # 방은 room 기준이다. move_to 직후의 vc.channel 은 게이트웨이 이벤트가 와야
            # 갱신되므로, 그걸 믿으면 on_voice_state_update 의 방 필터가 옛 방을 가리켜
            # 퇴장 flush 와 봇 퇴장 감지가 조용히 안 돈다.
            channel=post_to, voice_channel_id=room.id, ledger=ledger,
            secret_key=bytes(vc.secret_key or b""),
        )
        await ctx.respond(
            f"🔴 전사 시작 (`{room.name}`). 줄은 {post_to.mention} 에 올라갑니다. "
            f"`/live-stop` 으로 종료합니다."
        )

    # ------------------------------------------------------- /live-stop /live-join
    @discord.slash_command(name="live-stop", description="전사를 끝내고 회의록을 저장합니다")
    @discord.guild_only()
    async def live_stop(self, ctx: discord.ApplicationContext) -> None:
        if not await _defer(ctx):
            return
        async with self._lock_for(ctx.guild.id):
            vc = ctx.voice_client
            if ctx.guild.id not in self._meetings:
                if vc is not None and is_recording(vc):
                    # 표와 라이브러리 상태가 어긋난 경우. 그냥 두면 /live 는 "이미 녹음 중",
                    # /live-stop 은 "회의 없음" 으로 서로를 막아 프로세스 재시작 말고는 길이 없다.
                    vc.stop_recording()
                    await ctx.respond("표에 없는 녹음을 정지했습니다. 회의록은 없습니다.")
                    return
                await ctx.respond("진행 중인 회의가 없습니다.", ephemeral=True)
                return

            # 먼저 답한다. stop_recording() 은 동기이고 라우터 join 에 최대 5초를 쓴다
            # (reader.py:165-168). 그동안 봇 전체가 멈추므로 응답이 뒤면 3초 시한에 걸린다.
            await ctx.respond("회의를 마칩니다. 회의록을 만드는 중입니다...")
            if vc is not None and is_recording(vc):
                # 이 줄이 돌아온 시점에 cleanup() → drain() 이 끝나 있다 (reader.py:163-197).
                # 다음 줄에서 session.close() 를 불러도 마지막 발화를 잃지 않는다.
                vc.stop_recording()
        await self._finish_meeting(ctx.guild.id)

    @discord.slash_command(name="live-join", description="봇이 음성 채널에 입장만 합니다")
    @discord.guild_only()
    async def live_join(self, ctx: discord.ApplicationContext) -> None:
        if not await _defer(ctx):
            return
        meeting = self._meetings.get(ctx.guild.id)
        if meeting is not None:
            # 녹음 중 move_to 는 destroy_all_decoders 를 깨뜨린다 (router.py:116-119).
            await ctx.respond(self._busy_message(meeting), ephemeral=True)
            return
        voice = getattr(ctx.author, "voice", None)
        if voice is None or voice.channel is None:
            await ctx.respond("먼저 음성 채널에 들어간 뒤 다시 실행해 주세요.", ephemeral=True)
            return
        room = voice.channel
        perms = room.permissions_for(ctx.guild.me)
        missing = [name for name, ok in (("채널 보기", perms.view_channel),
                                         ("음성 연결", perms.connect)) if not ok]
        if missing:
            await ctx.respond(f"`{room.name}` 에 필요한 권한이 없습니다: {', '.join(missing)}.",
                              ephemeral=True)
            return
        vc = ctx.voice_client
        if vc is not None and is_recording(vc):
            # 표에는 없는데 리더가 살아 있다. 여기서 move_to 하면 destroy_all_decoders 가
            # 순회 중 변경으로 터진다 (router.py:116-119). _meetings 검사는 이 상태를 못 잡는다.
            await ctx.respond("이 서버에서 표에 없는 녹음이 돌고 있습니다. `/live-stop` 으로 먼저 "
                              "끝내 주세요.", ephemeral=True)
            return
        try:
            if vc is not None and vc.is_connected():
                if vc.channel.id == room.id:
                    await ctx.respond(f"이미 `{room.name}` 에 있습니다.", ephemeral=True)
                    return
                await vc.move_to(room)
            else:
                await room.connect(cls=SafeVoiceClient)
        except asyncio.TimeoutError:
            await ctx.respond("음성 채널 연결이 60초 안에 끝나지 않았습니다.", ephemeral=True)
            return
        except Exception as e:
            await ctx.respond(f"음성 채널 연결 실패: {type(e).__name__}: {e}", ephemeral=True)
            return
        await ctx.respond(f"`{room.name}` 입장 완료. `/live` 로 전사를 시작하세요.")

    @discord.slash_command(name="selftest", description="봇이 어디서 막혔는지 단계별로 확인합니다")
    @discord.guild_only()
    @discord.option("stt", bool, required=False,
                    description="STT 왕복까지 확인 (1초 오디오, 약 0.1원 과금)")
    @discord.option("seconds", int, required=False, min_value=1, max_value=15,
                    description="수신을 재는 시간 (기본 3초, 말하다 쉬는 구간을 넣으려면 길게)")
    async def selftest(self, ctx: discord.ApplicationContext, stt: bool = False,
                       seconds: int | None = None) -> None:
        from capture import selftest as st

        # 프로브가 인터랙션 시한 3초를 넘긴다. defer 뒤에는 followup 까지 15분이라
        # 15초 프로브도 안에 들어온다.
        if not await _defer(ctx):
            return
        await ctx.followup.send(await st.run(self, ctx, use_stt=stt, seconds=seconds))

    def _on_recording_done(self, sink, ctx: discord.ApplicationContext) -> None:
        """py-cord 가 stop_recording 안에서 동기로 부른다 (reader.py:182-184).

        동기 함수로 둔 이유가 둘이다. 코루틴을 돌려주면 py-cord 가 loop.create_task 의 반환값을
        버리는데 (reader.py:185-188) asyncio 는 태스크를 약한 참조로만 들고 있어 실행 중에
        수거될 수 있다. 그리고 우리가 태스크를 만들면 예외도 우리가 볼 수 있다.
        본문은 태스크를 예약하는 것이 전부라, 동기 콜백이 sink.cleanup()(reader.py:195) 보다
        먼저 실행된다는 사실에 걸리는 게 없다 — 실제 마무리는 루프가 제어권을 되찾은 뒤,
        즉 cleanup() 이 끝난 뒤에 돈다.

        /live-stop 은 이 콜백을 기다리지 않는다. 이 경로가 필요한 것은 네트워크 단절과
        disconnect() 처럼 /live-stop 을 거치지 않고 리더가 멈추는 경우다
        (voice/client.py:381, 618-620). _finish_meeting 은 pop 가드로 멱등하다.
        """
        guild_id = ctx.guild.id
        loop = self.bot.loop

        def _spawn() -> None:
            task = loop.create_task(self._finish_meeting(guild_id))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            _spawn()
        else:
            # _stop() 은 라우터 스레드에서 시작될 수도 있다 (router.py:131-136).
            loop.call_soon_threadsafe(_spawn)

    # ------------------------------------------------------------------ 종료
    async def _finish_meeting(self, guild_id: int) -> None:
        """/live-stop, 봇의 음성 채널 퇴장, py-cord 콜백이 전부 여기로 온다.

        표에서 먼저 꺼내므로 어느 쪽이 먼저 도착하든 본문은 한 번만 돈다.
        길드 락은 잡지 않는다 — /live-stop 이 락을 쥔 채 부를 수 있고 asyncio.Lock 은 재진입이 안 된다.
        """
        # 이 계획의 목표가 "종료 명령 후 10초 안에 회의록" 이다. 그 수치를 재는 자리가
        # 여기뿐이다 — session.close() 의 반환값은 전사 대기 시간일 뿐 파일이 나온 시각이
        # 아니다. 종료 메시지에 둘을 같이 찍어 실제 회의에서 그대로 옮겨 적는다.
        t0 = time.monotonic()
        meeting = self._meetings.pop(guild_id, None)
        if meeting is None:
            return

        guild = self.bot.get_guild(guild_id)
        vc = guild.voice_client if guild is not None else None

        # 1. 재정렬 창을 먼저 비운다. 여기가 스스로 하지 않으면 위 독스트링의 "전부 여기로
        #    온다" 가 거짓이 된다 — 봇 퇴장 경로에는 stop_recording() 이 없고, py-cord 의
        #    cleanup() 은 자기 태스크에서 여러 번 await 한 뒤에야 온다 (state.py:1909 가
        #    먼저 예약되지만 1928 의 우리 리스너가 먼저 끝난다). 늦게 온 샘플은 이미 멈춘
        #    워커 큐와 이미 join 된 트랙 스레드로 들어가 예외도 카운터도 없이 사라진다.
        #    두 번 불러도 안전하다 — Reorderer.flush() 가 _buf 를 비운다 (timeline.py:101-106).
        #    여기서 예외를 밖으로 내보내지 않는다. pop 이 이미 끝나서, 나가면 회의록·wav·
        #    매니페스트·요약이 한꺼번에 사라지고 표에도 없어 아무도 다시 시도하지 못한다.
        #    꼬리를 잃은 드레인이 회의 전체를 잃는 것보다 낫다. 대신 요약에 적어 내보낸다.
        #    CancelledError 는 BaseException 이라 여기 안 걸리고 그대로 올라간다.
        drain_error = None
        try:
            meeting.sink.cleanup()
        except Exception as e:
            drain_error = f"{type(e).__name__}: {e}"
            print(f"[meeting] guild={guild_id} {meeting.meeting_id}: 마지막 드레인 실패 "
                  f"({drain_error}). 회의 끝부분이 빠졌을 수 있다.", flush=True)

        # 2. 남은 발화를 확정하고 전사를 기다린다. close() 는 워커를 최대 10초 기다리는
        #    블로킹 호출이라 스레드로 뺀다. 루프에서 부르면 그동안 봇 전체가 멈춘다.
        elapsed = await asyncio.to_thread(meeting.session.close, 10.0)

        # 3. 스냅샷은 close() 가 돌아온 **뒤** 에 찍는다. 앞에서 찍으면 close() 가 확정하는
        #    마지막 발화들이 통째로 빠진다 — 그 줄들은 전부 close() 안에서 on_line 으로 온다
        #    (stt/session.py:144-175). 마감 경계는 close() 의 반환이고, 그 뒤에 오는 줄이
        #    ledger.late 다. 세기만 하고 되살리지 않는다.
        meeting.ledger.closed = True
        lines = list(meeting.ledger.lines)

        # 4. 화자별 트랙을 닫고 매니페스트를 쓴다. 표시 이름은 여기서 붙인다.
        entries = await asyncio.to_thread(meeting.pool.close)
        for e in entries:
            member = guild.get_member(int(e["user_id"])) if guild is not None else None
            if member is not None:
                e["display_name"] = member.display_name
        # 매니페스트는 평평하게 recordings/session_{ts}.json 에 쓴다. stt/transcribe.py:60 과
        # stt/eval/eval.py:108 이 RECORDINGS_DIR 을 얕게 훑기 때문이다. wav 는 회의
        # 디렉토리 안에 있고 file 필드가 상대 경로를 들고 있다. 화자가 0명이어도 쓴다 —
        # 무음으로 끝난 회의가 실제로 열렸다는 유일한 기록이다.
        manifest_path, _ = await asyncio.to_thread(
            write_manifest, entries, self.recordings_dir,
            ts=meeting.ts,
            guild=guild.name if guild is not None else None,
            channel=vc.channel.name if vc is not None and vc.channel is not None else None,
            library_version=discord.__version__,
        )

        # 5. 회의록. 게시기 정리보다 **앞** 이다. 게시가 막혀 있어도 파일은 나와야 한다.
        out = await asyncio.to_thread(write_transcript, lines, meeting.out_dir, meeting.meeting_id)
        # 지연은 회의록 옆에 따로 쓴다. transcript.jsonl 의 레코드 모양은 BE 계약이다.
        # 값은 여기서 한 번만 뜬다. 아래 요약까지 가는 동안 게시 태스크가 계속 돌면서
        # 같은 Line 객체를 채우므로, 줄을 그대로 넘기면 파일과 화면이 갈라진다.
        timings = snapshot(lines)
        latency_path = await asyncio.to_thread(write_latency, timings, meeting.out_dir)

        finals = [ln for ln in lines if ln.final]
        report = meeting.sink.level_report()
        total = time.monotonic() - t0
        msg = [
            f"⏹ 종료. 발화 {len(finals)}건 · 회의록까지 {total:.1f}초 "
            f"(전사 대기 {elapsed:.1f}초, 목표 10초)",
            format_summary(timings),
            f"회의록 `{out['markdown']}` · 구간 지연 `{latency_path.name}`",
            f"화자별 트랙 {len(entries)}개 · 매니페스트 `{manifest_path.name}`",
        ]
        msg.append(
            f"수신 패킷 {report['packets']} · 잡음 {report['noise_packets']} · "
            f"write 오류 {report['write_errors']} · 화자 미상 {report['unattributed']} · "
            f"트랙 버림 {meeting.pool.dropped} · 최대 RMS {report['peak_rms']:.3f} "
            f"(임계 {report['speech_rms']:.3f}, {report['verdict']})"
        )
        if meeting.session.gate is not None:
            msg.append(meeting.session.gate.summary())
        if drain_error is not None:
            msg.append(f"⚠️ 마지막 드레인 실패 ({drain_error}) — 회의 끝부분이 빠졌을 수 있습니다")
        try:
            await meeting.channel.send("\n".join(msg))
        except Exception as e:
            print(f"[meeting] 종료 메시지 전송 실패: {type(e).__name__}: {e}", flush=True)

        # 6. 게시기를 접는다. 기본 데드라인 8초 (publisher.py:115). 못 나간 줄은 화면에만
        #    없고 transcript.jsonl 에는 이미 있다. await 가 예외를 올려도 여기서 끝나지 않게
        #    감싼다 — 회의록은 이미 나왔고 남은 것은 disconnect 뿐이다.
        meeting.publisher.stop()
        try:
            await meeting.publisher_task
        except Exception as e:
            print(f"[publish] 게시 태스크 종료 예외: {type(e).__name__}: {e}", flush=True)

        if meeting.ledger.late:
            print(f"[meeting] {meeting.meeting_id}: 마감 뒤 도착한 줄 {meeting.ledger.late}건. "
                  f"회의록에 없다. Task 12 에서 실측한다.", flush=True)
        if meeting.pool.dropped:
            print(f"[meeting] {meeting.meeting_id}: 트랙 큐가 넘쳐 {meeting.pool.dropped}건 버렸다.",
                  flush=True)

        # 7. 음성 채널에서 나간다. 회의가 끝나면 봇이 남아 있을 이유가 없고, 남아 있으면
        #    다음 /live 가 "이미 연결됨" 분기로 들어가 상태가 하나 늘어난다.
        #    단 위의 await 들(전사 10초 + 게시 8초) 동안 _meetings 는 비어 있어서 그 사이에
        #    시작된 /live 가 같은 VoiceClient 를 다시 쓴다. 그 회의가 표에 있으면 끊지
        #    않는다 — disconnect 는 self.stop() 으로 남의 리더까지 세운다
        #    (voice/client.py:381 → 620-622).
        if vc is not None and guild_id not in self._meetings:
            try:
                await vc.disconnect(force=True)
            except Exception as e:
                print(f"[voice] 퇴장 실패: {type(e).__name__}: {e}", flush=True)

        if self.on_session_saved is not None:
            payload = {"meeting_id": meeting.meeting_id, "guild_id": guild_id,
                       "session": str(meeting.ts), "speakers": entries, **out}
            try:
                await self.on_session_saved(payload, out["jsonl"])
            except Exception as e:  # BE 후처리 실패가 회의록 저장까지 망치지 않게
                print(f"[warn] on_session_saved 훅 실패: {e!r}")
