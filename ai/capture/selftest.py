"""봇이 실제로 어디서 막혔는지 한 번에 보여준다.

오프라인 리플레이 하니스가 sink 위쪽을 전부 덮으므로, 실제 디스코드에서만 확인되는 것은
sink 아래뿐이다. 연결, 인텐트, 권한, DAVE 협상, 패킷 도착.

단계마다 "실패하면 사람이 무엇을 하면 되는가" 를 같이 찍는다. 원시 값만 찍으면 사용자가
스스로 추론해야 하고, 그러면 이 명령은 없는 것과 같다.

여기서 읽는 관측점 상당수가 py-cord private 속성이라 설치본 버전에 묶여 있다. 자리마다
주석으로 근거를 남겼다. 기준은 2.8.2.dev91+g10a5e8cf1 (PR #3159) 이다.
"""

from __future__ import annotations

import asyncio
import collections

import discord

from capture.streaming_sink import StreamingSink
from shared.config import env

PCM_20MS_BYTES = 3840  # 48kHz 2ch 16bit 20ms (opus.py:378-384, 실측)
PROBE_SECONDS = 3.0

CAUSES = {
    "슬래시 명령 등록": "DISCORD_GUILD_ID 를 채우면 그 서버에 즉시 등록된다. 비우면 글로벌 "
                 "등록이라 반영까지 최대 1시간 걸린다",
    "인텐트": "개발자 포털 → Bot → Privileged Gateway Intents 에서 SERVER MEMBERS 를 켠다. "
           "MESSAGE CONTENT 는 쓰지 않으므로 꺼 둔다",
    "음성 채널 권한": "서버 설정 → 역할에서 봇 역할에 채널 보기와 연결 권한을 준다",
    "음성 연결": "/record 나 /join 을 먼저 실행한다. 연결이 살아 있는데 실패로 뜨면 음성 "
             "웹소켓 폴러가 죽은 것이라 봇을 다시 띄운다",
    "DAVE": "py-cord 가 PR #3159 브랜치인지 확인한다. 2.8.x 정식판은 음성 수신이 안 된다",
    "오디오 수신": "DAVE 협상 실패, SERVER MEMBERS 인텐트 누락, 또는 봇이 들어간 방에서 아무도 "
              "말하지 않았다. 위 DAVE 단계를 먼저 본다",
    "채널 쓰기": "명령을 친 텍스트 채널에 봇 역할의 메시지 보내기 권한이 없다",
    "STT 왕복": "ai/.env 의 ELICE_API_KEY 를 확인한다. 네트워크가 막혀 있을 수도 있다",
}


class SelfTest:
    def __init__(self) -> None:
        self._steps: list[tuple[str, bool, str, bool]] = []

    def record(self, step: str, ok: bool, detail: str = "", *, info: bool = False) -> None:
        """info=True 면 all_ok() 판정에서 빼고 정보로만 찍는다."""
        self._steps.append((step, ok, detail, info))

    def all_ok(self) -> bool:
        return all(ok for _, ok, _, info in self._steps if not info)

    def report(self) -> str:
        out = []
        for step, ok, detail, info in self._steps:
            mark = "정보" if info else ("OK  " if ok else "실패")
            out.append(f"{mark} {step:<14} {detail}")
            if not ok and not info and step in CAUSES:
                out.append(f"       ↳ {CAUSES[step]}")
        body = "\n".join(out)
        if len(body) > 1900:  # 디스코드 메시지 2000자 한도
            body = body[:1900] + "\n… (잘림)"
        return "```\n" + body + "\n```"


class _NullSession:
    """오디오가 들어오는지만 보는 가짜 세션. 전사도 VAD 도 하지 않는다.

    3초 프로브에 진짜 Session 을 붙이면 워커 스레드 3개가 뜨고 유료 API 를 부른다.
    """

    def __init__(self) -> None:
        self.fed = 0

    def feed(self, speaker_id, speaker_name, samples, offset_ms) -> None:
        self.fed += 1

    def flush_speaker(self, speaker_id) -> None:
        pass


class _ProbeSink(StreamingSink):
    """3초 프로브 전용 sink. 패킷 크기 분포를 추가로 센다.

    20ms 패킷은 3840바이트여야 한다. 다른 값이 섞이면 pcm_to_mono16k 의 전제(4바이트 정렬,
    3:1 데시메이션)를 다시 봐야 한다.
    """

    def __init__(self) -> None:
        super().__init__(_NullSession())
        self.sizes: collections.Counter = collections.Counter()

    def write(self, data, user) -> None:
        pcm = getattr(data, "pcm", b"")
        self.sizes[len(pcm) if pcm else 0] += 1
        super().write(data, user)


