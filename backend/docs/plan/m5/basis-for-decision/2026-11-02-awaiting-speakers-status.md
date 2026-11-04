# 업로드 회의의 화자 지정 대기는 새 상태 awaiting_speakers 로 두고, 동시 처리 제한에서 뺀다

- 기록일: 2026-11-02 (이슈 #266, BE↔AI 논의 #255, FE 요청 #256. AI·FE 합의 전의 BE 입장이다)
- 관련 마일스톤: M5

## 문제와 제약

- 수동 업로드 회의는 AI 가 화자를 나눈 뒤 PM 이 "이 목소리가 누구인지"를 지정해야 다음 단계로 간다(#255).
- 업로드 회의는 처음부터 `processing` 이고(앞선 [결정](2026-10-14-upload-claim.md)), 같은 공간에 `processing` 회의가 있으면 다음 업로드는 409 다(D-088).
- PM 이 지정할 때까지 회의가 `processing` 으로 남으면 그동안 그 공간의 다른 업로드가 모두 막힌다.
- 추출 등록은 회의가 `processing` 일 때만 받는다(조건부 UPDATE). 회의 종료(`PATCH /meetings/{id}/end`)는 `processing`·`done`·`failed` 인 회의를 409 로 거절한다.
- 프론트는 모르는 상태 값을 `created`("Discord 녹음 중")로 읽는다. 새 상태를 쓰는 API 가 생기기 전에는 이 상태의 회의가 만들어지지 않는다.
- `meeting.status` 컬럼은 `String(16)` 인데 `awaiting_speakers` 는 17자다. sqlite 테스트는 길이를 검사하지 않아 통과하고 PostgreSQL 에서만 저장이 실패한다.
- AI 와 FE 의 합의가 아직 없어서 경로와 필드 이름은 바뀔 수 있다.

## 실제 검토한 선택지

대기를 나타내는 방법

1. 회의를 계속 `processing` 으로 두고 `meeting_upload` 에 대기 여부를 따로 기록하기.
2. 새 회의 상태를 두고 동시 처리 제한(`status == processing` 검사)에서 빼기.

새 상태 이름과 컬럼 폭

1. 이름을 `awaiting_speakers` 로 유지하고 `meeting.status` 를 `String(32)` 로 넓히기.
2. 16자 이하 이름으로 바꾸기(예: `awaiting_speaker`). 이름이 #255 논의에 이미 나와 있어 AI·FE 와 다시 정해야 한다.

대기 중 같은 공간의 새 업로드

1. 허용하고 대기 회의 수 상한을 두지 않기.
2. 지정 제출 때 다른 `processing` 회의가 있으면 409 로 막기.

## 선택과 이유

- **새 상태를 두고 제한에서 뺀다.** 1 은 `processing` 에 갇힌 공간을 풀지 못한다. 2 는 기존 업로드 409 검사가 `processing` 만 보므로 코드 변경 없이 대기 회의가 제한에서 빠진다.
- **이름은 유지하고 컬럼을 넓힌다.** 마이그레이션이 어차피 필요하고, PostgreSQL 에서 varchar 길이를 늘리는 것은 테이블을 다시 쓰지 않는다. 이름을 바꾸면 합의를 다시 해야 한다. 새 상태를 쓰는 코드는 이 마이그레이션 뒤에 배포한다.
- **종료 API 의 상태 집합에 새 상태를 넣는다.** 넣지 않으면 대기 중인 회의에 `/end` 가 와서 `processing` 으로 돌아가 PM 의 지정을 건너뛴다(테스트로 고정).
- **대기 중 새 업로드는 허용한다.** 2 는 PM 이 기다려야 해서 UX 가 나쁘다.

## 장단점과 감수한 제약

- 지정을 제출하면 회의가 `processing` 으로 돌아가는데, 그 사이 같은 공간에 다른 업로드가 `processing` 이면 처리 중 회의가 둘이 된다. D-088 의 "공간마다 처리 하나"가 약해진다. 업로드 409 와 프론트 리다이렉트는 `.first()` 한 건으로 간다.
- 대기 회의 수에 상한이 없다.
- 이 변경만으로는 이 상태로 바꾸는 API 가 없어 운영 화면에 영향이 없다. 라벨 전달(AI)·지정(PM) API 는 합의 뒤 별도 변경으로 한다.
- 마이그레이션 downgrade 는 `awaiting_speakers` 행을 `processing` 으로 되돌린 뒤 컬럼을 줄인다.

## 영향 범위와 재검토 조건

- 영향: `MeetingStatus`, `meeting.status` 컬럼, 회의 종료 API, 마이그레이션 1개.
- 대기 회의가 둘 이상 쌓이거나 제출 뒤 처리 중 회의가 둘이 되는 일이 실제로 문제가 되면 "대기 중 같은 공간의 새 업로드"의 선택지 2(제출 때 막기)를 다시 본다.
- 프론트가 `awaiting_speakers` 를 표시·추적하게 되기 전에는(#256) 이 상태를 만드는 API 를 운영에 켜지 않는다.

## 근거와 관련 문서

- 이슈 #266, #255, #256
- 앞선 결정: [업로드 회의는 처음부터 processing](2026-10-14-upload-claim.md)
- 코드: [models.py](../../../../app/models/models.py) `MeetingStatus`, [meetings.py](../../../../app/api/meetings.py) `_ENDED_STATUSES`, [마이그레이션](../../../../migrations/versions/2862514e7dbd_widen_meeting_status.py)
- 테스트: [test_uploads_api.py](../../../../tests/api/test_uploads_api.py), [test_meeting_upload.py](../../../../tests/api/test_meeting_upload.py)
