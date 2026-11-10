# API 문서

Backend는 FastAPI가 코드에서 자동으로 만드는 OpenAPI 스펙을 API 명세의 기준으로 삼는다. 엔드포인트 목록을 손으로 옮겨 적지 않는다. 그래서 코드와 문서가 어긋나지 않는다.

## 보는 곳

| 경로 | 용도 |
|---|---|
| `/docs` | Swagger UI. 엔드포인트별 요청·응답 스키마를 보고 바로 호출해 볼 수 있다 |
| `/redoc` | ReDoc. 읽기 전용으로 훑어볼 때 |
| `/openapi.json` | 원본 OpenAPI 스펙. Postman 등으로 가져올 때 |

- 로컬: `http://localhost:8000/docs` ([Backend 실행 안내](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/README.md))
- 배포 서버: `[확정 후 기입]`
- 정적 페이지(포털): `[후속 작업 — CI에서 openapi.json을 뽑아 ReDoc 페이지로 배포]`

> 📷 **사진 자리**: Swagger UI 화면 — 회의·승인 API 묶음이 펼쳐진 모습 (파일: ../assets/api-swagger.png)

## API 묶음

모든 경로는 `/api/v1` 아래에 있다(`backend/app/main.py`).

| 묶음 | 라우터 | 사용자 |
|---|---|---|
| 인증·계정 | `auth`, `withdrawal`, `consents` | 웹 |
| 워크스페이스·팀원·초대 | `workspaces`, `members`, `invitations` | 웹 |
| 회의·업로드·발화 | `meetings`, `uploads`, `sources`, `meeting_purges` | 웹 · AI |
| 추출·승인·태스크 | `extractions`, `approvals`, `tasks`, `similar_tasks`, `project_map` | AI · 웹 |
| 메시지·알림 | `messages`, `message_socket`, `message_settings`, `notifications` | 웹 |
| 외부 연동 | `integrations` (Discord·Notion OAuth, 채팅 채널) | 웹 |
| 봇·워커용 | `bot_messages`, `bot_lookups`, `bot_summaries`, `integrations.bot_*`, `withdrawal.bot_router` | AI (서비스 토큰 `X-Service-Token`) |

## 계약 문서

자동 생성 스펙에 담기지 않는 합의 상태·오류 규칙·흐름은 계약 문서에 있다.

- [FE API 계약](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/docs/contracts/frontend-api-contract.md): 웹 화면이 쓰는 API
- [BE·AI 계약](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/docs/contracts/backend-ai-contract.md): AI 워커·봇이 쓰는 API
- 요약: [테크스펙 — 인터페이스 명세](../techspec/interface.md)
