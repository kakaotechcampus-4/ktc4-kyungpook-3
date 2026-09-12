"""화자 한 명의 오디오 스트림을 발화 단위로 자른다.

디스코드가 유저별 트랙을 따로 주므로 이 클래스는 자기 화자만 신경 쓰면 되고
화자 분리 문제가 아예 없다. 화자마다 인스턴스를 하나씩 둔다.

시각은 스스로 세지 않고 밖에서 받는다. py-cord PR#3159 은 무음 구간을 채우지
않으므로(SilencePacket 이 정의만 있고 쓰이지 않는다), 받은 오디오 길이를 세면
앞의 침묵만큼 타임스탬프가 통째로 앞당겨진다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np

SPEECH_RMS = float(os.environ.get("MM_SPEECH_RMS", "0.006"))
NOISE_MARGIN = 1.8       # 배경 소음 대비 배수
SILENCE_HOLD_MS = 800    # 이만큼 조용하면 발화 끝
MIN_SPEECH_MS = 320      # 이보다 짧으면 버린다 (기침, 마우스)
MAX_SEGMENT_MS = 25_000  # 긴 독백 상한
FRAME_MS = 20


@dataclass
class Utterance:
    speaker_id: str
    pcm: np.ndarray
    sample_rate: int
    start_ms: int
    end_ms: int
    seq: int

    @property
    def duration_s(self) -> float:
        return (self.end_ms - self.start_ms) / 1000


@dataclass
class StreamingVAD:
    speaker_id: str
    sample_rate: int = 16_000
    frame_ms: int = FRAME_MS
    speech_rms: float = SPEECH_RMS

    _buf: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))
    _pending: list[np.ndarray] = field(default_factory=list)
    _noise: float = 0.004
    _speaking: bool = False
    _speech_ms: int = 0
    _silence_ms: int = 0
    _seg_start_ms: int = 0
    _next_frame_ms: int = 0
    _last_speech_ms: int = 0
    _seq: int = 0

    @property
    def _frame(self) -> int:
        return max(1, int(self.sample_rate * self.frame_ms / 1000))

    @property
    def _buf_end_ms(self) -> int:
        return self._next_frame_ms + len(self._buf) * 1000 // self.sample_rate

    @property
    def pending_ms(self) -> int:
        """아직 확정되지 않은 발화의 현재 길이. 진단용으로 읽는다."""
        return self._last_speech_ms - self._seg_start_ms if self._speaking else 0

    @property
    def pending_pcm(self) -> np.ndarray:
        return np.concatenate(self._pending) if self._pending else np.zeros(0, dtype=np.float32)

    @property
    def pending_start_ms(self) -> int:
        return self._seg_start_ms if self._speaking else 0

    def feed(self, samples: np.ndarray, offset_ms: int | None = None) -> list[Utterance]:
        """offset_ms 는 이 조각 첫 샘플의 회의 경과 시각. 생략하면 이어지는 것으로 본다."""
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        samples = samples.astype(np.float32)

        out: list[Utterance] = []
        if offset_ms is not None:
            gap_ms = offset_ms - self._buf_end_ms
            if gap_ms >= self.frame_ms:
                # 패킷이 끊긴 구간은 무음이다. 시간축을 옮기기 **전에** 진행 중이던
                # 발화를 닫는다. 진행 중이던 발화가 이전 시각축에 속하므로 축 이동 전에
                # 닫아야 한다. end_ms 자체는 _last_speech_ms 에서 오므로 순서의 영향을 받지 않는다.
                done = self._on_gap(gap_ms)
                if done is not None:
                    out.append(done)
                self._buf = np.zeros(0, dtype=np.float32)
                self._next_frame_ms = offset_ms
            # 과거를 가리키는 패킷은 무시하고 이어붙인다. 시간축을 되돌리면
            # start_ms 가 seq 순서와 어긋난다.

        self._buf = np.concatenate([self._buf, samples])
        frame = self._frame
        while len(self._buf) >= frame:
            f, self._buf = self._buf[:frame], self._buf[frame:]
            done = self._step(f)
            if done is not None:
                out.append(done)
        return out

    def sweep(self, now_ms: int) -> Utterance | None:
        """마지막으로 받은 오디오 뒤로 흐른 시간을 침묵으로 세고, 한도를 넘으면 닫는다.

        `_on_gap` 은 뒤에 온 패킷이 공백을 알려 줄 때만 불린다. 디스코드는 사람이 말을
        멈추면 패킷을 아예 끊으므로, 그 화자가 다시 말할 때까지 발화가 열린 채로 남는다.
        회의가 끝날 때 `flush()` 가 닫아 주니 회의록에서 빠지지는 않지만, 회의 중에 줄이
        화면에 안 뜬다. 이 함수를 주기적으로 불러 그 자리를 메운다.

        한도를 넘길 때만 `_silence_ms` 를 적립한다. 미달인데 적립해 두면 뒤에 온 패킷의
        `_on_gap` 이 같은 구간을 한 번 더 세서 발화가 일찍 닫힌다.

        now_ms 는 sink 가 쓰는 것과 같은 회의 시계여야 한다. 리플레이처럼 오디오를 순간
        주입하는 경로에서는 주기적으로 부르지 않는다. 값 자체는 맞지만 실제 시간 기준으로
        도는 청소가 몇 번 걸리느냐가 기기 속도에 달려서 같은 입력이 실행마다 다른 발화 수를
        낸다.
        """
        if not self._speaking:
            return None
        idle_ms = now_ms - self._buf_end_ms
        if idle_ms <= 0 or self._silence_ms + idle_ms < SILENCE_HOLD_MS:
            return None
        self._silence_ms += idle_ms
        return self._close()

    def _on_gap(self, gap_ms: int) -> Utterance | None:
        if not self._speaking:
            return None
        self._silence_ms += gap_ms
        if self._silence_ms >= SILENCE_HOLD_MS:
            return self._close()
        return None

    def _step(self, f: np.ndarray) -> Utterance | None:
        rms = float(np.sqrt(np.mean(f * f)))
        threshold = max(self.speech_rms, self._noise * NOISE_MARGIN)
        frame_start_ms = self._next_frame_ms
        self._next_frame_ms += self.frame_ms

        if rms > threshold:
            self._silence_ms = 0
            if not self._speaking:
                self._speaking = True
                self._speech_ms = 0
                self._seg_start_ms = frame_start_ms
                self._pending = []
            self._speech_ms += self.frame_ms
            self._last_speech_ms = self._next_frame_ms
            self._pending.append(f)
            if self._next_frame_ms - self._seg_start_ms >= MAX_SEGMENT_MS:
                return self._close()
            return None

        # 조용할 때만 배경 소음 추정치를 갱신한다 (에어컨, 팬에 적응)
        self._noise = self._noise * 0.97 + rms * 0.03
        if not self._speaking:
            return None

        self._silence_ms += self.frame_ms
        self._pending.append(f)  # 발화 끝의 여운을 살짝 남긴다
        if self._silence_ms >= SILENCE_HOLD_MS:
            return self._close()
        return None

    def _close(self) -> Utterance | None:
        pcm = self.pending_pcm
        speech_ms, start_ms = self._speech_ms, self._seg_start_ms
        # 끝은 마지막으로 말이 있던 프레임까지다. 뒤에 붙는 무음 대기를 포함시키면
        # 발화 길이가 부풀고 배치 VAD 와 수치가 어긋난다.
        end_ms = self._last_speech_ms
        self._speaking = False
        self._pending = []
        self._speech_ms = 0
        self._silence_ms = 0

        if speech_ms < MIN_SPEECH_MS or len(pcm) == 0:
            return None

        self._seq += 1
        return Utterance(
            speaker_id=self.speaker_id,
            pcm=pcm,
            sample_rate=self.sample_rate,
            start_ms=start_ms,
            end_ms=end_ms,
            seq=self._seq,
        )

    def flush(self) -> list[Utterance]:
        """회의 종료나 퇴장 시 진행 중이던 발화를 확정한다."""
        if not self._speaking:
            return []
        u = self._close()
        return [u] if u else []
