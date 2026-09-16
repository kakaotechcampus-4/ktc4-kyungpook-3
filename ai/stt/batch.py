"""회의 트랙 wav 묶음을 발화 단위로 잘라 전사하고 한 시간축에 정렬한다. 종료 후 배치 경로.

입력은 화자별 wav 여러 개다. 각 파일은 같은 회의 시계 위에 있다. TrackWriter 가 쓴 것은
샘플 위치가 곧 회의 경과 시각이고 패킷이 안 온 구간은 0 이다. SyncedWaveSink 가 쓴 것도
앞을 무음으로 채워 같은 모양이다. 그래서 트랙별 오프셋 없이 VAD 가 준 start_ms 가 그대로
회의 기준 시각이고, 여섯 화자를 start 로 정렬하면 회의록이다.

트랙을 통째로 모델에 넣지 않는 이유는 둘이다. 무음까지 과금되고, 무음 구간에서 위스퍼가
앞 문장을 반복하거나 문장을 지어낸다. 그래서 먼저 VAD 로 발화 클립을 자른다.

단위가 셋 있다.
  클립  VAD 가 침묵(800ms, 8초 넘긴 발화는 400ms)에서 자른 조각. STT 되매핑의 최소 단위.
  턴    같은 화자의 클립이 3초 안에 이어진 묶음. 회의록 한 줄이고 seq 하나다. 사이에 다른
        화자의 클립이 시작하면 거기서 끊는다.
  묶음  STT 에 한 번에 보내는 오디오. 턴을 침묵 0.2초로 이어 28초 안으로 채운다. 턴 하나가
        28초를 넘으면 그 턴 안의 가장 긴 쉼에서 가른다. 클립 중간은 어디서도 안 자른다.

모드 넷을 같은 시간축 위에 둔다.
  clip   클립 하나씩 전사. 앞뒤 문맥이 없어 CER 이 나쁘고 로컬은 호출마다 30초 창을 채우는
         고정비가 든다. 실시간 경로가 보내던 단위다.
  chunk  묶음 단위 전사. 기본값. 단어 시각으로 클립에 되돌린다.
  track  트랙 통째. 반복 억제 옵션을 켜고, VAD 가 말이 없다고 본 자리의 단어는 버린다.
  whole  트랙 통째, 옵션 없음. 이전 transcribe.py 가 하던 것과 같다. 비교 기준.

사용 (ai/ 안에서):
  .venv/bin/python -m stt.batch recordings/<회의> --mode chunk --backend local
  .venv/bin/python -m stt.batch recordings/<회의> --mode chunk --backend elice --yes
"""

from __future__ import annotations

import argparse
import bisect
import json
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np
import soundfile as sf

from stt.backend import SttBackend, SttResult, Word
from stt.lines import Line
from stt.speech_gate import SpeechGate
from stt.vad import StreamingVAD, Utterance

