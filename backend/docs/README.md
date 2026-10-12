# Backend 문서 안내

실행·API 동작·권한은 [Backend README](../README.md), 작성 권한과 양식은 [공통 규칙](../../docs/agent-rules.md)과 [저장소 문서 안내](../../docs/README.md)를 따른다.

## 대표 경로

```text
backend/docs/
├── contracts/
├── requests/
└── plan/
    ├── backend-plan.md
    └── m0/ ~ m7/
        ├── plan.md
        ├── basis-for-decision/
        └── trouble-shooting/
```

- [AI(녹음 봇) 계약](contracts/backend-ai-contract.md): 봇이 부르는 회의·발화·유사 검색·추출 등록·서버로 워크스페이스 찾기 API의 현재 코드 대조.
- 웹 화면용 API 계약은 [프론트엔드 대표 계약](../../frontend/docs/contracts/frontend-api-contract.md)에 있다. 같은 계약을 여기에 복제하지 않는다. 엔드포인트별 스키마는 서버의 `/docs`(Swagger)가 기준이다.
- [전체 계획](plan/backend-plan.md): 사용자 관리 문서. 기존 원문을 그대로 이동했다.
- [마일스톤 안내](plan/README.md): M0~M7 계획 연결과 전체 계획의 상태.
- `requests/`: 다른 파트가 백엔드에 보낸 요청을 실제로 받으면 기록한다. 프론트엔드의 기존 요청은 [프론트엔드 계약 §4](../../frontend/docs/contracts/frontend-api-contract.md#4-백엔드-요청)에 남아 있고 복제하지 않는다.

## 기존 문서 배치

| 기존 문서 | 현재 위치 | 분류 근거 |
|---|---|---|
| `plan/backend-development-plan.md` | [plan/backend-plan.md](plan/backend-plan.md) | 전체 계획. 내용 변경 없이 이름만 변경 |

그 밖의 백엔드 문서는 없었다. 결과 문서나 과거 선택·검증 기록을 소급 작성하지 않았다.
