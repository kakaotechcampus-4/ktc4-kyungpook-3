"""회의마다 처리 기록. 처리 한 번(recorder.process_session 호출 하나)이 어디서 얼마나 걸렸고 서버를 얼마나 썼는지 남긴다.

서버 처리 용량 측정(#154)과 같은 칸을 쓴다. 실제 회의의 걸린 시간과 자원을 쌓아 측정값과 견주려는 것이다.
기록에는 숫자만 둔다. 전사 문장은 넣지 않는다.

process_session 이 처리를 시작할 때 OpsRun 을 만들고 단계마다 begin 을 부르고, 끝에서 finish 로 기록 한 건을 만든다.
그 기록은 매니페스트 ops 목록에 덧붙고, 회의 폴더의 처리기록.md 는 그 목록 전체로 처리마다 다시 쓴다.
아무 단계도 돌지 않고 실패도 없는 호출(설정이 없어 멈춘 회의를 복구 바퀴가 다시 집은 것)은 남기지 않는다.
기록은 처리가 돌아올 때 남는다. 처리 도중 프로세스가 죽으면(메모리 초과, 강제 종료, 배포 재시작) 그 처리의 기록은
없고, 다음 기록의 recovery_attempts 에만 흔적이 남는다. 메모리를 넘겨 죽은 처리의 최대 메모리는 여기서 얻지 못한다.

기록 한 건의 칸
  run_started_at, run_ended_at   처리 시작과 끝(UTC ISO)
  wall_s          처리 시작부터 끝까지 초. 단계 밖의 일(BE 회의를 processing 으로 돌리기, 끊긴 녹음의 트랙 찾기,
                  모델 올리기, 실패를 세고 포기를 BE 에 알리기)도 든다
  wait_s          처리 시작 시각에서 매니페스트 recorded_at 을 뺀 초. recorded_at 은 녹음을 저장한 시각이라 대개 줄 서
                  있던 시간이다. 녹음 중에 죽어 트랙을 다시 찾은 회의는 recorded_at 이 녹음 시작 시각이라 회의 길이가
                  들고, 재시도 처리는 재시도까지 기다린 시간이 든다. recorded_at 이 초 단위라 처리 시작도 초 단위로
                  잘라 뺀다. 그래서 1초 밑은 맞지 않는다. recorded_at 이 없으면 None
  stages          {이름: {started_at, ended_at, s}}. 이름은 stt, sources, extract, handoff 로 매니페스트 failed_stage 와 같다.
                  이번 처리에서 돈 단계만 있다
  model_load_s    이번 처리에서 로컬 모델을 처음 올린 초. 전사 단계 초에는 들지 않는다. 안 올렸으면 None
  meeting_s       회의 길이. 매니페스트 speakers 의 duration_sec 최댓값
  speech_s, track_s, calls, failed, retries, calls_over_20s, gated, audio_sent_s, unmapped_chunks
                  전사 요약(batch summary)에서. audio_sent_s 는 보낸 소리 길이(묶음마다 한 번), unmapped_chunks 는
                  단어 시각이 없어 묶음째 한 줄로 남은 수다. 이번 처리에서 전사를 처음부터 돌리지 않았으면 None 이다(추출부터
                  이었거나 실패한 줄만 다시 보냈다)
  rtf_meeting, rtf_speech   전사 단계 초 ÷ meeting_s, ÷ speech_s. 위와 같은 때 None 이다. 다시 보낸 몇 줄의 시간을
                  회의 길이로 나누면 회의끼리 견줄 수 없는 값이 나온다
  stt_krw         전사 비용 추정(원). Elice 면 audio_sent_s × 6원/60초(옛 주소 단가, 새 엔드포인트 단가는 확인 못 함),
                  로컬은 0. audio_sent_s 가 None 이면 None
  retried_lines   실패했던 줄을 다시 보낸 수
  peak_rss_bytes  처리하는 동안 이 프로세스의 상주 메모리 최대. 1초마다와 처리 앞뒤에 읽는다. 읽을 수 없는 OS 면 None
  cpu_s           처리 앞뒤 getrusage(RUSAGE_SELF) 의 사용자·커널 CPU 초 차. resource 가 없는 OS 면 None
  recovery_attempts   처리를 시작할 때의 recovery.attempts. 앞선 실행이 단계를 닫지 못한 횟수다. 단계가 닫히면
                  recovery 가 지워지므로 끝에서 읽지 않는다
  llm_calls       판단 경로일 때 이번 추출 단계에서 Terra·Luna 에 보낸 호출 수 {"terra", "luna"}. 클라이언트에 호출 수가
                  없으면 그 값이 None. 옛 경로이거나 추출이 돌지 않았으면 None
  status, failed_stage   처리 뒤 상태와 이번 처리가 실패한 단계
  mode, extract_path, model, backend   MM_PIPELINE_MODE(없으면 None), MM_EXTRACT_PATH, 전사 모델 이름, 백엔드 이름

메모리와 CPU 는 프로세스 전체 값이다. 봇 방식이면 녹음 스레드와 이벤트 루프의 몫이 섞이고, 봇이 회의 둘을 같이
처리하면 서로의 몫도 섞인다. Terra·Luna 클라이언트도 프로세스에 하나라 같이 처리하는 회의의 호출이 섞인다.
워커는 한 번에 한 회의라 녹음과 다른 회의의 몫이 섞이지 않는다.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from shared.schemas import now_iso

SAMPLE_INTERVAL_S = 1.0              # 메모리 표본 간격
SAMPLER_NAME = "ops-rss"             # 표본 스레드 이름. 테스트가 멈췄는지 이 이름으로 본다
STATUS_FILE = Path("/proc/self/status")
FILE_NAME = "처리기록.md"
_STT_KEYS = ("speech_s", "track_s", "calls", "failed", "retries", "calls_over_20s", "gated", "audio_sent_s",
             "unmapped_chunks")


def read_rss(path: Path = STATUS_FILE) -> int | None:
    """이 프로세스의 상주 메모리(바이트). 리눅스 /proc/self/status 의 VmRSS 다. 읽을 수 없으면 None."""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024        # kB 라고 적혀 있지만 1024 바이트다
    except (OSError, ValueError, IndexError):
        return None
    return None


def cpu_seconds() -> float | None:
    """이 프로세스가 지금까지 쓴 CPU 초(사용자 + 커널). resource 는 윈도에 없다. 맨 위에서 import 하면 capture 를
    윈도에서 import 하지 못한다."""
    try:
        import resource
    except ImportError:
        return None
    ru = resource.getrusage(resource.RUSAGE_SELF)
    return ru.ru_utime + ru.ru_stime


def llm_counts() -> dict | None:
    """판단 경로면 Terra·Luna 클라이언트가 지금까지 보낸 호출 수 {"terra", "luna"}. 옛 경로면 None.

    llm.get_llm 은 프로세스에 클라이언트를 하나씩 두므로 파이프라인이 쓰는 것과 같다. 호출 수(calls)가 없는
    클라이언트(키가 없을 때의 NullLLM)는 그 값이 None 이다.
    """
    from capture.judge_path import extract_path

    if extract_path() != "judge":
        return None
    import llm

    return {which: getattr(llm.get_llm(which), "calls", None) for which in ("terra", "luna")}


def _since(raw: str | None, now: datetime) -> float | None:
    try:
        dt = datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return round((now - dt).total_seconds(), 2)


def _stt_krw(backend: str, audio_sent_s: float | None) -> float | None:
    """전사 비용 추정(원). Elice 면 보낸 소리 × 단가, 로컬은 호출 비용이 없어 0. 보낸 소리를 모르면 None.

    단가는 stt.elice 의 6원/60초(옛 주소 단가)다. 새 엔드포인트의 단가와 과금 단위는 확인하지 못했다. 보낸 소리는
    묶음마다 한 번 센 값이라 재시도로 다시 보낸 몫은 빠진다(재시도 수는 retries 칸).
    """
    if audio_sent_s is None:
        return None
    if not str(backend).startswith("elice"):
        return 0.0
    from stt.elice import WHISPER_KRW_PER_SEC
    return round(audio_sent_s * WHISPER_KRW_PER_SEC, 2)


def _ratio(a: float | None, b: float | None) -> float | None:
    return round(a / b, 3) if a is not None and b else None


class OpsRun:
    """처리 한 번의 기록기. 만들 때 시작 시각과 CPU 초를 적고 메모리 표본 스레드를 띄운다. finish 나 stop 이 멈춘다.

    read 는 메모리를 읽는 함수, interval_s 는 표본 간격이다. 테스트가 바꿔 끼운다. 처리 도중에 부르는 begin·end 는
    시각만 적고, load_model·watch_llm 은 예외를 삼킨다. 기록 때문에 회의 처리가 실패하지 않게 한다.
    """

    def __init__(self, manifest: dict, *, read=None, interval_s: float | None = None) -> None:
        now = datetime.now(timezone.utc).replace(microsecond=0)   # now_iso 와 같은 꼴. recorded_at 과 같은 초 단위로 뺀다
        self.started_at = now.isoformat()
        self._t0 = time.monotonic()
        self._cpu0 = cpu_seconds()
        self._wait_s = _since(manifest.get("recorded_at"), now)
        self._attempts = (manifest.get("recovery") or {}).get("attempts", 0)
        self.stages: dict[str, dict] = {}
        self.model_load_s: float | None = None
        self._open: tuple[str, str, float] | None = None
        self._llm0: dict | None = None
        self._read = read if read is not None else read_rss
        self._peak: int | None = None
        self._stop = threading.Event()
        self._sample()
        self._thread: threading.Thread | None = threading.Thread(
            target=self._loop, args=(SAMPLE_INTERVAL_S if interval_s is None else interval_s,),
            name=SAMPLER_NAME, daemon=True)
        try:
            self._thread.start()
        except RuntimeError:                              # 스레드를 못 띄우면 처리 앞뒤 두 번만 읽는다
            self._thread = None

    def _sample(self) -> None:
        try:
            rss = self._read()
        except Exception:  # noqa: BLE001 - 메모리를 못 읽어도 처리는 그대로다
            return
        if rss is not None and (self._peak is None or rss > self._peak):
            self._peak = rss

    def _loop(self, interval_s: float) -> None:
        while not self._stop.wait(interval_s):
            self._sample()

    def stop(self) -> None:
        """표본 스레드를 멈추고 마지막으로 한 번 더 읽는다. 두 번 불러도 된다."""
        if self._stop.is_set():
            return
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._sample()

    def begin(self, name: str) -> None:
        """단계를 연다. 열린 단계가 있으면 먼저 닫는다."""
        self.end()
        self._open = (name, now_iso(), time.monotonic())

    def end(self) -> None:
        """열린 단계를 닫는다. 없으면 아무것도 안 한다."""
        if self._open is None:
            return
        name, at, t = self._open
        self._open = None
        self.stages[name] = {"started_at": at, "ended_at": now_iso(), "s": round(time.monotonic() - t, 2)}

    def load_model(self, backend) -> None:
        """로컬 백엔드(_load 와 _model 이 있다)가 아직 모델을 안 올렸으면 지금 올리고 그 시간을 남긴다.

        원래도 첫 전사 호출이 하던 일이다. 앞으로 당겨 전사 단계 초와 RTF 에서 떼어 낸다. 올리다 실패하면 삼킨다.
        첫 전사 호출이 다시 올리고, 그 실패는 원래처럼 전사 단계가 센다.
        """
        if not hasattr(backend, "_load") or getattr(backend, "_model", True) is not None:
            return
        t = time.monotonic()
        try:
            backend._load()
        except Exception as e:  # noqa: BLE001
            print(f"[ops] 모델을 미리 올리지 못했다: {type(e).__name__}: {e}", flush=True)
            return
        self.model_load_s = round(time.monotonic() - t, 2)

    def watch_llm(self) -> None:
        """추출 단계 앞에서 부른다. 판단 경로면 Terra·Luna 호출 수를 적어 두고 finish 가 차를 낸다."""
        try:
            self._llm0 = llm_counts()
        except Exception as e:  # noqa: BLE001
            print(f"[ops] LLM 호출 수를 읽지 못했다: {type(e).__name__}: {e}", flush=True)

    def finish(self, manifest: dict, result: dict, *, model: str, backend: str) -> dict:
        """기록 한 건. 표본 스레드를 멈추고 열린 단계를 닫은 뒤 만든다. result 는 process_session 의 결과다."""
        from capture.judge_path import extract_path

        self.stop()
        self.end()
        wall_s = round(time.monotonic() - self._t0, 2)
        cpu1 = cpu_seconds()
        summary = (result.get("transcribe") or {}).get("summary")
        stt = {key: summary.get(key) for key in _STT_KEYS} if summary else dict.fromkeys(_STT_KEYS)
        stt_s = (self.stages.get("stt") or {}).get("s") if summary else None
        durations = [e.get("duration_sec") or 0 for e in manifest.get("speakers") or []]
        meeting_s = max(durations) if durations else None
        llm_calls = None
        if self._llm0 is not None:
            after = llm_counts() or {}
            llm_calls = {which: (after.get(which) - n if n is not None and after.get(which) is not None else None)
                         for which, n in self._llm0.items()}
        return {
            "run_started_at": self.started_at, "run_ended_at": now_iso(), "wall_s": wall_s, "wait_s": self._wait_s,
            "stages": self.stages, "model_load_s": self.model_load_s, "meeting_s": meeting_s,
            "speech_s": stt["speech_s"], "track_s": stt["track_s"],
            "rtf_meeting": _ratio(stt_s, meeting_s), "rtf_speech": _ratio(stt_s, stt["speech_s"]),
            "calls": stt["calls"], "failed": stt["failed"], "retries": stt["retries"],
            "calls_over_20s": stt["calls_over_20s"], "gated": stt["gated"],
            "audio_sent_s": stt["audio_sent_s"], "stt_krw": _stt_krw(backend, stt["audio_sent_s"]),
            "unmapped_chunks": stt["unmapped_chunks"],
            "retried_lines": result.get("retried", 0), "peak_rss_bytes": self._peak,
            "cpu_s": round(cpu1 - self._cpu0, 2) if cpu1 is not None and self._cpu0 is not None else None,
            "recovery_attempts": self._attempts, "llm_calls": llm_calls,
            "status": manifest.get("status"), "failed_stage": result.get("failed_stage"),
            "mode": os.environ.get("MM_PIPELINE_MODE") or None, "extract_path": extract_path(),
            "model": model, "backend": backend,
        }


# ─────────────────────────────────────────────────────────── 사람이 읽는 것

def _dur(s: float) -> str:
    """10초 밑은 소수 한 자리, 한 시간 밑은 분·초, 그 위는 시간·분. 9.96 은 반올림하면 10 이라 "10초" 로 쓴다."""
    if round(s, 1) < 10:
        return f"{s:.1f}초"
    n = round(s)
    if n < 60:
        return f"{n}초"
    if n < 3600:
        return f"{n // 60}분 {n % 60}초"
    return f"{n // 3600}시간 {n % 3600 // 60}분"


def _mem(b: int) -> str:
    """1GB 는 1024MB 다. 서버 메모리(free, /proc/meminfo)와 같은 단위다."""
    return f"{b / 1024 ** 3:.1f}GB" if b >= 1024 ** 3 else f"{b / 1024 ** 2:.0f}MB"


def summary_line(entry: dict) -> str:
    """결과 메시지 끝에 붙이는 한 줄. 처리는 이번 처리의 시작부터 끝이다. 모르는 값은 뺀다."""
    parts = [f"처리 {_dur(entry['wall_s'])}"]
    if entry.get("wait_s") is not None:
        parts.append(f"대기 {_dur(entry['wait_s'])}")
    if entry.get("peak_rss_bytes") is not None:
        parts.append(f"최대 메모리 {_mem(entry['peak_rss_bytes'])}")
    return "⏱ " + " · ".join(parts)


_STAGES = (("stt", "전사"), ("sources", "회의록 저장"), ("extract", "추출"), ("handoff", "인계"))
_STATUS = {"saved": "저장까지", "transcribed": "전사까지", "partial": "전사 일부 실패", "sourced": "회의록 저장까지",
           "extracted": "추출까지", "handed_off": "인계까지", "recording": "녹음 중"}
_HEAD = ("시작", "상태", "대기", "처리", "전사", "회의록 저장", "추출", "인계", "결과까지", "말한 시간", "RTF 회의 · 말",
         "최대 메모리", "CPU 초", "호출·실패·재시도", "보낸 소리 · 전사 비용", "단어 시각 없는 묶음")
_TERMS = (
    ("시작", "처리를 시작한 시각. 회의 시간대로 적는다", "run_started_at(UTC)"),
    ("상태", "처리가 끝났을 때 회의가 어디까지 갔나. 실패면 괄호 안이 실패한 단계다", "status, failed_stage"),
    ("대기 시간", "녹음을 저장한 뒤 처리를 시작할 때까지 기다린 시간. 앞 회의가 처리 중이면 길어진다. 재시도 처리는 "
     "재시도까지 기다린 시간이, 녹음 중에 끊긴 회의는 회의 길이가 든다", "wait_s"),
    ("전사, 회의록 저장, 추출, 인계", "단계마다 걸린 시간. 전사는 오디오를 글로 바꾸고, 회의록 저장은 그 글을 BE 에 넣고, "
     "추출은 할일과 결정을 뽑고, 인계는 결과를 BE 에 넘긴다. 빈 칸은 이번 처리에서 그 단계가 돌지 않았다는 뜻이다",
     "stages"),
    ("처리 시간", "이번 처리의 시작부터 끝. 단계 밖의 일(모델 올리기, BE 에 처리 시작 알리기, 실패를 세고 포기를 BE 에 "
     "알리기)도 든다", "wall_s"),
    ("결과까지", "대기 시간과 처리 시간의 합. 녹음을 저장한 뒤 이번 처리가 끝날 때까지다", "wait_s + wall_s"),
    ("말한 시간", "말 필터가 사람 말로 보고 전사에 보낸 구간의 합. 침묵은 빠진다", "speech_s"),
    ("회의 길이", "가장 긴 화자 트랙의 길이", "meeting_s"),
    ("RTF 회의 기준", "전사 시간 ÷ 회의 길이. 0.5 면 60분 회의를 30분에 전사했다. 두 RTF 는 전사를 처음부터 돌린 "
     "처리에만 있다", "rtf_meeting"),
    ("RTF 말한 시간 기준", "전사 시간 ÷ 말한 시간. 1 보다 크면 말한 시간보다 전사가 오래 걸렸다", "rtf_speech"),
    ("최대 메모리", "처리하는 동안 이 프로그램이 가장 많이 쓴 메모리. 1초마다 잰다. 1GB 는 1024MB. 봇 방식이면 녹음에 "
     "쓰는 몫과 같이 처리한 회의의 몫도 든다", "peak_rss_bytes"),
    ("CPU 초", "CPU 가 실제로 일한 시간의 합. 코어가 둘이면 처리 시간의 두 배까지 나온다. 봇 방식이면 녹음 몫과 같이 "
     "처리한 회의의 몫도 든다", "cpu_s"),
    ("호출", "전사 모델에 보낸 요청 수", "calls"),
    ("실패", "다시 보내도 끝내 실패한 요청 수. 그 구간은 회의록에서 빠진다", "failed"),
    ("재시도", "실패한 요청을 다시 보낸 횟수", "retries"),
    ("20초 넘은 호출", "한 번에 20초 넘게 걸린 전사 요청 수. 멈춘 것처럼 보이는 요청이다", "calls_over_20s"),
    ("말 필터가 거른 클립", "사람 말이 아니라고 보고 전사에 보내지 않은 소리 조각 수", "gated"),
    ("보낸 소리", "전사에 보낸 소리 길이의 합. 묶음마다 한 번 센다. 재시도로 다시 보낸 몫은 빠진다", "audio_sent_s"),
    ("전사 비용", "Elice 로 전사했을 때 보낸 소리 × 6원/60초로 센 추정. 새 엔드포인트의 단가와 과금 단위는 확인하지 "
     "못했다. 로컬 전사는 0원", "stt_krw"),
    ("단어 시각 없는 묶음", "응답에 단어 시각이 없어 묶음 전체(최대 28초)가 회의록 한 줄로 남은 수. 새 Elice 엔드포인트는 "
     "모든 묶음이 여기 든다", "unmapped_chunks"),
    ("다시 보낸 줄", "앞선 처리에서 실패한 줄만 골라 다시 전사한 수", "retried_lines"),
    ("모델 올리기", "이번 처리에서 전사 모델을 처음 메모리에 올린 시간. 전사 시간에는 들지 않는다", "model_load_s"),
    ("복구 시도", "이번 처리 전에 단계를 끝내지 못한 실행 수", "recovery_attempts"),
    ("LLM 호출", "판단 경로에서 이번 추출이 Terra·Luna 에 보낸 요청 수", "llm_calls"),
)


def _opt(value, fmt) -> str:
    return "" if value is None else fmt(value)


def _row(entry: dict, tz: ZoneInfo) -> list[str]:
    started = datetime.fromisoformat(entry["run_started_at"]).astimezone(tz).strftime("%m/%d %H:%M:%S")
    status = entry.get("status")
    label = f"실패({dict(_STAGES).get(entry.get('failed_stage'), entry.get('failed_stage'))})" \
        if status == "failed" else _STATUS.get(status, status or "")
    stages = entry.get("stages") or {}
    wait = entry.get("wait_s")
    rtf = (entry.get("rtf_meeting"), entry.get("rtf_speech"))
    calls = (entry.get("calls"), entry.get("failed"), entry.get("retries"))
    return [started, label, _opt(wait, _dur), _dur(entry["wall_s"]),
            *[_opt((stages.get(key) or {}).get("s"), _dur) for key, _ in _STAGES],
            "" if wait is None else _dur(wait + entry["wall_s"]),
            _opt(entry.get("speech_s"), _dur),
            "" if rtf == (None, None) else " · ".join(_opt(x, str) for x in rtf),
            _opt(entry.get("peak_rss_bytes"), _mem), _opt(entry.get("cpu_s"), lambda x: f"{x:.1f}"),
            "" if calls[0] is None else "·".join(str(x) for x in calls),
            "" if entry.get("audio_sent_s") is None else
            f"{_dur(entry['audio_sent_s'])} · {entry.get('stt_krw') or 0:.0f}원",
            _opt(entry.get("unmapped_chunks"), str)]


def write_markdown(meeting_dir: Path, title: str, manifest: dict) -> Path:
    """회의 폴더에 처리기록.md 를 쓴다. 매니페스트 ops 목록 전체로 통째로 다시 쓴다. 처리 한 번이 한 줄이다."""
    tz_name = manifest.get("timezone") or "UTC"
    tz = ZoneInfo(tz_name)
    records = manifest.get("ops") or []
    meeting_s = next((r.get("meeting_s") for r in reversed(records) if r.get("meeting_s") is not None), None)
    out = [f"# 처리 기록: {title}", "",
           f"회의 길이 {_opt(meeting_s, _dur) or '모름'}. 처리 한 번이 한 줄이다. 시각은 {tz_name} 기준이다. "
           "원래 숫자는 매니페스트(session_<회의>.json)의 ops 에 있다.", "",
           "| " + " | ".join(_HEAD) + " |", "|" + "---|" * len(_HEAD)]
    out += ["| " + " | ".join(_row(r, tz)) + " |" for r in records]
    out += ["", "## 용어", "", "| 용어 | 뜻 | 매니페스트 ops 칸 |", "|---|---|---|"]
    out += [f"| {term} | {meaning} | {key} |" for term, meaning, key in _TERMS]
    meeting_dir.mkdir(parents=True, exist_ok=True)
    path = meeting_dir / FILE_NAME
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return path
