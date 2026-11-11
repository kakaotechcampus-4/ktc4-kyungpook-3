# Docs

프로젝트 문서, 기획서, 아키텍처를 관리하는 디렉터리입니다.

## 최종 제출 문서 (문서 포털)

[포털 첫 화면](index.md)에서 시작한다. `mkdocs.yml`이 목차다. 원자료(이 문서 아래의 계획·결과·결정 기록·계약)를 요약하고 링크한다.

- [사용자 가이드](user/getting-started.md) · [개발자 가이드](dev/local-setup.md) · [테크스펙](techspec/index.md) · [설계 심화](design/index.md) · [협업 문서](collab/index.md) · [API 문서](api/index.md)

## 에이전트 공통 관리

- [공통 작업 규칙](agent-rules.md): 작업 시작 절차, 문서 수정 권한, 기록 의무와 스킬 사용 시점.
- [Codex 진입점](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/AGENTS.md) · [Claude Code 진입점](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/CLAUDE.md): 공통 규칙을 먼저 읽도록 안내.
- [팀 스킬 사용 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/.agents/README.md): 일곱 스킬의 역할, 호출 방법과 수정 방법.
- [파트별 전체 흐름](파트별%20전체%20흐름.md): 현재 코드로 확인한 프론트엔드 중심 처리 순서와 파트 경계.
- [프로젝트 상세 설명](프로젝트%20상세%20설명.md): 프로젝트 전체(목표, 팀, 구조, 파트별 상세, 수치, 타임라인, 현재 상태, 남은 일)를 2026-11-07 기준으로 정리한 원자료. 최종 문서화·테크스펙·발표 자료의 바탕.

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

- [Frontend](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/README.md)
- [Backend](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/README.md)
- [AI](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/README.md) · [AI 문서 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/README.md)

현재 구현·검증 기록은 [FE 마일스톤 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/README.md), [FE 이슈 결과](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/tree/develop/frontend/docs/plan), [BE 마일스톤 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/plan/README.md), [AI 작성 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/tree/develop/ai/docs/basis_for_decision/ai)·[팀원 작성 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/tree/develop/ai/docs/basis_for_decision/member)에서 찾는다. 계획, 결과의 기록일과 검증 환경, 현재 배포 상태를 구분한다. 코드 병합이나 MSW 통과만으로 실서버·외부 공급사·iOS 검증 완료를 표시하지 않는다.

Frontend는 [문서 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/README.md), [대표 계약](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/contracts/frontend-api-contract.md), [전체 계획](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/frontend-plan.md), [M0~M8 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/plan/README.md)로 구조화했습니다. 기존 M0~M5 계획 원문과 완료 조건·인수인계·구현 결정 기록은 해당 마일스톤 폴더로 옮겼습니다. 이전 경로의 파일과 이동 안내는 삭제했습니다. 디자인·마스코트·성능 등 파트 고유 자료와 공유 기록은 유지합니다.

Backend는 [문서 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/README.md), [AI 계약](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/contracts/backend-ai-contract.md), [전체 계획](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/plan/backend-plan.md), [M0~M7 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/plan/README.md)로 구조화했습니다. 전체 계획은 `backend-development-plan.md`에서 이름만 바꿨고, M0~M7의 plan.md는 빈 초기화 파일입니다. AI 문서는 아직 재배치하지 않았습니다.

## 서비스 정책

[정책 확정 내용과 게시 상태](policy/README.md)에서 교육·평가용 시범 운영의 확정 정책, 약관·개인정보처리방침 게시 준비본, 외부 업체 공식 링크와 남은 확인 항목을 볼 수 있습니다.

## 공통 문서 역할과 양식

아래 경로는 계획·구현·검증 근거를 찾는 공통 규약입니다. 기존 문서 중 역할이 대응되는 부분만 정리하며, 다른 폴더의 존재는 오류가 아닙니다. `<part>`는 실제 파트 경로입니다.

| 경로 | 작성 주체·시점 | 주요 내용 |
|---|---|---|
| `docs/파트별 전체 흐름.md` | 초기 구조화 시 에이전트 | 주요 처리 흐름, 파트 책임·데이터 흐름·의존 관계, 계약 링크 |
| `<part>/README.md` | 초기 구조화 및 개발 후 에이전트 | 파트 책임, 코드 경로, 문서 링크, 마일스톤 상태, 추가 문서 영역 |
| `<part>/docs/contracts/*.md` | 초기 구조화 및 계약 변경 시 에이전트 | 제공자·소비자, 인터페이스·입출력·오류·제약, 코드 근거, 합의 상태 |
| `<part>/docs/requests/*.md` | 실제 요청 발생 시 | 요청·수신 파트, 배경·작업·완료조건·처리 상태·관련 문서 |
| `<part>/docs/plan/<part>-plan.md` | 사용자 | 전체 목표, 마일스톤·산출물·완료조건, 의존성 |
| `<part>/docs/plan/mN/plan.md` | 사용자 또는 명시적으로 요청한 계획 작성 스킬 | 목표·범위·작업 순서·의존성·검증 방법·완료조건. 초기에는 빈 파일 |
| `<part>/docs/plan/mN/result.md` | 개발 후 에이전트 | 실제 구현·코드, 조건별 상태와 근거, 실제 검증, 계획 대비 차이·이유·영향, 잔여 작업 |
| `frontend/docs/plan/mN/work-items/<식별자>-<이름>/` | FE 후속 작업 시 에이전트 | 실제 이슈·PR에 연결한 결과. 독립 개선은 `plan/refactor/work-items/`에 두며 색인에서 이슈와 PR 종류를 구분 |
| `<part>/docs/plan/mN/basis-for-decision/*.md` | 의미 있는 선택 시 에이전트 | 문제·제약, 실제 대안, 선택·이유, 장단점·영향·관련 근거 |
| `<part>/docs/plan/mN/trouble-shooting/*.md` | 사람 | 증상·조사·시도·결과, 해결 또는 미해결 상태, 고민과 인사이트 |

계약 파일은 의미 있는 이름을 사용하고, 의사결정·트러블슈팅 파일은 `YYYY-MM-DD-<slug>.md`로 명명합니다. 한국어와 상대 링크를 사용하며, 빈 결과나 가상의 기록을 미리 생성하지 않습니다. 보호 범위와 계획 작성 예외는 [공통 작업 규칙](agent-rules.md)을 따릅니다.
