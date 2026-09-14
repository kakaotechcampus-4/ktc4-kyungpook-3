# 검증 계획 - Discord 기반 전사·화자분리 정확도 테스트

## 0. 배경 / 목적

본격적으로 판단/문서화 로직을 만들기 전에, 캡처 파이프라인 자체가 실제로 쓸 만한지부터 확인합니다. 확인할 건 세 가지입니다.

1. **전사 정확도** - 실제 한국어 발화를 얼마나 정확히 텍스트로 옮기는가
2. **화자 분리 품질** - Discord 음성채널에서 유저별 트랙이 실제로 깨끗하게 분리되어 녹음되는가(다른 사람 목소리 섞임/크로스토크 없는지)
3. **지연** - 실시간 경로에서 발화가 끝나고 줄이 화면에 뜰 때까지 얼마나 걸리는가

기존 `implementation_plan.md`(판단→문서화→승인→Notion 반영 전체 파이프라인)와는 별개로, 이 문서는 그 앞단인 "캡처+전사"만 떼어내서 빠르게 검증하기 위한 계획입니다. LLM 판단, 문서화, Notion 연동은 이번 범위에 없습니다.

## 1. 준비물

- Discord 서버 하나(테스트용), 음성채널 하나
- Discord 봇 토큰. Developer Portal 에서 **SERVER MEMBERS** 인텐트 활성화. 두 Cog 를 함께 붙일 때는 **MESSAGE CONTENT** 도 켭니다
- 초대 링크의 scopes 에 `bot` 과 `applications.commands` 를 둘 다 넣습니다. 빠지면 슬래시 명령이 서버에 안 뜹니다
- Python 3.12, `ai/requirements.txt` 의 의존성. **py-cord 는 PR #3159 브랜치를 씁니다** - 2.8 정식판은 DAVE(E2EE) 음성 수신을 못 하고, DAVE 는 2026-03-01 부터 필수입니다
- 실제 목소리를 낼 사람 최소 2명 이상(화자 분리 테스트를 위해 1명으로는 부족함)

```bash
cd ai
uv venv --python 3.12 .venv
uv pip install -r requirements.txt
cp .env.example .env      # DISCORD_BOT_TOKEN, ELICE_API_KEY, DISCORD_GUILD_ID
```

## 2. 디렉토리 구조

`ai/` 가 AI 파트의 독립 프로젝트 루트입니다 (`decision_log/0002` 참고).

```
ai/
├── stt_diarization_validation_plan.md
├── capture/
│   ├── discord_adapter.py       # 오프라인 녹음 Cog (/join /record /stop /leave /end)
│   ├── realtime_adapter.py      # 실시간 전사 Cog (/live /live-join /live-stop /selftest)
│   ├── run_recorder.py          # 오프라인 Cog 실행기
│   └── run_realtime.py          # 실시간 Cog 실행기
├── stt/
│   ├── transcribe.py            # 오프라인 전사 (faster-whisper)
│   ├── session.py               # 실시간 전사 파이프라인
│   └── eval/
│       ├── eval.py              # CER/WER 계산 + 크로스토크 체크리스트
│       ├── realtime_bench.py    # 실시간 경로 종단 측정
│       └── ground_truth/        # 사람이 만든 정답 스크립트 (git 에 안 올림)
├── tests/replay.py              # 녹음 wav 를 디스코드 패킷 흐름처럼 흘리는 하니스
├── recordings/                  # 화자별 wav + 매니페스트
└── transcripts/                 # 오프라인 전사 결과
```

## 3. 실행 흐름

캡처 구현이 두 개라 검증도 두 갈래입니다. 어느 쪽으로 갈지는 멘토 리뷰에서 정합니다 (`decision_log/0006`).

### 3.1 오프라인 경로

