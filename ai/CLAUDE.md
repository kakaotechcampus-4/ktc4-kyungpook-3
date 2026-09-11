# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 이 저장소는 무엇인가

Discord 기반 팀을 위한 PM 에이전트의 AI 파트. 회의 캡처 → 전사 → 할일 추출 → 의미 판단 → 문서 초안 →
PM 승인 → Notion 반영으로 이어지는 파이프라인입니다. 누가 무엇을 언제 만드는지, 주차별 마일스톤과 통과
기준까지 담긴 전체 계획은 `../implementation_plan_1.md`에 있으니, 구조를 바꾸는 작업 전에는 먼저 읽으세요.

**모노레포 구조**: 이 저장소 루트는 `ai/`(여기) `backend/` `frontend/` 세 개의 독립 프로젝트로 나뉘어
있고, 각자 자기 venv·의존성·테스트를 따로 갖습니다. **`ai/` 디렉토리 자체가 AI 파트의 파이썬 프로젝트
루트**이고, `import` 문에 `ai.` 접두어가 붙지 않습니다 — `shared.schemas`, `capture.discord_adapter`
처럼 이 디렉토리 기준 상대 경로로 임포트합니다. `backend/`, `frontend/` 는 다른 담당자가 만들며 이
체크아웃에는 없습니다. **현재 캡처(Phase 0 일부)까지만 구현돼 있습니다.** `stt/`, `extract/`, `judge/`,
`draft/`, `reminder/`, `confidence/`는 이후 이슈에서 붙습니다.

## 명령어

모든 명령은 **이 디렉토리(`ai/`) 안에서** 실행합니다.

```bash
# 설치 (uv venv 에는 pip 이 없으므로 안에서는 항상 `pip` 대신 `uv pip` 사용)
uv venv --python 3.12 .venv
uv pip install -r requirements.txt   # py-cord 는 git PR 브랜치라 git 필요. Linux 는 libopus0 도 필요
cp .env.example .env                 # 최소 DISCORD_BOT_TOKEN 채우기

# 테스트 (설치된 py-cord 는 있어야 하지만 봇 토큰이나 네트워크 연결은 필요 없다 — 스텁 데이터, tmp_path fixture 사용)
.venv/bin/python -m pytest
.venv/bin/python -m pytest tests/test_recording_store.py -k save_session  # 단일 테스트

# 캡처
python capture/run_recorder.py   # 개발용 봇: Discord 에서 /join /record /stop /leave
```

이 저장소에는 lint/format 설정이 없습니다. 있다고 가정하지 마세요.

## 아키텍처

### 플랫폼 격리가 이 프로젝트의 핵심 제약

이번 스프린트의 목적은 판단 로직(extract/judge/draft)이 실제로 동작한다는 것을 검증해서, 이후 다른
플랫폼으로 그대로 옮길 수 있게 하는 것입니다. 그래서 **"Discord"라는 이름은 `capture/` 안에만(그리고
이후 `reminder`의 발송 어댑터에만) 있어야 합니다.** `extract`, `judge`, `draft`는 전부 `member_id` /
(불투명한 문자열로 취급하는) `discord_user_id` 를 키로 쓰는 순수 dict 만 주고받아야 하고, `discord.py`
객체를 직접 넘기면 안 됩니다. 이 모듈들을 건드릴 때는 플랫폼 타입이 경계를 넘어 새어 나가지 않았는지
확인하세요.

이 원칙에 따라 `capture/discord_adapter.py`는 봇 프로세스를 **직접 띄우지 않습니다.** 대신
`discord.Cog`(`RecordingCog`)와 `required_intents()`를 export 만 합니다. 실제 `discord.Bot`은
(다른 프로젝트인 `backend/bot/main.py`가) `bot.add_cog(RecordingCog(bot, on_session_saved=...))`로
붙입니다. `capture/run_recorder.py`는 BE가 준비되기 전 검증용으로 같은 Cog 를 띄우는 최소 실행기입니다
— 정식 진입점이 아니라 임시 개발 도구로 취급하세요.

### 데이터 흐름과 파일 구조 (지금까지 — 캡처만)

```
Discord 음성채널
  → RecordingCog (/record, /stop) → recording_store.save_session()
  → recordings/{user_id}_{ts}.wav (화자별 트랙 — 트랙 자체가 화자이므로 별도 diarization 모델 불필요)
  → recordings/session_{ts}.json  (매니페스트: user_id ↔ display_name ↔ file ↔ duration)
```

`on_session_saved(manifest, manifest_path)`는 BE 가 전사 → 추출 → 판단 → `approval_request` 생성을
이어 붙이도록 마련된 훅 지점입니다. `/stop` 으로 파일 저장이 끝난 직후 호출되며, 여기서 예외가 나도
잡아서 무시하므로 녹음 저장 자체는 깨지지 않습니다.

### shared/ 는 AI-BE 계약

`shared/schemas.py`는 MVP 4테이블(`Member`, `Task`, `TaskHistory`, `ApprovalRequest`)과, 이후 Phase 가
쓸 단계 간 타입(`Transcript`, `ExtractedTask`, `JudgeResult`, `DraftResult`)을 정의합니다. 전부
`to_dict()`/`from_dict()`로 JSON 왕복이 가능한 순수 dataclass 이고, ORM 이나 pydantic 은 쓰지 않습니다.
**이 파일은 BE 와 공유하는 계약**이므로, 물리적으로는 `ai/shared/` 안에 있지만 BE 의 DB 모델이 이걸
1:1 로 따르게 되어 있는 만큼 필드 이름/구조를 바꿀 땐 반드시 알려야 합니다.

`shared/config.py`는 python-dotenv 없이 `.env`를 직접 읽고, `settings()` / `RECORDINGS_DIR` 등을
노출합니다. `AI_ROOT`(이 디렉토리 자체)를 기준으로 모든 경로가 계산됩니다.

### decision_log/

정답이 명확하지 않은 비용/시간/정확도 트레이드오프 결정을 남기는 곳이지, 변경 이력이 아닙니다.
템플릿과 언제 항목을 추가하는지는 `decision_log/README.md` 참고 — 대략 "나중에 왜 이렇게 했는지"를
누군가 물을 만한 결정이면 여기 남기고, 단순 리팩터링은 남기지 않습니다.
