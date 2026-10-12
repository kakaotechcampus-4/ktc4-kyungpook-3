"""디스코드 음성 채널 화자별 녹음 어댑터 (py-cord Cog). 녹음을 저장까지 하고, 처리는 워커(capture/worker.py)가 한다.

"Discord" 라는 이름은 ai/ 안에서는 capture/ 안에만 있어야 한다.
봇 프로세스(기동, 토큰, 상시 실행)는 backend/bot/main.py 가 소유하고, 이 Cog 를 add_cog 로 붙인다:

    from capture.discord_adapter import RecordingCog, required_intents
    bot.add_cog(RecordingCog(bot, on_session_saved=...))

명령
  /join     명령한 사람이 있는 음성 채널에 봇 입장
  /record   화자별 트랙 녹음 시작. 채널에 "녹음·전사 중" 을 알리고 BE 에 회의를 만든다
  /stop     녹음 종료. 트랙을 닫고 저장한 뒤 워커를 찌른다. 처리 진행은 워커가 이 채널에 알린다
  /leave    음성 채널 퇴장 (녹음 중에는 거절)
  /end      자기 녹음의 저장까지 끝나면 퇴장. 그 사이 새 녹음이 시작됐으면 남는다

녹음은 StreamingSink + TrackWriter 다. 패킷을 받는 즉시 16kHz 모노로 바꿔 화자별 wav 에 흘리고
(메모리가 회의 길이와 무관), 트랙 안의 위치는 녹음 시작부터 흐른 monotonic 시간이다. 그래서
트랙들이 같은 시계 위에 있고 종료 뒤 stt/batch.py 가 그대로 정렬한다. 벽시계는 매니페스트
started_at 에 한 번만 적는다. 실시간 게시 Cog(capture/realtime/)는 이 프로세스에 올리지 않는다.
음성 연결은 길드마다 하나라 녹음기 둘이 같이 돌 수 없다.

세션은 둘로 나눠 든다. _active 는 녹음 중인 것(길드마다 하나), _processing 은 트랙을 닫고 저장 중인 것(회의 ID
마다). 앞 회의를 저장하는 동안에도 새 녹음을 받는다.

처리 방식은 워커 하나다(결정 기록 0026). 봇은 saved 를 다 쓴 뒤 회의 잠금을 놓고 워커를 찌르고(request_nudge)
on_session_saved(manifest, manifest_path) 훅을 부른다. 워커는 전사 → 회의록 저장 → 할일 추출 → BE 인계를 하면서
단계가 끝날 때마다 그 회의의 채널에 알릴 글을 우편함(recordings/.worker/outbox)에 쓰고, 봇이 OUTBOX_POLL_S 마다
그것을 채널에 올린다(_drain_outbox). 워커는 디스코드를 모르고, 디스코드에 글을 올리는 프로세스는 봇 하나다.
워크스페이스는 /record 때 서버로 BE 에 물어 매니페스트에 고정한다. 연결이 없는 서버는 녹음하지 않는다(#199).
채널 알림은 전부 _notify 를 거쳐서, 디스코드 쪽 실패가 파일과 상태 처리를 막지 않는다.

재시작 안내. 봇이 준비되면(on_ready, 준비된 뒤에 붙었으면 붙는 자리에서) 루프가 MM_RECOVERY_INTERVAL_S
(기본 60초)마다 봇이 녹음 중에 죽어 recording 으로 남은 회의를 찾아, 한 시간 안에 끊긴 것이면 그 채널에 재시작
안내를 한 번 올린다. 녹음된 부분은 워커가 처리한다.

회의 잠금. 누가 회의를 처리할지는 회의마다의 OS 파일 잠금(recorder.try_lock)만 정한다. /record 는 잠금을
먼저 잡고 recording 매니페스트를 쓰고, saved 를 다 쓴 뒤 놓는다. 근거는
docs/basis_for_decision/member/2026-09-26-0013-recovery-worker-and-meeting-lock.md.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

import discord

from capture.handoff import from_env as handoff_from_env
from capture.notify import FileOutbox
from capture.recorder import (RECOVERY_INTERVAL_S, STATUS_RECORDING, STATUS_SAVED, NullSession, interrupted_meetings,
                              manifest_path, meeting_title, queue_ahead, try_lock, try_restart_lock, write_status)
from capture.streaming_sink import StreamingSink
from capture.track_writer import TrackPool
from capture.voice_client import SafeVoiceClient
from capture.worker import request_nudge, worker_trouble
from shared.config import RECORDINGS_DIR, settings
from shared.schemas import now_iso

SessionSavedHook = Callable[[dict, Path], Awaitable[None]]

NOTICE = "🔴 녹음·전사 중입니다. 이 음성 채널의 말은 화자별로 녹음되고 `/stop` 뒤 회의록이 여기 올라옵니다."
# 봇은 서버에 있는데 웹에서 이 서버를 워크스페이스에 연결하지 않았다(#199). /record 는 녹음하지 않고 이렇게 답한다
NOT_CONNECTED_REFUSED = ("⚠️ 이 디스코드 서버가 웹 워크스페이스에 연결돼 있지 않아 녹음을 시작하지 않았습니다. "
                         "PM 이 웹 온보딩의 디스코드 연결 단계에서 이 서버를 연결한 뒤 다시 `/record` 해 주세요.")
DEPLOYING_NOTICE = "⏳ 새 버전을 배포하느라 봇이 곧 다시 시작됩니다. 1분쯤 뒤에 다시 `/record` 해 주세요."
FLUSH_EVERY_S = 0.2   # 재정렬 창에 갇힌 마지막 패킷을 이 주기로 비운다. 패킷은 20ms 마다 온다
RESUME_NOTICE = ("⚠️ 봇이 다시 시작되어 끊긴 회의의 녹음된 부분을 처리합니다. "
                 "이어서 기록하려면 `/join` 뒤 `/record` 를 실행해 주세요.")
OUTBOX_POLL_S = 2.0        # 워커가 우편함에 쓴 알림을 채널에 올리는 주기
OUTBOX_MAX_AGE_S = 1800.0  # 이보다 오래 올리지 못한 알림은 버린다. 봇이 오래 꺼져 있었으면 지난 진행은 의미가 없다


def is_recording(vc) -> bool:
    fn = getattr(vc, "is_recording", None)
    if callable(fn):
        return bool(fn())
    return bool(getattr(vc, "recording", False))


def required_intents() -> discord.Intents:
    """이 Cog 가 동작하는 데 필요한 인텐트. backend/bot/main.py 가 Bot 생성 시 사용.

    message_content 는 필요 없다. 슬래시 명령과 채널 게시는 그 인텐트 없이 된다.
    """
    intents = discord.Intents.default()
    intents.voice_states = True
    intents.members = True  # user_id → 표시 이름
    return intents


@dataclass
class _Recording:
    meeting_id: str
    ts: int
    out_dir: Path
    sink: StreamingSink
    pool: TrackPool
    text_channel: object
    guild_id: int
    voice_channel_id: int
    voice_channel_name: str | None
    guild_name: str | None
    started_at: str
    text_channel_id: int | None = None
    workspace_id: str | None = None
    timezone: str = "Asia/Seoul"
    be: dict = field(default_factory=dict)          # BE 회의 상태. capture/handoff.py 가 채운다
    notified: set[int] = field(default_factory=set)
    flush_task: asyncio.Task | None = None
    done: asyncio.Event = field(default_factory=asyncio.Event)
    lock: object | None = None                      # 회의 잠금(recorder.MeetingLock). 녹음하는 동안 쥔다
    hint_names: list[str] = field(default_factory=list)   # 전사 이름 힌트(#195). 서버 멤버 표시 이름


def _member_names(guild) -> list[str]:
    """전사 이름 힌트(#195). 서버 멤버의 표시 이름. 회의에 없는 사람도 이름으로 불리며 일을 맡는다. 봇 계정은 뺀다.

    상한(20명)과 겹침 제거는 stt.backend.name_prompt 가 한다. 워크스페이스를 찾게 되면(#180) BE 멤버 이름으로 바꾼다.
    """
    return [m.display_name for m in getattr(guild, "members", None) or []
            if not getattr(m, "bot", False) and getattr(m, "display_name", None)]


class RecordingCog(discord.Cog):
    def __init__(self, bot: discord.Bot, *, recordings_dir: Path = RECORDINGS_DIR,
                 on_session_saved: SessionSavedHook | None = None, handoff_factory=None):
        """handoff_factory() 는 capture.handoff.Handoff 또는 None (BE 설정 없음). 기본은 환경 변수다.

        /record 때 서버의 워크스페이스를 찾고 BE 회의를 먼저 만드는 데만 쓴다. 처리는 워커가 한다.
        """
        self.bot = bot
        self.recordings_dir = recordings_dir
        self.on_session_saved = on_session_saved
        self._handoff_factory = handoff_factory if handoff_factory is not None else handoff_from_env
        self._active: dict[int, _Recording] = {}        # 길드 ID → 녹음 중
        self._processing: dict[str, _Recording] = {}   # 회의 ID → 저장 중
        self._tasks: set[asyncio.Task] = set()
        self._recovery_interval_s = RECOVERY_INTERVAL_S      # 재시작 안내 주기. 0 이면 루프를 띄우지 않는다
        self._recovery_task: asyncio.Task | None = None
        self._outbox_task: asyncio.Task | None = None
        self._started_at = now_iso()                         # 이보다 먼저 시작돼 recording 으로 남은 회의는 재시작으로 끊겼다
        self._resume_noticed: set[str] = set()
        # 봇 쪽이 준비된 뒤에 이 Cog 를 붙이면 on_ready 를 받지 못한다. 그때는 붙는 자리에서 루프를 띄운다
        if getattr(bot, "is_ready", lambda: False)():
            try:
                self.start_recovery_loop()
            except RuntimeError:                             # 이벤트 루프 밖에서 붙였다. 다음 on_ready 에 뜬다
                pass

    # ------------------------------------------------------------------ 명령
    @discord.slash_command(name="join", description="봇이 현재 음성채널에 입장합니다")
    async def join(self, ctx: discord.ApplicationContext) -> None:
        voice = getattr(ctx.author, "voice", None)
        if voice is None or voice.channel is None:
            await ctx.respond("먼저 음성채널에 들어간 뒤 다시 실행해 주세요.", ephemeral=True)
            return
        channel = voice.channel
        vc = ctx.voice_client
        if vc is not None and vc.is_connected():
            if vc.channel.id == channel.id:
                await ctx.respond(f"이미 `{channel.name}` 에 있습니다.", ephemeral=True)
                return
            if is_recording(vc):
                await ctx.respond("녹음 중에는 방을 옮길 수 없습니다. 먼저 `/stop` 을 실행해 주세요.", ephemeral=True)
                return
            await vc.move_to(channel)
        else:
            await channel.connect(cls=SafeVoiceClient)
        await ctx.respond(f"`{channel.name}` 입장 완료. `/record` 로 녹음을 시작하세요.")

    def _record_blocked(self, ctx: discord.ApplicationContext) -> str | None:
        """지금 녹음을 시작할 수 없는 이유. 없으면 None."""
        vc = ctx.voice_client
        if vc is None or not vc.is_connected():
            return "봇이 음성채널에 없습니다. `/join` 먼저 실행해 주세요."
        if is_recording(vc) or ctx.guild.id in self._active:
            return "이미 녹음 중입니다. `/stop` 으로 먼저 종료하세요."
        return None

    @discord.slash_command(name="record", description="화자별 트랙 녹음을 시작합니다")
    async def record(self, ctx: discord.ApplicationContext) -> None:
        if (why := self._record_blocked(ctx)) is not None:
            await ctx.respond(why, ephemeral=True)
            return
        # 녹음 전에 이 서버의 워크스페이스를 찾는다. 연결이 없으면 녹음하지 않는다(#199). 조회가 일시로 실패하면
        # 녹음은 하고 처리할 때 다시 묻는다. 다시 할 수 없는 회의를 BE 장애 때문에 잃지 않게 한다
        handoff = self._handoff_factory()
        meta = {"be": {}, "guild_id": str(ctx.guild.id)}
        if handoff is not None:
            await ctx.defer()                   # BE 를 묻는 동안 디스코드의 3초 응답 기한을 넘기지 않는다
            try:
                if await asyncio.to_thread(handoff.workspace, meta) is None:
                    await ctx.respond(NOT_CONNECTED_REFUSED)
                    return
            except Exception as e:  # noqa: BLE001
                meta["be"]["error"] = f"{type(e).__name__}: {e}"
                print(f"[be] 워크스페이스 조회 실패: {meta['be']['error']}", flush=True)
            # 묻는 사이 같은 서버의 다른 /record 가 먼저 시작했거나 봇이 채널을 떠났을 수 있다
            if (why := self._record_blocked(ctx)) is not None:
                await ctx.respond(why, ephemeral=True)
                return
        vc = ctx.voice_client
        # 배포는 녹음 확인부터 봇 재시작까지 이 잠금을 쥔다(#215). 쥐고 있으면 곧 재시작되니 녹음하지 않는다.
        # 회의 잠금을 잡고 recording 매니페스트를 쓸 때까지 쥔다. 그래야 배포가 그 사이를 녹음 없음으로 보지 않는다
        restart = try_restart_lock(self.recordings_dir)
        if restart is None:
            await ctx.respond(DEPLOYING_NOTICE, ephemeral=True)
            return
        try:
            # 회의 잠금을 먼저 잡고 recording 매니페스트를 쓴다. 워커는 봇 메모리를 못 보니 이 잠금으로 녹음 중인 회의를
            # 건너뛰고, 잠금 없는 recording 은 봇이 녹음 중에 죽은 회의로 읽는다
            ts = int(time.time())
            while True:
                path = manifest_path(self.recordings_dir, f"{ctx.guild.id}_{ts}")
                lock = try_lock(path)
                if lock is not None and not path.exists():
                    break
                if lock is not None:
                    lock.release()
                ts += 1        # 같은 초에 시작한 앞 회의가 있다. 회의 ID 가 겹치면 그 매니페스트와 트랙을 덮어쓴다
            meeting_id = f"{ctx.guild.id}_{ts}"
            out_dir = self.recordings_dir / meeting_id
            out_dir.mkdir(parents=True, exist_ok=True)
            pool = TrackPool(out_dir, ts)
            sink = StreamingSink(NullSession(), on_samples=pool.submit)
            cfg = settings()
            rec = _Recording(meeting_id=meeting_id, ts=ts, out_dir=out_dir, sink=sink, pool=pool,
                             text_channel=ctx.channel, guild_id=ctx.guild.id, voice_channel_id=vc.channel.id,
                             voice_channel_name=getattr(vc.channel, "name", None),
                             guild_name=ctx.guild.name if ctx.guild else None, started_at=now_iso(),
                             text_channel_id=getattr(ctx.channel, "id", None),
                             timezone=cfg.meeting_timezone, lock=lock, hint_names=_member_names(ctx.guild),
                             workspace_id=meta.get("workspace_id"), be=meta["be"])
            vc.start_recording(sink, self._on_recording_done, ctx)
            self._active[ctx.guild.id] = rec
            # 시작 시점에 매니페스트를 먼저 쓴다. 봇이 죽어도 이 회의가 있었다는 기록과 트랙이 남는다
            _, manifest = self._write_status(rec, STATUS_RECORDING, [])
        finally:
            restart.release()
        rec.flush_task = asyncio.create_task(self._flush_loop(rec))
        await ctx.respond(NOTICE)
        # BE 에 회의를 먼저 만들어 둔다. 실패해도 녹음은 계속되고 처리할 때 다시 한다
        if handoff is not None and rec.workspace_id:
            try:
                await asyncio.to_thread(handoff.start, meta, title=meeting_title(manifest))
            except Exception as e:  # noqa: BLE001
                rec.be["error"] = f"{type(e).__name__}: {e}"
                print(f"[be] 회의 생성 실패: {rec.be['error']}", flush=True)
            if self._active.get(ctx.guild.id) is rec:   # 그 사이 끝나지 않았을 때만 다시 쓴다
                self._write_status(rec, STATUS_RECORDING, [])

    @discord.slash_command(name="stop", description="녹음을 종료하고 회의록을 만듭니다")
    async def stop(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None or not is_recording(vc) or ctx.guild.id not in self._active:
            await ctx.respond("진행 중인 녹음이 없습니다.", ephemeral=True)
            return
        # 먼저 답한다. stop_recording() 은 동기이고 라우터 join 에 최대 5초를 쓴다
        await ctx.respond("⏹ 녹음 종료. 트랙을 닫고 저장합니다. 처리 진행이 이 채널에 올라옵니다.")
        vc.stop_recording()

    @discord.slash_command(name="leave", description="봇이 음성채널에서 나갑니다")
    async def leave(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None:
            await ctx.respond("봇이 음성채널에 없습니다.", ephemeral=True)
            return
        if is_recording(vc) or ctx.guild.id in self._active:
            await ctx.respond("녹음 중입니다. 먼저 `/stop` 으로 종료하거나, 저장까지 기다렸다가 나가려면 `/end` 를 사용하세요.",
                              ephemeral=True)
            return
        await vc.disconnect(force=True)
        await ctx.respond("음성채널에서 나갔습니다.")

    @discord.slash_command(name="end", description="녹음 저장이 끝나면 음성채널에서 나갑니다")
    async def end(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None:
            await ctx.respond("봇이 음성채널에 없습니다.", ephemeral=True)
            return
        rec = self._active.get(ctx.guild.id)
        waiting = [r for r in self._processing.values() if r.guild_id == ctx.guild.id]
        if rec is not None and is_recording(vc):
            await ctx.respond("⏹ 녹음 종료. 저장이 끝나면 나갑니다.")
            vc.stop_recording()
            await rec.done.wait()          # 자기 세션만 기다린다
            if ctx.guild.id in self._active:
                # 기다리는 사이 새 녹음이 시작됐다. 그 연결은 새 녹음 것이라 끊지 않는다
                await self._notify(ctx.channel, "새 녹음이 시작돼 음성채널에 남습니다.")
                return
        elif waiting:
            # 녹음은 끝났고 저장이 도는 중이다. 설명대로 끝날 때까지 기다린다
            await ctx.respond("저장이 끝나면 나갑니다.")
            for r in waiting:
                await r.done.wait()
            if ctx.guild.id in self._active:
                await self._notify(ctx.channel, "새 녹음이 시작돼 음성채널에 남습니다.")
                return
        else:
            await ctx.respond("음성채널에서 나가는 중...")
        await vc.disconnect(force=True)
        await self._notify(ctx.channel, "음성채널에서 나갔습니다.")

    # ------------------------------------------------------------------ 이벤트
    @discord.Cog.listener()
    async def on_voice_state_update(self, member, before, after) -> None:
        rec = self._active.get(member.guild.id)
        if rec is None:
            return
        left = before.channel is not None and before.channel.id == rec.voice_channel_id and \
            (after.channel is None or after.channel.id != rec.voice_channel_id)
        joined = after.channel is not None and after.channel.id == rec.voice_channel_id and \
            (before.channel is None or before.channel.id != rec.voice_channel_id)
        if member.id == self.bot.user.id:
            if left:
                # 봇이 회의 방에서 빠졌다. /stop 과 같은 경로로 끝낸다
                await self._finish(member.guild.id)
            return
        if joined and member.id not in rec.notified:
            # 늦게 들어온 사람도 녹음 중인 것을 안다
            rec.notified.add(member.id)
            await self._notify(rec.text_channel, f"{member.mention} {NOTICE}")
        elif left:
            rec.sink.drain_speaker(member.id)

    @discord.Cog.listener()
    async def on_ready(self) -> None:
        self.start_recovery_loop()

    # ------------------------------------------------------------------ 재시작 안내, 우편함
    def start_recovery_loop(self) -> asyncio.Task | None:
        """재시작 안내 루프와 우편함 루프를 띄운다. on_ready 가 재연결로 다시 와도 하나씩만 돈다.

        정리는 둘이다. Cog 를 떼면 cog_unload 가 취소한다. bot.run() 이 끝나면 py-cord 가 남은 태스크를 모두
        취소한다(Client.close 는 cog_unload 를 부르지 않는다). 재시작 안내 주기가 0 이면 그 루프만 띄우지 않는다.
        """
        loop = asyncio.get_running_loop()
        if self._outbox_task is None or self._outbox_task.done():
            self._outbox_task = loop.create_task(self._outbox_loop())
        if self._recovery_interval_s <= 0:
            return None
        if self._recovery_task is None or self._recovery_task.done():
            self._recovery_task = loop.create_task(self._recovery_loop())
        return self._recovery_task

    def cog_unload(self) -> None:
        for task in (self._recovery_task, self._outbox_task):
            if task is not None:
                task.cancel()

    async def _recovery_loop(self) -> None:
        """첫 바퀴는 바로 돈다(재시작으로 끊긴 회의). 한 바퀴가 예외를 내도 로그만 남기고 다음 바퀴로 간다."""
        while True:
            try:
                await self._tick()
            except Exception as e:  # noqa: BLE001 - 깨진 매니페스트 하나가 안내를 멈추면 안 된다
                print(f"[recovery] 재시작 안내 바퀴 예외: {type(e).__name__}: {e}", flush=True)
            await asyncio.sleep(self._recovery_interval_s)

    async def _tick(self) -> None:
        """루프의 한 번. 처리는 워커가 하고 봇은 재시작 안내만 올린다."""
        await self._notice_interrupted()

    async def _outbox_loop(self) -> None:
        while True:
            try:
                await self._drain_outbox()
            except Exception as e:  # noqa: BLE001
                print(f"[outbox] 우편함 바퀴 예외: {type(e).__name__}: {e}", flush=True)
            await asyncio.sleep(OUTBOX_POLL_S)

    async def _drain_outbox(self) -> None:
        """워커가 우편함에 쓴 알림을 그 채널에 이름 순서대로 올리고 지운다(capture.notify.FileOutbox).

        올리지 못하면 거기서 멈추고 다음 바퀴에 다시 올린다. 같은 회의의 알림 순서를 지키려는 것이다.
        OUTBOX_MAX_AGE_S 가 지난 것과 읽을 수 없는 것은 버린다.
        """
        box = FileOutbox(self.recordings_dir).dir
        if not box.is_dir():
            return
        for path in sorted(box.glob("*.json")):
            try:
                note = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                path.unlink(missing_ok=True)
                continue
            if time.time() - float(note.get("at") or 0) > OUTBOX_MAX_AGE_S:
                print(f"[outbox] 오래된 알림을 버린다: {str(note.get('text'))[:60]}", flush=True)
                path.unlink(missing_ok=True)
                continue
            channel = self._channel_for({"text_channel_id": note.get("channel_id")})
            file = note.get("file")
            attachment = discord.File(file) if file and Path(file).exists() else None
            if not await self._notify(channel, note.get("text") or "", file=attachment):
                if channel is None:                 # 봇이 볼 수 없는 채널이다. 다시 해도 같다
                    path.unlink(missing_ok=True)
                    continue
                break
            path.unlink(missing_ok=True)

    async def _notice_interrupted(self, *, guild_id=None) -> None:
        """봇이 뜨기 전에 녹음 중이던 회의의 채널에 재시작 안내를 한 번 올린다. 끊긴 지 한 시간 안일 때만."""
        for _, m in interrupted_meetings(self.recordings_dir, since=self._started_at, guild_id=guild_id,
                                         exclude=self._holding()):
            session = str(m.get("session"))
            if session in self._resume_noticed:
                continue
            self._resume_noticed.add(session)
            await self._notify(self._channel_for(m), RESUME_NOTICE)

    def _worker_warning(self) -> str:
        """저장 알림 끝에 붙이는 경고. 워커가 처리를 못 하고 있을 때만 쓴다. /recover 가 없어 이 자리가 유일하다."""
        trouble = worker_trouble(self.recordings_dir)
        return f"\n⚠️ {trouble}. 워커가 다시 돌면 이어서 처리합니다. 운영자에게 알려 주세요." if trouble else ""

    def _holding(self) -> set[str]:
        """봇이 지금 들고 있는 회의 ID. 녹음 중(_active)과 저장 중(_processing). 그 wav 를 워커가 집으면 안 된다."""
        return {r.meeting_id for r in self._active.values()} | set(self._processing)

    # ------------------------------------------------------------------ 종료
    def _on_recording_done(self, sink, ctx: discord.ApplicationContext) -> None:
        """py-cord 가 stop_recording 안에서 동기로 부른다 (reader.py:182-184). 태스크만 예약한다."""
        guild_id = ctx.guild.id
        loop = getattr(self.bot, "loop", None)

        def _spawn() -> None:
            task = asyncio.get_running_loop().create_task(self._finish(guild_id))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is not None and (loop is None or running is loop):
            _spawn()
        elif loop is not None:
            loop.call_soon_threadsafe(_spawn)   # 라우터 스레드에서 시작될 수도 있다

    async def _flush_loop(self, rec: _Recording) -> None:
        try:
            while True:
                await asyncio.sleep(FLUSH_EVERY_S)
                rec.sink.flush_idle()
        except asyncio.CancelledError:
            pass

    def _write_status(self, rec: _Recording, status: str, entries: list[dict], transcript: str | None = None):
        return write_status(self.recordings_dir, rec.meeting_id, status=status, entries=entries, guild=rec.guild_name,
                            channel=rec.voice_channel_name, library_version=discord.__version__,
                            started_at=rec.started_at, meeting_dir=rec.meeting_id, transcript=transcript,
                            extra={"timezone": rec.timezone, "be": rec.be, "guild_id": str(rec.guild_id),
                                   "voice_channel_id": str(rec.voice_channel_id),
                                   "text_channel_id": str(rec.text_channel_id) if rec.text_channel_id else None,
                                   "workspace_id": rec.workspace_id, "hint_names": rec.hint_names})

    async def _notify(self, channel, text: str, file=None) -> bool:
        """채널에 올린다. 디스코드 쪽 실패는 로그로만 남긴다. 파일과 상태 처리가 알림에 막히지 않는다."""
        if channel is None:
            return False
        try:
            if file is not None:
                await channel.send(text, file=file)
            else:
                await channel.send(text)
            return True
        except Exception as e:  # noqa: BLE001
            print(f"[notify] 채널 알림 실패: {type(e).__name__}: {e} :: {text[:60]}", flush=True)
            return False

    def _channel_for(self, result: dict):
        cid = result.get("text_channel_id")
        if not cid:
            return None
        try:
            return self.bot.get_channel(int(cid))
        except (TypeError, ValueError, AttributeError):
            return None

    async def _finish(self, guild_id: int) -> None:
        """/stop, /end, 봇 퇴장, py-cord 콜백이 전부 여기로 온다. 표에서 먼저 꺼내 한 번만 돈다.

        꺼낸 순간부터 이 길드는 새 녹음을 받을 수 있다. 이 세션은 _processing 에 옮겨 두고 저장이 끝나면 done 을
        켠다. saved 를 다 쓴 뒤 회의 잠금을 놓고 워커를 찌른다. 처리와 그 진행 알림은 워커가 한다.
        완료 신호와 자원 정리는 무슨 일이 있어도 finally 에서 한다.
        """
        rec = self._active.pop(guild_id, None)
        if rec is None:
            return
        self._processing[rec.meeting_id] = rec
        try:
            if rec.flush_task is not None:
                rec.flush_task.cancel()
            drain_error = None
            try:
                rec.sink.cleanup()   # 두 번 불러도 안전하다. 재정렬 창을 비운다
            except Exception as e:  # noqa: BLE001
                drain_error = f"{type(e).__name__}: {e}"

            entries = await asyncio.to_thread(rec.pool.close)
            guild = self.bot.get_guild(guild_id)
            for e in entries:
                member = guild.get_member(int(e["user_id"])) if guild is not None else None
                if member is not None:
                    e["display_name"] = member.display_name
            path, manifest = self._write_status(rec, STATUS_SAVED, entries)
            for e in entries:
                print(f"[saved] {e['file']}  {e['display_name']}  {e['duration_sec']}s", flush=True)

            if not entries:
                await self._notify(rec.text_channel, "⚠️ 저장된 오디오가 없습니다. 아무도 말하지 않았거나 py-cord 가 "
                                   "음성을 수신하지 못했습니다 (requirements.txt 의 PR 브랜치 참고).")
                return
            warn = ""
            if drain_error:
                warn += f"\n⚠️ 마지막 패킷 정리 실패 ({drain_error}). 회의 끝부분이 빠졌을 수 있습니다."
            if rec.pool.dropped:
                warn += f"\n⚠️ 쓰기 큐가 넘쳐 조각 {rec.pool.dropped}개를 버렸습니다."
            # saved 를 다 쓴 뒤에 잠금을 놓는다. 이제 워커가 집는다. 찌르면 주기를 기다리지 않고 바로 돈다
            if rec.lock is not None:
                rec.lock.release()
            request_nudge(self.recordings_dir)
            ahead = queue_ahead(self.recordings_dir, rec.meeting_id, exclude=self._holding())
            await self._notify(rec.text_channel, f"✅ 녹음을 저장했습니다(화자 {len(entries)}명). 처리 진행은 이 채널에 "
                               f"올라옵니다(앞에 {ahead}건).{warn}{self._worker_warning()}")

            if self.on_session_saved is not None:
                try:
                    await self.on_session_saved(manifest, path)
                except Exception as e:  # 훅 실패가 녹음 저장까지 망치지 않게
                    print(f"[warn] on_session_saved 훅 실패: {e!r}", flush=True)
        except Exception as e:  # noqa: BLE001 - 여기 오면 파일 저장이 죽은 것이다. 신호는 아래서 켠다
            print(f"[finish] 세션 {rec.meeting_id} 저장 예외: {type(e).__name__}: {e}", flush=True)
            await self._notify(rec.text_channel, f"⚠️ 녹음 저장 중 예외: {type(e).__name__}: {e}. 트랙은 남아 있습니다. "
                               "끝나지 않은 단계는 워커가 이어서 처리합니다.")
        finally:
            if rec.lock is not None:
                rec.lock.release()          # 저장 중 예외로 위에서 놓지 못했을 때
            self._processing.pop(rec.meeting_id, None)
            rec.done.set()
