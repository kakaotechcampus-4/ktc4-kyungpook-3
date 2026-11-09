# 업로드 회의 추출 지연과 요약 잘림을 고친다

- 날짜: 2026-11-10
- 이슈: #624
- PR: -
- 브랜치: fix/624-llm-stream-due-clear
- 작성자: 김동우

## 문제 상황

11/9 22:53 에 4인 테스트 회의 녹음(`1108 4인 테스트 회의 녹음본.m4a`, 3분 57초)을 수동 업로드했다. 회의 `681e66ca`.

| 시각(KST) | 일 |
|---|---|
| 22:53:31 | 업로드 |
| 22:55:45 | PM 화자 지정 끝, 처리 시작 |
| 22:55:55 ~ 22:57:46 | 1회차: 전사 5.5초, 추출 105초. 발화 1개 판단 못 함 → 실패로 세고 60초 기다림 |
| 22:58:47 ~ 23:00:27 | 2회차: 추출 100초. 같은 발화 실패 → 120초 기다림 |
| 23:02:28 ~ 23:04:01 | 3회차: 추출 93초. 재시도 상한이라 그 발화를 빼고 인계 |
| 23:04:24 | 요약 1차: 출력 잘림 |
| 23:19:30 | 요약 2차(BE 임대 15분 뒤): 저장 |

같은 날 앞서 올린 업로드 `12be7454` 는 요약 두 번이 모두 잘려 BE 시도 상한(2)을 다 썼고, 요약이 끝내 없다.

## 원인을 찾은 과정

1. 워커 로그(`journalctl -u mm-worker`)와 매니페스트의 `ops` 로 단계별 시간을 나눴다. 추출 한 번은 1분 45초였고, 나머지는 재실행과 대기였다. 실패 사유는 세 번 모두 같은 발화의 `draft`: "Luna 응답을 파싱하지 못했습니다" 였다.
2. 요약 로그는 실패 때마다 "출력 2000, 추론 2000" 이었다. 출력 상한을 처음엔 draft 실패의 원인으로도 의심했다.
3. 그 발화(근거 문장 21 ~ 24)만 서버에서 실제 Terra·Luna 로 세 번 다시 돌리며 모든 호출의 `finish_reason` 과 토큰을 찍었다. draft 는 잘리지 않았다(`stop`, 추론 142 ~ 187). Terra 가 기존 Task "TV 백업 및 복구 절차 문서화"(마감 11/10)의 일정 변경으로 판단했고, Luna 가 `due_date: null` 을 줘 파서가 "일정 변경인데 마감이 없다" 로 거부했다. 출력 상한 가설은 draft 에 대해서는 틀렸다.
4. 원인은 둘이었다. "미정" 을 null 로 받는 프롬프트 정의와, 기존 마감을 지우는 값을 보낼 칸이 없는 계약이다. 입력이 같으면 항상 실패하는데 회의 전체 재시도가 돌았다. → [0062](2026-11-10-0062-clear-existing-due-with-due-cleared.md), [0063](2026-11-10-0063-retry-the-failed-call-in-place.md)
5. 요약의 2000 은 게이트웨이 상한이었다. 비스트리밍에서 `max_completion_tokens=6000` 은 400 이었고, 스트리밍은 3711 토큰까지 끝까지 받았다. 추출 1단계도 4분 회의에 출력 1800 토큰으로 상한에 붙어 있었다. → [0061](2026-11-10-0061-llm-streaming-for-gateway-cap.md)

## 한 일

- `llm.py`: `MLAPIClient._stream` 을 새로 둬 `generate_json`·`generate_json_once` 가 스트리밍으로 받는다. 시작부터 정한 시간이 지나면 끊고, `finish_reason` 이 `stop` 이 아니면 로그에 남긴다. `generate_json` 은 잘린 응답을 버린다. `CALL_ATTEMPTS = 2`
- `judge/final_judge.judge`, `draft/doc_draft.draft`: 실패한 호출을 그 자리에서 한 번 더 한다
- `draft/doc_draft.py` 프롬프트: `none` 에 "마감을 아직 못 정했다·미정이라고 하거나" 를 더했다
- `judge/pipeline.py`
  - `to_item`: 원래 마감이 있는 Task 의 해제는 update 항목에 `due_cleared: true` 를 싣는다
  - `_merge_into`, `_with_edit`: 같은 회의 안에서 합칠 때도 같은 규칙이다. 앞의 해제를 다음 판단에 "마감을 X → 없음" 으로 보인다
  - `_has_change`: 해제도 바뀌는 값으로 센다
  - `run`: 해제를 실패로 남기던 분기(`DUE_CLEARED_REASON`)를 지웠다
