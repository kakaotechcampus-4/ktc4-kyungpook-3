# PM 에이전트 — AI 파트

`../implementation_plan_1.md` 의 AI 파트 구현. **현재 캡처(Phase 0 일부)까지 구현됨.**

모노레포 구조상 이 저장소는 `ai/` `backend/` `frontend/` 가 각자 독립된 하위 프로젝트입니다(각자 자기
venv·의존성·테스트를 따로 가짐). **이 디렉토리(`ai/`) 자체가 AI 파트의 프로젝트 루트**이고, 아래 명령은
전부 이 디렉토리 안에서 실행하는 걸 기준으로 적었습니다.

```
shared/schemas.py   AI·BE 공통 계약 (MVP 4테이블 + 단계 간 입출력 타입). 바꾸면 전원 공유.
shared/config.py    .env 로딩
capture/            discord_adapter.py (RecordingCog, Discord 이름은 이 안에서만) · streaming_sink.py · track_writer.py · publisher.py · recording_store.py · run_recorder.py (검증용 실행기)
decision_log/       트레이드오프 결정 기록
tests/              pytest — 외부 서비스 없이 실행
recordings/         녹음 산출물 (git 제외)
```

## AI ↔ BE 경계

- `capture/discord_adapter.py` 는 **봇을 띄우지 않습니다.** `RecordingCog` 를 export 하고, BE 의
  `backend/bot/main.py`(다른 디렉토리, 다른 프로젝트)가 `bot.add_cog(RecordingCog(bot, on_session_saved=...))`
  로 붙입니다. BE 가 준비되기 전에는 `capture/run_recorder.py` 로 같은 구성을 띄워 검증합니다.
- `/stop` 으로 회의록 저장이 끝나면 `on_session_saved(payload, jsonl_path)` 훅이 호출됩니다. `payload` 는
  `meeting_id` · `guild_id` · `session` · `speakers` 와 회의록 경로(`markdown`, `jsonl`)를 담습니다. BE 는
  여기서 Phase 1/2 함수 호출 → `approval_request` 생성을 이어 붙이면 됩니다. 전사는 이미 끝나 있습니다.
- 회의록은 `recordings/{guild_id}_{ts}/transcript.md` 와 `transcript.jsonl` 입니다.
- 매니페스트는 `recordings/session_{ts}.json` 한 자리에 평평하게 씁니다 = `{"session", "speakers":
  [{"user_id", "display_name", "file", "duration_sec"}]}`. 화자별 wav 는 회의 디렉토리 안에 있고
  `file` 은 매니페스트 기준 상대 경로(`{guild_id}_{ts}/{user_id}_{ts}.wav`)입니다.
- `DISCORD_CHANNEL_ID` 는 어댑터가 더 이상 읽지 않습니다. 전사 줄은 `/record` 를 친 채널(또는
  `/record channel:` 로 고른 채널)에 올라갑니다. 설정값은 BE 쪽에서 쓸 수 있어 남겨 둡니다.

## 설치 (이 디렉토리, `ai/` 안에서)

```bash
uv venv --python 3.12 .venv
uv pip install -r requirements.txt   # py-cord 는 PR #3159 브랜치라 git 필요. Linux: sudo apt install libopus0
source .venv/bin/activate
cp .env.example .env                 # DISCORD_BOT_TOKEN 과 ELICE_API_KEY 채우기 (DISCORD_GUILD_ID 넣으면 슬래시 커맨드 즉시 반영)
```

⚠️ Discord 음성 수신은 2026-03 부터 DAVE(E2EE) 필수. PyPI 의 py-cord 2.8.x 로는 녹음이 **안 됩니다**.
`requirements.txt` 의 PR 브랜치를 쓰세요. `/stop` 종료 요약의 "수신 패킷" 이 0 이면 오디오가 한 건도
안 들어온 것이고, 라이브러리 버전이 첫 번째 의심 대상입니다.

## 실행

```bash
python capture/run_recorder.py    # Discord 에서 /record → (말하기) → /stop
#    recordings/{guild_id}_{ts}/transcript.md · transcript.jsonl · {user_id}_{ts}.wav
#    recordings/session_{ts}.json
```

녹음한 wav 를 오프라인으로 다시 전사할 때는 회의 디렉토리를 직접 줍니다. 기본 수집은 `recordings/` 를
얕게 훑어서 하위 디렉토리를 보지 않습니다.

```bash
python stt/transcribe.py --audio recordings/<meeting_id>
```

## 테스트

```bash
pytest          # 설치된 py-cord 는 있어야 하지만 봇 토큰도 네트워크도 필요 없습니다 (스텁 데이터, tmp_path)
```

## 실시간 전사 실행

