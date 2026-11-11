# Backend 문서 안내

실행 방법과 폴더 구조는 [Backend README](../README.md)에 있다. 작성 권한과 양식은 [공통 규칙](../../docs/agent-rules.md)과 [저장소 문서 안내](../../docs/README.md)를 따른다.

## 어디에 무엇이 있나

```text
backend/docs/
├── reference/              # 기능별 동작 규칙(현재 코드 기준 설명)
├── contracts/              # 다른 파트와의 API 계약
├── requests/               # 다른 파트와 주고받은 요청
└── plan/
    ├── backend-plan.md     # 전체 계획(사용자 관리 문서)
    ├── README.md           # M0~M7 안내, 결정 기록 목록
    └── m0/ ~ m7/
        ├── plan.md         # 전체 계획의 해당 절
        ├── result.md
        └── basis-for-decision/
```

| 찾는 것 | 문서 |
|---|---|
| 기능이 지금 어떻게 동작하나 | [기능별 문서](#기능별-문서) |
| AI 봇이 부르는 API | [AI(녹음 봇) 계약](contracts/backend-ai-contract.md) |
| 웹 화면이 부르는 API | [프론트엔드 대표 계약](../../frontend/docs/contracts/frontend-api-contract.md), 서버의 `/docs`(Swagger) |
| 무엇을 만들었고 어떻게 검증했나 | [마일스톤 안내](plan/README.md)의 결과 |
| 왜 그렇게 정했나 | [결정 기록 목록](plan/README.md#결정-기록-목록) |

## 기능별 문서

| 문서 | 다루는 내용 |
|---|---|
| [응답 형식·에러 코드·권한](reference/api-conventions.md) | 응답 봉투, `error.code` 전체 목록, PM 전용 API, 아직 없는 기능 |
| [계정과 인증](reference/auth.md) | 가입·카카오 로그인, 세션 토큰, 로그인 제한, 비밀번호 재설정, 이름 규칙 |
| [Notion 연동](reference/notion.md) | Task를 Notion에 반영하는 방식, 재시도, OAuth 연결 |
| [Discord 연동](reference/discord.md) | 봇 초대 OAuth, 서버 사용자 목록, 채팅 수집 채널, 팀원 연결 옮기기 |
| [유사 검색과 담당자 별칭](reference/matching-and-alias.md) | 유사 task 검색, AI 판단 접수, 별칭 학습, 전사 힌트 |
| [회의 녹음 보관과 재생](reference/meeting-audio.md) | 녹음 저장 위치, 보관 기간, 재생 API |
| [메시지와 알림](reference/messages.md) | 메시지·알림 설정, 읽지 않은 수, 답장 판단 재시도 |
| [운영과 의존성](reference/operations.md) | 운영 실행(Docker), 서버 안의 워커, health ready, KPI view, 의존성 잠금 |
| [심사용 시드](reference/demo-seed.md) | 시연용 계정·공간·회의를 채우는 명령 |

Backend README에 있던 기능별 설명을 2026-11-11에 주제별로 나눠 옮겼다. 다른 문서가 걸던 README 앵커(`#에러-코드` 등)는 README의 "옮긴 절"이 받는다.

## 계약과 요청

- [AI(녹음 봇) 계약](contracts/backend-ai-contract.md): 봇이 부르는 회의·발화·유사 검색·추출 등록·서버로 워크스페이스 찾기·전사 힌트 조회 API의 현재 코드 대조.
- 웹 화면용 API 계약은 [프론트엔드 대표 계약](../../frontend/docs/contracts/frontend-api-contract.md)에 있다. 같은 계약을 여기에 복제하지 않는다. 엔드포인트별 스키마는 서버의 `/docs`(Swagger)가 기준이다.
- `requests/`: 다른 파트가 백엔드에 보낸 요청을 실제로 받으면 기록한다.
  - [녹음 시작 때 배포 재시작 잠금 확인](requests/bot-restart-lock.md)(AI)
  - 프론트엔드의 기존 요청은 [프론트엔드 계약 §4](../../frontend/docs/contracts/frontend-api-contract.md#4-백엔드-요청)에 남아 있고 복제하지 않는다.

## 계획과 결과

- [전체 계획](plan/backend-plan.md)은 사용자가 관리한다. `plan/backend-development-plan.md`에서 이름만 바꿔 옮겼다.
- [마일스톤 안내](plan/README.md)에 M0~M7별 과거 계획 상태와 현재 결과, 결정 기록 목록이 있다.
- 마일스톤별 plan.md는 전체 계획의 해당 절(범위, 작업, 완료 기준)을 옮긴 것이다.
