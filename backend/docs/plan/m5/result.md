# 마일스톤 구현 결과

## 작업 근거와 요약

M5 plan.md 는 비어 있다. 이번 작업은 이슈 #219(녹음 업로드 파일 저장과 AI 전달 API)를 근거로 했다. 범위는 사용자와 정한 "백엔드에서 할 수 있는 일을 먼저 끝내고 AI 에 형식을 넘긴다"이다. 전체 계획 M5(웹 음성 업로드·비동기 처리)의 파일 저장·AI 전달·참석자 검증·용량과 형식 검증·임시 파일 정리에 해당한다.

1. 업로드 API(`POST /workspaces/{id}/meetings/upload`)가 녹음을 서버 디스크에 원본 그대로 저장하고, 참석자와 파일 정보를 새 테이블 `meeting_upload` 에 남긴 뒤 회의를 `processing` 으로 만든다(이전 스텁과 같은 상태).
2. AI 가 서비스 토큰으로 대기 목록을 읽고, 회의를 가져가고(`meeting_upload.claimed_at` 기록), 녹음을 받는 API 세 개를 만들었다. 결과 보고는 기존 `/sources`·`/extractions`·`/fail` 을 그대로 쓴다.
3. 업로드 회의가 done·failed 가 되면 녹음 폴더를 지운다.
4. 운영 compose 에 업로드 볼륨을 붙였다.

AI 쪽 업로드 처리 경로가 없으므로 M5 완료는 판정하지 않는다.

## 실제 구현 및 관련 코드

