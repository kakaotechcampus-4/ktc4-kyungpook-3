# 프론트 오류 코드 목록에 서버 코드 다섯 개가 없음

- 구분: FE 수정
- 상태: 수정함 (`c5eedf0`)

## 현상

아래 서버 오류가 오면 전용 안내 없이 공통 문구(「문제가 생겼어요…」)로 보인다.

| 코드 | 상태 | 프론트 경로에서 나올 수 있는 곳 |
|---|---|---|
| `DISCORD_API_FAILED` | 502 | 팀원 연결의 Discord 사용자 목록 조회 |
| `LAST_PM_REQUIRED` | 409 | 마지막 PM의 역할 변경 |
| `APPROVAL_CONFLICT` | 409 | 승인 처리. 승인 엔티티가 코드 문자열로 따로 판별하고 있었다 |
| `MEETING_FAILED` | 409 | 지금 프론트 경로에서는 확인하지 못했다 |
| `EMBEDDING_UNAVAILABLE` | 502 | 지금 프론트 경로에서는 확인하지 못했다 |

## 원인

프론트 `ERROR_CODES`(`frontend/src/shared/api/errors.ts`)가 31개였고, 서버(`backend/app/core/errors.py`)는 36개다.

## 조치

다섯 개 코드와 안내 문구를 추가했다. 개수 테스트를 서버 기준 36개로 바꿨다. 각 오류를 실제 서버에서 일으켜 본 검증은 하지 않았다.
