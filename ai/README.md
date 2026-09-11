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

## 다음 단계

실제 음성 채널에서 한 번도 돌려 보지 않았습니다. 실측(수신 패킷, 종료까지 걸린 시간, CER)이 다음입니다.
