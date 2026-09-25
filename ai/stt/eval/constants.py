"""전사·수신 경로의 이름 붙은 상수 목록과, 운영 코드를 고치지 않고 값을 바꿔 끼우는 도구.

상수 하나가 곧 결정 하나다. 그래서 상수마다 근거 종류와 흔들어 볼 값을 여기에 적는다. 민감도
측정(`stt/eval/sensitivity.py`)은 이 목록을 읽어 기본값 주변을 한 번에 하나씩 흔들고, 근거 표를
이 목록과 측정 결과로 만든다. 새 상수를 만들면 REGISTRY 에 한 줄 더한다. 빠뜨리면
tests/stt/test_constants.py 가 깨진다.

값 바꿔 끼우기가 모듈 속성 대입만으로 안 되는 이유. 파이썬의 기본 인자는 함수를 정의할 때 한 번
평가된다. `def group_turns(utts, gap_s=TURN_GAP_S)` 의 기본값은 import 순간의 3.0 이 함수 객체의
`__defaults__` 에 들어가 박힌다. 그 뒤에 `batch.TURN_GAP_S = 1.0` 을 해도 `group_turns(utts)` 는 3.0 으로
돈다. `build_chunks`·`merge_turns`·`split_long`, 데이터클래스 `StreamingVAD` 의 `speech_rms`,
`SpeechGate` 의 `threshold`·`min_ratio` 가 같다. `run()` 은 이 함수들을 기본 인자로 부른다. 반대로
`cut()` 의 `TAIL_PAD_S` 와 VAD 의 나머지 ms 상수는 호출할 때 모듈 전역을 읽어서 속성 대입으로 바뀐다.
그래서 `overrides()` 는 모듈 속성과, 목록의 `binds` 에 적힌 (함수, 인자) 의 기본값을 같이 바꾸고
끝나면 둘 다 되돌린다.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import re
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[2]

# 근거 종류. 표의 "근거 종류" 칸에 그대로 나간다
MEASURED = "여기서 측정"
RESULT_FILE = "다른 측정 결과 파일"
SPEC = "외부 사양"
DESIGN = "설계 판단"
NOT_HERE = "여기서 측정 불가"
EVIDENCE_KINDS = (MEASURED, RESULT_FILE, SPEC, DESIGN, NOT_HERE)

# 쓰이는 자리
BATCH = "배치 기본 경로"
REALTIME = "실시간 전용"
TRACK_ONLY = "track·whole 모드 전용"
STATS_ONLY = "통계만"
RECEIVE = "수신"
EVAL = "평가(정렬본 생성)"
FIXED = "고정"

# 흔드는 우선순위. 시간이 모자라면 앞에서부터 돈다
P_UNIT, P_VAD, P_GATE, P_NONE = 1, 2, 3, 9


@dataclass(frozen=True)
class Const:
    module: str
    name: str                      # 클래스 속성이면 "EliceStt.TIMEOUT_PER_AUDIO_S"
    evidence: str
    affects: str
    scope: str = BATCH
    sweep: tuple = ()              # 흔들 값. 현재 기본값을 반드시 포함한다
    metric: str = "err_chars"      # 주 지표
    binds: tuple = ()              # ((함수 qualname, 인자 이름), ...) 정의 시점에 값이 묶이는 기본 인자
    elice: bool = False            # 백엔드에 따라 갈릴 수 있어 Elice 로도 확인한다
    priority: int = P_NONE
    source: str = ""               # 측정 밖 근거: 결과 파일, 사양, 주석, 테스트
    recheck: str = ""              # 다시 잴 조건
    decision: str = "유지"

    @property
    def path(self) -> str:
        return f"{self.module}.{self.name}"


_PACKETS = "실서버 녹음과 패킷 도착 기록(패킷별 도착 시각·RTP·SSRC)이 들어오면"
_REAL = "실녹음 골든셋(짧은 대답·겹침·긴 침묵 뒤 발화)이 들어오면"
_SHORT = "실녹음에서 짧은 대답이 말 필터에 걸리는지 볼 때. 합성에서는 이 값이 거른 수를 바꿨다(0012)"
_GATE = "실녹음에서 짧은 대답이 걸리는지와 말 아닌 소리가 통과하는지를 같이 볼 때. 이 데이터에는 말 아닌 클립이 없다(0012)"
_EDGE = "기본값이 평탄 구간의 한쪽 끝이다. 실녹음에서 줄이 잘게 나뉘거나 끝 음절이 빠지면 먼저 본다(0012)"

REGISTRY: tuple[Const, ...] = (
    # ── stt/batch.py
    Const("stt.batch", "SR", SPEC, "모델 입력 표본율", FIXED,
          source="위스퍼 입력 규격 16kHz. load_track 이 다른 표본율을 거절한다"),
    Const("stt.batch", "CHUNK_MAX_S", MEASURED, "묶음 길이 상한. 호출 수와 문맥, 위스퍼 30초 창", BATCH,
          sweep=(15.0, 20.0, 24.0, 28.0, 30.0, 40.0), binds=(("build_chunks", "max_s"), ("split_long", "max_s")),
          elice=True, priority=P_UNIT, recheck="30초 넘는 독백이 있는 실녹음이 들어오면. LONG_SPLIT_FROM_S 보다 커야 한다"),
    Const("stt.batch", "CHUNK_GAP_S", MEASURED, "묶음 안 클립 사이에 넣는 침묵. 이음 자리에 마침표가 남나", BATCH,
          sweep=(0.0, 0.1, 0.2, 0.4, 0.8, 1.5), metric="punct", binds=(("build_chunks", "gap_s"),),
          elice=True, priority=P_UNIT, recheck="모델이 바뀌면(문장부호 습관이 모델마다 다르다)"),
    Const("stt.batch", "TURN_GAP_S", MEASURED, "같은 화자 클립을 한 턴(회의록 한 줄)으로 보는 최대 공백", BATCH,
          sweep=(0.5, 1.0, 2.0, 3.0, 5.0, 8.0), metric="lines",
          binds=(("build_chunks", "turn_gap_s"), ("group_turns", "gap_s"), ("merge_turns", "gap_s")),
          priority=P_UNIT, recheck=_REAL),
    Const("stt.batch", "WORD_TOLERANCE_S", DESIGN, "단어를 클립에 배정하는 경계 여유", TRACK_ONLY,
          source="chunk 는 묶음 안 위치로 되매핑해 이 값을 안 쓴다(_chunk_lines)", recheck="track 모드를 다시 쓸 때"),
    Const("stt.batch", "TAIL_PAD_S", MEASURED, "클립 끝에 남기는 여유. 마지막 음절", BATCH,
          sweep=(0.0, 0.05, 0.1, 0.2, 0.4, 0.8), metric="edge", elice=True, priority=P_UNIT, recheck=_SHORT),
    Const("stt.batch", "LONG_SPLIT_FROM_S", MEASURED, "CHUNK_MAX_S 를 넘는 클립을 가를 자리를 찾기 시작하는 시각", BATCH,
          sweep=(5.0, 10.0, 15.0, 20.0, 25.0), metric="edge", binds=(("split_long", "search_from_s"),),
          priority=P_UNIT, recheck="쉼 없이 30초 넘게 말하는 실녹음이 들어오면"),
    Const("stt.batch", "WHOLE_SEGMENT_GAP_S", DESIGN, "whole 모드에서 줄을 나누는 단어 사이 공백", TRACK_ONLY,
          source="whole 은 비교 기준 모드(0008 표 1)"),
    Const("stt.batch", "STALL_S", MEASURED, "오래 걸린 호출을 세는 문턱. 동작은 안 바꾼다", STATS_ONLY,
          metric="latency", source="0008 배경: 같은 1초 클립 20회 p50 2.62 p95 25.15초",
          recheck="Elice 서버나 모델이 바뀌면"),
    Const("stt.batch", "RETRIES", DESIGN, "실패한 호출을 다시 보내는 횟수", BATCH, metric="latency",
          source="0008 표 3: 고정 30초 타임아웃 때 호출이 전부 잘려 181원을 버린 뒤 넣었다",
          recheck="실패율을 잴 만큼 호출이 쌓이면(#40)"),
    Const("stt.batch", "RETRY_WAIT_S", DESIGN, "재시도 사이 대기", BATCH, metric="latency",
          source="0008. 대기 길이별 성공률은 안 쟀다", recheck="실패율을 잴 만큼 호출이 쌓이면(#40)"),
    # ── stt/vad.py
    Const("stt.vad", "SPEECH_RMS", MEASURED, "말로 보는 최소 RMS", BATCH,
          sweep=(0.003, 0.0045, 0.006, 0.009, 0.012), metric="lost",
          binds=(("StreamingVAD.__init__", "speech_rms"),), priority=P_VAD, recheck=_REAL),
    Const("stt.vad", "NOISE_MARGIN", MEASURED, "배경 소음 추정치 대비 말 임계 배수", BATCH,
          sweep=(1.2, 1.5, 1.8, 2.4, 3.0), metric="lost", priority=P_VAD,
          recheck="배경 소음이 있는 실녹음이 들어오면(정렬본 무음은 0 이다)"),
    Const("stt.vad", "SILENCE_HOLD_MS", MEASURED, "이만큼 조용하면 클립을 닫는다", BATCH,
          sweep=(400, 600, 800, 1000, 1500), metric="err_chars", priority=P_VAD, recheck=_EDGE),
    Const("stt.vad", "MIN_SPEECH_MS", MEASURED, "이보다 짧은 소리는 버린다", BATCH,
          sweep=(120, 200, 320, 480, 640), metric="lost", priority=P_VAD, recheck=_REAL),
    Const("stt.vad", "MAX_SEGMENT_MS", DESIGN, "실시간 경로의 긴 독백 강제 절단", REALTIME,
          binds=(("StreamingVAD.__init__", "max_segment_ms"),),
          source="배치 cut() 은 max_segment_ms=10**9 로 끄고 split_long 에 맡긴다"),
    Const("stt.vad", "FRAME_MS", DESIGN, "VAD 판정 프레임", FIXED,
          binds=(("StreamingVAD.__init__", "frame_ms"),),
          source="디스코드 패킷 20ms 와 같다. ONSET_MS 를 == 로 비교해 ms 상수가 이 배수라는 전제가 코드에 있다"),
    Const("stt.vad", "ONSET_MS", MEASURED, "임계를 넘는 프레임이 이만큼 이어져야 말로 본다", BATCH,
          sweep=(20, 40, 60, 100, 160), metric="lost", priority=P_VAD, recheck=_EDGE),
    Const("stt.vad", "RESTART_SILENCE_MS", MEASURED, "짧은 소리 뒤 이만큼 조용하면 그 소리를 버리고 다시 센다", BATCH,
          sweep=(200, 300, 400, 600, 800), metric="lost", priority=P_VAD, recheck=_REAL),
    Const("stt.vad", "SOFT_CAP_MS", MEASURED, "발화가 이만큼 길어지면 짧은 쉼에서도 끊는다", BATCH,
          sweep=(4000, 6000, 8000, 12000, 20000), metric="err_chars", priority=P_VAD, recheck=_REAL),
    Const("stt.vad", "SOFT_HOLD_MS", MEASURED, "길어진 발화를 끊는 짧은 쉼", BATCH,
          sweep=(200, 300, 400, 600, 800), metric="err_chars", priority=P_VAD, recheck=_REAL),
    # ── stt/speech_gate.py
    Const("stt.speech_gate", "ENABLED", MEASURED, "말 필터 켬·끔", BATCH, sweep=(True, False), metric="lost",
          priority=P_GATE, source="0005", recheck=_GATE),
    Const("stt.speech_gate", "THRESHOLD", MEASURED, "silero 말 판정 임계", BATCH, sweep=(0.5, 0.8, 0.95, 0.98),
          metric="lost", binds=(("SpeechGate.__init__", "threshold"),), priority=P_GATE,
          source="0005: 골든셋 실제 발화 18건 말 비율 최소 75%, 환각 클립 42% 이하", recheck=_GATE),
    Const("stt.speech_gate", "MIN_SPEECH_RATIO", MEASURED, "클립에서 말 비율이 이보다 낮으면 거른다", BATCH,
          sweep=(0.3, 0.45, 0.6, 0.75, 0.9), metric="lost", binds=(("SpeechGate.__init__", "min_ratio"),),
          priority=P_GATE, source="0005", recheck=_GATE),
    # ── stt/elice.py, stt/transcribe.py
    Const("stt.elice", "WHISPER_KRW_PER_SEC", SPEC, "Elice 전사 단가(원/초)", FIXED,
          source="Elice 단가 6원/60초 (2026-09, stt/elice.py)", recheck="단가가 바뀌면"),
    Const("stt.elice", "EliceStt.TIMEOUT_PER_AUDIO_S", MEASURED, "오디오 1초당 더 기다리는 시간", BATCH,
          metric="latency", source="2026-09-15 길이별 3회: 고정비 2.4초에 길이의 0.45배", recheck="Elice 서버나 모델이 바뀌면"),
    Const("stt.transcribe", "MAX_SEC_PER_AUDIO_MIN", SPEC, "통과 기준: 오디오 1분당 전사 30초", FIXED,
          source="멘토 기준 (계획서 4장)"),
    # ── 수신 (capture/). wav 골든셋으로는 못 잰다
    Const("capture.audio", "TARGET_SR", SPEC, "수신 PCM 을 내리는 표본율", FIXED, source="위스퍼 입력 16kHz"),
    Const("capture.audio", "DECIM", SPEC, "48kHz → 16kHz 솎음 배수", FIXED, source="디스코드 PCM 48kHz"),
    Const("capture.recording_store", "PCM_RATE", SPEC, "디스코드 PCM 표본율", FIXED, source="디스코드 음성 48kHz"),
    Const("capture.recording_store", "PCM_CHANNELS", SPEC, "디스코드 PCM 채널 수", FIXED, source="디스코드 음성 스테레오"),
    Const("capture.recording_store", "PCM_SAMPLE_WIDTH", SPEC, "디스코드 PCM 표본 폭(바이트)", FIXED, source="16비트"),
    Const("capture.streaming_sink", "GAP_MS", NOT_HERE, "이보다 벌어진 패킷 간격을 화자 끊김으로 센다", RECEIVE,
          source="주석(20ms 패킷 세 개), tests/capture/test_streaming_sink.py", recheck=_PACKETS),
    Const("capture.streaming_sink", "IDLE_FLUSH_MS", NOT_HERE, "패킷이 이만큼 안 오면 재정렬 창을 비운다", RECEIVE,
          source="주석(창에 갇힌 발화 끝 320ms 가 MIN_SPEECH_MS 미달로 사라진 사례), test_streaming_sink", recheck=_PACKETS),
    Const("capture.timeline", "NOISE_NONZERO_MAX", NOT_HERE, "0 아닌 바이트가 이 개수 이하인 패킷은 버린다", RECEIVE,
          source="주석(디스코드 침묵 프레임, 쓰레기 패킷), Craig", recheck=_PACKETS),
    Const("capture.timeline", "REORDER_WINDOW", NOT_HERE, "RTP 순서로 정렬하는 창(패킷 수)", RECEIVE,
          source="Craig 와 같은 16패킷(320ms). tests/capture/test_timeline.py", recheck=_PACKETS),
    Const("capture.timeline", "HALF_RANGE", SPEC, "32비트 RTP 타임스탬프 랩어라운드 판정", FIXED, source="RTP 32비트"),
    Const("capture.timeline", "REANCHOR_TICKS", DESIGN, "RTP 기준점을 다시 잡는 문턱(5분)", RECEIVE,
          source="주석: 정상 재정렬(약 15,360틱)과 자릿수가 다르다", recheck=_PACKETS),
    Const("capture.track_writer", "MAX_GAP_MS", DESIGN, "트랙에 한 번에 채우는 무음 상한(4시간)", RECEIVE,
          source="주석: 60초였을 때 1분 넘게 조용한 화자의 시간축이 당겨졌다"),
    Const("capture.track_writer", "TrackPool.QUEUE_MAX", DESIGN, "쓰기 큐 상한(약 80초분)", RECEIVE,
          source="주석", recheck=_PACKETS),
    Const("capture.discord_adapter", "FLUSH_EVERY_S", NOT_HERE, "재정렬 창을 비우는 주기", RECEIVE,
          source="주석(패킷 20ms 마다)", recheck=_PACKETS),
    # ── 평가. 정렬본을 만드는 값이라 평가 결과에 영향이 있다
    Const("stt.eval.golden", "SR", SPEC, "정렬본 표본율", FIXED, source="위스퍼 입력 16kHz"),
    Const("stt.eval.golden", "RUN_GAP_S", MEASURED, "정렬본을 만들 때 한 화자의 발화 덩어리를 나누는 공백", EVAL,
          source="sensitivity align-sweep 으로 다시 정렬해 wav 를 비교한다", recheck="새 원본 골든셋을 정렬할 때"),
    Const("stt.eval.golden", "PLACE_GAP_S", MEASURED, "정렬본에서 발화 덩어리 사이에 두는 침묵", EVAL,
          source="sensitivity align-sweep 으로 다시 정렬해 묶음 입력과 전사 오류를 비교한다",
          recheck="새 원본 골든셋을 정렬할 때"),
)

BY_PATH = {c.path: c for c in REGISTRY}

# 숫자처럼 보이지만 결정이 아닌 이름. 이유를 같이 적는다
EXCLUDED: dict[str, str] = {}

SCANNED = (
    "stt/batch.py", "stt/vad.py", "stt/speech_gate.py", "stt/elice.py", "stt/transcribe.py",
    "capture/audio.py", "capture/recording_store.py", "capture/streaming_sink.py", "capture/timeline.py",
    "capture/track_writer.py", "capture/discord_adapter.py", "stt/eval/golden.py",
)
_UPPER = re.compile(r"^[A-Z][A-Z0-9_]*$")


def _numeric(node: ast.AST) -> bool:
    """숫자 리터럴이거나 숫자 리터럴끼리의 산술, 또는 float()/int() 호출."""
    if isinstance(node, ast.Constant):
        return isinstance(node.value, (int, float, bool))
    if isinstance(node, ast.UnaryOp):
        return _numeric(node.operand)
    if isinstance(node, ast.BinOp):
        return _numeric(node.left) and _numeric(node.right)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        return node.func.id in ("float", "int")
    return False


def _assigns(body, prefix: str = ""):
    for node in body:
        if isinstance(node, ast.ClassDef) and not prefix:
            yield from _assigns(node.body, f"{node.name}.")
        targets, value = [], None
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        for t in targets:
            if isinstance(t, ast.Name) and _UPPER.match(t.id):
                yield f"{prefix}{t.id}", value


def scanned_constants() -> dict[str, ast.AST]:
    """SCANNED 파일의 모듈·클래스 수준 숫자 상수. {경로: 값 노드}. import 하지 않고 소스를 읽는다."""
    out: dict[str, ast.AST] = {}
    for rel in SCANNED:
        src = (AI_ROOT / rel).read_text(encoding="utf-8")
        module = rel[:-3].replace("/", ".")
        for name, value in _assigns(ast.parse(src).body):
            if _numeric(value):
                out[f"{module}.{name}"] = value
    return out


def unregistered_constants() -> list[str]:
    return sorted(p for p in scanned_constants() if p not in BY_PATH and p not in EXCLUDED)


def source_value(path: str) -> str:
    """소스에 적힌 그대로의 값. import 없이 읽으므로 py-cord 가 없는 환경에서도 표를 만든다."""
    node = scanned_constants().get(path)
    return ast.unparse(node) if node is not None else "?"


def _owner(c: Const):
    obj = importlib.import_module(c.module)
    *parents, attr = c.name.split(".")
    for p in parents:
        obj = getattr(obj, p)
    return obj, attr


def current_value(path: str):
    owner, attr = _owner(BY_PATH[path])
    return getattr(owner, attr)


def _function(module: str, qual: str):
    obj = importlib.import_module(module)
    for part in qual.split("."):
        obj = getattr(obj, part)
    return obj


def bound_default(module: str, qual: str, param: str):
    return inspect.signature(_function(module, qual)).parameters[param].default


def _patch_default(fn, param: str, value):
    """fn 의 기본 인자 하나를 바꾸고, 되돌리는 함수를 돌려준다."""
    kwd = fn.__kwdefaults__ or {}
    if param in kwd:
        old = dict(kwd)
        fn.__kwdefaults__ = {**kwd, param: value}
        return lambda: setattr(fn, "__kwdefaults__", old)
    params = [p for p in inspect.signature(fn).parameters.values()
              if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    defaults = fn.__defaults__ or ()
    names = [p.name for p in params][len(params) - len(defaults):]
    if param not in names:
        raise KeyError(f"{fn.__qualname__} 에 기본값이 있는 인자 {param} 이 없다")
    old = defaults
    new = list(defaults)
    new[names.index(param)] = value
    fn.__defaults__ = tuple(new)
    return lambda: setattr(fn, "__defaults__", old)


@contextmanager
def overrides(values: dict[str, object]):
    """{상수 경로: 값} 을 모듈 속성과 묶인 기본 인자에 같이 넣고, 끝나면 되돌린다.

    목록에 없는 경로는 KeyError. 오타가 조용히 기본값으로 도는 것을 막는다.
    """
    consts = [BY_PATH[p] for p in values]          # 먼저 전부 확인한다. 반쯤 바꾼 채로 멈추지 않게
    undo = []
    try:
        for c in consts:
            v = values[c.path]
            owner, attr = _owner(c)
            old = getattr(owner, attr)
            setattr(owner, attr, v)
            undo.append(lambda o=owner, a=attr, x=old: setattr(o, a, x))
            for qual, param in c.binds:
                undo.append(_patch_default(_function(c.module, qual), param, v))
        yield
    finally:
        for step in reversed(undo):
            step()
