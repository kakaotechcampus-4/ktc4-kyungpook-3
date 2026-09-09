# 검증 계획 — Discord 기반 전사·화자분리 정확도 테스트

## 0. 배경 / 목적

본격적으로 판단/문서화 로직을 만들기 전에, 캡처 파이프라인 자체가 실제로 쓸 만한지부터 확인합니다. 확인할 건 딱 두 가지입니다.

1. **전사 정확도** — faster-whisper가 실제 한국어 발화를 얼마나 정확히 텍스트로 옮기는가
2. **화자 분리 품질** — Discord 음성채널에서 유저별 트랙이 실제로 깨끗하게 분리되어 녹음되는가(다른 사람 목소리 섞임/크로스토크 없는지)

기존 `implementation_plan.md`(판단→문서화→승인→Notion 반영 전체 파이프라인)와는 별개로, 이 문서는 그 앞단인 "캡처+전사"만 떼어내서 빠르게 검증하기 위한 계획입니다. LLM 판단, 문서화, Notion 연동은 이번 범위에 없습니다.

## 1. 준비물

- Discord 서버 하나(테스트용), 음성채널 하나
- Discord 봇 토큰 (Discord Developer Portal에서 발급, `Voice States`, `Message Content` 인텐트 활성화)
- Python 3.10+, `py-cord`(Pycord, discord.py 대신 이걸 써야 음성 녹음 가능), `faster-whisper`, `jiwer`(정확도 계산용)
- 실제 목소리를 낼 사람 최소 2명 이상(화자 분리 테스트를 위해 1명으로는 부족함)

```
pip install py-cord faster-whisper jiwer --break-system-packages
```

## 2. 디렉토리 구조

```
stt-validation/
├── stt_diarization_validation_plan.md
├── requirements.txt
├── .env.example                # DISCORD_BOT_TOKEN=
├── bot.py                      # 봇 실행 진입점
├── recordings/                 # 화자별 wav 저장 위치 (user_id_timestamp.wav)
├── transcripts/                # 화자별 전사 결과 (.txt, .json)
├── ground_truth/               # 사람이 직접 만든 정답 스크립트
│   ├── speaker1_script.txt
│   └── speaker2_script.txt
└── eval.py                     # WER 계산 + 크로스토크 체크리스트 출력
```

## 3. 실행 흐름

### 3.1 봇 세팅 (`bot.py`)

슬래시 커맨드 3개만 있으면 됩니다.

- `/join` — 봇이 현재 음성채널에 입장
- `/record` — `discord.sinks.WaveSink()`로 녹음 시작 (`vc.start_recording(sink, on_finished)`)
- `/stop` — 녹음 종료. `on_finished` 콜백에서 `sink.audio_data`(유저ID → AudioData 딕셔너리)를 순회하며 `recordings/{user_id}_{timestamp}.wav`로 각각 저장

```python
@bot.slash_command()
async def record(ctx):
    vc = ctx.voice_client
    vc.start_recording(discord.sinks.WaveSink(), finished_callback, ctx)
    await ctx.respond("녹음 시작")

async def finished_callback(sink, ctx):
    for user_id, audio in sink.audio_data.items():
        with open(f"recordings/{user_id}_{int(time.time())}.wav", "wb") as f:
            f.write(audio.file.read())
```

### 3.2 테스트 시나리오 두 가지로 녹음

**시나리오 A — 정독(스크립트 읽기)**: 팀원 2~3명이 각자 미리 준비된 문장(뉴스 기사 한 단락 등, 1~2분 분량)을 순서대로 읽습니다. 읽은 문장을 `ground_truth/`에 그대로 저장해두면 정답이 100% 확보됩니다. WER을 정확한 숫자로 계산하려면 이 시나리오가 필수입니다.

**시나리오 B — 자연스러운 대화**: 실제 회의처럼 자유롭게 대화하며 서로 말을 주고받습니다(끼어들기, 짧은 대답 포함). 정답 스크립트는 녹음 후 사람이 직접 들으면서 수기로 작성합니다. 이건 실제 사용 환경에 더 가까운 케이스라, 정독보다 정확도가 낮게 나올 걸 감안하고 보셔야 합니다.

두 시나리오 모두 최소 1회씩, 가능하면 화자 수를 2명/3명으로 늘려가며 반복하는 걸 추천합니다(화자 수가 늘수록 정확도가 어떻게 변하는지도 같이 보여야 하니까요).

### 3.3 전사 (`transcribe.py`)

```python
from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8")
segments, info = model.transcribe(audio_path, language="ko")
text = " ".join(seg.text for seg in segments)
```

- 모델 크기는 `tiny`/`base`/`small`/`medium` 중 골라서 비교해보세요. CPU 기준으로 `small`이 속도·정확도 균형이 괜찮은 편이고, 여유 되면 `medium`까지 한 번 더 돌려서 차이를 비교하시면 좋습니다.
- `speaker`는 이미 알아요 — 파일명(`user_id`)이 곧 화자니까 별도 diarization 모델이 필요 없습니다. 이게 Discord 캡처의 핵심 이점이고, 이번 검증에서 그게 실제로 성립하는지(파일에 다른 사람 목소리가 안 섞여 있는지) 확인하는 게 목적입니다.

### 3.4 정확도 평가 (`eval.py`)

**전사 정확도(WER)**

```python
from jiwer import wer
error_rate = wer(ground_truth_text, transcribed_text)
print(f"WER: {error_rate * 100:.1f}%")
```

한국어는 띄어쓰기 관습 차이 때문에 WER이 실제 체감보다 나쁘게 나올 수 있어요. 숫자만 믿지 말고, 정답과 결과를 나란히 놓고 눈으로 직접 비교하는 정성 평가를 같이 하세요.

**화자 분리 품질(정성 체크리스트)** — 자동화하기 어려운 부분이라 사람이 직접 각 화자 wav 파일을 들으며 체크합니다.

- [ ] speaker1 파일에 speaker2의 목소리가 섞여 들리는가 (크로스토크)
- [ ] 말 안 할 때(침묵 구간)에 다른 사람 소리가 새어 들어오는가
- [ ] 여러 명이 동시에 말한 구간에서 자기 트랙에 자기 목소리만 잡히는가
- [ ] 녹음 시작/끝에 소리 끊김이나 씹힘이 있는가

## 4. 통과 기준 (1차 목표치)

| 항목 | 목표 |
|---|---|
| 정독 시나리오 WER | 15% 이하 |
| 대화 시나리오 WER | 30% 이하 (더 어려운 조건이라 기준 완화) |
| 크로스토크 | 체크리스트 4개 항목 모두 "아니오" |
| 처리 시간 | 1분 오디오당 전사 시간 30초 이내(체감 사용성 기준) |

이 숫자는 "이 정도면 다음 단계(판단 로직)로 넘어가도 되는가"를 판단하기 위한 최소 기준이지, 최종 제품 품질 기준이 아니에요. 여기서 기준 미달이 나오면 모델 크기(`small`→`medium`)를 올리거나 마이크 품질/거리 문제인지부터 점검하시면 됩니다.

## 5. Definition of Done

- [ ] 2명 이상 화자로 정독 시나리오 1회, 대화 시나리오 1회 이상 녹음 완료
- [ ] 화자별 wav 파일이 `recordings/`에 정상 분리 저장됨
- [ ] 각 wav를 faster-whisper로 전사해 `transcripts/`에 저장
- [ ] WER 계산 결과와 크로스토크 체크리스트 결과를 표로 정리
- [ ] 위 통과 기준 대비 결과 정리 (기준 충족/미충족 명시)
