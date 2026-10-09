"""Elice ML API 전사 (서버리스 엔드포인트).

  POST {ELICE_STT_BASE_URL}/v1/audio/transcriptions   (주소는 https://mlapi.run/<엔드포인트 id>)
  multipart: file=<wav>, model=openai/whisper-large-v3, language=ko, response_format=verbose_json,
             timestamp_granularities[]=word, timestamp_granularities[]=segment (같은 필드를 두 번)
  응답 {"duration":"6.0","language":"ko","text":" ...","segments":[{"start":0.0,"end":6.0,...}],"words":null}

vLLM 0.19.1 이 OpenAI 호환 API 로 서빙한다. word 를 요청해도 words 는 늘 null 이고, segments 는
30초 창마다 하나라 짧은 입력이면 입력 전체를 덮는 하나뿐이다(2026-10 실측). 그래서 단어 시각이
없다. 세그먼트로 단어 시각을 지어내지 않는다. stt/batch.py chunk 모드는 words 가 비면 묶음 전체를
한 줄(timing="chunk")로 두고 unmapped 에 센다. 6초 음성 응답은 0.47~1.03초였다.
묶음에는 한 화자의 여러 턴이 28초까지 들어가고, 그 턴들은 회의에서 몇 분씩 떨어져 있을 수 있다. 그러면 그 한
줄이 사이에 낀 다른 화자의 말을 건너뛰어, 짧은 턴이 오가는 대화에서 회의록의 화자 순서가 무너진다.

단가 ₩6 / 60초로 둔다(2026-09 옛 주소의 단가). 서버리스라 보낸 오디오 길이만큼 과금된다고 보고
새 엔드포인트의 단가는 따로 확인하지 못했다. 최소 과금 단위도 확인하지 못했다. 그래서 호출을
잘게 쪼개지 않는다.

타임아웃은 30초에 오디오 1초당 0.6초를 더한다. 아래 수치는 9/29 부터 응답하지 않는 옛 주소
(api-cloud-function.elice.io)에서 잰 것이다. 같은 1초 클립 20회(2026-09-15)는 p50 2.6초에 15% 가
22~28초 stall 이었고, 길이별로는 고정비 2.4초에 길이의 0.45배가 붙었다. 고정 30초였을 때 트랙
통째 호출이 전부 잘려 회의 하나에 88원을 버렸다(2026-09-16). 새 엔드포인트에서는 아직 다시 재지
않았다.
"""

from __future__ import annotations

import os

import numpy as np
import requests

from capture.audio import to_wav_bytes
from stt.backend import SttError, SttResult, Word

STT_MODEL = "openai/whisper-large-v3"
WHISPER_KRW_PER_SEC = 6 / 60


def whisper_krw(audio_seconds: float) -> float:
    return audio_seconds * WHISPER_KRW_PER_SEC


class EliceStt:
    """Whisper large-v3 (API). 최종 전사용."""

    name = "elice/whisper-large-v3"

    TIMEOUT_PER_AUDIO_S = 0.6   # 오디오 1초당 더 기다리는 시간. 옛 주소 실측 0.45배에 여유

    def __init__(self, language: str = "ko", timeout: int = 30, word_timestamps: bool = True):
        self.language = language
        self.timeout = timeout          # 고정 몫. 여기에 길이 비례분이 붙는다
        self.word_timestamps = word_timestamps

    def timeout_for(self, audio_seconds: float) -> float:
        return self.timeout + self.TIMEOUT_PER_AUDIO_S * audio_seconds

    def transcribe(self, samples: np.ndarray, sample_rate: int, prompt: str | None = None) -> SttResult:
        """prompt 를 주면 폼에 싣는다(#195). vLLM 은 위스퍼가 학습한 앞 문맥 기호가 아니라 <|prev|> 뒤에 넣는다."""
        key = os.environ.get("ELICE_API_KEY")
        if not key:
            raise SttError("ELICE_API_KEY 환경변수가 없습니다.")
        base = os.environ.get("ELICE_STT_BASE_URL")
        if not base:
            raise SttError("ELICE_STT_BASE_URL 환경변수가 없습니다.")
        if not base.startswith("https://"):
            # http 면 Bearer 키가 평문으로 나간다. 주소에 엔드포인트 id 가 있어 메시지에는 싣지 않는다
            raise SttError("ELICE_STT_BASE_URL 은 https:// 로 시작해야 합니다.")

        wav = to_wav_bytes(samples, sample_rate)
        grans = ["word", "segment"] if self.word_timestamps else ["segment"]
        # 같은 이름의 필드를 두 번 보내야 해서 dict 가 아니라 (이름, 값) 목록으로 둔다
        data = [("model", STT_MODEL), ("language", self.language), ("response_format", "verbose_json")]
        data += [("timestamp_granularities[]", g) for g in grans]
        if prompt:
            data.append(("prompt", prompt))

        try:
            r = requests.post(
                f"{base.rstrip('/')}/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {key}"},
                files={"file": ("seg.wav", wav, "audio/wav")},
                data=data,
                timeout=self.timeout_for(len(samples) / sample_rate),
            )
        except requests.RequestException as e:
            # 연결 끊김과 타임아웃은 OSError 계열이라 호출자의 except SttError 를 그냥 지나친다.
            # 예외 이름만 싣는다. 본문이나 헤더를 붙이면 Authorization 이 로그로 나간다.
            raise SttError(f"STT 요청 실패: {type(e).__name__}") from e

        if r.status_code != 200:
            # 서버가 헤더를 본문에 되돌려 주면 키가 실린다. 자르기 전에 가려야 경계에 걸친 키도 남지 않는다
            raise SttError(f"STT {r.status_code}: {r.text.replace(key, '***')[:200]}")

        try:
            j = r.json()
        except ValueError as e:
            # 게이트웨이가 200 에 HTML 을 실어 보내는 경우가 있다. ValueError 는 SttError 가 아니다.
            raise SttError("STT 응답이 JSON 이 아님") from e

        if not isinstance(j, dict) or not isinstance(j.get("text"), str):
            # 200 에 JSON 이어도 text 가 없으면 빈 줄로 넘기지 않는다. 서버 문자열은 싣지 않는다.
            raise SttError("STT 응답에 text 가 없음")

        try:
            # 시각은 여기서 float 로 바꾼다. 문자열로 두면 batch 가 이 호출 밖에서 더하다 회의 전체가 멈춘다
            words = [
                Word(text=(w.get("word") or w.get("text") or "").strip(), start_s=float(w["start"]),
                     end_s=float(w["end"]))
                for w in j.get("words") or []
            ]
        except (KeyError, TypeError, ValueError) as e:
            raise SttError("STT 응답의 단어 시각을 읽지 못함") from e
        return SttResult(text=j["text"].strip(), words=words)
