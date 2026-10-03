# 판단 파이프라인 오케스트레이터 (1단계 → 유사 검색 → Terra → Luna → /extractions item)

- 날짜: 2026-09-29
- 이슈: #106
- PR: #109
- 브랜치: feat/106-judge-pipeline (base: feat/103-luna-draft — #104 위에 쌓은 PR)
- 작성자: 유재환

## 한 일

- `shared/schemas.py` — `NotionCandidate.notion_page_id`를 nullable로. 승인 직후 Notion 동기화 전인
  Task 는 페이지가 없다(#102 유사 검색 응답과 같음)
- `judge/pipeline.py`
  - `to_item()` — `JudgeFinding` + `JudgeResult` + `DraftResult` → `/extractions` item. 새로 판단하지
    않고 합치기만 한다(담당자·근거는 finding, 새 항목/수정·대상·상태·분류는 result, 제목·마감·설명은 draft)
  - `run()` + `CandidateSource` — 회의 전사록 하나를 item 목록(`PipelineResult(items, failures)`)으로
- `judge/eval_pipeline.py` + `judge/golden_set_pipeline/meeting_01.json` — BE 만 가짜로 두고 LLM·임베딩은
  실제로 부르는 E2E 스크립트(pytest 밖)
- `draft/doc_draft.py` — E2E 에서 나온 문장 품질 문제 2건 수정(아래 "결과")
- `tests/test_pipeline.py` 24개, `tests/shared/test_schemas.py` 1개 추가

## 왜

1단계·Terra 2단계·Luna Phase 2 가 모듈로만 있고 이어 붙이는 코드가 없어서, 회의 하나를 넣었을 때 BE 로
무엇이 가는지 확인할 방법이 없었다. BE(#98 → #102)를 기다리지 않고 AI 쪽 흐름을 끝까지 검증하려고
유사 검색을 인터페이스(`CandidateSource`)로 떼어 두고 가짜로 채웠다.

### to_item 규칙 (#99 에서 기록한 두 문제 반영)

| 규칙 | 이유 |
|---|---|
| `status` 는 category 와 무관하게 반영 | 상태만 바뀌면 Terra 가 `category=decision` 을 준다 — category 만 보면 status 가 빠진다 |
| update 에서 현재 값과 같은 필드는 제거, 남는 변경이 없으면 item 을 만들지 않음 | "진행 중 → 진행 중" 같은 빈 승인 카드 방지 |
| 단, `scope` 는 바뀌는 필드가 없어도 보냄 | "소셜 로그인은 이번엔 빼기로"는 담을 Task 필드가 없지만 실제 결정 — 버리면 조용히 사라진다 |
| 담당자는 update 에서 `category=assignee` 일 때만 | 일정 변경 발화에 섞인 호칭으로 담당자가 바뀌지 않게 |
| 담당자는 비교하지 않고 호칭이 있으면 변경으로 봄 | AI 는 member_id 를 모른다 — 해소·비교는 BE(#102 에 요청) |
| `second`·`thirdpronoun`·`thirdrole` 호칭은 풀린 이름이 없으면 보내지 않음 | 별칭 조회가 안 되는 표현 — `capture/handoff.py` 와 같은 규칙 |
| update 의 `task_title` 은 현재 제목(표시용) | BE `ExtractionItemCreate.task_title` 이 필수 — BE 는 update payload 에 넣지 않는다 |

### 실패 처리

회의 하나에 결정이 여러 개라 finding 마다 LLM 을 부른다. 하나의 파싱 실패로 나머지 결정까지 버리지
않도록 두 종류로 나눴다.

| 실패 | 처리 |
|---|---|
| LLM 키 없음 | 시작 전에 `PipelineUnavailableError` |
| 1단계 실패 | 회의 전체 에러(finding 자체가 없음) |
| 유사 검색 / Terra / 수정 대상 없음 / Luna (finding 하나) | 그 finding 만 `failures` 에 남기고 계속 |

`final_judge`·`doc_draft` 는 "키 없음"과 "파싱 실패"를 같은 에러로 던진다. 루프 전에 키부터 보면
루프 안의 에러는 전부 finding 하나의 실패로 볼 수 있어서, 두 모듈은 고치지 않았다.

### 테스트에서 잡은 버그

Terra 가 Notion 에만 있는(`task_id=None`) 후보를 고르면 `matched_task_id=None` 이 되는데, 수정 대상을
찾는 `c.task_id == result.matched_task_id` 가 `None == None` 으로 참이 되어 그 후보가 대상으로 잡혔다.
`matched_task_id` 가 None 이면 먼저 거르고 `failures`(stage=target)로 남긴다.

## 결과

E2E(`eval_pipeline`, 실제 Luna·Terra·임베딩) — 회의 fixture 1개, 기대 조건 6개:

| 발화 | 결과 |
|---|---|
| "결제 환불 기능은 지민님이 다음 주까지" + "네, 제가 맡을게요" | create, 지민님, 10/11(다음 주 일요일) |
| "로그인 마감 미룰 수 있을까요? 다음 주 화요일로요" + "네" | update task_login, 10/6 |
| "검색 성능 개선 어제 다 끝냈어요" | update task_search, done |
| "소셜 로그인 버튼은 이번엔 안 넣기로" | update task_social_login, scope(doc_text 만) |
| "색상 팔레트 계속 정리하고 있어요"(이미 진행 중) | item 없음 |
| 결제 API 연동(언급 없음, 결제 환불과 헷갈리기 쉬움) | 수정 없음 |

프롬프트 수정 전 2회, 수정 후 4회 모두 **6/6**, failures 0.

### 문장 품질 — 고친 것

**범위 변경 doc_text 가 어색했다.** "수정이면 '현재 값 → 새 값'"을 바뀌는 값이 없는 scope 에도 적용했다.

```
전: 로그인 화면에 소셜 로그인 버튼 추가 작업을 이번 작업 범위에서 제외 (로그인 화면에 소셜 로그인 버튼 추가 → 소셜 로그인 버튼 추가 제외)
후: 로그인 화면에 소셜 로그인 버튼 추가 작업을 이번 범위에서 제외
```

→ 규칙에 "범위 변경은 화살표 없이 무엇이 빠지거나 더해지는지만" 추가, few-shot 에 범위 변경 예시 추가.

**새 항목 doc_text 에 "작업 범위에 추가하고"가 붙었다.** 위 수정 뒤에 나왔다. Terra 가 새 항목에도
`category=scope` 를 주는데, 그게 프롬프트에 "바뀌는 것: 작업 범위"로 들어갔기 때문이다.

```
전: 결제 환불 기능 개발을 작업 범위에 추가하고 지민님이 10/11(일)까지 하기로 함
후: 결제 환불 기능 개발을 지민님이 10/11(일)까지 하기로 함
```

→ 새 항목에는 "바뀌는 것" 줄을 넣지 않는다.

### 기록만 한 것

- **새 항목의 category 가 `scope` 로 나온다**(6회 모두). `is_new=True` 판정은 맞고 item 에도 영향이
  없지만, category 기준이 새 항목에는 잘 맞지 않는다
- **fixture 가 회의 1개이고 발화가 명확하다.** STT 오류·말 끊김이 있는 실제 전사록으로는 봇 연결 뒤에
  다시 본다
- **상태만 바뀌는 발화의 category 가 `decision` 으로 나온다.** 상태 변경 category 가 없어서다. status 는
  category 와 무관하게 반영하므로 동작에는 문제가 없고, `status` category 를 따로 둘지는 보류했다
  (`decision_log/0014`)
- **decision 이면서 바뀌는 필드가 없으면 버린다.** "바뀌는 것 없음"과 "필드에 안 담기는 결정"("JSON:API 로
  통일하기로")이 같은 모양이라 구분이 안 돼서다 — 후자가 빠지는 한계가 있다. scope 만 예외로 보낸다
- **scope 승인은 Task·Notion 어디에도 남지 않는다.** 승인 요청으로 PM 에게 보이게만 했고, 결정 내용
  (`doc_text`)을 어디에 저장할지는 정하지 않았다(PR #105 리뷰에서 나온 지적)

## 다음

- 봇 연결 — `CandidateSource` 의 HTTP 구현(#102 `POST /workspaces/{id}/tasks/similar`,
  `X-Service-Token`), `capture/handoff.py` 에서 `run()` 결과를 `/extractions` 로, recorder 에 옛 경로와
  고르는 플래그
- BE #102 — update item 담당자를 해소 후 현재 값과 비교(같으면 제외, 못 풀면 PM 확인)해 달라고 요청함
- tests 정리 — `tests/` 바로 아래 judge·draft·extract 테스트를 모듈별 디렉토리로(지민님 작업과 겹쳐 별도로)
- decision 빈 update — "바뀌는 게 없는 발화"를 Terra 가 `is_meaningful=false` 로 먼저 거르도록 기준을
  강화하고(골든셋으로 진짜 결정이 같이 걸러지지 않는지 확인), decision 도 scope 처럼 보내기. 이때
  `status` category 분리(`decision_log/0014`)를 함께 적용하고 BE 에도 decision 예외 요청
- scope/decision 결정 기록 위치 — 승인 시 task_history 기록 또는 Notion 페이지 본문 추가 (BE 와 논의)