async def run(cog, ctx: discord.ApplicationContext, use_stt: bool = False) -> str:
    # 어댑터가 이 모듈을 부르므로 모듈 최상단에서 되부르면 순환 import 다.
    from capture.discord_adapter import is_recording

    t = SelfTest()

    guild_id = env("DISCORD_GUILD_ID")
    t.record("슬래시 명령 등록", bool(guild_id),
             f"guild={guild_id}" if guild_id else "글로벌 등록 (반영까지 최대 1시간)")

    intents = cog.bot.intents
    ok = intents.members and intents.voice_states and not intents.message_content
    t.record("인텐트", ok,
             f"members={intents.members} voice_states={intents.voice_states} "
             f"message_content={intents.message_content}")

    room = getattr(getattr(ctx.author, "voice", None), "channel", None)
    if room is None:
        t.record("음성 채널 권한", False, "명령을 친 사람이 음성 채널에 없어 확인 못 함")
    else:
        p = room.permissions_for(ctx.guild.me)
        missing = [n for n, v in (("채널 보기", p.view_channel), ("연결", p.connect)) if not v]
        t.record("음성 채널 권한", not missing,
                 f"#{room.name} " + ("전부 있음" if not missing else "없음: " + ", ".join(missing)))

    vc = ctx.voice_client
    connected = vc is not None and vc.is_connected()
    detail = "/record 나 /join 을 먼저 실행하세요"
    if connected:
        # _runner 가 죽어도 is_connected() 는 True 로 남는다 (voice/state.py:329-330).
        # 이 한 줄이 SafeVoiceClient 가 막는 경로를 보는 유일한 직접 관측점이다.
        # _ssrc_to_id 는 voice/client.py:313 — 비어 있는데 녹음 중이면 죽은 상태의 표준형이다.
        runner = getattr(vc._connection, "_runner", None)
        dead = runner is not None and runner.done()
        connected = not dead
        detail = (f"{vc.channel.name} · ssrc 매핑 {len(vc._ssrc_to_id)}건"
                  + (" · 음성 WS 폴러 죽음" if dead else ""))
    t.record("음성 연결", connected, detail)

    if connected:
        # DAVE 수립 실패 시 나오는 예외 타입은 확인하지 못했다 — davey.davey 가 컴파일된
        # .so 이고 .pyi 가 예외 클래스를 하나도 선언하지 않는다. 그래서 관측값으로 판정한다.
        # ready 는 davey/__init__.pyi:183, downgraded_dave 는 voice/state.py:273.
        state = vc._connection
        session = state.dave_session
        ready = bool(session is not None and session.ready)
        bits = [f"dave={vc.is_dave_connection()}", f"ready={ready}",
                f"downgraded={state.downgraded_dave}"]
        if session is not None:
            # 패킷은 오는데 안 풀리는 경우에 이 통계가 가장 나은 신호다
            # (davey/__init__.pyi:316-325).
            for m in (vc.channel.members if vc.channel is not None else [])[:6]:
                stats = session.get_decryption_stats(m.id)
                if stats is not None:
                    bits.append(f"{m.display_name}:{stats}")
        t.record("DAVE", ready and not state.downgraded_dave, " ".join(bits))
    else:
        t.record("DAVE", False, "음성 연결이 없어 건너뜀")

    meeting = cog._meetings.get(ctx.guild.id)
    if meeting is not None:
        r = meeting.sink.level_report()
        if r["packets"] == 0:
            # 회의가 막 시작돼 아무도 말하지 않았을 수 있다. 실패가 아니다.
            t.record("오디오 수신", True, "회의 진행 중 · 아직 발화 없음", info=True)
        else:
            t.record("오디오 수신", True,
                     f"회의 진행 중 · 패킷 {r['packets']} · 최대 RMS {r['peak_rms']:.3f} "
                     f"(임계 {r['speech_rms']:.3f})")
        t.record("VAD 확정", True, f"확정 발화 {len([x for x in meeting.ledger.lines if x.final])}건",
                 info=True)
    elif connected and not is_recording(vc):
        # 이미 녹음 중인 클라이언트에 한 번 더 걸면 ClientException 이다
        # (voice/client.py:760-761). 위 is_recording 가드가 그 자리를 막는다.
        probe = _ProbeSink()
        err = None
        try:
            vc.start_recording(probe, lambda *a: None, ctx)
        except Exception as e:
            # 여기서 예외가 밖으로 나가면 사용자는 리포트 대신 인터랙션 오류만 본다.
            t.record("오디오 수신", False, f"녹음을 시작하지 못했습니다: {type(e).__name__}: {e}")
        else:
            try:
                await asyncio.sleep(PROBE_SECONDS)
            finally:
                # stop_recording 이 _reader 를 MISSING 으로 되돌리므로
                # (voice/client.py:788-790) reader.error 는 반드시 정지 전에 읽는다.
                # write 예외는 패킷 하나가 아니라 녹음 세션 전체를 끝내고
                # (reader.py:273-281) 그 흔적이 reader.error 다 (reader.py:123).
                err = getattr(getattr(vc, "_reader", None), "error", None)
                vc.stop_recording()
            r = probe.level_report()
            good = probe.sizes.get(PCM_20MS_BYTES, 0)
            total = sum(probe.sizes.values())
            # 같은 단계 안에 적는다 — 단계 이름을 하나 더 만들면 CAUSES 에 없어서 안내가 안 붙는다.
            t.record("오디오 수신", (r["packets"] > 0 or r["noise_packets"] > 0) and not err,
                     f"{PROBE_SECONDS:g}초 동안 패킷 {total} (음성 {r['packets']}, "
                     f"잡음 {r['noise_packets']}) · 최대 RMS {r['peak_rms']:.3f} "
                     f"(임계 {r['speech_rms']:.3f})"
                     + (f" · reader 오류 {type(err).__name__}: {err}" if err else ""))
            t.record("PCM 크기", total == 0 or good == total,
                     f"{good}/{total} 이 {PCM_20MS_BYTES}바이트" if total else "패킷 없음",
                     info=True)
            t.record("VAD 확정", True, f"sink → session 전달 {probe.session.fed}건", info=True)
    elif connected:
        t.record("오디오 수신", True, "이미 녹음 중이라 프로브를 건너뜀", info=True)
    else:
        t.record("오디오 수신", False, "음성 연결이 없어 건너뜀")

    if connected:
        # 라우터 사망은 reader.packet_router (reader.py:124), 소켓 리더 정지는
        # voice/state.py:110. 루프 디버그가 켜져 있으면 교차 스레드 create_task 가
        # 패킷마다 RuntimeError 를 내고 voice/state.py:199-204 가 그걸 삼킨다.
        rd = vc._reader
        t.record("수신 내부 상태", True,
                 f"router_alive={rd.packet_router.is_alive() if rd else '-'} "
                 f"socket_paused={vc._connection._socket_reader.is_paused()} "
                 f"loop_debug={asyncio.get_running_loop().get_debug()}", info=True)

    # 권한 비트가 맞는데도 못 보내는 경우(채널 덮어쓰기, 슬로우모드)가 이 단계가 잡아야 할
    # 바로 그 상황이다. 실제로 보내고 고치고 지운다.
    try:
        probe_msg = await ctx.channel.send("selftest: 쓰기 확인")
        await probe_msg.edit(content="selftest: 편집 확인")
        await probe_msg.delete()
        t.record("채널 쓰기", True, f"#{ctx.channel.name} 전송·편집·삭제 확인")
    except Exception as e:
        t.record("채널 쓰기", False, f"#{ctx.channel.name} {type(e).__name__}: {e}")

    if not use_stt:
        t.record("STT 왕복", True,
                 "옵션 stt:True 로 실행하면 1초 오디오로 확인한다 "
                 "(₩6/60초 기준 약 0.1원, 최소 과금 단위는 확인하지 못했다)", info=True)
    elif not t.all_ok():
        # 연결도 안 되는 상태에서 유료 API 를 부를 이유가 없다.
        t.record("STT 왕복", True, "앞 단계가 실패해 건너뜀", info=True)
    else:
        import numpy as np

        from stt.elice import EliceStt

        try:
            # 실패 경로 다섯이 전부 같은 SttError 라 (stt/elice.py) 실제 원인은 메시지에만 있다.
            r = EliceStt().transcribe(np.zeros(16_000, dtype="float32"), 16_000)
            t.record("STT 왕복", True, f"응답 정상 (text={r.text[:20]!r})")
        except Exception as e:
            t.record("STT 왕복", False, f"{type(e).__name__}: {e}")

    return t.report()
