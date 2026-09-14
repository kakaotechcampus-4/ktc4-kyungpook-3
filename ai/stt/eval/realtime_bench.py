"""실시간 파이프라인 종단 측정.

리플레이 하니스로 실제 녹음을 흘려 다음을 잰다.
  1. 발화별 첫 줄 지연   발화가 끝난 시각부터 그 줄이 나올 때까지 (페이싱 켜야 의미 있음)
  2. 종료 후 산출 시간   close() 부터 회의록 파일까지
  3. API 호출 수         발화 수와 같아야 한다
  4. 유실                write_errors · unattributed · 확정 줄 수
  5. 말 필터가 거른 수    Silero 게이트의 passed/rejected

VAD 상수와 게이트 임계를 인자로 받는다. 같은 녹음을 임계만 바꿔 다시 흘리면 그 회의에서
결과가 어떻게 달라지는지 나온다 — 임계를 고칠 때 근거로 쓰라고 만든 것이다.

게시 요청 수는 여기서 안 잰다. 디스코드가 없어 게시기를 돌리지 않으므로 범위 밖이다.
마감 뒤 도착한 줄(late_lines)과 미게시 턴은 실제 회의에서만 나온다.

사용:
  .venv/bin/python stt/eval/realtime_bench.py                      # 합성 3초, 무과금
  .venv/bin/python stt/eval/realtime_bench.py --tracks "<디렉토리>" --pace
  .venv/bin/python stt/eval/realtime_bench.py --tracks "<디렉토리>" --min-speech-ms 200 --no-gate
  .venv/bin/python stt/eval/realtime_bench.py --tracks "<디렉토리>" --stt elice --pace --yes

--stt elice 는 --yes 없이는 견적만 찍고 끝난다.

무거운 import 는 전부 main() 안에 있다. --speech-rms 가 StreamingVAD 의 데이터클래스
기본값이라 클래스 정의 시점에 굳어서, 인자를 읽고 MM_SPEECH_RMS 를 넣은 뒤에 stt.vad 를
불러와야 한다. 나머지 상수는 호출마다 모듈 전역을 읽으므로 import 뒤에 갈아끼워도 먹는다.
"""

from __future__ import annotations

import argparse
import os
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

SR = 16_000


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stt", choices=["fake", "elice"], default="fake")
    ap.add_argument("--tracks", type=Path,
                    help='화자별 16kHz 모노 wav 디렉토리. 예: "~/Desktop/카테캠 아이디어톤/'
                         'mm/golden/meeting-01/audio"')
    ap.add_argument("--pace", action="store_true",
                    help="오디오를 실제 속도로 흘린다. 체감 지연을 재려면 필요하다")
    ap.add_argument("--yes", action="store_true", help="유료 실행을 승인한다")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--workers", type=int, default=3)

    g = ap.add_argument_group("VAD 상수 (기본값은 stt/vad.py)")
    g.add_argument("--speech-rms", type=float, help="발화로 볼 RMS 하한")
    g.add_argument("--silence-hold-ms", type=int, help="이만큼 조용하면 발화 끝")
    g.add_argument("--min-speech-ms", type=int, help="이보다 짧은 발화는 버린다")
    g.add_argument("--noise-margin", type=float, help="배경 소음 대비 배수")

    h = ap.add_argument_group("말 필터 (기본값은 stt/speech_gate.py)")
    h.add_argument("--no-gate", action="store_true", help="Silero 게이트를 끄고 돌린다")
    h.add_argument("--gate-threshold", type=float, help="Silero 프레임 확률 임계")
    h.add_argument("--gate-ratio", type=float, help="발화로 인정할 말 프레임 비율 하한")
    return ap.parse_args(argv)


