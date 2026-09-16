"""디스코드 음성 채널 화자별 녹음 어댑터 (py-cord Cog). 종료 뒤 배치 전사까지 잇는다.

"Discord" 라는 이름은 ai/ 안에서는 capture/ 안에만 있어야 한다.
봇 프로세스(기동, 토큰, 상시 실행)는 backend/bot/main.py 가 소유하고, 이 Cog 를 add_cog 로 붙인다:

    from capture.discord_adapter import RecordingCog, required_intents
    bot.add_cog(RecordingCog(bot, on_session_saved=...))

명령
  /join     명령한 사람이 있는 음성 채널에 봇 입장
  /record   화자별 트랙 녹음 시작. 채널에 "녹음·전사 중" 을 알린다
  /stop     녹음 종료. 트랙을 닫고 배치 전사를 돌려 회의록을 채널에 올린다
  /leave    음성 채널 퇴장 (녹음 중에는 거절)
  /end      전사까지 끝나면 퇴장
  /recover  봇이 죽었거나 전사가 실패해 남은 녹음을 마저 전사한다

녹음은 StreamingSink + TrackWriter 다. 패킷을 받는 즉시 16kHz 모노로 바꿔 화자별 wav 에 흘리고
(메모리가 회의 길이와 무관), 트랙 안의 위치는 녹음 시작부터 흐른 monotonic 시간이다. 그래서
트랙들이 같은 시계 위에 있고 종료 뒤 stt/batch.py 가 그대로 정렬한다. 벽시계는 매니페스트
started_at 에 한 번만 적는다. 실시간 게시 Cog(capture/realtime/)는 이 프로세스에 올리지 않는다.
음성 연결은 길드마다 하나라 녹음기 둘이 같이 돌 수 없다.

on_session_saved(manifest, manifest_path) 훅은 전사까지 끝난 뒤 불린다. manifest["transcript"] 에
회의록 경로가 있고 transcripts/session_<ts>.transcript.json 이 BE 가 읽는 Transcript 다.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

import discord

from capture.recorder import (STATUS_FAILED, STATUS_RECORDING, STATUS_SAVED, STATUS_TRANSCRIBED, NullSession,
                              backend_from_env, extract_after_transcription, recover, transcribe_session,
                              write_status)
from capture.streaming_sink import StreamingSink
from capture.track_writer import TrackPool
from capture.voice_client import SafeVoiceClient
from shared.config import RECORDINGS_DIR, TRANSCRIPTS_DIR
from shared.schemas import now_iso
from stt.speech_gate import SpeechGate

SessionSavedHook = Callable[[dict, Path], Awaitable[None]]

NOTICE = "🔴 녹음·전사 중입니다. 이 음성 채널의 말은 화자별로 녹음되고 `/stop` 뒤 회의록이 여기 올라옵니다."
FLUSH_EVERY_S = 0.2   # 재정렬 창에 갇힌 마지막 패킷을 이 주기로 비운다. 패킷은 20ms 마다 온다


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
    voice_channel_id: int
    voice_channel_name: str | None
    guild_name: str | None
    started_at: str
    notified: set[int] = field(default_factory=set)
    flush_task: asyncio.Task | None = None
    done: asyncio.Event = field(default_factory=asyncio.Event)


class RecordingCog(discord.Cog):
    def __init__(self, bot: discord.Bot, *, recordings_dir: Path = RECORDINGS_DIR,
                 transcripts_dir: Path = TRANSCRIPTS_DIR, on_session_saved: SessionSavedHook | None = None,
                 stt_factory=None, gate_factory=None):
        """stt_factory() 는 (백엔드, 모델 이름, 워커 수). 기본은 MM_STT_BACKEND 환경 변수를 본다."""
        self.bot = bot
        self.recordings_dir = recordings_dir
        self.transcripts_dir = transcripts_dir
        self.on_session_saved = on_session_saved
        self._stt_factory = stt_factory or backend_from_env
        self._gate_factory = gate_factory if gate_factory is not None else SpeechGate
        self._recordings: dict[int, _Recording] = {}
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
        if is_recording(vc) or ctx.guild.id in self._recordings:
            await ctx.respond("이미 녹음 중입니다. `/stop` 으로 먼저 종료하세요.", ephemeral=True)
            return
        ts = int(time.time())
        meeting_id = f"{ctx.guild.id}_{ts}"
        out_dir = self.recordings_dir / meeting_id
        out_dir.mkdir(parents=True, exist_ok=True)
        pool = TrackPool(out_dir, ts)
        sink = StreamingSink(NullSession(), on_samples=pool.submit)
        rec = _Recording(meeting_id=meeting_id, ts=ts, out_dir=out_dir, sink=sink, pool=pool,
                         text_channel=ctx.channel, voice_channel_id=vc.channel.id,
                         voice_channel_name=getattr(vc.channel, "name", None),
                         guild_name=ctx.guild.name if ctx.guild else None, started_at=now_iso())
        vc.start_recording(sink, self._on_recording_done, ctx)
        self._recordings[ctx.guild.id] = rec
        # 시작 시점에 매니페스트를 먼저 쓴다. 봇이 죽어도 이 회의가 있었다는 기록과 트랙이 남는다
        self._write_status(rec, STATUS_RECORDING, [])
        rec.flush_task = asyncio.create_task(self._flush_loop(rec))
        await ctx.respond(NOTICE)

    @discord.slash_command(name="stop", description="녹음을 종료하고 회의록을 만듭니다")
    async def stop(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None or not is_recording(vc) or ctx.guild.id not in self._recordings:
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
        if is_recording(vc) or ctx.guild.id in self._recordings:
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
        rec = self._recordings.get(ctx.guild.id)
        if rec is not None and is_recording(vc):
            await ctx.respond("⏹ 녹음 종료. 전사가 끝나면 나갑니다.")
            vc.stop_recording()
            await rec.done.wait()
        else:
            await ctx.respond("음성채널에서 나가는 중...")
        await vc.disconnect(force=True)
        if ctx.channel is not None:
            await ctx.channel.send("음성채널에서 나갔습니다.")

    @discord.slash_command(name="recover", description="전사가 안 끝난 녹음을 마저 전사합니다")
    async def recover_cmd(self, ctx: discord.ApplicationContext) -> None:
        await ctx.respond("남은 녹음을 찾아 전사합니다...")
        backend, model_name, workers = self._stt_factory()
        results = await asyncio.to_thread(recover, self.recordings_dir, backend=backend, model_name=model_name,
                                          workers=workers, gate=self._gate_factory(),
                                          transcripts_dir=self.transcripts_dir)
        if not results:
            await ctx.channel.send("전사가 안 끝난 녹음이 없습니다.")
            return
        for r in results:
            if r["status"] == STATUS_TRANSCRIBED:
                await ctx.channel.send(f"✅ 세션 `{r['session']}` 전사 완료", file=discord.File(str(r["markdown"])))
            else:
                await ctx.channel.send(f"⚠️ 세션 `{r['session']}` 전사 실패: {r['error']}")

    # ------------------------------------------------------------------ 이벤트
    @discord.Cog.listener()
    async def on_voice_state_update(self, member, before, after) -> None:
        rec = self._recordings.get(member.guild.id)
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
            await rec.text_channel.send(f"{member.mention} {NOTICE}")
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
        return write_status(self.recordings_dir, rec.ts, status=status, entries=entries, guild=rec.guild_name,
                            channel=rec.voice_channel_name, library_version=discord.__version__,
                            started_at=rec.started_at, meeting_dir=rec.meeting_id, transcript=transcript)

    async def _finish(self, guild_id: int) -> None:
        """/stop, /end, 봇 퇴장, py-cord 콜백이 전부 여기로 온다. 표에서 먼저 꺼내 한 번만 돈다."""
        rec = self._recordings.pop(guild_id, None)
        if rec is None:
            return
        if rec.flush_task is not None:
            rec.flush_task.cancel()
        drain_error = None
        try:
            rec.sink.cleanup()   # 두 번 불러도 안전하다. 재정렬 창을 비운다
        except Exception as e:
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
            await rec.text_channel.send("⚠️ 저장된 오디오가 없습니다. 아무도 말하지 않았거나 py-cord 가 음성을 "
                                        "수신하지 못했습니다 (requirements.txt 의 PR 브랜치 참고).")
            rec.done.set()
            return
        head = f"✅ 저장 완료 (화자 {len(entries)}명). 전사 중입니다..."
        if drain_error:
            head += f"\n⚠️ 마지막 패킷 정리 실패 ({drain_error}). 회의 끝부분이 빠졌을 수 있습니다."
        if rec.pool.dropped:
            head += f"\n⚠️ 쓰기 큐가 넘쳐 조각 {rec.pool.dropped}개를 버렸습니다."
        await rec.text_channel.send(head)

        try:
            backend, model_name, workers = self._stt_factory()
            out = await asyncio.to_thread(transcribe_session, self.recordings_dir, manifest, backend=backend,
                                          model_name=model_name, workers=workers, gate=self._gate_factory(),
                                          transcripts_dir=self.transcripts_dir)
            rel = str(Path(out["markdown"]).relative_to(self.recordings_dir))
            path, manifest = self._write_status(rec, STATUS_TRANSCRIBED, entries, transcript=rel)
            s = out["summary"]
            text = (f"📝 회의록 (세션 `{rec.ts}`, 화자 {len(entries)}명, 줄 {len(out['lines'])}개, "
                    f"전사 호출 {s['calls']}회, 보낸 오디오 {s['audio_sent_s']}초)")
            if out["failed"]:
                text += f"\n⚠️ 전사 실패 {out['failed']}줄은 회의록에 없습니다. `/recover` 로 다시 시도할 수 있습니다."
            await rec.text_channel.send(text, file=discord.File(str(out["markdown"])))
            # 전사 뒤 할일 추출. LLM 설정이 없으면 조용히 건너뛴다. 실패해도 회의록은 이미 올라갔다
            try:
                tasks_path = await asyncio.to_thread(extract_after_transcription, self.transcripts_dir, manifest)
            except Exception as e:
                tasks_path = None
                await rec.text_channel.send(f"⚠️ 할일 추출 실패: {type(e).__name__}: {e}")
            if tasks_path is not None:
                manifest["tasks"] = str(tasks_path)
                path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
                tasks = json.loads(tasks_path.read_text(encoding="utf-8"))
                shown = "\n".join(f"- {x.get('task')} / {x.get('assignee_mention') or '담당 미정'} / {x.get('due_date') or '마감 미정'}"
                                   for x in tasks[:10]) or "- (없음)"
                await rec.text_channel.send(f"📋 할일 {len(tasks)}건\n{shown}")
        except Exception as e:
            path, manifest = self._write_status(rec, STATUS_FAILED, entries)
            print(f"[transcribe] 세션 {rec.ts} 실패: {type(e).__name__}: {e}", flush=True)
            await rec.text_channel.send(f"⚠️ 전사 실패: {type(e).__name__}: {e}\n트랙은 저장돼 있습니다. "
                                        f"`/recover` 로 다시 시도하세요.")

        if self.on_session_saved is not None:
            try:
                await self.on_session_saved(manifest, path)
            except Exception as e:  # BE 후처리 실패가 녹음·전사 결과까지 망치지 않게
                print(f"[warn] on_session_saved 훅 실패: {e!r}", flush=True)
        rec.done.set()