- `judge/reply.py`: 답장 판단은 run 의 `due_cleared` 항목을 지금과 같은 `due_clear` 줄(알리기만)로 바꾼다. 보충 판단도 같다
- `capture/recorder.py`, `.env.example`: `MM_EXTRACT_RETRY_MAX` 기본값 2 → 0
- `backend/app/schemas/meeting.py`, `backend/app/api/extractions.py`: `due_cleared` 를 받아 대상 Task 에 마감이 있으면 변경안에 `due_date: null` 을 싣는다
- `backend/docs/contracts/backend-ai-contract.md`: `due_cleared` 필드와 "update 마감 해제" 행

## 왜

업로드 회의는 PM 이 결과를 기다리는 흐름이라, 4분 회의가 8분 넘게 걸리고 요약이 운에 따라 안 나오는 것을 그대로 둘 수 없었다. 세 가지 트레이드오프는 결정 기록에 따로 적었다.

## 결과

| 항목 | 값 |
|---|---|
| 바꾼 프롬프트로 같은 발화 | 3/3 `due_date: "none"`(바꾸기 전 3/3 null) |
| 이 브랜치 코드로 같은 회의 판단 한 번(서버, 저장된 전사본, BE 는 유사 검색만) | 항목 9개, 판단 못 한 발화 0개. 원준 발화는 update `due_cleared: true`. 100.7초, LLM 호출 23회 모두 `stop`, 최대 출력 1634 토큰 |
| 바꾸기 전 같은 회의 | 실행 3회와 대기 3분, 화자 지정 뒤 인계까지 8분 16초, 그 발화는 빠짐 |
| 스트리밍으로 받은 최대 출력 | 3711 토큰, `stop` |
| AI 테스트 | `.venv/bin/python -m pytest -q` 전부 통과 |
| BE 테스트 | `.venv/bin/python -m pytest -q` 3124 passed, 2191 skipped(PostgreSQL 변형, 로컬 DB 없음). `ruff check .` 통과 |
| 조사·확인 비용 | 약 750원(장부 `investigation-2026-11-09-luna-truncation.jsonl`, `fix-624-llm-stream-due-clear.jsonl`. Terra 단가 상한으로 센 추정) |

새 테스트:

- `test_llm.py`: 스트리밍 요청인지, 잘린 응답을 버리는지, 전체 시간 상한을 넘으면 끊는지
- `test_final_judge.py`, `test_doc_draft.py`: 실패한 호출을 그 자리에서 한 번 더 하는지. 프롬프트에 미정 규칙이 있는지
- `test_pipeline.py`
  - 기존 마감이 있는 Task 의 해제가 `due_cleared` 카드가 되는지
  - 마감이 없던 Task 는 카드를 내지 않는지
  - 같은 회의에서 미루기 → 해제, 해제 → 다시 날짜 순서로 말했을 때
- `backend/tests/api/test_extractions_judge.py`: 변경안에 `due_date: null` 이 실리는지, 마감 없는 Task 는 승인이 없는지, 승인하면 마감이 비는지

새로 올린 업로드로 업로드부터 인계·요약까지 전체를 재는 것은 배포 뒤에 한다. 요약을 스트리밍으로 부른 실측도 아직 안 했다.

## 다음

- 배포 뒤 4인 테스트 녹음을 다시 올려 인계까지 걸린 시간과 요약 1차 성공을 잰다
- 요약이 없는 `12be7454` 는 배포 뒤 `capture.backfill_summaries` 로 다시 만든다
- 서버 `.env` 에 `MM_EXTRACT_RETRY_MAX` 가 직접 적혀 있으면 기본값 변경이 먹지 않는다. 배포할 때 확인한다
- 60분 회의 크기의 스트리밍 출력은 아직 재지 않았다(0061 다시 볼 조건)
- 열린 PR #607 이 `judge/pipeline.py`, `backend/app/api/extractions.py`, 계약 문서를 같이 고친다. 먼저 머지되는 쪽에 맞춰 충돌을 푼다