def load_tracks(d: Path, ReplayTrack, sf) -> list:
    out = []
    for i, p in enumerate(sorted(d.glob("*.wav"))):
        audio, sr = sf.read(str(p), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != SR:
            raise SystemExit(f"{p.name}: {sr}Hz. 16000Hz 로 맞춰 주세요")
        out.append(ReplayTrack(user_id=i + 1, name=p.stem, samples=audio,
                               ssrc=100 + i, silent_below=0.002))
    if not out:
        raise SystemExit(f"{d} 안에 wav 가 없습니다")
    return out


def settings_line(vad, gate) -> str:
    """이번 실행이 쓴 값. 수치와 같이 남겨야 다음에 같은 조건으로 다시 돌릴 수 있다."""
    parts = [
        f"speech_rms={vad.SPEECH_RMS}",
        f"silence_hold_ms={vad.SILENCE_HOLD_MS}",
        f"min_speech_ms={vad.MIN_SPEECH_MS}",
        f"noise_margin={vad.NOISE_MARGIN}",
    ]
    parts.append("gate=off" if gate is None else f"gate={gate.threshold}/{gate.min_ratio}")
    return " · ".join(parts)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    if args.speech_rms is not None:
        os.environ["MM_SPEECH_RMS"] = str(args.speech_rms)

    import numpy as np
    import soundfile as sf

    import stt.vad as vad
    from capture.streaming_sink import StreamingSink
    from shared.config import RECORDINGS_DIR
    from stt.backend import SttResult
    from stt.session import Session
    from stt.speech_gate import SpeechGate
    from stt.transcript_writer import write_transcript
    from tests.replay import ReplayTrack, replay

    if args.silence_hold_ms is not None:
        vad.SILENCE_HOLD_MS = args.silence_hold_ms
    if args.min_speech_ms is not None:
        vad.MIN_SPEECH_MS = args.min_speech_ms
    if args.noise_margin is not None:
        vad.NOISE_MARGIN = args.noise_margin

    class FakeStt:
        name = "fake"

        def __init__(self):
            self.calls = 0

        def transcribe(self, samples, sample_rate):
            self.calls += 1
            return SttResult(text=f"({len(samples) / sample_rate:.1f}초)", words=[])

    class CountingStt:
        def __init__(self, inner):
            self.inner = inner
            self.name = inner.name
            self.calls = 0

        def transcribe(self, samples, sample_rate):
            self.calls += 1
            return self.inner.transcribe(samples, sample_rate)

    out_dir = args.out or (RECORDINGS_DIR / "bench")

    if args.tracks:
        tracks = load_tracks(args.tracks.expanduser(), ReplayTrack, sf)
    else:
        t = np.arange(SR * 3) / SR
        tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        tracks = [ReplayTrack(user_id=1, name="합성", samples=tone, ssrc=11)]

    audio_s = sum(len(tr.samples) / SR for tr in tracks)
    if args.stt == "elice":
        from stt.elice import EliceStt, whisper_krw

        print(f"트랙 {len(tracks)}개 · 합계 {audio_s:.0f}초 · 예상 상한 "
              f"{whisper_krw(audio_s):.0f}원 (VAD 가 침묵을 잘라내므로 실제는 이보다 적다. "
              f"최소 과금 단위는 미확인)")
        if not args.yes:
            print("유료 실행이다. 승인하려면 --yes 를 붙여 다시 실행한다.")
            return
        stt = CountingStt(EliceStt())
    else:
        stt = FakeStt()

    if args.no_gate:
        gate = None
    else:
        kw = {}
        if args.gate_threshold is not None:
            kw["threshold"] = args.gate_threshold
        if args.gate_ratio is not None:
            kw["min_ratio"] = args.gate_ratio
        gate = SpeechGate(**kw)

    print(f"설정: {settings_line(vad, gate)}")

    if args.pace:
        longest = max(len(tr.samples) / SR + tr.start_ms / 1000 for tr in tracks)
        print(f"실시간 페이싱. 주입에만 약 {longest:.0f}초 걸린다 (멈춘 게 아니다).")

    lines, lag, wall = [], [], []
    started = time.monotonic()

    def on_line(line):
        lines.append(line)
        if line.final:
            # wall 은 시작부터 이 줄이 나올 때까지의 실제 시간. 페이싱을 끄면 이게 큐 배수 시간이다.
            # lag 는 거기서 발화가 끝난 회의 시각을 뺀 것. 페이싱을 켰을 때만 체감 지연이 된다
            # (안 켜면 오디오가 순간 주입돼 음수가 나온다).
            now = time.monotonic() - started
            wall.append(now)
            lag.append(now - line.end_ms / 1000)

    # 페이싱을 켜면 실제 봇과 같은 단조 시계를 쓰고 침묵 청소도 같이 돈다. 끄면 오디오가
    # 순간 주입되므로 청소를 붙이지 않는다 — 값은 맞지만 몇 번 걸리느냐가 기기 속도에
    # 달려 같은 입력이 실행마다 다른 발화 수를 낸다. 대신 페이싱을 끈 실행은 발화가
    # 실제보다 길게 뭉친다. 수치를 볼 때는 --pace 쪽을 본다.
    if args.pace:
        t0 = time.monotonic()

        def now_ms() -> int:
            return int((time.monotonic() - t0) * 1000)

        clock = None
    else:
        virtual = {"now_ms": 0}

        def now_ms() -> int:
            return virtual["now_ms"]

        clock = virtual

    session = Session(final_stt=stt, on_line=on_line, workers=args.workers, gate=gate,
                      now_ms=now_ms if args.pace else None)
    sink = StreamingSink(session, now_ms=now_ms)

    replay(tracks, sink.write, clock=clock, pace=args.pace)
    sink.drain()
    elapsed = session.close(timeout_s=10.0)

    t_write = time.monotonic()
    finals = [ln for ln in lines if ln.final]
    out = write_transcript(lines, out_dir, "bench")
    write_s = time.monotonic() - t_write
    report = sink.level_report()

    print(f"\n발화 {len(finals)}건 · STT 호출 {stt.calls}건")
    if gate is not None:
        print(f"말 필터: 통과 {gate.passed} · 거름 {gate.rejected} · 오류 {gate.errors}")
    if not lag:
        print("확정된 발화가 없다. 입력이 전부 침묵이거나 VAD 임계가 높다")
    elif args.pace:
        print(f"발화별 첫 줄 지연: 중앙값 {statistics.median(lag):.2f}초 · "
              f"최대 {max(lag):.2f}초 (발화 끝 기준, 실시간 페이싱)")
    else:
        print(f"큐 배수 시간 {max(wall):.2f}초 — 순간 주입이라 체감 지연이 아니다. "
              f"체감 지연은 --pace 로 잰다")
    print(f"종료 후 산출까지 {elapsed + write_s:.2f}초 "
          f"(close {elapsed:.2f} + 파일 {write_s:.2f}, 목표 10초)")
    print(f"수신 {report['packets']} · 잡음 {report['noise_packets']} · "
          f"write 오류 {report['write_errors']} · 화자 미상 {report['unattributed']}")
    print(f"회의록 {out['markdown']}")
    for ln in sorted(finals, key=lambda x: x.start_ms)[:10]:
        print(f"  [{ln.start_ms / 1000:6.1f}s] {ln.speaker_name}: {ln.text[:40]}")

    if stt.calls != len(finals):
        raise SystemExit(f"STT 호출 {stt.calls} != 발화 {len(finals)}. 발화당 1회여야 한다")


if __name__ == "__main__":
    main()
