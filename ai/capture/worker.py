"""후처리 워커. 봇은 녹음을 저장까지만 하고, 이 프로세스가 끝나지 않은 회의를 전사 → 회의록 저장 → 할일 추출
→ BE 인계한다(결정 기록 0026). 처리 방식은 이것 하나다.

    python -m capture.worker              # ai/ 안에서. --recordings, --transcripts, --interval 로 바꿀 수 있다
    python -m capture.worker --retry <서버ID>   # 떠 있는 워커가 그 서버를 포기한 것까지 돌게 깨운다

디스코드를 모른다. discord 와 capture.discord_adapter 를 import 하지 않고 봇 토큰도 필요 없다. 회의마다 단계가 끝날
때 그 회의의 채널에 알릴 글을 우편함(recordings/.worker/outbox, capture.notify.FileOutbox)에 쓰고, 디스코드에 붙어
있는 봇이 그것을 올린다. MM_DEBUG_REPORT 를 켜면 처리 시간·메모리 같은 디버그 줄도 쓴다.

처리는 봇과 같은 recorder.recover_pass 이고 재시도·포기 규칙도 같다. 한 번에 한 회의만 처리한다
(MM_MAX_CONCURRENT_MEETINGS 는 보지 않는다). 봇과는 회의 잠금(recorder.try_lock)으로 갈린다. 녹음 중인 회의는
봇이 잠금을 쥐고 있어 건너뛴다. 봇이 녹음 중에 죽으면 OS 가 잠금을 풀고, 워커가 녹음된 부분을 처리한다.

봇과는 파일로 말한다. recordings/.worker/heartbeat.json 에 주기마다 살아 있다는 표시(pid, 시각, 처리 중인
회의)를 남긴다. 처리 스레드와 따로 도는 태스크가 쓰므로 긴 전사 중에도 끊기지 않는다. 봇은 이것으로 워커가
조용한지 본다(worker_trouble). --retry 가 남긴 recordings/.worker/wake-<서버ID> 가 있으면 그 서버의 회의를 포기한
것까지 바로 돈다. 봇이 녹음을 저장하면
recordings/.worker/nudge 를 만들어(request_nudge) 다음 바퀴를 주기까지 기다리지 않게 한다.
SIGTERM·SIGINT 를 받으면 새 회의를 집지 않고 하던 회의를 마친 뒤 끝난다.

바퀴 끝에 회의 요약을 한 건 맡는다(capture/summary_sweep.py). 처리 단계와 별개라 실패해도 회의 상태는 그대로다.
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
from capture.judge_path import extract_path
from capture.notify import FileOutbox, MeetingReporter, debug_from_env
from capture.recorder import (
    STATUS_SOURCED,
    Claims,
    backend_from_env,
    build_extractor,
    prune_audio,
    recover_pass,
    save_manifest,
)
from capture.summary_sweep import summary_from_env
from shared.config import RECORDINGS_DIR, TRANSCRIPTS_DIR
from shared.schemas import now_iso
from upload.assign import assign_one
from upload.cleanup import cleanup_one
from upload.intake import intake_one
from upload.report import report_one

WORKER_INTERVAL_S = float(os.environ.get("MM_WORKER_INTERVAL_S", "10"))   # 한 바퀴 주기이자 살아 있다는 표시 주기
WORKER_DIR = ".worker"


def worker_dir(recordings_dir: Path) -> Path:
    return recordings_dir / WORKER_DIR


def request_wake(recordings_dir: Path, guild_id) -> Path:
    """워커가 다음 짧은 확인 때 이 서버의 회의를 포기한 것까지 바로 한 바퀴 돈다."""
    d = worker_dir(recordings_dir)
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"wake-{guild_id}"
    p.touch()
    return p


def request_nudge(recordings_dir: Path) -> Path:
    """봇이 녹음을 저장하면 부른다. 워커가 다음 짧은 확인 때(poll_s) 보통 한 바퀴를 바로 돈다."""
    d = worker_dir(recordings_dir)
    d.mkdir(parents=True, exist_ok=True)
    p = d / "nudge"
    p.touch()
    return p


def read_heartbeat(recordings_dir: Path) -> dict | None:
    """워커가 마지막으로 남긴 살아 있다는 표시. 없거나 읽을 수 없으면 None."""
    try:
        return json.loads((worker_dir(recordings_dir) / "heartbeat.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def worker_trouble(recordings_dir: Path) -> str | None:
    """워커가 처리를 못 하고 있으면 그 한 줄, 살아 있으면 None. 주기의 여섯 배(최소 1분) 넘게 조용하면 응답이 없다고 본다.

    봇의 저장 알림과 --retry 가 쓴다. 표시는 처리 스레드와 따로 도는 태스크가 남기므로 긴 전사 중에도 끊기지 않는다.
    """
    hb = read_heartbeat(recordings_dir)
    if hb is None:
        return "워커 신호가 없습니다"
    if hb.get("state") == "stopped":
        return "워커가 멈춰 있습니다"
    age = max(0.0, time.time() - float(hb.get("at_ts") or 0))
    if age > max(60.0, 6 * float(hb.get("interval_s") or 10)):
        return f"워커가 {int(age // 60)}분째 응답이 없습니다"
    return None


def _on_stop_signals(loop, stop) -> None:
    """SIGTERM·SIGINT 에 stop 을 건다. 윈도의 이벤트 루프는 add_signal_handler 가 없어서(NotImplementedError)
    signal.signal 로 걸고 이벤트 루프로 넘긴다."""
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop)
        except NotImplementedError:
            signal.signal(sig, lambda signum, frame: loop.call_soon_threadsafe(stop))


def intake_from_env():
    """웹 업로드 가져오기에 쓸 (BE 클라이언트, 화자 분리기). 명시적 opt-in 이다: MM_UPLOAD_INTAKE=1 이고
    BE_BASE_URL·BE_SERVICE_TOKEN·PYANNOTEAI_API_KEY 가 다 있을 때만, 하나라도 없으면 None(BE 도 pyannoteAI 도 부르지 않는다).
    BE 의 claim 계약은 워커가 한 대라는 전제라서 운영 서버 한 대에서만 켠다."""
    if os.environ.get("MM_UPLOAD_INTAKE", "").strip() != "1":
        return None
    from capture.handoff import BeClient
    from shared.config import settings
    from upload.diarize import PyannoteAiDiarizer

    cfg = settings()
    token = getattr(cfg, "be_service_token", "")
    key = os.environ.get("PYANNOTEAI_API_KEY", "").strip()
    missing = [n for n, v in (("BE_BASE_URL", cfg.be_base_url), ("BE_SERVICE_TOKEN", token), ("PYANNOTEAI_API_KEY", key))
               if not v]
    if missing:   # 켰는데 꺼지면 업로드가 processing 으로 남는다. 값은 찍지 않고 이름만 남긴다(#289 리뷰)
        print(f"[worker] MM_UPLOAD_INTAKE=1 이지만 설정이 비어 업로드 가져오기를 끈다: {', '.join(missing)}", flush=True)
        return None
    return BeClient(cfg.be_base_url, service_token=token), PyannoteAiDiarizer(key)


class Worker:
    def __init__(self, recordings_dir: Path = RECORDINGS_DIR, *, transcripts_dir: Path = TRANSCRIPTS_DIR,
                 stt_factory=None, gate_factory=None, extractor_factory=None, handoff_factory=None, intake_factory=None,
                 summary_factory=None, interval_s: float | None = None, poll_s: float = 1.0, notifier=None,
                 debug: bool | None = None) -> None:
        """팩토리 기본은 환경 변수다. poll_s 는 깨우기와 종료 신호를 확인하는 간격이다.

        notifier 는 채널 알림을 받는다(send). 기본은 봇이 읽는 우편함이다. debug 기본은 MM_DEBUG_REPORT 다.
        """
        extract_path()      # MM_EXTRACT_PATH 가 모르는 값이면 시작할 때 멈춘다. 추출은 워커만 한다
        # MM_SUMMARY_LLM 도 시작할 때 본다. 가져오기와 달리 설정 오타를 지나치지 않는다
        self._summary = (summary_factory if summary_factory is not None else summary_from_env)()
        self.recordings_dir = recordings_dir
        self.transcripts_dir = transcripts_dir
        self._stt_factory = stt_factory or backend_from_env
        self._gate_factory = gate_factory if gate_factory is not None else (lambda: None)   # 배치는 말 필터 없이(0030)
        self._extractor_factory = extractor_factory if extractor_factory is not None else build_extractor
        self._handoff_factory = handoff_factory if handoff_factory is not None else handoff_from_env
        self._intake_factory = intake_factory if intake_factory is not None else intake_from_env
        self._intake = None                               # (client, diarizer). 처음 필요할 때 만든다
        self._intake_built = False
        self.interval_s = WORKER_INTERVAL_S if interval_s is None else interval_s
        self.poll_s = poll_s
        self._notifier = notifier if notifier is not None else FileOutbox(recordings_dir)
        self._debug = debug_from_env() if debug is None else debug
        self._announced: set[str] = set()     # 이번 실행 동안 처리 시작을 알린 회의(capture.notify.MeetingReporter)
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
        """한 바퀴. 결과는 process_session 이 BE 로 넘긴다. 회의마다 그 채널에 단계가 끝날 때 알리고 로그를 남긴다."""
        reporters: dict[str, MeetingReporter] = {}

        def start(m: dict) -> None:
            self._current = str(m.get("session"))
            reporters[self._current] = MeetingReporter(self._notifier, m, debug=self._debug, announced=self._announced)
            reporters[self._current].started()

        async def log(r: dict) -> None:
            # 채널 알림과 따로 로그에도 남긴다. 실패 이유와 빠진 것, 처리 기록 한 줄
            notes = " 포기" if r.get("gave_up") else ""
            if r.get("error"):
                notes += f" 오류: {r['error']}"
            if r.get("ended"):
                notes += f" 끝난 회의라 로컬을 지웠다({r['ended']})"
            if r.get("extract_failures"):
                notes += f" 판단하지 못한 발화 {len(r['extract_failures'])}건"
            if (r.get("be") or {}).get("dropped_items"):
                notes += f" BE 가 받지 않은 항목 {r['be']['dropped_items']}건"
            if r.get("sources"):
                notes += f" 회의록 저장 {r['sources'].get('inserted', 0)}줄"
            if (r.get("skipped") or {}).get(STATUS_SOURCED):
                notes += f" 건너뜀 회의록 저장({r['skipped'][STATUS_SOURCED]})"
            ops = r.get("ops")
            if ops:
                # 처리 기록 한 줄. 모르는 값은 뺀다. 칸은 capture/ops_record.py
                notes += f" 처리 {ops['wall_s']}초"
                if ops.get("wait_s") is not None:
                    notes += f" 대기 {ops['wait_s']}초"
                if ops.get("peak_rss_bytes") is not None:
                    notes += f" 최대 메모리 {ops['peak_rss_bytes'] / 1024 ** 2:.0f}MB"
            print(f"[worker] 세션 {r['session']} {r['status']} 이번에 {r['ran']} 실패 {r.get('attempts')}회{notes}",
                  flush=True)
            reporter = reporters.get(str(r["session"]))
            if reporter is not None:
                reporter.finished(r, manual=manual)

        try:
            return await recover_pass(self.recordings_dir, claims=self._claims, sem=self._sem,
                                      stt_factory=self._stt_factory, gate_factory=self._gate_factory,
                                      extractor_factory=self._extractor_factory, handoff_factory=self._handoff_factory,
                                      transcripts_dir=self.transcripts_dir, guild_id=guild_id, manual=manual,
                                      stop=lambda: self._stopping, on_start=start, on_result=log,
                                      progress_for=lambda m: reporters[str(m.get("session"))].progress,
                                      wait_for_workspace=True)    # 연결 전에는 올릴 웹이 없어 전사하지 않는다(#199)
        finally:
            self._current = None

    async def _intake_once(self) -> None:
        """웹 업로드 가져오기를 한 건 한 단계. 정지 신호 뒤에는 새로 claim 하지 않는다. 한 번에 한 회의 자리(_sem) 안에서 돈다.
        같은 자리에서 assign_one(PM 이 지정을 끝낸 회의를 mapped 로) → report_one(가져온 회의의 화자 라벨 보고) → intake_one 순서로
        한 번씩 부른다. 호출 사이마다 정지 신호를 확인하고, 각 호출의 예외는 따로 로그만 남긴다."""
        if self._stopping:
            return
        if not self._intake_built:
            self._intake_built = True      # 실패해도 한 번만 시도하고 로그를 남긴다(설정은 재시작해야 바뀐다)
            try:
                self._intake = self._intake_factory()
            except Exception as e:  # noqa: BLE001 - 가져오기를 못 만들어도 워커는 계속 돈다
                print(f"[worker] 업로드 가져오기 오류: {type(e).__name__}: {e}", flush=True)
        if self._intake is None:
            return
        client, diarizer = self._intake
        async with self._sem:
            if self._stopping:
                return
            self._current = "upload"
            progresses = []
            try:
                for call in (lambda: assign_one(self.recordings_dir, client=client),
                             lambda: report_one(self.recordings_dir, client=client),
                             lambda: intake_one(self.recordings_dir, client=client, diarizer=diarizer),
                             lambda: cleanup_one(self.recordings_dir, self.transcripts_dir, client=client)):
                    if self._stopping:     # 앞 호출 도중 stop() 이 오면 다음 호출은 부르지 않는다
                        break
                    try:
                        progresses.append(await asyncio.to_thread(call))
                    except Exception as e:  # noqa: BLE001 - 넷 다 예외를 내지 않는 게 약속이지만 워커는 어떤 경우에도 계속 돈다
                        print(f"[worker] 업로드 가져오기 오류: {type(e).__name__}: {e}", flush=True)
            finally:
                self._current = None
        for progress in progresses:
            if progress is not None:
                print(f"[worker] 업로드 {progress.meeting_id} {progress.event}", flush=True)

    async def _summary_once(self) -> None:
        """회의 요약 한 건. 정지 신호 뒤에는 새로 맡지 않고, 한 번에 한 회의 자리(_sem) 안에서 돈다."""
        if self._stopping or self._summary is None:
            return
        async with self._sem:
            if self._stopping:
                return
            self._current = "summary"
            try:
                await asyncio.to_thread(self._summary.run_once)
            except Exception as e:  # noqa: BLE001 - run_once 는 예외를 내지 않는 게 약속이지만 워커는 어떤 경우에도 계속 돈다
                print(f"[worker] 요약 오류: {type(e).__name__}: {e}", flush=True)
            finally:
                self._current = None

    async def _prune_audio(self) -> None:
        """보관 기한이 지난 회의 음성(트랙 wav)을 지운다(#561). 인계가 끝난 회의는 바로, 포기한 회의는 7일 뒤다.
        실패해도 로그만 남기고 바퀴는 계속 돈다."""
        try:
            dropped = await asyncio.to_thread(prune_audio, self.recordings_dir)
        except Exception as e:  # noqa: BLE001 - 음성 정리는 곁가지다. 다음 바퀴에 다시 한다
            print(f"[worker] 음성 정리 오류: {type(e).__name__}: {e}", flush=True)
            return
        for session in dropped:
            print(f"[worker] 세션 {session} 음성 삭제", flush=True)

    async def _purge_once(self) -> None:
        from capture.meeting_purge import purge_one
        from capture.privacy_cleanup import cleanup_one as privacy_cleanup_one
        handoff = self._handoff_factory()
        if handoff is None or self._stopping:
            return
        for cleanup in (privacy_cleanup_one, purge_one):
            try:
                await asyncio.to_thread(cleanup, self.recordings_dir, self.transcripts_dir, client=handoff.client)
            except Exception:  # noqa: BLE001 - a failed purge retains the backend lease for retry
                print("[worker] artifact cleanup pending retry", flush=True)

    def _wakes(self) -> list[Path]:
        d = worker_dir(self.recordings_dir)
        return sorted(d.glob("wake-*")) if d.is_dir() else []

    def _nudge(self) -> Path:
        return worker_dir(self.recordings_dir) / "nudge"

    async def _nap(self) -> None:
        """다음 바퀴까지 쉰다. 깨우기나 찌르기가 오거나 멈추라는 신호가 오면 바로 돌아온다."""
        waited = 0.0
        while not self._stopping and waited < self.interval_s and not self._wakes() and not self._nudge().exists():
            await asyncio.sleep(self.poll_s)
            waited += self.poll_s

    async def run(self) -> None:
        beat = asyncio.create_task(self._heartbeat_loop())
        try:
            while not self._stopping:
                self._nudge().unlink(missing_ok=True)      # 이번 바퀴가 그 녹음까지 본다
                await self.run_pass()
                for wake in self._wakes():
                    if self._stopping:
                        break
                    wake.unlink(missing_ok=True)
                    await self.run_pass(guild_id=wake.name[len("wake-"):], manual=True)
                await self._intake_once()
                await self._summary_once()
                await self._purge_once()
                await self._prune_audio()
                await self._nap()
        finally:
            beat.cancel()
            self._beat("stopped")


def retry(recordings_dir: Path, guild_id: str) -> str:
    """재시도를 다 써서 멈춘 회의를 사람이 다시 돌리는 자리다. 떠 있는 워커를 깨워 그 서버를 포기한 것까지 돌게 한다.

    여기서 직접 돌리지 않는다. 워커와 두 프로세스가 같이 전사하면 한 번에 한 회의가 깨지고 로컬 전사면 메모리가
    두 배다. 결과는 워커가 그 회의의 채널에 알린다. 워커가 꺼져 있으면 깨우기가 남아 있다가 워커가 뜨면 돈다.
    """
    request_wake(recordings_dir, guild_id)
    trouble = worker_trouble(recordings_dir)
    if trouble:
        return f"{trouble}. 깨우기를 남겼습니다. 워커가 뜨면 서버 {guild_id} 의 회의를 돌립니다."
    return f"워커가 곧 서버 {guild_id} 의 회의를 포기한 것까지 돌립니다. 결과는 그 회의의 채널에 올라옵니다."


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="회의 후처리 워커")
    ap.add_argument("--recordings", default=str(RECORDINGS_DIR))
    ap.add_argument("--transcripts", default=str(TRANSCRIPTS_DIR))
    ap.add_argument("--interval", type=float, default=None, help="한 바퀴 주기(초). 기본 MM_WORKER_INTERVAL_S")
    ap.add_argument("--retry", metavar="서버ID", default=None,
                    help="떠 있는 워커가 그 서버의 회의를 포기한 것까지 돌게 깨우고 끝난다. 재시도를 다 써서 멈춘 회의에 쓴다")
    args = ap.parse_args(argv)
    if args.retry:
        print(f"[worker] --retry {args.retry}: {retry(Path(args.recordings), args.retry)}", flush=True)
        return 0
    worker = Worker(Path(args.recordings), transcripts_dir=Path(args.transcripts), interval_s=args.interval)

    async def run() -> None:
        _on_stop_signals(asyncio.get_running_loop(), worker.stop)
        await worker.run()

    asyncio.run(run())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
