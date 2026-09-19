"""디스코드 음성 채널 화자별 녹음 어댑터 (py-cord Cog). 종료 뒤 배치 전사, 할일 추출, BE 인계까지 잇는다.

"Discord" 라는 이름은 ai/ 안에서는 capture/ 안에만 있어야 한다.
봇 프로세스(기동, 토큰, 상시 실행)는 backend/bot/main.py 가 소유하고, 이 Cog 를 add_cog 로 붙인다:

    from capture.discord_adapter import RecordingCog, required_intents
    bot.add_cog(RecordingCog(bot, on_session_saved=...))

명령
  /join     명령한 사람이 있는 음성 채널에 봇 입장
  /record   화자별 트랙 녹음 시작. 채널에 "녹음·전사 중" 을 알리고 BE 에 회의를 만든다
  /stop     녹음 종료. 트랙을 닫고 전사 → 할일 추출 → BE 인계를 돌려 결과를 채널에 올린다
  /leave    음성 채널 퇴장 (녹음 중에는 거절. 앞 회의의 후처리 중에는 된다)
  /end      자기 녹음의 후처리까지 끝나면 퇴장. 그 사이 새 녹음이 시작됐으면 남는다
  /recover  이 서버에서 끝까지 처리되지 않은 회의를 마지막 단계 다음부터 마저 처리한다

녹음은 StreamingSink + TrackWriter 다. 패킷을 받는 즉시 16kHz 모노로 바꿔 화자별 wav 에 흘리고
(메모리가 회의 길이와 무관), 트랙 안의 위치는 녹음 시작부터 흐른 monotonic 시간이다. 그래서
트랙들이 같은 시계 위에 있고 종료 뒤 stt/batch.py 가 그대로 정렬한다. 벽시계는 매니페스트
started_at 에 한 번만 적는다. 실시간 게시 Cog(capture/realtime/)는 이 프로세스에 올리지 않는다.
음성 연결은 길드마다 하나라 녹음기 둘이 같이 돌 수 없다.

세션은 둘로 나눠 든다. _active 는 녹음 중인 것(길드마다 하나), _processing 은 트랙을 닫고 후처리
중인 것(회의 ID 마다). 앞 회의의 전사가 도는 동안에도 새 녹음을 받는다. 연달아 잡힌 회의에서 앞
회의 전사(수 분)가 끝날 때까지 막으면 다음 회의 첫 발화를 잃기 때문이다. 후처리는 프로세스에서
한 번에 하나만 돈다 (MM_MAX_CONCURRENT_MEETINGS, 기본 1). 로컬 모델은 CPU 를 다 쓴다.

종료 뒤 처리는 capture/recorder.py 의 process_session 이다. /stop 과 /recover 가 같은 함수를 쓴다.
BE 인계(capture/handoff.py)는 BE_BASE_URL 과 BE_WORKSPACE_ID 가 있을 때만 돈다. 채널 알림은
전부 _notify 를 거쳐서, 디스코드 쪽 실패가 파일과 상태 처리를 막지 않는다.
on_session_saved(manifest, manifest_path) 훅은 그 뒤에 불린다. manifest["transcript"] 에 회의록
경로가 있고 transcripts/session_<회의ID>.transcript.json 이 BE 가 읽는 Transcript 다.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

import discord

from capture.handoff import from_env as handoff_from_env
from capture.recorder import (STATUS_EXTRACTED, STATUS_FAILED, STATUS_HANDED_OFF, STATUS_PARTIAL, STATUS_RECORDING,
                              STATUS_SAVED, STATUS_TRANSCRIBED, NullSession, backend_from_env, build_extractor,
                              meeting_title, process_session, recover, write_status)
from capture.streaming_sink import StreamingSink
from capture.track_writer import TrackPool
from capture.voice_client import SafeVoiceClient
from shared.config import RECORDINGS_DIR, TRANSCRIPTS_DIR, settings
from shared.schemas import now_iso
from stt.speech_gate import SpeechGate

SessionSavedHook = Callable[[dict, Path], Awaitable[None]]

NOTICE = "🔴 녹음·전사 중입니다. 이 음성 채널의 말은 화자별로 녹음되고 `/stop` 뒤 회의록이 여기 올라옵니다."
FLUSH_EVERY_S = 0.2   # 재정렬 창에 갇힌 마지막 패킷을 이 주기로 비운다. 패킷은 20ms 마다 온다
STAGE_LABEL = {STATUS_TRANSCRIBED: "전사", STATUS_EXTRACTED: "할일 추출", STATUS_HANDED_OFF: "BE 인계",
               "stt": "전사", "extract": "할일 추출", "handoff": "BE 인계"}


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


def _name_resolver(guild):
    """uid → 서버 표시 이름. 복구로 되찾은 트랙의 이름을 채우는 데 쓴다."""
    def name_of(uid: str):
        try:
            member = guild.get_member(int(uid)) if guild is not None else None
        except (TypeError, ValueError):
            member = None
        return member.display_name if member is not None else None
    return name_of


class RecordingCog(discord.Cog):
    def __init__(self, bot: discord.Bot, *, recordings_dir: Path = RECORDINGS_DIR,
                 transcripts_dir: Path = TRANSCRIPTS_DIR, on_session_saved: SessionSavedHook | None = None,
                 stt_factory=None, gate_factory=None, extractor_factory=None, handoff_factory=None):
        """stt_factory() 는 (백엔드, 모델 이름, 워커 수). 기본은 MM_STT_BACKEND 환경 변수를 본다.

        extractor_factory() 는 extract_tasks 를 부를 함수 또는 None (LLM 설정 없음).
        handoff_factory() 는 capture.handoff.Handoff 또는 None (BE 설정 없음). 둘 다 기본은 환경 변수다.
        """
        self.bot = bot
        self.recordings_dir = recordings_dir
        self.transcripts_dir = transcripts_dir
        self.on_session_saved = on_session_saved
        self._stt_factory = stt_factory or backend_from_env
        self._gate_factory = gate_factory if gate_factory is not None else SpeechGate
        self._extractor_factory = extractor_factory if extractor_factory is not None else build_extractor
        self._handoff_factory = handoff_factory if handoff_factory is not None else handoff_from_env
        self._active: dict[int, _Recording] = {}        # 길드 ID → 녹음 중
        self._processing: dict[str, _Recording] = {}   # 회의 ID → 후처리 중
        self._post_sem = asyncio.Semaphore(max(1, int(os.environ.get("MM_MAX_CONCURRENT_MEETINGS", "1"))))
        self._tasks: set[asyncio.Task] = set()

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

    @discord.slash_command(name="record", description="화자별 트랙 녹음을 시작합니다")
    async def record(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None or not vc.is_connected():
            await ctx.respond("봇이 음성채널에 없습니다. `/join` 먼저 실행해 주세요.", ephemeral=True)
            return
        if is_recording(vc) or ctx.guild.id in self._active:
            await ctx.respond("이미 녹음 중입니다. `/stop` 으로 먼저 종료하세요.", ephemeral=True)
            return
        ts = int(time.time())
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
                         text_channel_id=getattr(ctx.channel, "id", None), workspace_id=cfg.be_workspace_id or None,
                         timezone=cfg.meeting_timezone)
        vc.start_recording(sink, self._on_recording_done, ctx)
        self._active[ctx.guild.id] = rec
        # 시작 시점에 매니페스트를 먼저 쓴다. 봇이 죽어도 이 회의가 있었다는 기록과 트랙이 남는다
        _, manifest = self._write_status(rec, STATUS_RECORDING, [])
        rec.flush_task = asyncio.create_task(self._flush_loop(rec))
        await ctx.respond(NOTICE)
        # BE 에 회의를 먼저 만들어 둔다. 실패해도 녹음은 계속되고 인계 단계가 다시 만든다
        handoff = self._handoff_factory()
        if handoff is not None:
            try:
                await asyncio.to_thread(handoff.start, {"be": rec.be}, title=meeting_title(manifest))
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
        await ctx.respond("⏹ 녹음 종료. 트랙을 닫고 전사합니다. 회의록이 이 채널에 올라옵니다.")
        vc.stop_recording()

    @discord.slash_command(name="leave", description="봇이 음성채널에서 나갑니다")
    async def leave(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None:
            await ctx.respond("봇이 음성채널에 없습니다.", ephemeral=True)
            return
        if is_recording(vc) or ctx.guild.id in self._active:
            await ctx.respond("녹음 중입니다. 먼저 `/stop` 으로 종료하거나, 전사까지 기다렸다가 나가려면 `/end` 를 사용하세요.",
                              ephemeral=True)
            return
        await vc.disconnect(force=True)
        await ctx.respond("음성채널에서 나갔습니다.")

    @discord.slash_command(name="end", description="전사가 끝나면 음성채널에서 나갑니다")
    async def end(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None:
            await ctx.respond("봇이 음성채널에 없습니다.", ephemeral=True)
            return
        rec = self._active.get(ctx.guild.id)
        if rec is not None and is_recording(vc):
            await ctx.respond("⏹ 녹음 종료. 전사가 끝나면 나갑니다.")
            vc.stop_recording()
            await rec.done.wait()          # 자기 세션만 기다린다
            if ctx.guild.id in self._active:
                # 기다리는 사이 새 녹음이 시작됐다. 그 연결은 새 녹음 것이라 끊지 않는다
                await self._notify(ctx.channel, "새 녹음이 시작돼 음성채널에 남습니다.")
                return
        else:
            await ctx.respond("음성채널에서 나가는 중...")
        await vc.disconnect(force=True)
        await self._notify(ctx.channel, "음성채널에서 나갔습니다.")

    @discord.slash_command(name="recover", description="끝까지 처리되지 않은 녹음을 마저 처리합니다")
    async def recover_cmd(self, ctx: discord.ApplicationContext) -> None:
        await ctx.respond("이 서버의 남은 녹음을 찾아 마지막 단계 다음부터 마저 처리합니다...")
        backend, model_name, workers = self._stt_factory()
        async with self._post_sem:
            results = await asyncio.to_thread(recover, self.recordings_dir, backend=backend, model_name=model_name,
                                              workers=workers, gate=self._gate_factory(),
                                              transcripts_dir=self.transcripts_dir,
                                              extractor=self._extractor_factory(), handoff=self._handoff_factory(),
                                              guild_id=ctx.guild.id, name_of=_name_resolver(ctx.guild))
        shown = 0
        for r in results:
            if not r["ran"] and r["status"] != STATUS_FAILED:
                continue   # 설정이 없어 그 자리에 그대로인 회의는 매번 알리지 않는다
            shown += 1
            channel = self._channel_for(r) or ctx.channel   # 결과는 그 회의를 시작한 채널에
            await self._notify(channel, f"세션 `{r['session']}`")
            await self._report(channel, r["session"], r)
        if shown == 0:
            waiting = len(results)
            await self._notify(ctx.channel, "마저 처리할 녹음이 없습니다." +
                               (f" 설정이 없어 멈춘 회의 {waiting}개는 그대로입니다." if waiting else ""))

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
                                   "workspace_id": rec.workspace_id})

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

        꺼낸 순간부터 이 길드는 새 녹음을 받을 수 있다. 이 세션은 _processing 에 옮겨 두고 끝나면
        done 을 켠다. 완료 신호와 자원 정리는 무슨 일이 있어도 finally 에서 한다.
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
            head = f"✅ 저장 완료 (화자 {len(entries)}명). 전사 중입니다..."
            if drain_error:
                head += f"\n⚠️ 마지막 패킷 정리 실패 ({drain_error}). 회의 끝부분이 빠졌을 수 있습니다."
            if rec.pool.dropped:
                head += f"\n⚠️ 쓰기 큐가 넘쳐 조각 {rec.pool.dropped}개를 버렸습니다."
            await self._notify(rec.text_channel, head)

            # 전사 → 할일 추출 → BE 인계. 어느 단계가 죽어도 매니페스트에 남고 /recover 가 거기서 잇는다
            backend, model_name, workers = self._stt_factory()
            async with self._post_sem:
                result = await asyncio.to_thread(process_session, self.recordings_dir, manifest, backend=backend,
                                                 model_name=model_name, workers=workers, gate=self._gate_factory(),
                                                 transcripts_dir=self.transcripts_dir,
                                                 extractor=self._extractor_factory(), handoff=self._handoff_factory(),
                                                 name_of=_name_resolver(guild))
            await self._report(rec.text_channel, rec.meeting_id, result)

            if self.on_session_saved is not None:
                try:
                    await self.on_session_saved(manifest, path)
                except Exception as e:  # BE 후처리 실패가 녹음·전사 결과까지 망치지 않게
                    print(f"[warn] on_session_saved 훅 실패: {e!r}", flush=True)
        except Exception as e:  # noqa: BLE001 - 여기 오면 파일 처리가 죽은 것이다. 신호는 아래서 켠다
            print(f"[finish] 세션 {rec.meeting_id} 후처리 예외: {type(e).__name__}: {e}", flush=True)
            await self._notify(rec.text_channel, f"⚠️ 후처리 중 예외: {type(e).__name__}: {e}. 트랙은 남아 있습니다. "
                               "`/recover` 로 다시 시도하세요.")
        finally:
            self._processing.pop(rec.meeting_id, None)
            rec.done.set()

    async def _report(self, channel, session, result: dict) -> None:
        """process_session 의 결과를 채널에 올린다. 이번에 끝낸 단계만 말한다."""
        tr = result.get("transcribe")
        if tr is not None:
            s = tr.get("summary")
            text = f"📝 회의록 (세션 `{session}`, 화자 {result.get('speakers', 0)}명, 줄 {tr['lines']}개"
            if s:
                text += f", 전사 호출 {s['calls']}회, 보낸 오디오 {s['audio_sent_s']}초"
            text += ")"
            if result.get("retried"):
                text += f"\n🔁 실패했던 {result['retried']}줄을 다시 보냈습니다."
            if tr["failed"]:
                if result["status"] == STATUS_PARTIAL:
                    text += f"\n⚠️ 전사 실패 {tr['failed']}줄. 이 회의는 완료로 닫지 않았습니다. `/recover` 가 그 구간만 다시 보냅니다."
                else:
                    text += f"\n⚠️ 다시 보내도 실패한 {tr['failed']}줄은 회의록에 없습니다. 구간은 매니페스트에 남아 있습니다."
            await self._notify(channel, text, file=discord.File(str(tr["markdown"])))
        if STATUS_EXTRACTED in result["ran"]:
            tasks = result.get("tasks") or []
            shown = "\n".join(f"- {x.get('task')} / {x.get('assignee_resolved') or x.get('assignee_mention') or '담당 미정'} "
                              f"/ {x.get('due_date') or '마감 미정'}" for x in tasks[:10]) or "- (없음)"
            await self._notify(channel, f"📋 할일 {len(tasks)}건\n{shown}")
        be = result.get("be")
        if STATUS_HANDED_OFF in result["ran"] and be:
            await self._notify(channel, f"📨 BE 인계 완료. 회의 `{be.get('meeting_id')}`, 항목 {be.get('item_count', 0)}건")
        for stage, why in result.get("skipped", {}).items():
            await self._notify(channel, f"ℹ️ {STAGE_LABEL.get(stage, stage)}은 건너뜁니다 ({why}).")
        if result["status"] == STATUS_FAILED:
            label = STAGE_LABEL.get(result.get("failed_stage"), result.get("failed_stage"))
            print(f"[{result.get('failed_stage')}] 세션 {session} 실패: {result['error']}", flush=True)
            await self._notify(channel, f"⚠️ {label} 실패: {result['error']}\n트랙과 지금까지의 결과는 남아 있습니다. "
                               f"`/recover` 로 이 단계부터 다시 시도하세요.")
