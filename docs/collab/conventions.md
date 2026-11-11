# 코딩 컨벤션

파트별 lint·포맷 규칙과, 커밋·PR·이슈를 쓰는 규칙을 정리한다. 설정 파일과 CI 로 강제되는 것과, 기록에서 관찰된 관행을 나눠 적는다.

## 1. 파트별 lint·포맷

| 파트 | 도구 | 설정 | CI 에서 하는 일 |
|---|---|---|---|
| Frontend | ESLint 9 + typescript-eslint, Prettier 3 | [eslint.config.js](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/eslint.config.js), [.prettierrc.json](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/.prettierrc.json) | `npm run typecheck` → `lint` → `format:check` → `test`, 빌드, Playwright E2E ([frontend-ci.yml](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/frontend-ci.yml)) |
| Backend | ruff | [backend/ruff.toml](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/ruff.toml) — ruff 기본 규칙(E4, E7, E9, F), `target-version = "py312"` | `ruff check .` → pytest(pgvector 서비스) → `alembic upgrade head` + `alembic check` → 이미지 빌드 ([backend-ci.yml](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/backend-ci.yml)) |
| AI | 없음 | [ai/pyproject.toml](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/pyproject.toml) 은 pytest 설정만 있다. `ai/CLAUDE.md` 에 "lint/format 설정은 없다"고 적혀 있다 | pytest 만 ([ai-ci.yml](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/ai-ci.yml)) |

### Frontend 규칙 요점

- Prettier: 세미콜론 없음, 작은따옴표, 한 줄 100자, 마지막 쉼표 `all`, 줄바꿈 LF.
- `@typescript-eslint/no-explicit-any`: error.
- `jsx-a11y` 권장 규칙 전부: 접근성 위반을 lint 에서 잡는다.
- `eslint-plugin-boundaries`: `src/` 를 `app → pages → widgets → features → entities → shared` 계층으로 나누고, 위 계층만 아래 계층을 import 하게 막는다(기본 `disallow`).

### Backend·AI 규칙 요점

