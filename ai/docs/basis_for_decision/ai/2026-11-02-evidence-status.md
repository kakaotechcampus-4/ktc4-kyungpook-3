# 판단 경로 새 항목에 근거 상태와 유사 검색 값을 실어 보낸다

- 날짜: 2026-11-02
- 이슈: #232
- PR: #261
- 브랜치: feature/confidence-passthrough
- 작성자: 윤지민 (Claude Code)

## 한 일

- `extract/dates.py`: `resolve_due_raw(raw, today)`. 날짜 하나로 정해지는 마감 표현(오늘·내일·모레, (이번·다음 주) X요일, M월 D일, M/D, 끝의 `까지`·`까지는` 허용)만 날짜로 계산하고, 기간·근사 표현은 None
- `shared/schemas.py`: `DraftStructured.due_raw` 추가(기존 필드 변경 없음)
- `draft/doc_draft.py`: Luna 가 `due_date` 와 함께 근거 원문의 마감 표현 `due_raw` 를 낸다. 최종 마감이 있을 때만 담는다
- `judge/evidence.py`(새 파일): 근거 원문 대조로 상태를 정한다
  - `task_status`: 약속·결정·완료 표현이 있고 그 줄이 질문·조건이 아니면 certain, 아니면 inferred
  - `due_status`: 마감이 없으면 missing. `due_raw` 가 근거 한 줄 안에 경계(앞이 숫자가 아님, 뒤가 줄 끝·까지·에·는·날)를 지켜 들어 있고, 다시 계산한 날짜가 같을 때만 certain
  - `worse`: 합치기용
- `judge/pipeline.py`: `run` 이 create 항목에 `task_status`·`due_status`·`due_raw`·`similar_count`·`top_similarity` 를 싣는다. 같은 회의 새 항목 카드에 합칠 때 갱신한다. update 항목에는 넣지 않고, `to_item` 은 바꾸지 않았다
- [backend-ai 계약](../../../../backend/docs/contracts/backend-ai-contract.md): "근거 상태의 뜻"을 추가했다(certain 은 원문 확인이지 정답 확률이 아님, 계산 방법, 한계). 낡은 "Luna 애매 표시" 설명도 고쳤다

## 왜

BE 의 judge auto 조건은 이미 머지돼 있었지만 AI 가 이 키를 보내지 않아, judge 새 항목은 늘 null 신호로 review 가 됐다. 상태를 어떻게 매길지는 [0028](2026-11-02-0028-evidence-status-by-source-check.md).

## 결과

| 항목 | 값 |
|---|---|
| 관련 테스트 | `test_dates`·`test_evidence`·`test_pipeline`·`test_doc_draft`·`shared/test_schemas`·`capture/test_judge_wiring`·`test_platform_isolation` 160 passed |
| 전체 | 로컬 venv(Windows, Python 3.10)에서 기존 실패 171건(fcntl·resource·discord voice·`fromisoformat` 'Z')이 있다. 기준선 대비 새 실패는 `stt/realtime/test_session.py` 타이밍 테스트뿐이며, 이번 변경과 무관하게 단독 실행에서도 흔들린다. CI 확인 필요 |
| 실제 Luna 응답 | 확인하지 않았다. `due_raw` 를 원문 그대로 주는지는 요청이 있을 때 `python -m judge.eval_pipeline` 으로 상태 분포를 본다(키 필요, 비용 발생) |
