# 백엔드 요청 사항

프론트엔드 개발에 필요한 것만 정리했다. 작성일 2026-09-15.

**전제** — prefix `/api/v1` · 봉투 `{data, error}` · 식별자 `workspaceId` · 세션은 HttpOnly 쿠키(본문에 토큰 없음) · 단일 EC2 동일 오리진이라 CORS 불필요 · 날짜 `YYYY-MM-DD`와 시각 ISO 8601을 형식으로 구분 · 프론트의 권한 분기는 UX용이므로 **서버도 검사해야 함**

---

## 새로 필요한 API

| 영역 | 필요한 것 |
|---|---|
| **auth** | 가입, 로그인, 로그아웃, `GET /me`, Google 시작·콜백 |
| **workspaces** | 목록·생성·상세, **온보딩 단계 상태**(완료·건너뜀·미완), 마지막 이용 워크스페이스, **내 역할** |
| **integrations** | **OAuth 시작 URL 경로**(Notion·Discord), **Discord 연결·해제** |
| **members** | Discord 사용자 목록 + 팀원 1:1 매핑. 부분 매핑 허용 |
| **meetings** | **목록**, **multipart 음성 업로드 + 진행률**, **회의록 본문**(요약·전사문·반영 태스크) |
| **tasks** | 상세, 상태 변경, 확인 필요 승인·반려 |
| **dashboard** | **집계 API** — 요약 숫자 4개, 확인필요·마감임박 각 5건, 최근 반영, 되돌리기 |

회의 리소스는 **하나로 유지**하고 `source`로 구분한다. 봇 녹음과 웹 업로드가 한 목록에 날짜순으로 들어가야 한다.

대시보드는 **집계 API여야 한다.** 페이지네이션된 리스트로는 워크스페이스 전체 개수를 맞출 수 없다.

---

## 기존 명세에서 바꿀 것

| 현재 | 요청 |
|---|---|
| `POST /workspaces` 가 `members` 요구 | **`members`·`notion_name` 제거 또는 optional** — 생성 시점엔 Discord 미연결이라 `discord_id`를 알 수 없음 |
| `POST .../integrations/notion` 이 `{mcp_token, database_id}` | **본문에서 두 필드 제거** — 화면에 입력란이 없고 보드도 고르지 않음 |
| `GET .../integrations` 응답 형태 미정 | **표시용 이름 포함**(Notion 워크스페이스명·Discord 채널명), **미연결과 연결 끊김 구분** — 띄울 모달이 다름 |
| `GET /proposals?status=pending` 이 별도 리소스 | **`GET /tasks?status=needs_review`로 통합** — 화면이 한 목록에서 탭 전환. 내부는 그대로 둬도 됨 |
| `GET /meetings/{id}` 가 상태만 반환 | **회의록 본문 추가** — 회의록 화면 전체가 여기 의존 |
| `/meetings/notes` 가 텍스트 업로드 | 텍스트용이면 **1차 미사용** — 직접 업로드는 음성만 지원 |
| `decision` 의 `action` 이 `approve`/`edit`/`hold` | **`reject` 추가** — 화면 액션은 `승인`·`반려` |
| `checkin-rules` 의 `days: 3` | **72시간 단위로** |
| `/proposals` `/tasks` `/checkins` `/checkin-rules` | **워크스페이스 스코프 추가** — 전환 시 다른 워크스페이스 데이터가 섞임 |
| 목록 응답이 배열 직결 | **`total` 포함** — 목록엔 5개만 보여도 숫자는 전체 개수 |
| `assignee` 가 문자열 `"재환"` | **member ID** — 동명이인·이름 변경·비활성 팀원을 표현할 수 없음 |
| `blocker` 가 문자열 | **태스크 상태로** — `막힌 일` 집계가 상태 기반 |
| `POST /changes/poll` 이 `job_id` 반환 | **job 상태 조회 경로** — 202를 받고 폴링할 곳이 없음 |

---

## 먼저 확인할 것

`POST /meetings`, `/extractions`, `/approvals`가 이미 돌아간다. **`/proposals`가 `/approvals`의 새 이름인지, 이 명세가 교체인지 추가인지.** 여기부터 정해야 나머지가 풀린다.

JWT를 쓴다면 **만료를 짧게 두거나 무효화 목록이 필요하다.** 만료 전 무효화가 안 되면 로그아웃과 PM 권한 회수가 반영되지 않는다.