- Backend: 모델을 바꾸고 마이그레이션을 빠뜨리면 `alembic check` 가 CI 에서 실패한다.
- AI: 포맷 도구 대신 구조 규칙을 테스트로 강제한다(예: `capture/` 밖에서 `discord` import 금지 — `tests/test_platform_isolation.py`). 자세한 내용은 [AI 에이전트 운영 규칙](ai-agent-rules.md#ai-파트의-깨면-안-되는-규칙-aiclaudemd).
- AI 쪽에는 lint 를 두지 않았다. 도입은 정하지 않았다.

## 2. 커밋 메시지

Conventional Commits 형식 `<type>(<scope>): <설명>` 을 쓴다. 팀 노션 "커밋 컨벤션"에서 type 목록과 scope 표기(`feat(stt): ...`, `fix(notion): ...`), 브랜치 이름(`feature/1-화자분리` 처럼 타입과 이슈 번호)을 정했다.

관찰(2026-11-09, `develop` 최근 비머지 커밋 2,000개): 1,998개가 이 형식이다.

| type | 비율 감 | 예 |
|---|---|---|
| `docs` | 가장 많음 | `docs(frontend): #348 meeting 리뷰 반영 뒤 전체 테스트 결과를 적는다 (#348)` |
| `fix` | | `fix(migrations): 리뷰 반영 - 용어 목록 마이그레이션을 … 뒤로 잇는다` |
| `feat` | | `feat(judge): 전사 오인식 의심 단어가 있는 새 항목은 auto 로 보내지 않는다` |
| `test` | | `test(judge): Jev 근거 판정 평가를 217개 대사·3회 반복으로 늘려 0.8 을 다시 본다` |
| `refactor`, `chore`, `style`, `ci` | 적음 | |

- scope 는 파트(`frontend`, `backend`, `ai`)나 모듈(`api`, `capture`, `stt`, `judge`, `upload`, `approvals`, `deploy`, `contract` 등)을 쓴다.
- 설명은 한국어 평서문("~한다")이 많다. FE 담당 커밋은 영어 설명도 쓴다(예: `fix(summary): keep graph links within loaded live meetings`).
- 리뷰 반영 커밋은 설명 앞에 `리뷰 반영 -` 을 붙인다(2,000개 중 378개).
- 이슈 번호는 설명 안(`#348 …`)이나 끝(`(#348)`)에 붙인다.
- AI 에이전트가 함께 쓴 커밋은 본문 끝에 `Co-Authored-By: Claude …` 를 단다([AI 에이전트 운영 규칙](ai-agent-rules.md#5-ai-가-만든-기록과-사람이-쓴-기록의-구분)).

## 3. PR 제목과 본문

### 제목 — 현재 두 형식이 섞여 있다

| 형식 | 예 | 주로 쓰는 사람 |
|---|---|---|
| Conventional | `feat(judge): 전사 오인식 의심 단어가 있는 새 항목은 auto 로 보내지 않는다` | AI·BE |
| 대괄호 태그 | `[FEAT] [FE] 카카오 로그인을 보완하고 휴대폰 로그인을 시안 H-1 배치로 바꾼다 (#538)` | FE(hotpringles 96건), 일부 BE(hwnv 7, wkddnjswns 4) |

- `main` 밖 머지 PR 387건 중 Conventional 277건, 대괄호 107건(2026-11-11, GitHub GraphQL).
- 대괄호 형식은 `[유형] [파트] 설명 (#이슈)` 이다. 유형은 이슈 템플릿 제목 머리(`[FEAT]`, `[BUG]`, `[TASK]`)와 `[FIX]`, `[REFACTOR]` 를 쓴다.
- 지금은 둘 다 쓴다. 하나로 맞추지는 않았다.
- 주간 멘토 리뷰 PR 제목: `chore: N주차 개발 내용 develop → main 반영 (#PR,…)`.

### 본문 — PR 템플릿

[.github/pull_request_template.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/pull_request_template.md) 는 운영진이 배포했고 팀이 고칠 수 있다. `develop` 대상 PR 과 `main` 대상 PR 에 똑같이 뜬다.

| 절 | 내용 |
|---|---|
| 이번에 한 일 | 2~3줄. 화면이 있으면 스크린샷 |
| 리뷰에서 봐주셨으면 하는 곳 | 멘토 리뷰에서 가장 중요한 절. "전체 봐 주세요" 대신 구체적인 질문 |
| 고민했던 점 · 다른 선택지 | 두 방법 중 고른 이유 |
| 지난 리뷰 반영 | 재리뷰 요청일 때만. 피드백 → 반영 위치. 반영하지 않은 것은 이유 |

AI 하네스로 만든 PR 은 별도 구조(요약 / 설계 / 변경 / 검증 / 사람이 확인할 것 / 기록 / 다른 파트 전달)를 쓴다. 템플릿 절과 이름이 다르고, 하나로 맞추지는 않았다.

### convention-check 워크플로가 하는 일

[convention-check.yml](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/convention-check.yml) 은 운영진 배포 파일이다.

- `main` 대상 PR 이 열리거나 다시 열리거나 draft 를 벗어날 때만 돈다. 팀 내부 PR(`→ develop`)에는 돌지 않는다.
- 운영 저장소(`kakaotechcampus-4/pr-pipeline`)의 스크립트 `convention-notice.sh` 를 받아 실행하고, PR 제목·작성자·base·head 브랜치 등을 넘긴다.
- 컨벤션 이탈을 **안내 코멘트**로만 알린다. 머지를 막지 않는다.
- 검사 항목은 운영 저장소의 스크립트에 있고 이 저장소에는 없다.

## 4. 이슈 템플릿

[.github/ISSUE_TEMPLATE/](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/tree/develop/.github/ISSUE_TEMPLATE)

| 템플릿 | 제목 머리 | 라벨 | 주요 절 |
|---|---|---|---|
| Feature Request | `[FEAT] ` | enhancement | 담당 파트(ai/backend/frontend) 체크 … |
| Bug Report | `[BUG] ` | bug | 버그 설명, 재현 경로 … |
| Task / Chore | `[TASK] ` | chore | 담당 파트 체크 … |
| AI Feature (하네스) | `[AI] ` | enhancement | 목표, 먼저 읽을 것, 범위 안/밖, 지킬 것, 설계에서 정할 것, 완료 조건, 선행 이슈 |

팀이 더한 라벨: `chore`, `refactor`, `ai→be`, `ai→fe`, `contract`, `합의됨`([그라운드룰](ground-rules.md#2-파트-간-계약과-요청)).

## 5. CODEOWNERS 와 멘토 자동 지정

- [.github/CODEOWNERS](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/CODEOWNERS) 의 "운영진 영역" 4줄(`assign-mentor.yml`, `notify-discord.yml`, `convention-check.yml`, `CODEOWNERS`)은 운영진 팀 `pipeline-admin` 소유다. 팀은 고치지 않는다.
- "팀 자유 영역"에 파트별 리뷰어를 지정할 수 있지만 지금은 비어 있다. 파트 리뷰어는 PR 본문에서 직접 부른다(예: "BE 담당 리뷰 부탁드립니다").
- [assign-mentor.yml](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/assign-mentor.yml): `main` 대상 PR(draft 제외)에 담당 멘토를 자동 지정한다. 판정 로직은 운영 저장소 스크립트에 있다.
- [notify-discord.yml](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.github/workflows/notify-discord.yml): `main` 대상 PR 의 리뷰 요청·결과를 팀 Discord 에 알린다.
- 그 밖의 워크플로(파트 CI, 배포, 팀 알림)는 팀이 직접 추가했다.

## 관련 문서

- [브랜치 전략](branch-strategy.md)
- [그라운드룰](ground-rules.md)
- [로컬 개발 환경](../dev/local-setup.md)
