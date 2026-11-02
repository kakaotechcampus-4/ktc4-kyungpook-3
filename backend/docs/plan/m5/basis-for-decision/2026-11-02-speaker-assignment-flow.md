# 업로드 회의 화자 지정은 meeting_upload 컬럼과 AI 목록 조회·재개, PM 원본 재생으로 구현한다

- 기록일: 2026-11-02 (이슈 #266, BE↔AI 논의 #255, FE 요청 #256. AI·FE 합의 전의 BE 입장이다)
- 관련 마일스톤: M5

## 문제와 제약

- 수동 업로드 회의는 AI 가 화자를 나눈 뒤 PM 이 라벨마다 팀원을 지정해야 다음 단계로 간다. 상태 `awaiting_speakers` 와 동시 처리 제한에서 뺀 이유는 [앞선 결정](2026-11-02-awaiting-speakers-status.md)에 있다.
- 이 결정은 그 위의 흐름을 다룬다. AI 가 라벨을 보내고, PM 이 지정하고, AI 가 결과를 가져가 처리를 이어 가고, PM 이 지정하려고 원본을 듣는 흐름이다.
- AI·FE 와 합의가 아직 없어서 경로와 필드는 바뀔 수 있다.
- AI 가 가져가는 쪽은 BE 에서 AI 로 푸시하는 경로가 없다. 지금 AI 는 BE 를 폴링하는 구조(`/uploads/pending`, 녹음 내려받기)다.
- 녹음은 회의 폴더(`UPLOAD_DIR/{meeting_id}/`)에 있고, 처리가 `done`·`failed` 로 끝나면 폴더가 지워진다.
- 상태 전이는 동시에 들어올 수 있는 요청에서 한 번만 일어나야 한다.

## 실제 검토한 선택지

이 세션에서 비교한 것만 적는다. 이유가 기록으로 남지 않은 항목은 그렇게 표시한다.

저장 위치

1. `meeting_upload` 에 nullable 컬럼 5개(`speakers`, `speaker_mapping`, `speakers_reported_at`, `speakers_assigned_at`, `resumed_at`)를 추가한다.
2. 화자 지정을 위한 새 테이블을 둔다.

AI 가 지정 결과를 받는 방식

1. 지정이 끝나 아직 다시 가져가지 않은 회의를 한 번에 보는 목록(`GET /uploads/assigned`)과 가져갔다는 표시(`PATCH /uploads/{id}/resume`).
2. 회의마다 지정 결과를 조회한다.

PM 이 들을 소리

1. 원본 녹음을 그대로 내려 주고 `samples` 의 시작·끝(초)으로 프론트가 구간을 찾아 듣게 한다. 서버는 구간을 자르지 않는다.
2. BE 가 구간을 잘라 준다.
3. AI 가 샘플 오디오를 업로드한다.

정리 시점

1. 대기가 길어진 회의를 정리하는 sweeper 를 이번에 만든다.
2. 이번에는 만들지 않는다.

에러 코드

1. 기존 코드만 쓴다.
2. 새 코드 4개(`UPLOAD_NOT_CLAIMED`, `SPEAKERS_ALREADY_REPORTED`, `MEETING_NOT_AWAITING_SPEAKERS`, `SPEAKERS_NOT_ASSIGNED`)를 둔다. 이 중 `SPEAKERS_NOT_ASSIGNED` 는 `MEETING_NOT_AWAITING_SPEAKERS` 와 따로 둔다.

지정 제출의 규칙

1. 일부 라벨만 지정해서 제출하는 것을 허용한다.
2. 보고된 라벨 전부가 키에 있어야 하고, 지정하지 않을 라벨은 `null` 로 적게 한다.
3. 같은 멤버를 두 라벨에 지정하는 것을 허용한다.
4. 같은 멤버를 두 라벨에 지정하는 것을 막는다.
5. 이미 저장된 것과 같은 `mapping` 의 재제출을 검증보다 먼저 판정해 200(멱등)으로 답한다.
6. 같은 재제출도 검증을 거친 뒤에 판정한다.

## 선택과 이유

- **컬럼 5개를 `meeting_upload` 에 둔다(저장 위치 1).** 새 테이블 없이 업로드 한 건당 라벨·지정·시각이 한 행에 모인다. 새 테이블을 선택하지 않은 이유는 설계 문서에 한 줄로만 남아 있고(새 테이블 없음) 비교 근거는 기록이 없다. 대안 검토 기록 없음.
- **목록과 다시 가져가기(재개)로 한다(AI 방식 1).** 서비스 토큰으로 DB 만 읽는 목록이어서 AI 가 폴링하기 쉽고, `resumed_at` 을 조건부 UPDATE 로 한 번만 채워 같은 회의를 두 번 이어 가지 못하게 한다(두 번째 호출은 409 `MEETING_PROCESSING_IN_PROGRESS`). 회의별 조회를 선택하지 않은 이유의 근거는 기록이 없다. 대안 검토 기록 없음.
- **원본을 그대로 재생하게 한다(소리 1).** 서버가 새로 만드는 것이 `GET /meetings/{id}/audio` 하나이고 Range 는 starlette `FileResponse` 가 처리한다(테스트에서 `Range: bytes=0-99` 에 206·`Content-Range`·정확히 100바이트 확인). 구간 자르기와 샘플 업로드를 선택하지 않은 이유의 근거는 기록이 없다. 대안 검토 기록 없음.
- **sweeper 는 이번에 하지 않는다(정리 2).** 이 이슈의 범위로 정하지 않았다. AI 경로가 없거나 지정이 멈춘 회의는 실패 보고(`PATCH /meetings/{id}/fail`)로 풀고, 대기 상태에서도 그 보고가 된다(테스트 있음).
- **새 코드 4개를 둔다. `SPEAKERS_NOT_ASSIGNED` 는 따로 둔다.** 네 코드는 모두 409 이고 `details.status` 에 그 시점의 회의 상태를 담는다. `MEETING_NOT_AWAITING_SPEAKERS` 는 PM 이 지정을 내는 쪽의 "대기 상태가 아니다"이고, `SPEAKERS_NOT_ASSIGNED` 는 AI 가 재개하려는데 PM 이 아직 지정하지 않았다는 반대 방향의 거절이다. 방향이 달라 나눴다. 기존 코드만 쓰는 방안을 따로 비교한 기록은 없다. 대안 검토 기록 없음.
- **보고된 라벨 전부가 키에 있어야 한다. 일부만 지정해서 제출하는 것은 막는다.** 지정하지 않을 라벨은 `null` 이다. 모르는 라벨은 `details.unknown_labels`, 빠진 라벨은 `details.missing_labels` 로 400 이다. 검증에 실패하면 상태와 컬럼 모두 바뀌지 않는다. 일부만 허용하는 방안과의 비교 기록은 없다. 대안 검토 기록 없음.
- **같은 멤버를 두 라벨에 지정하는 것은 허용한다.** 허용 이유와 막는 방안과의 비교는 기록이 없다. 대안 검토 기록 없음.
- **같은 `mapping` 의 재제출은 검증보다 먼저 판정해 200 으로 답한다.** 이미 저장된 지정과 같으면 대기 상태 검사·라벨·멤버 검증을 건너뛰고 현재 상태로 200 을 준다. 요청이 겹치거나 응답이 유실돼도 안전하다. 사이에 멤버가 탈퇴해도 같은 요청이 400 으로 바뀌지 않는다. 다른 `mapping` 이면 409 다.

## 장단점과 감수한 제약

- 컬럼이 늘어 `meeting_upload` 가 넓어지고, 라벨·지정은 JSON 텍스트라서 DB 에서 조건 검색이 안 된다. 읽기·쓰기는 서비스에서 항상 통째로 한다.
- 원본 재생은 서버가 구간을 자르지 않으므로 프론트가 `samples` 의 위치로 이동해 들려줘야 한다. 긴 녹음은 Range 로 받는다.
- 녹음 폴더가 지워지면(`done`·`failed`) 재생은 404 다. 처리가 끝난 회의에서는 원본을 다시 들을 수 없다.
- sweeper 가 없어서 PM 이 지정하지 않는 대기 회의는 남는다. 정리는 실패 보고로 하며 자동은 아니다.
- 지정 제출이 잘못된 지정이어도 한 번 저장되면 다른 지정으로 고칠 수 없다(409). 고치는 경로는 없다.
- sqlite 테스트로 PostgreSQL 동시성은 볼 수 없다. 동시 제출 테스트는 `TEST_DATABASE_URL` 이 있을 때만 돈다.

## 영향 범위와 재검토 조건

- 영향: `meeting_upload` 컬럼 5개와 마이그레이션, 에러 코드 4개, AI 경로 3개(`POST /uploads/{id}/speakers`, `GET /uploads/assigned`, `PATCH /uploads/{id}/resume`), PM 경로 3개(`GET`·`PUT /meetings/{id}/speakers`, `GET /meetings/{id}/audio`), [speaker_assignment.py](../../../../app/services/speaker_assignment.py).
- AI 나 FE 가 합의 과정에서 경로·필드를 바꾸면 이 결정의 해당 항목을 다시 본다.
- 대기 회의가 방치돼 쌓이는 일이 실제로 생기면 sweeper 를 다시 본다.
- 처리가 끝난 뒤에도 원본을 들어야 하는 요구가 생기면 폴더 삭제 시점을 다시 본다.
- FE 가 `awaiting_speakers` 를 표시·추적하기 전에는 이 상태를 만드는 AI 경로를 운영에 켜지 않는다(앞선 결정의 조건과 같다).

## 근거와 관련 문서

- 이슈 #266, #255, #256
- 앞선 결정: [awaiting_speakers 상태](2026-11-02-awaiting-speakers-status.md), [업로드 회의는 처음부터 processing](2026-10-14-upload-claim.md)
- 코드: [uploads.py](../../../../app/api/uploads.py), [meetings.py](../../../../app/api/meetings.py), [speaker_assignment.py](../../../../app/services/speaker_assignment.py)
- 테스트: [test_speaker_assignment_api.py](../../../../tests/api/test_speaker_assignment_api.py), [test_uploads_api.py](../../../../tests/api/test_uploads_api.py)
- 계약: [backend-ai-contract.md](../../../contracts/backend-ai-contract.md), [frontend-api-contract.md](../../../../../frontend/docs/contracts/frontend-api-contract.md) §2.3.1
