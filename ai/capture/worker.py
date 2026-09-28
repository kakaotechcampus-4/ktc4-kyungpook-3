"""후처리 워커. MM_PIPELINE_MODE=worker 이면 봇은 녹음을 저장까지만 하고, 이 프로세스가 끝나지 않은 회의를
전사 → 할일 추출 → BE 인계한다.

    python -m capture.worker            # ai/ 안에서. --recordings, --transcripts, --interval 로 바꿀 수 있다

디스코드를 모른다. discord 와 capture.discord_adapter 를 import 하지 않고 봇 토큰도 필요 없다. 결과는 BE 로만
넘기고 사람은 웹에서 본다. 채널 안내는 봇이 한다.

처리는 봇과 같은 recorder.recover_pass 이고 재시도·포기 규칙도 같다. 한 번에 한 회의만 처리한다
(MM_MAX_CONCURRENT_MEETINGS 는 보지 않는다). 봇과는 회의 잠금(recorder.try_lock)으로 갈린다. 녹음 중인 회의는
봇이 잠금을 쥐고 있어 건너뛴다. 봇이 녹음 중에 죽으면 OS 가 잠금을 풀고, 워커가 녹음된 부분을 처리한다.

봇과는 파일로 말한다. recordings/.worker/heartbeat.json 에 주기마다 살아 있다는 표시(pid, 시각, 처리 중인
회의)를 남긴다. 처리 스레드와 따로 도는 태스크가 쓰므로 긴 전사 중에도 끊기지 않는다. 봇의 /recover 가
recordings/.worker/wake-<서버ID> 를 만들면 그 서버의 회의를 사람이 친 /recover 처럼(포기한 회의까지) 바로 돈다.
SIGTERM·SIGINT 를 받으면 새 회의를 집지 않고 하던 회의를 마친 뒤 끝난다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import socket
import time
from pathlib import Path

from capture.handoff import from_env as handoff_from_env
from capture.recorder import Claims, backend_from_env, build_extractor, recover_pass, save_manifest
from shared.config import RECORDINGS_DIR, TRANSCRIPTS_DIR
from shared.schemas import now_iso

WORKER_INTERVAL_S = float(os.environ.get("MM_WORKER_INTERVAL_S", "10"))   # 한 바퀴 주기이자 살아 있다는 표시 주기
WORKER_DIR = ".worker"


def worker_dir(recordings_dir: Path) -> Path:
    return recordings_dir / WORKER_DIR


def request_wake(recordings_dir: Path, guild_id) -> Path:
    """봇의 /recover 가 부른다. 워커가 다음 짧은 확인 때 이 서버의 회의를 바로 한 바퀴 돈다."""
    d = worker_dir(recordings_dir)
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"wake-{guild_id}"
    p.touch()
    return p


def read_heartbeat(recordings_dir: Path) -> dict | None:
    """워커가 마지막으로 남긴 살아 있다는 표시. 없거나 읽을 수 없으면 None."""
    try:
        return json.loads((worker_dir(recordings_dir) / "heartbeat.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _on_stop_signals(loop, stop) -> None:
    """SIGTERM·SIGINT 에 stop 을 건다. 윈도의 이벤트 루프는 add_signal_handler 가 없어서(NotImplementedError)
    signal.signal 로 걸고 이벤트 루프로 넘긴다."""
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop)
        except NotImplementedError:
            signal.signal(sig, lambda signum, frame: loop.call_soon_threadsafe(stop))


def _speech_gate():
    from stt.speech_gate import SpeechGate
    return SpeechGate()


class Worker:
    def __init__(self, recordings_dir: Path = RECORDINGS_DIR, *, transcripts_dir: Path = TRANSCRIPTS_DIR,
                 stt_factory=None, gate_factory=None, extractor_factory=None, handoff_factory=None,
                 interval_s: float | None = None, poll_s: float = 1.0) -> None:
        """팩토리는 봇(RecordingCog)과 같다. 기본은 환경 변수다. poll_s 는 깨우기와 종료 신호를 확인하는 간격이다."""
        self.recordings_dir = recordings_dir
        self.transcripts_dir = transcripts_dir
        self._stt_factory = stt_factory or backend_from_env
        self._gate_factory = gate_factory if gate_factory is not None else _speech_gate
        self._extractor_factory = extractor_factory if extractor_factory is not None else build_extractor
        self._handoff_factory = handoff_factory if handoff_factory is not None else handoff_from_env
        self.interval_s = WORKER_INTERVAL_S if interval_s is None else interval_s
        self.poll_s = poll_s
        self._claims = Claims()
        self._sem = asyncio.Semaphore(1)                  # 한 번에 한 회의
        self._stopping = False
        self._current: str | None = None
        self._started_at = now_iso()

    def stop(self) -> None:
        """새 회의를 집지 않는다. 하던 회의는 마치고 run() 이 끝난다."""
        self._stopping = True

    def _beat(self, state: str = "running") -> None:
        save_manifest(worker_dir(self.recordings_dir) / "heartbeat.json",
                      {"state": state, "pid": os.getpid(), "host": socket.gethostname(), "at": now_iso(),
                       "at_ts": time.time(), "interval_s": self.interval_s, "current": self._current,
                       "started_at": self._started_at})

    async def _heartbeat_loop(self) -> None:
        while True:
            self._beat()
            await asyncio.sleep(self.interval_s)

    async def run_pass(self, *, guild_id=None, manual: bool = False) -> tuple[list[dict], list[dict]]:
        """한 바퀴. 결과는 process_session 이 BE 로 넘긴다. 여기서는 로그만 남긴다."""
        def start(m: dict) -> None:
            self._current = str(m.get("session"))

        async def log(r: dict) -> None:
            print(f"[worker] 세션 {r['session']} {r['status']} 이번에 {r['ran']} 실패 {r.get('attempts')}회"
                  + (" 포기" if r.get("gave_up") else ""), flush=True)

        try:
            return await recover_pass(self.recordings_dir, claims=self._claims, sem=self._sem,
                                      stt_factory=self._stt_factory, gate_factory=self._gate_factory,
                                      extractor_factory=self._extractor_factory, handoff_factory=self._handoff_factory,
                                      transcripts_dir=self.transcripts_dir, guild_id=guild_id, manual=manual,
                                      stop=lambda: self._stopping, on_start=start, on_result=log)
        finally:
            self._current = None

    def _wakes(self) -> list[Path]:
        d = worker_dir(self.recordings_dir)
        return sorted(d.glob("wake-*")) if d.is_dir() else []

    async def _nap(self) -> None:
        """다음 바퀴까지 쉰다. 깨우기가 오거나 멈추라는 신호가 오면 바로 돌아온다."""
        waited = 0.0
        while not self._stopping and waited < self.interval_s and not self._wakes():
            await asyncio.sleep(self.poll_s)
            waited += self.poll_s

    async def run(self) -> None:
        beat = asyncio.create_task(self._heartbeat_loop())
        try:
            while not self._stopping:
                await self.run_pass()
                for wake in self._wakes():
                    if self._stopping:
                        break
                    wake.unlink(missing_ok=True)
                    await self.run_pass(guild_id=wake.name[len("wake-"):], manual=True)
                await self._nap()
        finally:
            beat.cancel()
            self._beat("stopped")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="회의 후처리 워커")
    ap.add_argument("--recordings", default=str(RECORDINGS_DIR))
    ap.add_argument("--transcripts", default=str(TRANSCRIPTS_DIR))
    ap.add_argument("--interval", type=float, default=None, help="한 바퀴 주기(초). 기본 MM_WORKER_INTERVAL_S")
    args = ap.parse_args(argv)
    worker = Worker(Path(args.recordings), transcripts_dir=Path(args.transcripts), interval_s=args.interval)

    async def run() -> None:
        _on_stop_signals(asyncio.get_running_loop(), worker.stop)
        await worker.run()

    asyncio.run(run())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
