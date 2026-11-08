# 전사 진행과 단계 시작 시각을 회의 상세에 노출한다

- 기록일: 2026-11-08
- 관련 마일스톤: M6 (프론트·AI 통합과 계약 확정). #381 결정과 같은 마일스톤에 둔다. [M6 plan.md](../plan.md)는 비어 있다.
- 근거 이슈: #483 (AI·BE·FE 공동 이슈의 A안 중 BE 몫). 설계는 이슈 댓글 "설계 확정 (BE, A안)"(2026-11-08)이고, 사용자가 설계 질문을 모두 추천안으로 정하라고 지시했다.

## 문제와 제약

- 회의 정리 중 화면에서 가장 오래 걸리는 전사 단계에 진행 정도가 없고, 단계가 언제 시작됐는지도 보이지 않는다. AI 는 트랙 진행을 알지만 BE 에 보내지 않고, BE 는 `processing_stage_at`을 저장하면서 응답에 싣지 않는다.
- [2026-11-05 결정](2026-11-05-processing-stage-report.md)은 "트랙 진행률은 보내지 않는다"(Q3), "응답에 단계 값을 노출하지 않는다"(Q5)고 정하면서, 화면이 트랙 진행이나 단계 값을 필요로 하면 다시 본다고 적었다. #483 이 그 조건에 해당한다.
- 기존 `progress` 세 값과 판정식은 바꾸지 않는다(FE 호환). AI·FE 가 아직 바뀌지 않았어도 깨지지 않아야 한다.

## 실제 검토한 선택지

- 진행 값 저장
  - A. 회의에 nullable 정수 컬럼 2개(채택): 조건부 UPDATE 의 WHERE 에서 숫자를 그대로 비교할 수 있어 sqlite 와 PostgreSQL 이 같은 SQL 로 돈다. 판정과 쓰기를 한 문장으로 묶는 기존 방식을 그대로 이어 간다.
  - B. JSON 컬럼 하나: 다른 단계의 진행이 생겨도 스키마가 그대로지만, WHERE 안 JSON 비교가 DB 마다 달라 조건부 UPDATE 를 이식성 있게 쓰기 어렵다.
  - C. 단계 이력 테이블: 지금 화면에 필요 없는 범위다(2026-11-05 결정의 B안과 같은 이유).
- 같은 단계에서 `done`이 줄 때: 덮어쓰기(채택) / 단조 증가만 허용. 재전사·재시작 때 0부터 다시 오는데 단조 증가로 막으면 표시가 옛 값에 멈춘다. 대신 봇이 순서대로 하나씩 보낸다는 전제를 계약에 적는다.
- `stage`가 `stt`가 아닌데 `stt`가 올 때: 400(채택) / 무시하고 200. 잘못 보낸 호출을 조용히 버리지 않기 위해서다. AI 는 오류를 삼키므로 처리는 멈추지 않는다.
- 처리 중이 아닌 회의의 `processing`: `null`(채택) / 저장값 그대로. 단계 값은 done·failed 뒤에도 남는데, 그대로 보이면 끝난 회의에 오래된 "5/5"가 보인다.
- 목록 API 노출: 하지 않음(채택). 처리 화면과 토스트는 상세를 쓴다.
- 만료 시계: 진행 보고가 업로드 3시간 만료를 늦추지 않는다(채택). 단계 보고와 만료는 지금처럼 따로 간다.

## 선택과 이유

1. `meeting.processing_stt_done`·`processing_stt_total`(Integer, nullable)을 더한다. 마이그레이션 [d6e1b4a8c297](../../../../migrations/versions/d6e1b4a8c297_add_meeting_processing_stt_progress.py), 백필 없음.
2. `PATCH /meetings/{id}/stage`가 선택 필드 `stt: {done, total}`을 받는다. `total >= 1`, `0 <= done <= total`, 정수만(StrictInt), `stage == "stt"`일 때만. 어기면 400 `INVALID_REQUEST`.
3. 단계 전환 UPDATE 가 진행 값도 같이 쓴다(없으면 NULL). 진행 컬럼은 늘 "지금 단계의 진행"만 담는다. 같은 `stt` 단계 재전송은 두 번째 조건부 UPDATE 로 진행만 고치고 `processing_stage_at`은 그대로 둔다([meeting_stage.py](../../../../app/services/meeting_stage.py)).
4. 회의 상세와 `/fail` 응답에 `processing: {stage, stage_at, stt} | null`을 더한다. 회의가 `processing`일 때만 객체다([meetings.py](../../../../app/api/meetings.py)).

## 장단점과 감수한 제약

- `done`/`total`이 무엇을 세는지 BE 는 정하지 않는다. AI 의 지금 progress 콜백은 "끝난 호출 수"와 "읽은 트랙 수"를 주고 "끝난 트랙 수"는 없다. 단위는 AI 가 정하고 화면 문구는 그 뒤에 정한다.
- 덮어쓰기라 요청이 순서를 바꿔 도착하면 진행이 잠깐 뒤로 갈 수 있다. 봇이 순서대로 보낸다는 계약으로 막는다.
- 진행 보고가 잦으면 회의 행 쓰기가 늘어난다. 빈도는 AI 에 줄여 달라고 알린다.
- 컬럼 2개가 늘고 단계별 이력은 여전히 남지 않는다.

## 영향 범위와 재검토 조건

- BE: stage 요청·응답 필드, 상세·`/fail` 응답 `processing`, 컬럼 2개. 새 오류 코드 없음. 모두 더하기만 하는 변경이라 배포 순서는 상관없다.
- AI: 진행 보고 호출 추가(AI 몫, 아직 없음).
- FE: `processing` 필드로 전사 진행과 단계 경과 표시, 모의 서버와 FE 계약 갱신(FE 몫).
- 계약: [BE↔AI 계약](../../../contracts/backend-ai-contract.md#patch-meetingsmeeting_idstage--200).
- 재검토 조건: 전사 말고 다른 단계에도 진행이 필요할 때(JSON 이나 별도 테이블 검토), AI 가 진행을 순서대로 보낼 수 없을 때(단조 증가나 순번 필드 검토), 목록 화면이 진행을 필요로 할 때.

## 근거와 관련 문서

- 이슈 #483 본문과 댓글 "설계 확정 (BE, A안)"(2026-11-08)
- [처리 단계 보고를 회의 컬럼으로 저장한다](2026-11-05-processing-stage-report.md)
- 코드: [meeting_stage.py](../../../../app/services/meeting_stage.py), [meetings.py](../../../../app/api/meetings.py), [meeting.py](../../../../app/schemas/meeting.py), [models.py](../../../../app/models/models.py), [test_meeting_stage.py](../../../../tests/api/test_meeting_stage.py)
