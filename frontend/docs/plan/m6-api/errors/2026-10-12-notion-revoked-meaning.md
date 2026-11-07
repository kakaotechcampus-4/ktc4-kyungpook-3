# Notion `revoked`가 실제로는 「연결 실패」만 뜻함

- 구분: 나중에 개선할 사항 (BE 요청 후보)
- 상태: FE 문구만 실제 뜻에 맞게 바꿨다(2026-10-12). 실패 이유 전달과 권한 해제 감지는 미요청이다.
- 관련: [#204](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/204)

## 현상

FE는 `revoked`를 「연결이 끊어졌다」로 안내했다. 업로드 차단 모달 제목은 「Notion 연결이 끊어졌어요」, 설정 배지는 「연결 끊김」이었다. 그런데 서버의 `revoked`는 끊김이 아니라 연결을 끝까지 마치지 못한 경우에만 나온다.

## 원인

BE 코드 전체에서 `revoked`가 나오는 경우는 두 가지다.

| 경우 | 근거 |
|---|---|
| OAuth 뒤 템플릿 DB 찾기가 실패해 서버가 토큰을 비움 | `backend/app/services/notion_connect.py:70` |
| 토큰은 있는데 2분이 지나도 DB가 붙지 않음(서버 재시작 등으로 작업이 사라짐) | `backend/app/api/integrations.py:63` |

반대로 사용자가 Notion에서 앱 권한을 해제한 경우는 감지하지 않는다.

- Notion 동기화 중 401·403·404가 와도 그 태스크를 반영 실패로 남길 뿐, 연동 상태는 바꾸지 않는다(`backend/app/services/notion.py:175`).
- `INTEGRATION_REVOKED` 오류 코드는 정의만 있고 이 코드를 내는 곳이 없다.

## 이번 조치 (FE)

- 업로드 차단·재연결 모달의 `revoked` 제목: 「Notion 연결이 끊어졌어요」 → 「Notion 연결을 마치지 못했어요」. D-100의 제목을 바꾼 것이라 그 까닭을 `NotionRequiredModal.tsx`에 적었다.
- 설정의 상태 배지: 「연결 끊김」 → 「연결 실패」.
- 버튼(「Notion 다시 연결하기」)과 설명은 그대로다.

## 나중에 개선할 사항

1. **실패 이유 전달 (BE):** 서버는 실패 이유를 이미 구분한다(`AttachResult`). 새 상태 값을 늘리지 않고 이유 필드를 더하는 방식을 제안한다(예: `status: "revoked", reason: "schema_mismatch"`). 그러면 FE가 사용자가 할 일을 안내할 수 있다.

   | 이유 | 안내할 수 있는 것 |
   |---|---|
   | `template_not_ready`, 작업 중단 | 다시 연결 |
   | `database_not_found` | 템플릿 페이지를 지웠거나 옮겼는지 확인 |
   | `schema_mismatch` | 템플릿 DB의 열을 바꿨는지 확인 |
   | `notion_error` | 공유 권한 범위 확인 |

2. **권한 해제 감지 (BE):** Notion 쪽에서 권한이 해제되면 지금은 연동이 계속 `connected`로 보이고, 태스크만 반영 실패가 쌓인다. 이를 감지해 연동 상태에 반영하는 기능이 필요하다. 이 기능이 생기면 「연결 실패」와 진짜 「끊김」을 이유로 나눠 안내한다.
3. **FE 후속:** 위 BE 보완이 생기면 모달·배지 문구를 이유별로 나누고, D-100 결정 문서와 대표 계약의 `revoked` 설명을 갱신한다.