`/join` → `/record` → `/stop`. `WaveSink` 계열이 화자별 오디오를 모아 두었다가 `/stop` 때 `recordings/{user_id}_{ts}.wav` 로 저장하고, 매니페스트를 `recordings/session_{ts}.json` 에 씁니다. 화자별 트랙의 시작 시각은 `SyncedWaveSink` 가 무음을 앞에 채워 맞춥니다.

전사는 그 뒤에 따로 돌립니다.

```bash
python -m stt.transcribe --session 1789149778     # 세션 하나
python -m stt.transcribe --model small,medium     # 모델 비교
```

### 3.2 실시간 경로

`/live-join` → `/selftest` → `/live` → 말하기 → `/live-stop`.

`StreamingSink` 가 `write()` 마다 디스크로 흘리면서 동시에 화자별 VAD 에 넣습니다. 무음이 800ms 이어지면 한 발화로 확정하고 그 시점에 API 를 한 번 부릅니다. 전사된 줄이 명령을 친 텍스트 채널에 올라가고, 종료 뒤에 `transcript.md` · `transcript.jsonl` · `latency.jsonl` 이 나옵니다.

`/selftest` 를 먼저 치는 이유는 연결·인텐트·권한·DAVE·수신·PCM 크기·채널 쓰기를 단계별로 확인하고 실패한 단계마다 무엇을 해야 하는지 같이 찍기 때문입니다. 기본 실행은 무과금입니다.

### 3.3 테스트 시나리오 두 가지로 녹음

**시나리오 A - 정독(스크립트 읽기)**: 팀원 2~3명이 각자 미리 준비된 문장(뉴스 기사 한 단락 등, 1~2분 분량)을 순서대로 읽습니다. 읽은 문장을 `ground_truth/` 에 그대로 저장해두면 정답이 100% 확보됩니다. 정확한 숫자를 내려면 이 시나리오가 필수입니다.

**시나리오 B - 자연스러운 대화**: 실제 회의처럼 자유롭게 대화하며 서로 말을 주고받습니다(끼어들기, 짧은 대답 포함). 정답 스크립트는 녹음 후 사람이 직접 들으면서 수기로 작성합니다. 실제 사용 환경에 더 가까운 케이스라 정독보다 정확도가 낮게 나올 걸 감안하고 보셔야 합니다.

두 시나리오 모두 최소 1회씩, 가능하면 화자 수를 2명/3명으로 늘려가며 반복하는 걸 추천합니다.

**한 번 녹음한 것으로 두 경로를 다 잽니다.** 실시간 경로가 화자별 wav 와 매니페스트를 오프라인 경로와 같은 형식으로 남기기 때문입니다. 회의를 두 번 하면 사람이 다르게 말해서 비교가 안 됩니다.

### 3.4 정확도 평가 (`stt/eval/eval.py`)

**전사 정확도는 CER 로 봅니다.** 한국어는 띄어쓰기가 불규칙해서 어절 단위 WER 이 실제 체감보다 나쁘게 나옵니다. 실제로 WER 0.2128 로 미달인 전사의 CER 이 0.0219 였고, 차이는 "와이어프레임 → 와이어 프레임", "세 가지 → 3가지" 같은 표기였습니다. 어절로 세면 띄어쓰기 하나가 오류 둘이 됩니다.

판정 컬럼은 `cer_nospace` 이고 시나리오별로 통과선이 다릅니다 (`CER_THRESHOLDS`). `wer_raw` / `wer_norm` 은 참고용으로 그대로 찍습니다.

정규화는 정답과 전사 **양쪽에 같은 함수**로 겁니다. 한쪽만 걸면 오히려 나빠집니다.

숫자만 믿지 말고 정답과 결과를 나란히 놓고 눈으로 비교하는 정성 평가를 같이 하세요.

**화자 분리 품질(정성 체크리스트)** - 자동화하기 어려운 부분이라 사람이 직접 각 화자 wav 를 들으며 체크합니다.

