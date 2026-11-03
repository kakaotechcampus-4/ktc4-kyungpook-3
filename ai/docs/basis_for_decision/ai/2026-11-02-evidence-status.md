# 판단 경로 새 항목에 근거 상태와 유사 검색 값을 실어 보낸다

- 날짜: 2026-11-02 ~ 2026-11-03
- 이슈: #232
- PR: #261
- 브랜치: feature/confidence-passthrough
- 작성자: 윤지민 (Claude Code)

## 한 일

- `shared/schemas.py`: `DraftStructured.due_raw` 추가(기존 필드 변경 없음)
- `draft/doc_draft.py`: Luna 가 `due_date` 와 함께 근거 원문의 마감 표현 `due_raw` 를 낸다. 최종 마감이 있을 때만 담는다
- `jev.py`(새 파일): Elice MLAPI 판정 API Jev(`typesafe/jev-latest`, `POST /v1/decisions`) 클라이언트. 대화형이 아니라 `state`(상황)와 `questions`(선택지 질문)를 보내면 질문마다 선택지별 확률을 돌려줘서 `llm.py` 와 따로 둔다. 키가 없거나 실패하면 None
- `shared/config.py`, `.env.example`: `JEV_API_KEY`, `JEV_BASE_URL`
- `judge/evidence.py`(새 파일): `verify()` 가 새 항목마다 Jev 에 한 번 묻는다
  - 상황: 회의 날짜(요일), 할 일 제목, 마감 날짜(요일)와 원문 표현, 근거 원문 줄
  - 질문: 할 일이 명시적으로 약속·결정·지시됐나, (마감이 있으면) 그 날짜가 이 일의 마감으로 명시되고 계산이 맞나. 각각 yes/no/unclear
  - yes 확률 0.8 이상이면 certain, 아니면 inferred. 마감이 없으면 묻지 않고 missing. 근거 줄이 없거나 호출이 실패하면 inferred
  - `worse`: 같은 회의 카드 합치기용
- `judge/pipeline.py`: `run` 이 create 항목에 `task_status`·`due_status`·`due_raw`·`similar_count`·`top_similarity` 를 싣는다. 같은 회의 새 항목 카드에 합칠 때 갱신한다. update 항목에는 넣지 않고, `to_item` 은 바꾸지 않았다
- `judge/eval_evidence.py`(새 파일): 정답 붙인 대사 19개로 실제 Jev 판정을 재는 평가 스크립트(pytest 밖)
- `tests/conftest.py`(새 파일): `.env` 에 Jev 키가 있어도 테스트가 실제 Jev 를 부르지 않게 막는다
- [backend-ai 계약](../../../../backend/docs/contracts/backend-ai-contract.md): "근거 상태의 뜻"(certain 은 원문에 명시됐다고 확인됐다는 뜻이지 정답 확률이 아님, 묻는 방법, 평가 결과, 한계)

처음에는 코드 규칙(표현 목록·정규식·날짜 계산기)으로 대조하는 A안을 구현했다가, 말의 모양이 조금만 바뀌어도 못 알아봐서 B안으로 바꿨다. A안 코드(`extract/dates.py` 의 `resolve_due_raw` 와 그 테스트)는 지웠다. 이유는 [0028](2026-11-02-0028-evidence-status-by-source-check.md).

## 왜

BE 의 judge auto 조건은 이미 머지돼 있었지만 AI 가 이 키를 보내지 않아, judge 새 항목은 늘 null 신호로 review 가 됐다.

## 결과

| 항목 | 값 |
|---|---|
| 관련 테스트 | `test_evidence`·`test_pipeline`·`test_doc_draft`·`shared/test_schemas`·`capture/test_judge_wiring`·`test_platform_isolation`·`test_final_judge`·`test_semantic_judge` 172 passed |
| 전체 | 로컬 venv(Windows, Python 3.10)에서 환경 문제로 원래 실패하는 170건(fcntl·resource·discord voice·`fromisoformat` 'Z' 등)만 실패. 변경 전 실패 목록에 없던 새 실패는 없다. CI 확인 필요 |
| 실제 Jev 평가 | `python -m judge.eval_evidence --repeat 2`(2026-11-03, 호출 38회). 잘못된 certain 0건, 할 일 37/38·마감 22/24 정답. 놓친 3건은 yes 0.78~0.79 로 기준 바로 아래 |
| 평가로 고친 것 | 마감 날짜에 요일을 함께 준다. 없을 때는 "금요일까지"인데 토요일 날짜를 yes 0.82 로 통과시켰다 |
| 실제 Luna 응답 | `due_raw` 를 원문 그대로 주는지는 재지 않았다. 필요하면 `python -m judge.eval_pipeline`(키 필요, 비용 발생) |