| 변경 | 위치 |
|---|---|
| `meeting_upload`: 업로드 회의마다 한 행. 저장 파일명, 원래 파일명, 크기, 형식, 올린 사람, 업로드 시각, 참석자(JSON), AI 가 가져간 시각(`claimed_at`). 새 테이블만 추가하는 마이그레이션 | [models.py](../../../app/models/models.py) `MeetingUpload`, [마이그레이션](../../../migrations/versions/bd244dd27629_add_meeting_upload.py) |
| 업로드: 제목 200자 제한(400), 참석자 `list[str]` 로 받기, 현재 팀원인지 확인(아니면 400), 형식(422)·용량(413) 검사, 녹음 저장(그동안 DB 연결은 풀에 돌려준다) → 워크스페이스 행을 잠그고 처리 중 회의를 다시 확인 → `meeting`·`meeting_upload` 를 한 번에 커밋, 상태 `processing`(같은 공간의 다음 업로드는 끝날 때까지 409, 동시에 온 업로드도 하나만 받음). 저장 실패는 422 `AUDIO_UPLOAD_FAILED`, 커밋 실패는 녹음 폴더를 지운다 | [workspaces.py](../../../app/api/workspaces.py) `upload_meeting` |
| 녹음 저장: `UPLOAD_DIR/{meeting_id}/audio.<확장자>`. 확장자는 원래 파일명에서 영문 소문자·숫자만 쓴다. 형식은 확장자 다섯 개와 파일 첫 바이트로 확인한다. `UPLOAD_DIR` 기본값은 실행 위치와 상관없이 `backend/uploads` | [upload_storage.py](../../../app/services/upload_storage.py) |
| AI 가져가기: `GET /uploads/pending`(DB 만 읽음, `processing` 이고 아직 안 가져간 업로드), `PATCH /uploads/{id}/claim`(`claimed_at` 이 비었을 때만 조건부 UPDATE), `GET /uploads/{id}/file` | [uploads.py](../../../app/api/uploads.py), [upload.py](../../../app/schemas/upload.py) |
| 회의가 done(추출 등록)·failed(실패 보고)가 되면 커밋 뒤 업로드 폴더 삭제. 삭제 실패는 경고 로그만 | [extractions.py](../../../app/api/extractions.py), [meetings.py](../../../app/api/meetings.py) |
| 운영: 이미지에 `/data/uploads`(소유자 mm)와 기본 `UPLOAD_DIR`, compose 에 `UPLOAD_DIR` 과 `uploads` 볼륨, env 예시 | [Dockerfile](../../../Dockerfile), [docker-compose.prod.yml](../../../docker-compose.prod.yml), [.env.example](../../../.env.example) |
| 테스트가 업로드를 임시 폴더에 쓰게 하는 공통 설정 | [conftest.py](../../../tests/conftest.py) |
| 계약 | [BE↔AI 계약 웹 업로드 가져가기](../../contracts/backend-ai-contract.md#웹-업로드-가져가기). 웹 업로드 API 는 [프론트엔드 대표 계약](../../../../frontend/docs/contracts/frontend-api-contract.md)이 관리하므로 고치지 않았다. 바뀐 점은 아래 "다른 파트에 알릴 것"으로 전한다 |

## 완료조건 확인

plan.md 가 비어 있어 완료조건이 없다. 아래는 전체 계획 M5 의 세부 항목과 완료 기준에 이번 작업을 대조한 것이다.

| 전체 계획 M5 항목 | 상태 | 근거 |
|---|---|---|
| multipart 업로드 경로·202 응답 | 구현 | 202 `{meeting_id, status: "processing"}`. pytest, 로컬 운영 compose |
| 파일 저장·AI 전달 | BE 구현, AI 미구현 | 저장과 가져가기 API 는 pytest·로컬 운영 compose 로 확인. AI 가 부르는 코드는 없다 |
| 참석자 파싱·소속 검증·저장 | 일부 | 파싱·검증·저장(`meeting_upload.attendees`) 구현. 회의록 참석자와 `attendee_count` 는 아직 이를 읽지 않는다 |
| 용량·길이·형식 검증 | 일부 | 용량 100MiB 와 형식 구현. 길이는 검사하지 않는다 |
| 처리 중 회의 검사(원자적) | 업로드 경로는 구현 | 녹음을 저장한 뒤 커밋 직전에 워크스페이스 행을 잠그고(`FOR UPDATE`) 다시 확인한다. 로컬 운영 compose 에서 동시 업로드로 처리 중 회의가 둘 생기는 것을 재현한 뒤 고쳤고, PostgreSQL 동시 업로드 테스트로 확인했다. Discord `/end` 는 막지 않는다 |
| Notion 연결 차단 | 하지 않기로 함 | 아래 계획 대비 변경 |
| 업로드 작업 복구·임시 파일 정리 | 일부 | 끝난 회의의 파일 삭제만. 멈춘 회의 정리(sweeper)는 보류 |
| 완료 기준: 웹 업로드가 영구 `processing` 에 머무르지 않고 성공 또는 실패로 끝나며, 이후 업로드가 가능하다 | 미충족 | AI 경로가 없어 업로드 회의가 `processing` 에서 끝나지 않고 그 공간의 업로드가 409 로 막힌다. 멈춘 회의를 자동으로 끝내는 장치도 없다. 손으로는 실패 보고 API 로 풀 수 있다(로컬 운영 compose 에서 확인) |

## 검증 내역

- 2026-10-14 로컬 `pytest -q -rs`, `TEST_DATABASE_URL`(pgvector pg16 `mm_test`) 지정, develop(`1b850c3`) 기준: 907 passed, 1 skipped(SQLite FOR UPDATE 미지원으로 원래 건너뛰는 테스트). 업로드 관련 테스트는 [test_meeting_upload.py](../../../tests/api/test_meeting_upload.py), [test_uploads_api.py](../../../tests/api/test_uploads_api.py).
- 같은 시점 `uvx ruff@0.14.0 check .`(CI 와 같은 버전): 통과.
- 동시 업로드: PostgreSQL 에서 두 요청이 모두 녹음 저장까지 마친 뒤 함께 커밋하도록 맞춘 테스트(`test_concurrent_uploads_to_one_workspace_accept_only_one`)가 202 하나·409 하나를 확인한다. 재확인 코드를 잠시 빼면 둘 다 202 가 되어 실패하는 것도 확인했다. 잠금을 넣은 뒤 로컬 운영 compose 는 다시 돌리지 않았다.
- 같은 시점 빈 `mm_test` 에 `alembic upgrade head` → `alembic check`(모델과 차이 없음) → `downgrade -1` → `upgrade head` → `alembic check`: 모두 정상.
- 2026-10-14 로컬 운영 compose 확인. `docker-compose.prod.yml` 을 그대로 쓰고 프로젝트 이름(`mm-prodtest`), 이미지 이름, 포트, `SERVICE_TOKEN`, 워커 끄기만 덮어쓴 구성으로 띄워 실제 HTTP 요청을 보냈다. 끝난 뒤 컨테이너·볼륨·이미지를 지웠다. 볼륨 권한, 재배포(`down` 뒤 `up -d --build`) 뒤 녹음·업로드 행 유지, 동시 업로드 8건의 메모리(최고 130MiB)는 같은 날과 2026-10-13 의 이전 구현(`created`·meta.json)으로 확인했고, 저장·볼륨 설정은 그 뒤 바뀌지 않았다.

| 확인 | 결과 |
|---|---|
| 기동 | 컨테이너가 마이그레이션(`bd244dd27629`, `claimed_at` 포함)을 올리고 health 정상 |
| 업로드(참석자 2명) | 202 `processing`. `ended_at`·`meeting_upload` 저장, `claimed_at` 비어 있음 |
| 같은 공간 두 번째 업로드 | 409 `MEETING_PROCESSING_IN_PROGRESS`, `details.meeting_id` 는 처리 중 회의 |
| 100MiB / 100MiB+1 | 202 / 413 `AUDIO_TOO_LARGE` |
| 대기 목록 | 업로드 순서대로, claim 한 회의는 빠짐 |
| claim | 첫 번째 200(`claimed_at` 채워짐), 두 번째 409 |
| 100MiB 받기 | 원본과 SHA-256 같음 |
| 실패 보고로 막힌 공간 풀기 | 200, 폴더 삭제, 그 공간에 다시 업로드 202 |
| 추출 등록 | 201, 폴더 삭제 |
| 100MiB 동시 업로드 6건(같은 공간 2건 포함) | 모두 202. 같은 공간의 2건이 둘 다 받아져 처리 중 회의가 둘이 됐다. 이 결과로 커밋 직전 잠금·재확인을 넣었다(아래) |

## 계획 대비 변경

- **"AI 가 가져갔다"를 회의 상태가 아니라 `meeting_upload.claimed_at` 에 둔다.** 처음에는 AI 가 없어도 공간이 막히지 않게 업로드를 `created` 로 두고 claim 때 `processing` 으로 바꿨다. 리뷰에서 프론트가 `created` 를 "Discord 녹음 중"으로 다뤄 처리 추적 중단, 응답을 잃었을 때 중복 업로드, "회의 중" 표시가 생긴다는 것이 드러나 처음부터 `processing` 으로 되돌렸다. 그래서 AI 경로가 생기기 전까지 업로드한 공간은 409 로 막힌다(이전 스텁과 같음). 자세한 이유는 결정 기록에 있다.
- **업로드 정보를 디스크의 meta.json 이 아니라 DB 테이블에 둔다.** 처음에는 기존 테이블을 바꾸지 않으려고 meta.json 에 두었다. `/code-review` 를 세 번 하는 동안 meta.json 이 없거나 깨졌거나 읽을 수 없을 때의 예외 지적이 매번 새로 나왔다. 대기 목록이 회의마다 디스크를 읽어야 했기 때문이다. 새 테이블을 추가하고(기존 테이블은 그대로) 디스크에는 녹음만 두었다.
- **Notion 연결 차단을 하지 않는다.** 전체 계획과 프론트 D-096(1차 임시 확정)은 Notion 미연결이면 업로드를 막는다. 사용자가 2026-10-13 "Notion 이 없어도 업로드되어야 한다"고 정했다. 프론트 결정 문서는 바꾸지 않았다.
- **동시 업로드는 워크스페이스 행 잠금으로 막는다.** 작업 시작 때는 다음으로 미뤘으나, 로컬 운영 compose 에서 재현되어 사용자가 이번에 넣기로 했다(2026-10-14). 녹음을 받기 전 409 검사는 그대로 두고, 녹음 저장 뒤 커밋 직전에 워크스페이스 행을 잠가 다시 확인한다. 잠금은 녹음을 저장하는 동안 걸지 않는다. DB 규칙(부분 유니크 인덱스)은 업로드 처리 중에 끝난 Discord 회의의 `/end` 를 실패시키므로 쓰지 않았다.
- **멈춘 회의 정리(sweeper)를 보류했다.** AI 가 업로드를 어떻게 가져갈지 정해지지 않았다. 그동안 막힌 공간은 실패 보고 API(`PATCH /meetings/{id}/fail`, 서비스 토큰)로 푼다.
- **길이 검사는 AI 에 넘긴다.** 백엔드 이미지에 오디오를 읽을 도구가 없다. AI 는 어차피 디코딩한다.
- **용량 한도는 전체 계획의 100MiB 를 따랐다.** 프론트 화면 한도(200MiB)와 다르다.

## 남은 작업과 제한 사항

- AI 업로드 처리 경로(대기 목록 → claim → 받기 → STT → 결과 보고). 그 전까지 운영에서 업로드한 회의는 `processing` 에 머물고 그 공간의 업로드는 409 다. 푸는 방법은 실패 보고 API 다.
- 멈춘 업로드 회의 정리(sweeper). `claimed_at`(가져간 지 오래됨)과 `ended_at`(업로드 뒤 아무도 안 가져감)으로 가릴 수 있다. 삭제에 실패한 폴더와 업로드 도중 서버가 죽어 남은 폴더도 지금은 직접 지워야 한다.
- 서버 Caddy 의 `/api/*` 요청 크기 제한. Caddy 는 기본 제한이 없고, FastAPI 는 인증 전에 본문을 다 읽는다. 그래서 로그인하지 않은 큰 요청도 끝까지 받은 뒤 거절한다. 업로드 전부터 있던 문제다.
- 참석자를 회의록에 쓰기(전체 계획 M3). 지금 업로드 회의의 회의록 참석자는 비고 `attendee_count` 는 0 이다.
- 운영 첫 배포 확인: 서버에서 `docker volume ls` 로 `mm-prod_uploads` 가 생겼는지, 웹에서 짧은 녹음을 올려 202 가 오는지.
- EC2 에서의 전송 속도는 확인하지 않았다.
- `/code-review` 에서 받고 이번에 고치지 않은 것: 디스크 오류도 422 `AUDIO_UPLOAD_FAILED`(사용자 잘못처럼 보이는 코드)로 응답한다(기존 오류 코드 정의와 프론트 계약을 따름). Discord 용 `/end` 는 같은 공간의 처리 중 회의를 보지 않는다(원래 있던 동작). claim 은 누가 가져갔는지 기록하지 않아 응답을 잃은 재시도가 409 를 받는다(계약에 처리 방법을 적었다). 파일 받기 중에 결과 보고로 폴더가 지워지면 500 이 날 수 있다(계약에 "보고 전에 받는다"고 적었다). 대기 목록은 녹음 파일이 있는지 보지 않는다(없으면 파일 받기가 404). 커밋은 됐는데 그 응답만 끊기면 녹음 폴더를 지워 녹음 없는 업로드 회의가 남을 수 있다(AI 가 파일 받기 404 를 받고 실패 보고로 끝낸다).

다른 파트에 알릴 것:

- 프론트: 업로드 응답 `status` 는 이전 스텁처럼 `processing`, 참석자 반복 필드를 모두 받고 공간 팀원이 아니면 400, 형식 422 `AUDIO_FORMAT_UNSUPPORTED`·용량 413 `AUDIO_TOO_LARGE`·저장 실패 422 `AUDIO_UPLOAD_FAILED`, 한도 200MiB → 100MiB 요청, 업로드 회의 참석자는 비어 보임, Notion 미연결이어도 서버는 업로드를 받음(D-096 과 다름).
- AI: [웹 업로드 가져가기](../../contracts/backend-ai-contract.md#웹-업로드-가져가기) 형식 공유와 합의. 업로드는 화자 분리 없이 Elice STT 로 처리하자는 방향을 BE 쪽에서 이야기했으나 AI 와 합의하지 않았다.

## 관련 기록

- [업로드 회의는 처음부터 processing 으로 두고, AI 가 가져간 것은 meeting_upload 에 기록한다](basis-for-decision/2026-10-14-upload-claim.md)