- [ ] speaker1 파일에 speaker2 의 목소리가 섞여 들리는가 (크로스토크)
- [ ] 말 안 할 때(침묵 구간)에 다른 사람 소리가 새어 들어오는가
- [ ] 여러 명이 동시에 말한 구간에서 자기 트랙에 자기 목소리만 잡히는가
- [ ] 녹음 시작/끝에 소리 끊김이나 씹힘이 있는가

### 3.5 지연 측정 (`stt/eval/realtime_bench.py`)

실시간 경로는 정확도만으로 판단할 수 없어서 지연을 따로 잽니다. 저장된 화자별 wav 를 리플레이 하니스로 흘려 발화별 첫 줄 지연, 종료 후 산출 시간, API 호출 수, 유실을 한 번에 냅니다.

```bash
.venv/bin/python stt/eval/realtime_bench.py --tracks "<화자별 16kHz wav 디렉토리>" --pace
```

`--pace` 를 켜야 오디오가 실제 속도로 흐릅니다. 끄면 순간 주입이라 발화가 실제보다 길게 뭉치고 "첫 줄까지" 가 체감 지연이 아니라 워커가 큐를 비우는 시간이 됩니다.

기본 백엔드는 `--stt fake` 라 **무과금**입니다. `--stt elice` 는 `--yes` 없이는 견적만 찍고 끝납니다.

VAD 상수와 말 필터 임계를 인자로 받으므로, 같은 녹음을 조건만 바꿔 다시 흘려 결과가 어떻게 달라지는지 볼 수 있습니다. 임계를 고칠 때 근거로 씁니다.

```bash
.venv/bin/python stt/eval/realtime_bench.py --tracks "<...>" --pace --silence-hold-ms 300
.venv/bin/python stt/eval/realtime_bench.py --tracks "<...>" --pace --no-gate
```

## 4. 통과 기준 (1차 목표치)

| 항목 | 목표 | 적용 |
|---|---|---|
| 정독 시나리오 CER | 5% 이하 | 두 경로 공통 |
| 대화 시나리오 CER | 10% 이하 (더 어려운 조건이라 기준 완화) | 두 경로 공통 |
| 크로스토크 | 체크리스트 4개 항목 모두 "아니오" | 두 경로 공통 |
| 오프라인 처리 시간 | 1분 오디오당 전사 30초 이내 | 오프라인 |
| 발화별 첫 줄 지연 | 발화 종료 후 중앙값 3초 이내 | 실시간 |
| 종료 후 회의록 | 종료 명령 후 10초 이내 | 실시간 |
| 유실 | `write 오류` · `화자 미상` · `마감 뒤 도착한 줄` 전부 0 | 실시간 |

이 숫자는 "이 정도면 다음 단계(판단 로직)로 넘어가도 되는가" 를 판단하기 위한 최소 기준이지 최종 제품 품질 기준이 아닙니다. **최종 판단 기준은 CER 이 아니라 엔드투엔드 할일 추출 정확도**이고, 그건 별도 이슈로 둡니다.

기준 미달이 나오면 모델 크기를 올리거나 마이크 품질/거리 문제인지부터 점검합니다. 실시간 쪽 지연이 미달이면 `latency.jsonl` 의 `queue_s` / `transcribe_s` / `publish_s` 중 어디가 큰지를 먼저 봅니다.

## 5. Definition of Done

- [ ] 2명 이상 화자로 정독 시나리오 1회, 대화 시나리오 1회 이상 녹음 완료
- [ ] 화자별 wav 파일이 `recordings/` 에 정상 분리 저장됨
- [ ] 같은 녹음을 두 경로로 전사 (오프라인 `transcribe.py`, 실시간 `realtime_bench.py`)
- [ ] CER 계산 결과와 크로스토크 체크리스트 결과를 표로 정리
- [ ] 실시간 경로의 지연과 유실 수치를 표로 정리
- [ ] 위 통과 기준 대비 결과 정리 (기준 충족/미충족 명시)
