# PM 에이전트 — AI 파트

`../implementation_plan_1.md` 의 AI 파트 구현. **현재 캡처(Phase 0 일부)까지 구현됨.**

모노레포 구조상 이 저장소는 `ai/` `backend/` `frontend/` 가 각자 독립된 하위 프로젝트입니다(각자 자기
venv·의존성·테스트를 따로 가짐). **이 디렉토리(`ai/`) 자체가 AI 파트의 프로젝트 루트**이고, 아래 명령은
전부 이 디렉토리 안에서 실행하는 걸 기준으로 적었습니다.

```
shared/schemas.py   AI·BE 공통 계약 (MVP 4테이블 + 단계 간 입출력 타입). 바꾸면 전원 공유.
shared/config.py    .env 로딩
capture/            discord_adapter.py (RecordingCog, Discord 이름은 이 안에서만) · recording_store.py · run_recorder.py (검증용 실행기)
decision_log/       트레이드오프 결정 기록
tests/              pytest — 외부 서비스 없이 실행
recordings/         녹음 산출물 (git 제외)
```

## AI ↔ BE 경계

- `capture/discord_adapter.py` 는 **봇을 띄우지 않습니다.** `RecordingCog` 를 export 하고, BE 의
  `backend/bot/main.py`(다른 디렉토리, 다른 프로젝트)가 `bot.add_cog(RecordingCog(bot, on_session_saved=...))`
  로 붙입니다. BE 가 준비되기 전에는 `capture/run_recorder.py` 로 같은 구성을 띄워 검증합니다.
- `/stop` 으로 저장이 끝나면 `on_session_saved(manifest, manifest_path)` 훅이 호출됩니다. BE 는 여기서
  전사 → Phase 1/2 함수 호출 → `approval_request` 생성을 이어 붙이면 됩니다.
- 매니페스트 `recordings/session_{ts}.json` = `{"session", "speakers": [{"user_id", "display_name", "file", "duration_sec"}]}`.

## 설치 (이 디렉토리, `ai/` 안에서)

```bash
uv venv --python 3.12 .venv
uv pip install -r requirements.txt   # py-cord 는 PR #3159 브랜치라 git 필요. Linux: sudo apt install libopus0
source .venv/bin/activate
cp .env.example .env                 # DISCORD_BOT_TOKEN 채우기 (DISCORD_GUILD_ID 넣으면 슬래시 커맨드 즉시 반영)
```

⚠️ Discord 음성 수신은 2026-03 부터 DAVE(E2EE) 필수. PyPI 의 py-cord 2.8.x 로는 녹음이 **안 됩니다**.
`requirements.txt` 의 PR 브랜치를 쓰세요. `/stop` 후 "저장된 오디오가 없습니다"가 나오면 라이브러리
문제일 가능성이 큽니다.

## 실행

```bash
python capture/run_recorder.py    # Discord 에서 /join → /record → (말하기) → /stop
#    recordings/{user_id}_{ts}.wav · recordings/session_{ts}.json
```

## 테스트

```bash
pytest          # py-cord 없이 실행 가능 (스텁 데이터 사용)
```

## 다음 단계

STT 전사(`stt/`)를 붙여서 `recordings/` 결과를 텍스트로 바꾸는 작업.
