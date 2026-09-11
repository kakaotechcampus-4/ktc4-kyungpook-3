"""Phase 0 — Discord 음성채널 화자별 녹음 어댑터 (py-cord Cog).

"Discord" 라는 이름은 ai/ 안에서는 이 파일에만 있어야 합니다.
봇 프로세스 자체(기동, 토큰, 상시 실행)는 be/bot/main.py 가 소유하고, 이 Cog 를 add_cog 로 붙여 씁니다:

    from capture.discord_adapter import RecordingCog
    bot.add_cog(RecordingCog(bot))

이 파일의 책임은 sink 에서 트랙을 꺼내 recording_store.save_session 에 넘기는 것까지입니다.
저장 결과(매니페스트 dict)는 on_session_saved 콜백으로 BE 에 전달됩니다 → BE 가 전사/파이프라인을 이어 붙입니다.

슬래시 커맨드
  /join   - 명령한 사람이 있는 음성채널에 봇 입장
  /record - 화자별 트랙 녹음 시작 (SyncedWaveSink — 무음 패딩으로 실제 시각 정렬)
  /stop   - 녹음 종료 → recordings/{user_id}_{ts}.wav + recordings/session_{ts}.json
  /leave  - 음성채널 퇴장 (녹음 중에는 거절 → 먼저 /stop 또는 /end 사용)
  /end    - 녹음 저장이 끝날 때까지 기다린 뒤 음성채널 퇴장

py-cord 버전 호환 메모 (2026-09 기준, requirements.txt 참고)
  - 2.6.x: 고전 API. vc.recording / callback(sink, *args). DAVE(E2EE) 미지원 → 2026-03-01 이후 수신 불가.
  - 2.8.x: DAVE "송신"만 지원. 수신(녹음) 경로 미완성 (pycord #3139).
  - PR #3159 (2.9.0rc1 예정): DAVE 수신 지원. vc.is_recording(), sink.audio_data 의 key 가 Member/User 객체.
  아래 코드는 세 경우를 모두 처리합니다.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

import discord

from capture.recording_store import Track, key_to_user_id, pcm_duration_sec, save_session, silence_padding
from shared.config import RECORDINGS_DIR

SessionSavedHook = Callable[[dict, Path], Awaitable[None]]


class SyncedWaveSink(discord.sinks.WaveSink):
    """화자별 wav 의 내부 시간축을 녹음 시작(0초) 기준 실제 경과시간으로 맞춘 WaveSink.

    `start_recording(..., sync_start=True)` 는 2.7 부터 deprecated 이고 이 PR #3159 브랜치에서는
    경고만 띄운 채 아무 동작도 하지 않는다 — AudioReader/Sink.write() 어디에도 무음 패딩 로직이 없다
    (discord/sinks/core.py, voice/receive/{reader,router}.py 확인). 그 결과 말이 뜸한 화자의 wav 는
    내부 초 단위가 실제 시각과 무관해져서, 세션(여러 화자) 병합 시 `start` 만으로 정렬해도 발화 순서가
    섞인다 — "누가 무엇에 답했나"(담당자 수락 판정)가 깨지는 지점.
    write() 호출 시각(wall clock)을 기준으로 무음을 앞에 채워 모든 화자 파일이 같은 0초를
    공유하게 만든다. 초 단위 근사(네트워크 지연만큼 오차)라 샘플 정밀도는 아니지만, 대화 turn 순서
    복원에는 충분하다.
    """

    def __init__(self):
        super().__init__()
        self._session_start = time.time()
        self._next_at: dict[object, float] = {}  # user -> 이 사용자 트랙이 이미 채워진 실제시각

    def write(self, data, user) -> None:
        raw = data.pcm if hasattr(data, "pcm") else data
        now = time.time()
        gap = now - self._next_at.get(user, self._session_start)
        self._next_at[user] = now + pcm_duration_sec(raw)
        super().write(silence_padding(gap) + raw, user)


def is_recording(vc) -> bool:
    fn = getattr(vc, "is_recording", None)
    if callable(fn):
        return bool(fn())
    return bool(getattr(vc, "recording", False))


def required_intents() -> discord.Intents:
    """이 Cog 가 동작하는 데 필요한 인텐트. be/bot/main.py 가 Bot 생성 시 사용."""
    intents = discord.Intents.default()
    intents.voice_states = True
    intents.message_content = True
    intents.members = True  # user_id → 표시 이름
    return intents


class RecordingCog(discord.Cog):
    def __init__(self, bot: discord.Bot, *, recordings_dir: Path = RECORDINGS_DIR,
                 on_session_saved: SessionSavedHook | None = None):
        self.bot = bot
        self.recordings_dir = recordings_dir
        self.on_session_saved = on_session_saved
        # guild_id -> 저장(finished_callback) 완료 신호. /end 가 disconnect 전에 대기하는 데 씀.
        self._save_done: dict[int, asyncio.Event] = {}

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
            await vc.move_to(channel)
        else:
            await channel.connect()
        await ctx.respond(f"`{channel.name}` 입장 완료. `/record` 로 녹음을 시작하세요.")

    @discord.slash_command(name="record", description="화자별 트랙 녹음을 시작합니다")
    async def record(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None or not vc.is_connected():
            await ctx.respond("봇이 음성채널에 없습니다. `/join` 먼저 실행해 주세요.", ephemeral=True)
            return
        if is_recording(vc):
            await ctx.respond("이미 녹음 중입니다. `/stop` 으로 먼저 종료하세요.", ephemeral=True)
            return
        vc.start_recording(SyncedWaveSink(), self.finished_callback, ctx)
        await ctx.respond(f"🔴 녹음 시작 (`{vc.channel.name}`). 말이 끝나면 `/stop` 을 실행하세요.\n※ 유저별로 개별 wav 로 저장됩니다.")

    @discord.slash_command(name="stop", description="녹음을 종료하고 화자별 wav 로 저장합니다")
    async def stop(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None or not is_recording(vc):
            await ctx.respond("진행 중인 녹음이 없습니다.", ephemeral=True)
            return
        if ctx.guild is not None:
            self._save_done[ctx.guild.id] = asyncio.Event()
        vc.stop_recording()  # 종료 후 finished_callback 호출
        await ctx.respond("⏹ 녹음 종료. 파일 저장 중...")

    @discord.slash_command(name="leave", description="봇이 음성채널에서 나갑니다")
    async def leave(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None:
            await ctx.respond("봇이 음성채널에 없습니다.", ephemeral=True)
            return
        if is_recording(vc):
            await ctx.respond("녹음 중입니다. 먼저 `/stop` 으로 종료하거나, 저장까지 기다렸다가 나가려면 `/end` 를 사용하세요.", ephemeral=True)
            return
        await vc.disconnect(force=True)
        await ctx.respond("음성채널에서 나갔습니다.")

    @discord.slash_command(name="end", description="녹음 저장이 끝나면 음성채널에서 나갑니다")
    async def end(self, ctx: discord.ApplicationContext) -> None:
        vc = ctx.voice_client
        if vc is None:
            await ctx.respond("봇이 음성채널에 없습니다.", ephemeral=True)
            return
        if is_recording(vc):
            event = asyncio.Event()
            if ctx.guild is not None:
                self._save_done[ctx.guild.id] = event
            vc.stop_recording()
            await ctx.respond("⏹ 녹음 종료. 저장이 끝나면 나갑니다...")
            await event.wait()
        else:
            await ctx.respond("음성채널에서 나가는 중...")
        await vc.disconnect(force=True)
        if ctx.channel is not None:
            await ctx.channel.send("음성채널에서 나갔습니다.")

    async def finished_callback(self, sink, ctx: discord.ApplicationContext) -> None:
        """녹음 종료 시 호출. sink.audio_data = {user_key: AudioData}."""
        try:
            await self._save_recording(sink, ctx)
        finally:
            # /end 가 disconnect 전에 이 콜백(저장 + 후속 훅)이 끝나길 기다리고 있을 수 있음
            event = self._save_done.pop(ctx.guild.id, None) if ctx.guild else None
            if event is not None:
                event.set()

    async def _save_recording(self, sink, ctx: discord.ApplicationContext) -> None:
        # 2.9 계열은 콜백 예약 직후 다른 스레드에서 sink.cleanup()(WAV 포맷)을 수행하므로 잠깐 기다림
        for _ in range(10):
            if getattr(sink, "finished", True):
                break
            await asyncio.sleep(0.2)

        tracks: list[Track] = []
        for key, audio in sink.audio_data.items():
            user_id = key_to_user_id(key)
            if user_id is None:
                print("[warn] 사용자 식별이 안 된 오디오 트랙을 건너뜁니다.")
                continue
            member = ctx.guild.get_member(user_id) if ctx.guild else None
            display_name = member.display_name if member else getattr(key, "display_name", None) or str(user_id)
            audio.file.seek(0)
            tracks.append(Track(user_id=str(user_id), display_name=display_name, raw=audio.file.read()))

        vc = ctx.voice_client
        manifest_path, manifest = save_session(
            tracks, self.recordings_dir,
            guild=ctx.guild.name if ctx.guild else None,
            channel=vc.channel.name if vc is not None and vc.channel is not None else None,
            library_version=discord.__version__,
        )
        for e in manifest["speakers"]:
            print(f"[saved] {e['file']}  {e['display_name']}  {e['duration_sec']}s")
        print(f"[saved] 매니페스트 {manifest_path.name}")

        if manifest["speakers"]:
            lines = [f"- **{e['display_name']}** → `{e['file']}` ({e['duration_sec']}s)" for e in manifest["speakers"]]
            msg = f"✅ 저장 완료 (세션 `{manifest['session']}`, 화자 {len(lines)}명)\n" + "\n".join(lines)
        else:
            msg = ("⚠️ 저장된 오디오가 없습니다. 아무도 말하지 않았거나, 사용 중인 py-cord 버전이 "
                   "DAVE(E2EE) 음성 수신을 지원하지 않을 수 있습니다 (requirements.txt 참고).")
        try:
            await ctx.followup.send(msg)
        except Exception:  # 인터랙션 토큰 만료 등
            if ctx.channel is not None:
                await ctx.channel.send(msg)

        if self.on_session_saved is not None and manifest["speakers"]:
            try:
                await self.on_session_saved(manifest, manifest_path)
            except Exception as e:  # BE 후처리 실패가 녹음 저장까지 망치지 않게
                print(f"[warn] on_session_saved 훅 실패: {e!r}")
