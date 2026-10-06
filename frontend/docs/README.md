# Frontend 문서 안내

파트 책임·코드·마일스톤 상태는 [Frontend README](../README.md), 작성 권한과 양식은 [공통 규칙](../../docs/agent-rules.md)과 [저장소 문서 안내](../../docs/README.md)를 따른다.

## 대표 경로

```text
frontend/docs/
├── contracts/
├── requests/
└── plan/
    ├── frontend-plan.md
    └── m0/ ~ m8/
        ├── plan.md
        ├── basis-for-decision/
        └── trouble-shooting/
```

- [API 계약](contracts/frontend-api-contract.md): 현재 코드 대조, 기존 명세와 백엔드 요청 목록.
- [전체 계획](plan/frontend-plan.md): 기존 원문을 그대로 이동한 사용자 관리 문서.
- [마일스톤 안내](plan/README.md): 실제 계획·완료 조건·인수인계·결정 기록과 상태.
- `requests/`: 독립 요청 기록 공간. 기존 백엔드 요청은 계약 §4에 유지하며 복제하지 않는다.

## 기존 문서 배치

아래 경로는 `frontend/docs/` 기준의 이동 이력이다. 이전 경로의 파일과 안내 파일은 모두 삭제했으며 원문은 현재 위치에서만 관리한다.

| 기존 문서 | 원문 위치 | 분류 근거 |
|---|---|---|
| `plan/frontend-development-plan.md` | [plan/frontend-plan.md](plan/frontend-plan.md) | 전체 계획 |
| `api/frontend-api-contract-draft.md` | [contracts/frontend-api-contract.md](contracts/frontend-api-contract.md) | 대표 계약 |
| `plan/m0-scaffolding.md` ~ `plan/m5-meeting-upload-processing-and-minutes.md` | 각 `plan/mN/plan.md` | 기존 문서가 명시한 마일스톤 |
| `plan/m4-done-criteria.md`, `plan/m4-handoff.md` | `plan/m4/`의 같은 파일명 | M4 완료 조건·실제 인수인계 |
| `plan/m5-done-criteria.md`, `plan/m5-handoff.md` | `plan/m5/`의 같은 파일명 | M5 완료 조건·실제 인수인계 |
| `plan/focus-visible-outline.md` | [plan/m2/focus-visible-outline.md](plan/m2/focus-visible-outline.md) | 공통 UI 포커스 구현 계획. 내용 보존 |
| `plan/prev-todo-m3.md` | [plan/m3/prev-todo-m3.md](plan/m3/prev-todo-m3.md) | 문서에 명시된 M3 착수 전 자료 |
| `impl-decision/`의 도메인·MSW·계층 검사 기록 3개 | [M1 결정](plan/m1/basis-for-decision) | M1 모델·MSW 사양과 계층 검증 근거 |
| `impl-decision/`의 토큰·공통 UI·포커스 기록 25개 | [M2 결정](plan/m2/basis-for-decision) | M2 사양·공통 UI 구현 근거 |
| `impl-decision/`의 인증·온보딩·앱 셸·검증 도구 기록 10개 | [M4 결정](plan/m4/basis-for-decision) | M4 사용자 흐름·검증 도구 구현 근거 |
| `impl-decision/`의 업로드·처리·회의록 기록 7개 | [M5 결정](plan/m5/basis-for-decision) | M5 구현 단위·후속 UX 기록 |

M0~M5의 기존 계획을 빈 초기화 파일 자리로 옮겼다. M6~M8의 계획은 여전히 0바이트다. 결과 문서를 새로 만들거나 과거 선택·검증을 소급 작성하지 않았다. 보호 계획의 이동 전 인라인 경로 표기는 [마일스톤 안내](plan/README.md)에서 해석한다.

## 유지한 고유·공유 영역

- [디자인 시스템](design/design-system.md), [캔버스 안내](design/canvas/README.md), [캐릭터](design/character.md): 시안·폰트·프로토타입과 함께 유지.
- [마스코트](mascot/mascot.md): HTML·JS 자산과 함께 유지.
- [성능 자료](performance/README.md): 측정·후속 개선 자료.
- [제품·기술 결정](decision/frontend-decisions.md): 여러 마일스톤이 공유하는 D-번호와 합의 근거.
- [구현 결정 안내](plan/basis-for-decision-guide.md): 기존 작성 양식과 이동한 원문 탐색 안내.
- [MSW 사용 안내](msw-guide.md): 개발·테스트의 공통 모의 데이터 사용법.
