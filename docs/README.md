# Docs

프로젝트 문서, 기획서, 아키텍처를 관리하는 디렉터리입니다.

## 에이전트 공통 관리

- [공통 작업 규칙](agent-rules.md): 작업 시작 절차, 문서 수정 권한, 기록 의무와 스킬 사용 시점.
- [Codex 진입점](../AGENTS.md) · [Claude Code 진입점](../CLAUDE.md): 공통 규칙을 먼저 읽도록 안내.
- [팀 스킬 사용 안내](../.agents/README.md): 일곱 스킬의 역할, 호출 방법과 수정 방법.
- [파트별 전체 흐름](파트별%20전체%20흐름.md): 현재 코드로 확인한 프론트엔드 중심 처리 순서와 파트 경계.

```text
프로젝트/
├── AGENTS.md
├── CLAUDE.md
├── docs/
│   ├── agent-rules.md
│   └── README.md
├── .agents/skills/
└── .claude/skills/
```

## 파트 문서

- [Frontend](../frontend/README.md)
- [Backend](../backend/README.md)
- [AI](../ai/README.md)

Frontend는 [문서 안내](../frontend/docs/README.md), [대표 계약](../frontend/docs/contracts/frontend-api-contract.md), [전체 계획](../frontend/docs/plan/frontend-plan.md), [M0~M8 안내](../frontend/docs/plan/README.md)로 구조화했습니다. 기존 M0~M5 계획 원문과 완료 조건·인수인계·구현 결정 기록은 해당 마일스톤 폴더로 옮겼습니다. 이전 경로의 파일과 이동 안내는 삭제했습니다. 디자인·마스코트·성능 등 파트 고유 자료와 공유 기록은 유지합니다. Backend·AI 문서는 이번 작업에서 재배치하지 않았습니다.

## 공통 문서 역할과 양식

아래 경로는 초기 구조화 시 사용할 공통 규약입니다. 기존 문서 중 역할이 대응되는 부분만 정리하며, 다른 폴더의 존재는 오류가 아닙니다. `<part>`는 실제 파트 경로입니다.

| 경로 | 작성 주체·시점 | 주요 내용 |
|---|---|---|
| `docs/파트별 전체 흐름.md` | 초기 구조화 시 에이전트 | 주요 처리 흐름, 파트 책임·데이터 흐름·의존 관계, 계약 링크 |
| `<part>/README.md` | 초기 구조화 및 개발 후 에이전트 | 파트 책임, 코드 경로, 문서 링크, 마일스톤 상태, 추가 문서 영역 |
| `<part>/docs/contracts/*.md` | 초기 구조화 및 계약 변경 시 에이전트 | 제공자·소비자, 인터페이스·입출력·오류·제약, 코드 근거, 합의 상태 |
| `<part>/docs/requests/*.md` | 실제 요청 발생 시 | 요청·수신 파트, 배경·작업·완료조건·처리 상태·관련 문서 |
| `<part>/docs/plan/<part>-plan.md` | 사용자 | 전체 목표, 마일스톤·산출물·완료조건, 의존성 |
| `<part>/docs/plan/mN/plan.md` | 사용자 또는 명시적으로 요청한 계획 작성 스킬 | 목표·범위·작업 순서·의존성·검증 방법·완료조건. 초기에는 빈 파일 |
| `<part>/docs/plan/mN/result.md` | 개발 후 에이전트 | 실제 구현·코드, 조건별 상태와 근거, 실제 검증, 계획 대비 차이·이유·영향, 잔여 작업 |
| `<part>/docs/plan/mN/basis-for-decision/*.md` | 의미 있는 선택 시 에이전트 | 문제·제약, 실제 대안, 선택·이유, 장단점·영향·관련 근거 |
| `<part>/docs/plan/mN/trouble-shooting/*.md` | 사람 | 증상·조사·시도·결과, 해결 또는 미해결 상태, 고민과 인사이트 |

계약 파일은 의미 있는 이름을 사용하고, 의사결정·트러블슈팅 파일은 `YYYY-MM-DD-<slug>.md`로 명명합니다. 한국어와 상대 링크를 사용하며, 빈 결과나 가상의 기록을 미리 생성하지 않습니다. 보호 범위와 계획 작성 예외는 [공통 작업 규칙](agent-rules.md)을 따릅니다.
