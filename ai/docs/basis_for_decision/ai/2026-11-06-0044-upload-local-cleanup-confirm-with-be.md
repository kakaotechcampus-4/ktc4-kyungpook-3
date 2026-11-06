# 0044. 업로드 로컬 정리는 BE 가 끝났다고 답한 회의만 지우고, 포기·인계 완료·끝난 기록은 7일 보관 뒤 지운다

- 기록일: 2026-11-06 (사용자와 설계를 확정한 날과 같다)
- 관련 마일스톤: 별도 마일스톤 없음. 수동 업로드 정리([#325](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/325), 묶음 #258). 앞 결정은 [0040](2026-11-03-0040-upload-intake-in-worker-submit-then-fetch.md), [0041](2026-11-04-0041-upload-assigned-resume-with-local-record.md), [0042](2026-11-04-0042-upload-report-speakers-fixed-body.md), [0043](2026-11-05-0043-upload-handoff-member-ids-at-send.md)

## 문제와 제약

화자 분리가 끝난 업로드는 매니페스트와 화자별 트랙(원본 길이 그대로, 1시간 회의면 트랙 하나에 약 115MB, 계산값)을 남긴다. PM 이 지정하지 않아 BE 가 7일 만료로 `failed` 처리한 회의는 지정 결과 목록(`GET /uploads/assigned`)에 나오지 않아 아무도 지우지 않았다. 처리 바퀴가 포기한 업로드(`be.status=failed`), 인계가 끝난 업로드의 트랙, 끝난 가져오기 기록(`.uploads/<id>/`)도 남았다.

- AI 가 서비스 토큰으로 회의 상태를 물을 경로가 없다. `GET /meetings/{id}` 는 사용자 로그인이 필요하다.
- 라벨 보고(`POST /uploads/{id}/speakers`)를 같은 내용으로 다시 보내면 BE 는 아무것도 쓰지 않고 현재 상태를 돌려주고, 끝난 회의는 409 `MEETING_ALREADY_ENDED`, 없는 회의는 404 `MEETING_NOT_FOUND` 를 준다(계약 `backend-ai-contract.md` 라벨 보고 절, BE `speaker_assignment.py`).
- 삭제는 되돌릴 수 없다. 지운 뒤 PM 이 지정하면 그 회의는 처리할 수 없다.
- 디스코드 회의 파일과 처리 중인 회의는 건드리면 안 된다.

## 실제 검토한 선택지

설계 초안(`ai-designer`)과 사용자 논의(2026-11-06)에서 나온 것만 적는다.

- 지정 만료 판단: (A) 로컬 시각만(보고 뒤 7일), (B) 7일+1시간 지난 후보만 같은 보고를 다시 보내 BE 답으로 확인, (C) BE 에 서비스 토큰용 상태 조회 경로를 새로 요청.
- 인계 완료 업로드의 트랙: 지우지 않음(디스코드와 같게) / 보관 뒤 트랙만 지움.
- BE 가 계속 지정 대기라고 답할 때: AI 가 `/fail` 을 보냄 / 확인만 계속.

## 선택과 이유

- **지정 만료는 B**: 후보 조건(보고 뒤 7일+1시간, 지정 받기 기록 없음)을 넘은 회의만 고정한 보고 본문을 다시 보내고, 409 `MEETING_ALREADY_ENDED`·오류 봉투 404 `MEETING_NOT_FOUND` 일 때만 매니페스트·잠금·트랙·전사본을 지운다. 200 이면 1시간 뒤 다시 확인한다. 삭제 근거를 BE 의 답으로만 삼는 것은 assign·report 가 ENDED·404 만 끝으로 보는 원칙과 같다. 보고 시각은 AI 가 200 을 받은 시각이라 BE 의 첫 보고 시각보다 늦거나 같아서, 로컬 후보 조건이 BE 만료보다 먼저 서지 않는다. A 는 BE sweeper 가 늦거나 멈추면 아직 대기 중인 회의를 지우고, C 는 계약 변경과 BE 작업이 업로드를 켜기 전에 맞추기 어렵다.
- **포기·인계 완료·끝난 기록은 BE 를 부르지 않고 7일 보관 뒤**: 우리가 받은 `be.status`(`failed`·`done`)가 이미 끝났다는 근거다. 7일은 원인을 볼 여유이고 BE `SPEAKER_ASSIGNMENT_TTL_SECONDS` 와 같은 값이다. 포기한 업로드는 매니페스트·트랙·전사본을 지운다. 인계가 끝난 업로드는 다시 처리할 일이 없어(0043, partial 재시도 없음) 트랙 폴더만 지우고 매니페스트·전사본·기록은 남긴다. 끝난 가져오기 기록 폴더는 그 회의의 매니페스트가 없을 때만 통째로 지운다.
- **`/fail` 은 보내지 않는다**: 만료는 BE 몫이다.
- 깨진 가져오기 기록 폴더는 어느 회의인지 확신할 수 없어 지우지 않고 로그만 남긴다. 잠긴 회의는 BE 를 부르지 않고 건너뛴다.
- 워커 업로드 바퀴(지정 받기 → 보고 → 가져오기) 끝에 정리를 붙여 같은 스위치(`MM_UPLOAD_INTAKE`)와 한 회의 자리 안에서 돈다.

## 장단점과 감수한 제약

- "같은 내용 재전송은 보고 시각과 상태를 바꾸지 않는다"는 BE 동작에 기대고 있다. BE 가 이 동작을 바꾸면 확인할 때마다 7일 시계가 늘어나 만료되지 않는다.
- 만료 후보 하나당 시간당 한 번 BE 를 부른다(계산값, 측정하지 않음).
- 인계가 끝난 업로드는 7일 동안 트랙을 디스크에 둔다.

## 영향 범위와 재검토 조건

- 코드: `ai/upload/cleanup.py`(새 모듈), `ai/capture/worker.py`. 가져오기 기록 `intake.json` 에 `expire` 키가 생긴다. intake·report·resume 상태 기계는 그대로다.
- 계약 모양은 바뀌지 않는다.
- 재검토: BE 가 서비스 토큰용 상태 조회를 만들 때(C 로 바꿈), BE 가 재전송 동작이나 7일 만료를 바꿀 때, 디스크가 부족해 보관 기간을 줄여야 할 때.

## 근거와 관련 문서

- 설계 초안과 사용자 확정 논의(2026-11-06), 확정 요약은 #325 댓글
- BE(develop): `backend/app/services/upload_sweeper.py`, `backend/app/services/speaker_assignment.py`, `backend/app/api/meetings.py`
- 계약: `backend/docs/contracts/backend-ai-contract.md` 업로드 절
- 코드: `ai/upload/cleanup.py`, `ai/upload/report.py`, `ai/upload/assign.py`, `ai/capture/recorder.py`(`drop_local`, `drop_transcripts`)
