"""회의 트랙 wav 묶음을 발화 단위로 잘라 전사하고 한 시간축에 정렬한다. 배치 경로.

입력은 화자별 wav 여러 개다. 각 파일은 같은 회의 시계 위에 있다 — TrackWriter 가 쓴 것은
샘플 위치가 곧 회의 경과 시각이고 패킷이 안 온 구간은 0 이다. SyncedWaveSink 가 쓴 것도
앞을 무음으로 채워 같은 모양이다. 그래서 트랙별 오프셋 없이 VAD 가 준 start_ms 가 그대로
회의 기준 시각이고, 여섯 화자를 start 로 정렬하면 회의록이다.

트랙을 통째로 모델에 넣지 않는 이유는 둘이다. 무음까지 과금되고, 무음 구간에서 위스퍼가
앞 문장을 반복한다(52초 트랙의 31~36초 완전 무음에 앞 문장이 복사돼 나왔고, 74.7초 파일은
한 문장을 무한 반복해 CER 87% 가 됐다). 그래서 먼저 VAD 로 발화 클립을 자른다.

모드 셋을 같은 시간축 위에 둔다. 멘토가 재라고 한 세 칸(Elice/클립, local/트랙, local/클립)이
여기서 나온다.

  clip   클립 하나씩 전사. 앞뒤 문맥이 없어 CER 이 약간 나쁘다. 무음 0. API 비용 최소.
         로컬 모델은 클립마다 30초 창을 채우는 고정 비용(turbo 약 5초)이 들어 손해다.
  chunk  같은 화자의 클립을 침묵 빼고 이어 CHUNK_MAX_S 안으로 묶어 전사하고, 단어 시각으로
         클립에 되매핑한다. 문맥이 살고 무음은 안 보낸다. 호출 수가 줄어 API stall 노출도 준다.
  track  트랙 통째. 로컬 전용. condition_on_previous_text=False 와 hallucination_silence_threshold
         로 반복을 누른다. VAD 가 말이 없다고 본 자리에 놓인 단어는 환각으로 세고 버린다.

사용 (ai/ 안에서):
  .venv/bin/python -m stt.batch recordings/<회의> --mode chunk --backend local
  .venv/bin/python -m stt.batch recordings/<회의> --mode clip --backend elice --yes
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf

from stt.backend import SttBackend, SttResult, Word
from stt.lines import Line
from stt.speech_gate import SpeechGate
from stt.vad import StreamingVAD, Utterance

SR = 16_000
CHUNK_MAX_S = 28.0     # 위스퍼 창 30초 아래. 넘기면 모델이 창을 쪼개고 문맥이 끊긴다
CHUNK_GAP_S = 0.20     # 클립 사이에 넣는 침묵. 없으면 단어가 붙어 나온다
WORD_TOLERANCE_S = 0.30  # track 모드에서 단어를 클립에 배정할 때 허용하는 경계 여유


@dataclass
class Track:
    speaker_id: str
    speaker_name: str
    path: Path


@dataclass
class BatchStats:
    mode: str
    backend: str
    tracks: int = 0
    clips: int = 0
    gated: int = 0
    calls: int = 0
    failed: int = 0
    audio_sent_s: float = 0.0
    speech_s: float = 0.0
    track_s: float = 0.0
    wall_s: float = 0.0
    unmapped: int = 0            # 단어 시각이 없어 통째로 첫 클립에 붙인 묶음 수
    hallucinated_words: int = 0  # track 모드: VAD 가 말이 없다고 본 자리의 단어 수
    transcribe_s: list[float] = field(default_factory=list)
    by_speaker_s: dict[str, float] = field(default_factory=dict)  # 화자별 호출 시간 합. 파일당 처리 시간 기록용
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def summary(self) -> dict:
        ts = sorted(self.transcribe_s)
        pct = lambda p: (ts[min(len(ts) - 1, int(round((len(ts) - 1) * p)))] if ts else None)  # noqa: E731
        return {
            "mode": self.mode, "backend": self.backend, "tracks": self.tracks, "clips": self.clips,
            "gated": self.gated, "calls": self.calls, "failed": self.failed,
            "audio_sent_s": round(self.audio_sent_s, 1), "speech_s": round(self.speech_s, 1),
            "track_s": round(self.track_s, 1), "wall_s": round(self.wall_s, 1),
            "transcribe_p50_s": None if not ts else round(statistics.median(ts), 2),
            "transcribe_p95_s": None if not ts else round(pct(0.95), 2),
            "transcribe_max_s": None if not ts else round(ts[-1], 2),
            "unmapped_chunks": self.unmapped, "hallucinated_words": self.hallucinated_words,
        }


# ─────────────────────────────────────────────────────────────── 자르기
def load_track(path: Path) -> np.ndarray:
    audio, sr = sf.read(str(path), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != SR:
        raise ValueError(f"{path.name}: {sr}Hz. 이 파이프라인은 {SR}Hz 를 전제한다")
    return audio


TAIL_PAD_S = 0.10   # 클립 끝에 남기는 여유. 마지막 음절이 잘리지 않을 만큼만


def cut(audio: np.ndarray, speaker_id: str) -> list[Utterance]:
    """실시간 경로와 같은 VAD 로 자른다. 샘플 위치가 회의 시각이므로 offset 은 그대로 준다.

    VAD 가 준 pcm 은 발화를 닫으려고 본 침묵 800ms 를 꼬리에 달고 있다(실시간 경로는 그대로
    보낸다). 배치에서는 start~end 에 100ms 만 더한 만큼으로 자른다. 1.5초 발화에 2.3초를 보내던
    것이 1.6초가 되고, 무음이 모델에 안 들어간다.
    """
    v = StreamingVAD(speaker_id=speaker_id, sample_rate=SR)
    n = SR * 20 // 1000
    out: list[Utterance] = []
    for i in range(0, len(audio) - n + 1, n):
        out += v.feed(audio[i:i + n], i * 1000 // SR)
    out += v.flush()
    for u in out:
        keep = int(((u.end_ms - u.start_ms) / 1000 + TAIL_PAD_S) * SR)
        if len(u.pcm) > keep > 0:
            u.pcm = u.pcm[:keep]
    return out


def discover(session_dir: Path, names: dict[str, str] | None = None) -> list[Track]:
    """디렉토리의 wav 를 트랙으로. 파일명 <uid>_<ts>.wav 면 uid, 아니면 stem 이 화자다."""
    names = names or {}
    tracks: list[Track] = []
    for p in sorted(session_dir.glob("*.wav")):
        stem = p.stem
        uid = stem.split("_", 1)[0] if "_" in stem and stem.split("_", 1)[0].isdigit() else stem
        tracks.append(Track(speaker_id=uid, speaker_name=names.get(uid, uid), path=p))
    return tracks


# ─────────────────────────────────────────────────────────────── 묶기
@dataclass
class Chunk:
    pcm: np.ndarray
    pieces: list[tuple[float, Utterance]]   # (묶음 안에서의 시작 초, 클립)

    def to_absolute(self, t_chunk_s: float) -> tuple[Utterance, float] | None:
        """묶음 안 시각 → (클립, 회의 시각). 침묵 자리면 가장 가까운 앞 클립."""
        best = None
        for off, u in self.pieces:
            if t_chunk_s + 1e-6 >= off:
                best = (off, u)
        if best is None:
            return None
        off, u = best
        return u, u.start_ms / 1000 + (t_chunk_s - off)


def build_chunks(utts: list[Utterance], max_s: float = CHUNK_MAX_S, gap_s: float = CHUNK_GAP_S) -> list[Chunk]:
    chunks: list[Chunk] = []
    cur: list[Utterance] = []
    cur_len = 0.0
    gap = np.zeros(int(SR * gap_s), dtype=np.float32)

    def flush() -> None:
        if not cur:
            return
        pcm_parts, pieces, off = [], [], 0.0
        for u in cur:
            pieces.append((off, u))
            pcm_parts.append(u.pcm)
            off += len(u.pcm) / SR
            pcm_parts.append(gap)
            off += gap_s
        chunks.append(Chunk(pcm=np.concatenate(pcm_parts), pieces=pieces))

    for u in utts:
        dur = len(u.pcm) / SR + gap_s
        if cur and cur_len + dur > max_s:
            flush()
            cur, cur_len = [], 0.0
        cur.append(u)
        cur_len += dur
    flush()
    return chunks


# ─────────────────────────────────────────────────────────────── 전사
def _call(backend: SttBackend, pcm: np.ndarray, stats: BatchStats,
          speaker: str = "") -> tuple[SttResult | None, float, str | None]:
    t0 = time.monotonic()
    try:
        r = backend.transcribe(pcm, SR)
        err = None
    except Exception as e:  # SttError 도, 예상 못 한 것도 줄 하나의 실패로만 남긴다
        r, err = None, f"{type(e).__name__}: {e}"
    dt = time.monotonic() - t0
    with stats._lock:   # 워커 여럿이 같은 통계를 만진다
        stats.calls += 1
        stats.audio_sent_s += len(pcm) / SR
        stats.transcribe_s.append(dt)
        stats.by_speaker_s[speaker] = stats.by_speaker_s.get(speaker, 0.0) + dt
        if err:
            stats.failed += 1
    return r, dt, err


def _line(u: Utterance, name: str, text: str, dt: float, err: str | None) -> Line:
    return Line(speaker_id=u.speaker_id, speaker_name=name, turn_id="", seq=0,
                start_ms=u.start_ms, end_ms=u.end_ms, text=text if not err else "",
                final=True, transcribe_s=round(dt, 3), error=err)


def _assign_words_to_clips(words: list[Word], clips: list[Utterance], tol_s: float) -> tuple[dict[int, list[str]], int]:
    """단어 중점이 어느 클립 안에 있는지로 배정. 어디에도 안 들어가면 환각 후보로 센다."""
    by_clip: dict[int, list[str]] = {}
    stray = 0
    for w in words:
        mid = (w.start_s + w.end_s) / 2
        hit = None
        for i, u in enumerate(clips):
            if u.start_ms / 1000 - tol_s <= mid <= u.end_ms / 1000 + tol_s:
                hit = i
                break
        if hit is None:
            stray += 1
            continue
        by_clip.setdefault(hit, []).append(w.text)
    return by_clip, stray


def transcribe_clip_mode(tr: Track, utts: list[Utterance], backend: SttBackend, stats: BatchStats,
                         workers: int) -> list[Line]:
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        results = list(ex.map(lambda u: _call(backend, u.pcm, stats, tr.speaker_id), utts))
    return [_line(u, tr.speaker_name, r.text if r else "", dt, err) for u, (r, dt, err) in zip(utts, results)]


def transcribe_chunk_mode(tr: Track, utts: list[Utterance], backend: SttBackend, stats: BatchStats,
                          workers: int) -> list[Line]:
    chunks = build_chunks(utts)
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        results = list(ex.map(lambda c: _call(backend, c.pcm, stats, tr.speaker_id), chunks))
    lines: list[Line] = []
    for c, (r, dt, err) in zip(chunks, results):
        clips = [u for _, u in c.pieces]
        if err or r is None:
            lines += [_line(u, tr.speaker_name, "", dt, err or "empty") for u in clips]
            continue
        if not r.words:
            # 단어 시각이 없으면 되매핑을 못 한다. 통째로 첫 클립에 붙이고 센다.
            stats.unmapped += 1
            lines.append(_line(clips[0], tr.speaker_name, r.text, dt, None))
            lines += [_line(u, tr.speaker_name, "", dt, None) for u in clips[1:]]
            continue
        texts: dict[int, list[str]] = {}
        for w in r.words:
            hit = c.to_absolute((w.start_s + w.end_s) / 2)
            if hit is None:
                continue
            u, _abs = hit
            texts.setdefault(id(u), []).append(w.text)
        for u in clips:
            lines.append(_line(u, tr.speaker_name, " ".join(texts.get(id(u), [])), dt, None))
    return lines


def transcribe_track_mode(tr: Track, audio: np.ndarray, utts: list[Utterance], backend: SttBackend,
                          stats: BatchStats) -> list[Line]:
    r, dt, err = _call(backend, audio, stats, tr.speaker_id)
    if err or r is None:
        return [_line(u, tr.speaker_name, "", dt, err or "empty") for u in utts]
    if not r.words:
        stats.unmapped += 1
        return [_line(u, tr.speaker_name, r.text if i == 0 else "", dt, None) for i, u in enumerate(utts)]
    by_clip, stray = _assign_words_to_clips(r.words, utts, WORD_TOLERANCE_S)
    stats.hallucinated_words += stray
    return [_line(u, tr.speaker_name, " ".join(by_clip.get(i, [])), dt, None) for i, u in enumerate(utts)]


# ─────────────────────────────────────────────────────────────── 한 회의
def run(tracks: list[Track], backend: SttBackend, *, mode: str = "chunk", gate: SpeechGate | None = None,
        workers: int = 3) -> tuple[list[Line], BatchStats]:
    """트랙 목록을 전사해 회의 전체 순번이 매겨진 Line 목록과 통계를 돌려준다."""
    if mode not in ("clip", "chunk", "track"):
        raise ValueError(f"mode 는 clip|chunk|track 이다: {mode}")
    stats = BatchStats(mode=mode, backend=getattr(backend, "name", type(backend).__name__))
    t0 = time.monotonic()
    all_lines: list[Line] = []
    for tr in tracks:
        audio = load_track(tr.path)
        stats.tracks += 1
        stats.track_s += len(audio) / SR
        utts = cut(audio, tr.speaker_id)
        if gate is not None:
            kept = []
            for u in utts:
                if gate.accepts(u.pcm, SR, tag=f"{tr.speaker_name}#{u.seq}"):
                    kept.append(u)
                else:
                    stats.gated += 1
            utts = kept
        stats.clips += len(utts)
        stats.speech_s += sum(u.duration_s for u in utts)
        if not utts:
            continue
        if mode == "clip":
            all_lines += transcribe_clip_mode(tr, utts, backend, stats, workers)
        elif mode == "chunk":
            all_lines += transcribe_chunk_mode(tr, utts, backend, stats, workers)
        else:
            all_lines += transcribe_track_mode(tr, audio, utts, backend, stats)

    # 회의 전체 순번. 화자별 카운터가 아니라 확정 순서(start) 기준이다.
    all_lines.sort(key=lambda ln: (ln.start_ms, ln.speaker_id))
    for i, ln in enumerate(all_lines, 1):
        ln.seq = i
    stats.wall_s = time.monotonic() - t0
    return all_lines, stats


def load_names(session_dir: Path) -> dict[str, str]:
    """recordings/session_<ts>.json 이 있으면 uid → 표시 이름."""
    names: dict[str, str] = {}
    for mp in [*session_dir.parent.glob("session_*.json"), *session_dir.glob("session_*.json")]:
        if mp.exists():
            try:
                for sp in json.loads(mp.read_text(encoding="utf-8")).get("speakers", []):
                    names[str(sp.get("user_id"))] = sp.get("display_name") or str(sp.get("user_id"))
            except (OSError, json.JSONDecodeError):
                pass
    return names


def make_backend(kind: str, model: str) -> SttBackend:
    if kind == "elice":
        from shared.config import settings
        from stt.elice import EliceStt
        settings()
        return EliceStt()
    from stt.local import LocalStt
    return LocalStt(model_size=model, track_mode=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="회의 트랙 묶음을 배치로 전사해 한 시간축에 정렬한다")
    ap.add_argument("session_dir", type=Path, help="화자별 wav 가 있는 디렉토리")
    ap.add_argument("--mode", choices=["clip", "chunk", "track"], default="chunk")
    ap.add_argument("--backend", choices=["local", "elice"], default="local")
    ap.add_argument("--model", default="large-v3-turbo", help="--backend local 의 faster-whisper 모델")
    ap.add_argument("--no-gate", action="store_true", help="말 필터를 끈다")
    ap.add_argument("--workers", type=int, default=None, help="동시 호출 수. 기본: elice 3, local 1")
    ap.add_argument("--out", type=Path, default=None, help="회의록 출력 디렉토리 (기본: session_dir)")
    ap.add_argument("--yes", action="store_true", help="유료 실행을 승인한다")
    args = ap.parse_args(argv)

    from stt.transcript_writer import write_transcript

    tracks = discover(args.session_dir, load_names(args.session_dir))
    if not tracks:
        print(f"{args.session_dir} 에 wav 가 없다", file=sys.stderr)
        return 1
    if args.backend == "elice" and not args.yes:
        from stt.elice import whisper_krw
        est = sum(len(load_track(t.path)) / SR for t in tracks) * (1.0 if args.mode == "track" else 0.7)
        print(f"트랙 {len(tracks)}개 · 예상 상한 약 {whisper_krw(est):.0f}원 (mode={args.mode}). "
              f"승인하려면 --yes.")
        return 0
    workers = args.workers if args.workers is not None else (3 if args.backend == "elice" else 1)
    backend = make_backend(args.backend, args.model)
    gate = None if args.no_gate else SpeechGate()
    lines, stats = run(tracks, backend, mode=args.mode, gate=gate, workers=workers)

    out_dir = args.out or args.session_dir
    meeting_id = args.session_dir.name
    out = write_transcript(lines, out_dir, meeting_id)
    s = stats.summary()
    (out_dir / f"batch_{args.mode}_{args.backend}.json").write_text(
        json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(s, ensure_ascii=False))
    print(f"회의록 {out['markdown']}  (전사 실패 {out['failed']}줄 제외)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