아래 절차는 아직 실제 서버에서 끝까지 돌려 보지 않았습니다. 어디서 막히는지는 `/selftest` 가
단계별로 알려 줍니다.

### 한 번만 하는 준비

포털 설정과 초대 링크는 코드에서 고칠 수 없어서 사람이 손으로 확인해야 합니다.

1. 개발자 포털 → 해당 앱 → Bot → Privileged Gateway Intents 에서 SERVER MEMBERS 를 켭니다.
   코드가 요청한 특권 인텐트를 포털에서 안 켜 두면 봇이 기동하자마자 죽습니다. MESSAGE CONTENT 는
   이 봇의 코드가 요청하지 않으므로 포털에서도 켜지 않습니다.
   확인은 포털의 SERVER MEMBERS 토글이 켜진 색인지 눈으로 봅니다.

2. 초대 링크의 scopes 에 `bot` 과 `applications.commands` 를 둘 다 넣습니다. 이게 빠지면 슬래시
   명령 자체가 서버에 안 뜹니다.
   확인은 실제로 쓴 링크에 `scope=bot%20applications.commands` (또는 `bot+applications.commands`)
   가 들어 있는지 문자열을 읽습니다. 이미 `bot` 만으로 초대한 서버라면 새 링크로 다시 초대합니다.
   재초대만으로 스코프가 갱신됩니다.

3. 봇 역할에 음성 채널의 채널 보기·연결, 텍스트 채널의 채널 보기·메시지 보내기를 줍니다.
   말하기(Speak) 는 수신 전용 녹음에 필요 없고, 링크 첨부와 메시지 기록 보기도 지금 코드에는
   필요 없습니다.
   확인은 음성·텍스트 채널에서 "채널 권한 보기" 로 봇 계정 기준 최종 권한을 봅니다.

4. `ai/.env` 에 `DISCORD_BOT_TOKEN`, `ELICE_API_KEY` 를 넣습니다. 값은 `secrets/` 에서 옮겨 넣고
   화면에 출력하지 않습니다. `DISCORD_GUILD_ID` 는 개발·데모용으로 내 서버 ID 를 채우면 슬래시
   명령이 몇 초 안에 그 서버에 뜹니다. 여러 서버에서 쓰려면 비웁니다. 글로벌 등록이라 반영까지
   최대 1시간 걸립니다. `DISCORD_CHANNEL_ID` 는 더 이상 쓰지 않습니다.
   확인은 봇을 띄운 뒤 서버에서 `/` 를 쳐서 join·record·selftest·stop·leave 다섯 개가 보이는지
   봅니다.

### 매번 하는 것

```bash
python capture/run_recorder.py
```

프로세스 하나가 초대된 서버 전부를 담당합니다. 무음 원인을 쫓을 때는 `LOG_LEVEL=DEBUG` 를 붙입니다.
패킷이 버려지는 로그가 DEBUG 라 기본 설정에서는 안 보입니다.

음성 채널에 들어간 다음, 전사를 올릴 텍스트 채널에서 명령을 칩니다.

1. `/selftest` - 어디까지 되는지 먼저 봅니다. 기본 실행은 유료 호출이 없습니다. STT 왕복까지
   보려면 `stt: True` 를 붙이는데, 1초짜리 오디오로 Elice API 를 실제로 한 번 부릅니다.
   ₩6/60초 기준 약 0.1원이고, 최소 과금 단위를 확인하지 못해서 실제 청구는 이보다 클 수
   있습니다.
2. `/record` - 봇이 명령을 친 사람의 음성 채널로 들어가 시작합니다. 줄은 명령을 친 채널에 올라갑니다
3. 말합니다
4. `/stop` - 회의록 경로와 수신 요약이 올라옵니다

서버당 회의는 하나입니다. 회의가 도는 중에 다른 방에서 `/record` 나 `/join` 을 치면 거부합니다.
봇 계정 하나가 길드당 음성 연결을 하나만 가질 수 있어서입니다.

산출물은 `recordings/{guild_id}_{ts}/` 아래 `transcript.md`, `transcript.jsonl`, 화자별 wav 이고
매니페스트는 `recordings/session_{ts}.json` 입니다. 녹음한 wav 를 오프라인으로 다시 전사할 때는
디렉토리를 직접 줍니다. 기본 수집이 하위 디렉토리를 보지 않습니다.

```bash
python stt/transcribe.py --audio recordings/<meeting_id>
```

막히면 `/selftest` 출력을 그대로 가져옵니다.

## 다음 단계

실제 음성 채널에서 한 번도 돌려 보지 않았습니다. 실측(수신 패킷, 종료까지 걸린 시간, CER)이 다음입니다.
