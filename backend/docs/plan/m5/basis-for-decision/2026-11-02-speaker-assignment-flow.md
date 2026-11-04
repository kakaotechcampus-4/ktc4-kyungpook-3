# 업로드 회의 화자 지정은 meeting_upload 컬럼과 AI 목록 조회·재개, PM 원본 재생으로 구현한다

- 기록일: 2026-11-02 (이슈 #266, BE↔AI 논의 #255, FE 요청 #256. AI 와는 #255 에서, FE 와는 #256 에서 방향을 합의했다. 지정 후보를 참석자로 제한할지는 아직 정하지 않았다)
- 관련 마일스톤: M5

## 문제와 제약

- 수동 업로드 회의는 AI 가 화자를 나눈 뒤 PM 이 라벨마다 팀원을 지정해야 다음 단계로 간다. 상태 `awaiting_speakers` 와 동시 처리 제한에서 뺀 이유는 [앞선 결정](2026-11-02-awaiting-speakers-status.md)에 있다.
- 이 결정은 그 위의 흐름을 다룬다. AI 가 라벨을 보내고, PM 이 지정하고, AI 가 결과를 가져가 처리를 이어 가고, PM 이 지정하려고 원본을 듣는 흐름이다.
- AI 와는 #255 에서 합의됐다(`backend-ai-contract.md` 의 "합의됨(#255)"). FE 는 #256 에서 원본 + 구간 재생, 같은 멤버 다중 지정 허용, 외부 참석자(`null`) 선택지를 받아들였다(2026-11-03, 정리는 2026-11-04). 지정 후보를 참석자로 제한할지와 부분 지정 화면은 FE 가 아직 답하지 않았다.
- 지금 AI 는 BE 를 폴링하는 구조(`/uploads/pending`, 녹음 내려받기)다.
- 녹음은 회의 폴더(`UPLOAD_DIR/{meeting_id}/`)에 있고, 처리가 `done`·`failed` 로 끝나면 폴더가 지워진다.
- 상태 전이는 동시에 들어올 수 있는 요청에서 한 번만 일어나야 한다.

## 실제 검토한 선택지

설계 초안(designer)에서 비교하고 사용자가 추천대로 승인한 것이다.

라벨·샘플·지정 결과를 둘 곳

- A. `meeting_upload` 에 nullable 컬럼(`speakers`·`speaker_mapping` JSON Text 2개와 시각 3개).
- B. 새 테이블 `meeting_upload_speaker`(회의·라벨마다 한 행, 멤버 FK).

AI 가 지정 결과를 받는 방식

- A. 지정 완료 목록 `GET /uploads/assigned` 와 `PATCH /uploads/{id}/resume`(기존 pending/claim 패턴).
- B. 회의별 조회 하나(`GET /uploads/{id}/speakers`).

샘플 오디오

- A. BE 가 원본을 PM 세션으로 Range 지원과 함께 내려 주고, FE 가 `samples` 의 start·end 구간만 재생한다.
- B. BE 가 구간을 잘라 준다.
- C. AI 가 샘플 파일을 올린다.

새 에러 코드

- 새 코드 4개(`UPLOAD_NOT_CLAIMED`, `SPEAKERS_ALREADY_REPORTED`, `MEETING_NOT_AWAITING_SPEAKERS`, `SPEAKERS_NOT_ASSIGNED`)를 둔다.
- 코드를 줄이는 안: `UPLOAD_NOT_CLAIMED`·`SPEAKERS_ALREADY_REPORTED` 를 `MEETING_NOT_PROCESSING` + `details.reason` 으로 대신한다(설계 초안에 있었다).

정리 시점

- sweeper(대기 만료 정리)를 이번에 만들지, 미룰지.

지정 제출의 규칙(일부 라벨만 지정 금지, 같은 멤버 두 라벨 허용, 같은 mapping 재제출을 검증보다 먼저 판정해 200)은 대안 검토 기록 없음, BE 기본값이다.

## 선택과 이유

- **AI 는 #255, FE 는 #256 합의대로 진행한다.** 아직 답이 없는 지정 후보 제한은 BE 기본값(아래 지정 제출의 규칙)으로 두고, 정해지면 다시 본다.
- **저장은 A(컬럼).** `attendees` 를 JSON Text 로 둔 선례와 같고 nullable 컬럼만 더하면 된다. 지정 결과는 한 번에 쓰고 한 번에 읽는다. B 는 라벨마다 행과 멤버 FK 가 있지만, `null`(외부 참석자)과 미지정을 가를 assigned 플래그가 따로 필요하고, upsert·조인·재전송 비교 코드가 늘며, 상태 시각은 어차피 `meeting_upload` 에 둬야 한다.
- **AI 방식은 A(목록과 재개).** `resumed_at` 은 조건부 UPDATE 로 한 번만 채우고, 이미 가져갔어도 회의가 processing 이면 같은 mapping 으로 200 을 다시 준다(응답을 잃은 AI 가 mapping 을 다시 얻을 수 있게 #269 리뷰에서 정했다). 그래서 같은 회의를 두 번 처리하지 않는 책임은 AI 쪽에 있다. 이 책임을 AI 가 받아들였는지는 #255 에서 확인된 적이 없어 확인이 필요하다. B 는 경로가 하나라 단순하지만 AI 가 어떤 회의를 기다리는지 직접 기억해야 하고, 재시작하면 찾을 방법이 없다. 두 번 처리 방지는 A 도 AI 몫이라 이 점은 둘의 차이가 아니다.
- **샘플 오디오는 A(원본 재생).** `GET /meetings/{id}/audio` 하나이고 Range 는 starlette `FileResponse` 가 처리한다(테스트에서 `Range: bytes=0-99` 에 206·`Content-Range`·100바이트 확인). 재생 응답의 Content-Type 은 클라이언트가 올린 값(검증 없이 저장됨)이 아니라 저장한 확장자로 정한 audio/* 허용 목록 값이고(목록 밖은 octet-stream), `nosniff` 와 `no-store` 헤더를 붙인다. 파일 앞 12바이트만 검사해 `text/html` 로 올린 파일이 API 출처에서 열릴 수 있기 때문이다. B 는 BE 이미지에 ffmpeg 같은 오디오 도구가 없다. C 는 저장 공간과 API 가 더 필요하다(#255 에 BE 입장으로 적음).
- **새 코드 4개를 둔다.** 모두 409 이고 `details.status` 를 담는다. `SPEAKERS_NOT_ASSIGNED` 를 따로 둔 이유는 resume 에서 "대기 중이지만 아직 지정 전"에 `MEETING_NOT_AWAITING_SPEAKERS` 를 쓰면 이름의 뜻이 반대가 되기 때문이다. 코드를 줄이는 안은 의미가 흐려져 쓰지 않았다.
- **sweeper 는 이번에 하지 않는다.** 대기 만료 TTL 이 pyannoteAI 결과 24시간 보관과 AI 가 분리 결과를 자체 저장하는지에 달려 있었다. AI 는 #255 에서 분리 결과를 바로 매니페스트·`diarization.json` 에 저장해 대기가 24시간 보관에 묶이지 않는다고 답했다(2026-11-02). sweeper 는 #301 에서 따로 정한다. 그동안은 실패 보고(`PATCH /meetings/{id}/fail`)로 푼다(#255 에 적음). 대기 상태에서도 그 보고가 된다.
- **지정 제출의 규칙은 BE 기본값이다.** 보고된 라벨 전부가 키에 있어야 하고(지정하지 않을 라벨은 `null`, 모르는 라벨은 `details.unknown_labels`, 빠진 라벨은 `details.missing_labels` 로 400), 같은 멤버를 두 라벨에 지정하는 것은 허용한다. 이미 저장된 것과 같은 mapping 의 재제출은 검증보다 먼저 판정해 현재 상태로 200 을 준다. 요청이 겹치거나 응답이 유실돼도 안전하고, 그 사이 멤버가 탈퇴해도 같은 요청이 400 으로 바뀌지 않는다. 다른 mapping 이면 409 다. 같은 멤버 다중 지정 허용과 `null`(외부 참석자)은 #256 에서 FE 가 받아들였다. 모든 라벨 지정은 AI 입장(#255)과 같다. 지정 후보를 참석자로 제한할지는 FE 답이 없어, 지금은 워크스페이스의 탈퇴하지 않은 멤버면 받는다.

## 장단점과 감수한 제약

- 컬럼 방식은 멤버 FK 무결성이 없다. 다만 멤버 삭제가 soft delete(`is_deleted`)라 FK 가 있어도 삭제를 잡지 못해 어차피 제출 시점에 검사한다. 라벨·지정은 JSON 텍스트라 DB 에서 조건 검색이 안 되고 서비스에서 통째로 읽고 쓴다.
- 목록과 재개 방식은 경로가 2개 늘고, 응답을 잃은 재시도는 resume 이 같은 mapping 으로 200 을 다시 줘서 풀지만, 두 번 처리 방지는 AI 가 해야 한다.
- 원본 재생은 FE 가 구간 재생을 구현해야 하고, 브라우저별 m4a·webm 재생과 Range 실사용은 FE 에서 확인해야 한다. 폴더가 지워지면(`done`·`failed`) 재생은 404 이고, 화자 조회의 `audio` 는 null 이라 FE 가 "회의 없음"과 가를 수 있다(#270 리뷰).
- 화자 조회의 후보는 업로드 때 고른 참석자 중 제출이 받는 멤버(이 워크스페이스의 탈퇴하지 않은 멤버)만 준다. 조회와 제출이 같은 기준이라 고르면 400 이 되는 후보가 보이지 않는다(#270 리뷰).
- sweeper 가 없어서 PM 이 지정하지 않는 대기 회의는 남는다. 정리는 실패 보고로 하며 자동은 아니다.
- 지정이 한 번 저장되면 다른 지정으로 고칠 수 없다(409).
- sqlite 테스트로 PostgreSQL 동시성은 볼 수 없다. 동시 제출 테스트는 `TEST_DATABASE_URL` 이 있을 때만 돈다.

## 영향 범위와 재검토 조건

- 영향: `meeting_upload` 컬럼 5개와 마이그레이션, 에러 코드 4개, AI 경로 3개(`POST /uploads/{id}/speakers`, `GET /uploads/assigned`, `PATCH /uploads/{id}/resume`), PM 경로 3개(`GET`·`PUT /meetings/{id}/speakers`, `GET /meetings/{id}/audio`), [speaker_assignment.py](../../../../app/services/speaker_assignment.py).
- FE 가 지정 후보를 참석자로 제한하기로 하면 조회 후보와 제출 검증을 함께 바꾼다. 그 밖에 AI·FE 가 경로·필드·제출 규칙을 바꾸면 해당 항목을 다시 본다.
- sweeper 는 #301 에서 정한다(AI 의 답은 위 sweeper 항목). 대기 회의가 방치돼 쌓이는 일이 실제로 생기면 다시 본다.
- 처리가 끝난 뒤에도 원본을 들어야 하는 요구가 생기면 폴더 삭제 시점을 다시 본다.
- FE 가 `awaiting_speakers` 를 표시·추적하기 전에는 이 상태를 만드는 AI 경로를 운영에 켜지 않는다(앞선 결정의 조건과 같다).

## 근거와 관련 문서

- 이슈 #266, #255, #256
- 앞선 결정: [awaiting_speakers 상태](2026-11-02-awaiting-speakers-status.md), [업로드 회의는 처음부터 processing](2026-10-14-upload-claim.md)
- 코드: [uploads.py](../../../../app/api/uploads.py), [meetings.py](../../../../app/api/meetings.py), [speaker_assignment.py](../../../../app/services/speaker_assignment.py)
- 테스트: [test_speaker_assignment_api.py](../../../../tests/api/test_speaker_assignment_api.py), [test_uploads_api.py](../../../../tests/api/test_uploads_api.py)
- 계약: [backend-ai-contract.md](../../../contracts/backend-ai-contract.md), [frontend-api-contract.md](../../../../../frontend/docs/contracts/frontend-api-contract.md) §2.3.1