SR = 16_000
CHUNK_MAX_S = 28.0       # 위스퍼 창 30초 아래. 넘기면 모델이 창을 쪼개고 문맥이 끊긴다
CHUNK_GAP_S = 0.20       # 묶음 안 클립 사이에 넣는 침묵. 없으면 단어가 붙어 나온다
TURN_GAP_S = 3.0         # 같은 화자 클립을 한 턴으로 보는 최대 공백. 실시간 turns.py 와 같은 값
WORD_TOLERANCE_S = 0.30  # 단어를 클립에 배정할 때 허용하는 경계 여유
TAIL_PAD_S = 0.10        # 클립 끝에 남기는 여유. 마지막 음절이 잘리지 않을 만큼만
LONG_SPLIT_FROM_S = 15.0 # 28초 넘는 클립은 15초 이후의 가장 조용한 20ms 에서 가른다
WHOLE_SEGMENT_GAP_S = 1.0  # whole 모드: 단어 사이가 이만큼 비면 새 줄
STALL_S = 20.0           # 이보다 오래 걸린 호출을 센다. Elice 가 15% 확률로 22~28초 멈춘다


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
    turns: int = 0
    gated: int = 0
    calls: int = 0
    failed: int = 0
    retries: int = 0             # 실패 뒤 다시 보낸 횟수
    long_splits: int = 0         # 28초 넘어 조용한 자리에서 가른 클립 수
    audio_sent_s: float = 0.0
    speech_s: float = 0.0
    track_s: float = 0.0
    wall_s: float = 0.0
    unmapped: int = 0            # 단어 시각이 없어 통째로 첫 클립에 붙인 묶음 수
    hallucinated_words: int = 0  # VAD 가 말이 없다고 본 자리의 단어 수. track 은 버리고 whole 은 남긴다
    transcribe_s: list[float] = field(default_factory=list)
    call_len_s: list[float] = field(default_factory=list)
    by_speaker_s: dict[str, float] = field(default_factory=dict)  # 화자별 호출 시간 합. 파일당 처리 시간 기록용
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def summary(self) -> dict:
        ts = sorted(self.transcribe_s)
        rtf = sorted(dt / n for dt, n in zip(self.transcribe_s, self.call_len_s) if n > 0)
        pct = lambda xs, p: (xs[min(len(xs) - 1, int(round((len(xs) - 1) * p)))] if xs else None)  # noqa: E731
        return {
            "mode": self.mode, "backend": self.backend, "tracks": self.tracks, "clips": self.clips,
            "turns": self.turns, "gated": self.gated, "calls": self.calls, "failed": self.failed,
            "retries": self.retries, "long_splits": self.long_splits,
            "audio_sent_s": round(self.audio_sent_s, 1), "speech_s": round(self.speech_s, 1),
            "track_s": round(self.track_s, 1), "wall_s": round(self.wall_s, 1),
            "transcribe_p50_s": None if not ts else round(statistics.median(ts), 2),
            "transcribe_p95_s": None if not ts else round(pct(ts, 0.95), 2),
            "transcribe_max_s": None if not ts else round(ts[-1], 2),
            "calls_over_20s": sum(1 for t in ts if t > STALL_S),
            "rtf_p50": None if not rtf else round(statistics.median(rtf), 3),
            "rtf_p95": None if not rtf else round(pct(rtf, 0.95), 3),
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


def split_long(u: Utterance, max_s: float = CHUNK_MAX_S, search_from_s: float = LONG_SPLIT_FROM_S) -> list[Utterance]:
    """max_s 를 넘는 클립을 가장 조용한 20ms 프레임에서 가른다. 가르는 자리는 search_from_s 이후.

    실시간 VAD 는 25초에서 단어 중간이라도 끊었다. 파일을 통째로 들고 있는 배치는 그럴 이유가
    없어서, 쉼이 없는 긴 독백만 여기서 조용한 자리를 골라 가른다. 8초 넘긴 발화를 400ms 쉼에서
    끊는 규칙은 그대로라 대부분은 여기까지 오지 않는다.
    """
    out: list[Utterance] = []
    cur = u
    frame = SR * 20 // 1000
    while len(cur.pcm) / SR > max_s:
        lo = int(search_from_s * SR) // frame
        hi = int(max_s * SR) // frame
        frames = cur.pcm[: hi * frame].reshape(-1, frame)
        rms = np.sqrt(np.mean(frames * frames, axis=1))
        k = lo + int(np.argmin(rms[lo:hi]))
        cut_at = k * frame
        head = replace(cur, pcm=cur.pcm[:cut_at], end_ms=cur.start_ms + cut_at * 1000 // SR)
        cur = replace(cur, pcm=cur.pcm[cut_at:], start_ms=cur.start_ms + cut_at * 1000 // SR)
        out.append(head)
    out.append(cur)
    return out


def cut(audio: np.ndarray, speaker_id: str, stats: BatchStats | None = None) -> list[Utterance]:
    """실시간 경로와 같은 VAD 로 자른다. 샘플 위치가 회의 시각이므로 offset 은 그대로 준다.

    VAD 가 준 pcm 은 발화를 닫으려고 본 침묵 800ms 를 꼬리에 달고 있다(실시간 경로는 그대로
    보낸다). 배치에서는 start~end 에 100ms 만 더한 만큼으로 자른다. 1.5초 발화에 2.3초를 보내던
    것이 1.6초가 되고, 무음이 모델에 안 들어간다. 25초 강제 절단은 끄고 split_long 에 맡긴다.
    """
    v = StreamingVAD(speaker_id=speaker_id, sample_rate=SR, max_segment_ms=10 ** 9)
    n = SR * 20 // 1000
    raw: list[Utterance] = []
    for i in range(0, len(audio) - n + 1, n):
        raw += v.feed(audio[i:i + n], i * 1000 // SR)
    raw += v.flush()
    out: list[Utterance] = []
    for u in raw:
        keep = int(((u.end_ms - u.start_ms) / 1000 + TAIL_PAD_S) * SR)
        if len(u.pcm) > keep > 0:
            u.pcm = u.pcm[:keep]
        parts = split_long(u)
        if stats is not None and len(parts) > 1:
            stats.long_splits += len(parts) - 1
        out += parts
    for i, u in enumerate(out, 1):
        u.seq = i
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


# ─────────────────────────────────────────────────────────────── 턴과 묶음
def group_turns(utts: list[Utterance], gap_s: float = TURN_GAP_S) -> list[list[Utterance]]:
    """같은 화자의 클립을 공백 gap_s 이내면 한 턴으로. 한 트랙 안에서만 본다."""
    turns: list[list[Utterance]] = []
    for u in utts:
        if turns and u.start_ms - turns[-1][-1].end_ms <= gap_s * 1000:
            turns[-1].append(u)
        else:
            turns.append([u])
    return turns


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


def _sent_len(u: Utterance, gap_s: float) -> float:
    return len(u.pcm) / SR + gap_s


def _fit_turn(turn: list[Utterance], max_s: float, gap_s: float) -> list[list[Utterance]]:
    """턴이 max_s 안에 들면 그대로, 넘으면 턴 안의 가장 긴 쉼에서 둘로 갈라 다시 본다."""
    if sum(_sent_len(u, gap_s) for u in turn) <= max_s or len(turn) == 1:
        return [turn]
    gaps = [turn[i + 1].start_ms - turn[i].end_ms for i in range(len(turn) - 1)]
    k = int(np.argmax(gaps)) + 1
    return _fit_turn(turn[:k], max_s, gap_s) + _fit_turn(turn[k:], max_s, gap_s)


def build_chunks(utts: list[Utterance], max_s: float = CHUNK_MAX_S, gap_s: float = CHUNK_GAP_S,
                 turn_gap_s: float = TURN_GAP_S, pack_turns: bool = True) -> list[Chunk]:
    """클립을 턴으로 묶고, 턴을 max_s 안으로 채운 묶음을 만든다.

    pack_turns=False 면 턴마다 묶음 하나다. 호출이 늘지만 묶음 안에 남의 턴이 안 섞인다.
    """
    gap = np.zeros(int(SR * gap_s), dtype=np.float32)
    groups: list[list[Utterance]] = []
    for turn in group_turns(utts, turn_gap_s):
        groups += _fit_turn(turn, max_s, gap_s)

    packed: list[list[Utterance]] = []
    cur: list[Utterance] = []
    cur_len = 0.0
    for grp in groups:
        glen = sum(_sent_len(u, gap_s) for u in grp)
        if cur and (not pack_turns or cur_len + glen > max_s):
            packed.append(cur)
            cur, cur_len = [], 0.0
        cur += grp
        cur_len += glen
    if cur:
        packed.append(cur)

    chunks: list[Chunk] = []
    for grp in packed:
        parts, pieces, off = [], [], 0.0
        for u in grp:
            pieces.append((off, u))
            parts.append(u.pcm)
            off += len(u.pcm) / SR
            parts.append(gap)
            off += gap_s
        chunks.append(Chunk(pcm=np.concatenate(parts), pieces=pieces))
    return chunks


# ─────────────────────────────────────────────────────────────── 전사
RETRIES = 2            # 실패한 호출을 다시 보내는 횟수. 배치는 마감이 없어 기다릴 수 있다
RETRY_WAIT_S = 2.0     # 재시도 사이 대기. API 가 잠시 막힌 것이면 이 정도로 풀린다


def _call(backend: SttBackend, pcm: np.ndarray, stats: BatchStats,
          speaker: str = "") -> tuple[SttResult | None, float, str | None]:
    """한 번 호출. 실패하면 RETRIES 만큼 다시 보낸다. 시간은 성공한 호출(또는 마지막 실패)만 센다.

    회의 중 전사에서는 재시도가 stall 을 두 배로 늘려서 안 했다. 배치는 마감이 없고 한 묶음이
    빠지면 회의록에서 그 화자의 한 턴이 통째로 사라지므로 다시 보내는 쪽이 낫다.
    """
    r, err, dt = None, None, 0.0
    for attempt in range(RETRIES + 1):
        t0 = time.monotonic()
        try:
            r = backend.transcribe(pcm, SR)
            err = None
        except Exception as e:  # SttError 도, 예상 못 한 것도 줄 하나의 실패로만 남긴다
            r, err = None, f"{type(e).__name__}: {e}"
        dt = time.monotonic() - t0
        if err is None or attempt == RETRIES:
            break
        with stats._lock:
            stats.retries += 1
        time.sleep(RETRY_WAIT_S * (attempt + 1))
    with stats._lock:   # 워커 여럿이 같은 통계를 만진다
        stats.calls += 1
        stats.audio_sent_s += len(pcm) / SR
        stats.transcribe_s.append(dt)
        stats.call_len_s.append(len(pcm) / SR)
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


def _clip_lines(tr: Track, utts: list[Utterance], results) -> list[Line]:
    return [_line(u, tr.speaker_name, r.text if r else "", dt, err) for u, (r, dt, err) in zip(utts, results)]


def _chunk_lines(tr: Track, chunks: list[Chunk], results, stats: BatchStats) -> list[Line]:
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


def _track_lines(tr: Track, utts: list[Utterance], result, stats: BatchStats) -> list[Line]:
    r, dt, err = result
    if err or r is None:
        return [_line(u, tr.speaker_name, "", dt, err or "empty") for u in utts]
    if not r.words:
        stats.unmapped += 1
        return [_line(u, tr.speaker_name, r.text if i == 0 else "", dt, None) for i, u in enumerate(utts)]
    by_clip, stray = _assign_words_to_clips(r.words, utts, WORD_TOLERANCE_S)
    stats.hallucinated_words += stray
    return [_line(u, tr.speaker_name, " ".join(by_clip.get(i, [])), dt, None) for i, u in enumerate(utts)]


def _whole_lines(tr: Track, audio_s: float, utts: list[Utterance], result, stats: BatchStats) -> list[Line]:
    """옵션 없이 트랙 통째. 모델이 낸 단어를 전부 남기고, 1초 넘게 비면 새 줄로 나눈다.

    VAD 클립 밖 단어는 세기만 하고 버리지 않는다. 이전 방식이 회의록에 무엇을 남겼는지
    그대로 보기 위한 비교 기준이다.
    """
    r, dt, err = result
    if err or r is None:
        return [_line(u, tr.speaker_name, "", dt, err or "empty") for u in utts]
    if not r.words:
        stats.unmapped += 1
        u = Utterance(speaker_id=tr.speaker_id, pcm=np.zeros(0, dtype=np.float32), sample_rate=SR,
                      start_ms=0, end_ms=int(audio_s * 1000), seq=1)
        return [_line(u, tr.speaker_name, r.text, dt, None)]
    _by, stray = _assign_words_to_clips(r.words, utts, WORD_TOLERANCE_S)
    stats.hallucinated_words += stray
    lines: list[Line] = []
    group: list[Word] = []
    for w in r.words:
        if group and w.start_s - group[-1].end_s > WHOLE_SEGMENT_GAP_S:
            lines.append(_words_line(tr, group, dt))
            group = []
        group.append(w)
    if group:
        lines.append(_words_line(tr, group, dt))
    return lines


def _words_line(tr: Track, ws: list[Word], dt: float) -> Line:
    u = Utterance(speaker_id=tr.speaker_id, pcm=np.zeros(0, dtype=np.float32), sample_rate=SR,
                  start_ms=int(ws[0].start_s * 1000), end_ms=int(ws[-1].end_s * 1000), seq=0)
    return _line(u, tr.speaker_name, " ".join(w.text for w in ws), dt, None)


# ─────────────────────────────────────────────────────────────── 턴 병합
def merge_turns(lines: list[Line], gap_s: float = TURN_GAP_S) -> list[Line]:
    """같은 화자의 줄을 공백 gap_s 이내면 한 줄로 합친다. 사이에 다른 화자의 줄이 시작하면 안 합친다.

    VAD 는 800ms 쉼(8초 넘긴 발화는 400ms)에서 자르므로 한 문장이 클립 여럿으로 나뉜다.
    회의록과 추출 입력은 문장이 한 줄에 있어야 한다. 전사 실패 줄은 합치지 않고 그대로 둔다.
    """
    lines = sorted(lines, key=lambda ln: (ln.start_ms, ln.speaker_id))
    starts_by_other: dict[str, list[int]] = {}
    for ln in lines:
        starts_by_other.setdefault(ln.speaker_id, []).append(ln.start_ms)
    all_starts = sorted((ln.start_ms, ln.speaker_id) for ln in lines)

    def other_between(spk: str, a: int, b: int) -> bool:
        i = bisect.bisect_right(all_starts, (a, "￿"))
        while i < len(all_starts) and all_starts[i][0] < b:
            if all_starts[i][1] != spk:
                return True
            i += 1
        return False

    out: list[Line] = []
    last_of: dict[str, int] = {}
    for ln in lines:
        j = last_of.get(ln.speaker_id)
        prev = out[j] if j is not None else None
        if (prev is not None and not prev.error and not ln.error
                and ln.start_ms - prev.end_ms <= gap_s * 1000
                and not other_between(ln.speaker_id, prev.end_ms, ln.start_ms)):
            prev.end_ms = max(prev.end_ms, ln.end_ms)
            prev.text = f"{prev.text} {ln.text}".strip()
            prev.transcribe_s = round(max(prev.transcribe_s or 0.0, ln.transcribe_s or 0.0), 3)
            continue
        out.append(replace(ln))
        last_of[ln.speaker_id] = len(out) - 1
    return out


# ─────────────────────────────────────────────────────────────── 한 회의
def run(tracks: list[Track], backend: SttBackend, *, mode: str = "chunk", gate: SpeechGate | None = None,
        workers: int = 1, pack_turns: bool = True, merge: bool = True,
        preprocess=None) -> tuple[list[Line], BatchStats]:
    """트랙 목록을 전사해 회의 전체 순번이 매겨진 Line 목록과 통계를 돌려준다.

    전 트랙의 호출을 한 풀에 넣어 workers 개씩 동시에 보낸다. 로컬 모델은 CPU 를 다 쓰므로
    workers=1 이 맞고, API 는 대기가 대부분이라 여럿이 벽시계를 줄인다.
    preprocess(audio, sr) 를 주면 트랙을 읽은 직후에 건다. 필터 비교용이다.
    """
    if mode not in ("clip", "chunk", "track", "whole"):
        raise ValueError(f"mode 는 clip|chunk|track|whole 이다: {mode}")
    stats = BatchStats(mode=mode, backend=getattr(backend, "name", type(backend).__name__))
    t0 = time.monotonic()

    prepared = []   # (track, audio_s, utts, chunks, units)
    for tr in tracks:
        audio = load_track(tr.path)
        if preprocess is not None:
            audio = preprocess(audio, SR)
        stats.tracks += 1
        stats.track_s += len(audio) / SR
        utts = cut(audio, tr.speaker_id, stats)
        if gate is not None:
            kept = []
            for u in utts:
                if gate.accepts(u.pcm, SR, tag=f"{tr.speaker_name}#{u.seq}"):
                    kept.append(u)
                else:
                    stats.gated += 1
            utts = kept
        stats.clips += len(utts)
        stats.turns += len(group_turns(utts))
        stats.speech_s += sum(u.duration_s for u in utts)
        chunks = None
        if mode == "clip":
            units = [u.pcm for u in utts]
        elif mode == "chunk":
            chunks = build_chunks(utts, pack_turns=pack_turns) if utts else []
            units = [c.pcm for c in chunks]
        else:
            units = [audio] if utts else []
        prepared.append((tr, len(audio) / SR, utts, chunks, units))

    jobs = [(i, j) for i, (_, _, _, _, units) in enumerate(prepared) for j in range(len(units))]
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        results = list(ex.map(lambda ij: _call(backend, prepared[ij[0]][4][ij[1]], stats, prepared[ij[0]][0].speaker_id),
                              jobs))
    got: dict[int, list] = {i: [] for i in range(len(prepared))}
    for (i, _j), r in zip(jobs, results):
        got[i].append(r)

    all_lines: list[Line] = []
    for i, (tr, audio_s, utts, chunks, units) in enumerate(prepared):
        if not units:
            continue
        if mode == "clip":
            all_lines += _clip_lines(tr, utts, got[i])
        elif mode == "chunk":
            all_lines += _chunk_lines(tr, chunks, got[i], stats)
        elif mode == "track":
            all_lines += _track_lines(tr, utts, got[i][0], stats)
        else:
            all_lines += _whole_lines(tr, audio_s, utts, got[i][0], stats)

    if merge:
        all_lines = merge_turns(all_lines)
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


def make_backend(kind: str, model: str, mode: str = "chunk", *, beam: int = 5,
                 cond: bool | None = None, hst: float | None = None) -> SttBackend:
    """모드에 맞는 백엔드. 로컬은 모드별 기본 옵션이 다르고, cond·hst 로 덮어쓸 수 있다.

    clip·chunk: 창이 하나라 cond 는 무관. hst 없음.
    track: cond=False, hst=1.0 (무음의 반복을 누른다).
    whole: cond=True, hst 없음. 이전 transcribe.py 의 기본값이다.
    """
    if kind == "elice":
        from shared.config import settings
        from stt.elice import EliceStt
        settings()
        return EliceStt()
    from stt.local import LocalStt
    default_cond = {"clip": False, "chunk": False, "track": False, "whole": True}[mode]
    default_hst = {"clip": None, "chunk": None, "track": 1.0, "whole": None}[mode]
    # hst=0 은 "끈다" 다. None 은 모드 기본값이다.
    hst_value = default_hst if hst is None else (None if hst == 0 else hst)
    local = LocalStt(model_size=model, beam_size=beam,
                     condition_on_previous_text=default_cond if cond is None else cond,
                     hallucination_silence_threshold=hst_value)
    if hst_value is None:
        local.hallucination_silence_threshold = None
        local.name = local.name.split("-hst")[0]
    return local


def default_workers(kind: str) -> int:
    """Elice 는 3. 여섯을 동시에 보내면 호출당 시간이 7초에서 34초로 늘어 타임아웃에 걸렸다(2026-09-16).
    셋이면 12초 안팎이고 끝까지 간다. 로컬은 CPU 를 다 쓰므로 1."""
    return 3 if kind == "elice" else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="회의 트랙 묶음을 배치로 전사해 한 시간축에 정렬한다")
    ap.add_argument("session_dir", type=Path, help="화자별 wav 가 있는 디렉토리")
    ap.add_argument("--mode", choices=["clip", "chunk", "track", "whole"], default="chunk")
    ap.add_argument("--backend", choices=["local", "elice"], default="local")
    ap.add_argument("--model", default="large-v3-turbo", help="--backend local 의 faster-whisper 모델")
    ap.add_argument("--beam", type=int, default=5, help="로컬 빔 폭. 1 이면 빠르고 5 가 정확하다")
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
        est = sum(len(load_track(t.path)) / SR for t in tracks) * (1.0 if args.mode in ("track", "whole") else 0.7)
        print(f"트랙 {len(tracks)}개 · 예상 상한 약 {whisper_krw(est):.0f}원 (mode={args.mode}). "
              f"승인하려면 --yes.")
        return 0
    workers = args.workers if args.workers is not None else default_workers(args.backend)
    backend = make_backend(args.backend, args.model, args.mode, beam=args.beam)
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
