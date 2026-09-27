# Terra 2단계가 암시적 진척 보고를 status 변경으로 살리는지 검증

- 날짜: 2026-09-28
- 이슈: #99
- PR: #100
- 브랜치: test/99-terra-progress-cases
- 작성자: 유재환

## 한 일

- `judge/golden_set_stage2/cases.json` — 암시적 진척 보고 케이스 8개 추가 (22 → 30개)
  - 채점 6개: 과거형 완료("붙였고요"), 1단계 요약문 형태 완료("마쳤다고 보고함"),
    착수(todo → in_progress), done 작업 재개(done → in_progress),
    이미 같은 상태인 보고 2개(in_progress/done 재언급 → `is_meaningful=false`)
  - 관찰 2개(`observe_only`): 진행 중 + 애로사항, 상태 변화 없는 진척률
- `judge/golden_set_stage2/README.md` — "겨냥하는 것"에 새 케이스 그룹 추가
- 프롬프트(`judge/final_judge.py`)는 **안 고쳤다** — 아래 결과대로 고칠 실패가 없었다

## 왜

#96 으로 1단계가 진척 보고("로그인 API 다 붙였어요")를 버리지 않고 넘기게 됐는데, 2단계가 이걸
기존 Task 의 `status` 변경으로 살리는지는 직접적인 표현("다 끝냈습니다", "막혔어요") 3건으로만
검증돼 있었다. 1단계가 실제로 넘기는 발화는 과거형·진행형·요약문처럼 상태를 직접 말하지 않는
경우가 많아서, 여기서 버려지면 1단계에서 살린 의미가 없다.

처음엔 "Terra 가 진척 보고를 문서에 새 내용이 없다며 `is_meaningful=false`로 버린다"고 가정하고
프롬프트를 고치려 했는데, 기존 평가 결과(9/23)를 보니 직접 표현 3건은 이미 전부 통과하고 있었다.
그래서 프롬프트 수정 대신 검증 케이스를 먼저 넓히고, 실패가 나올 때만 고치기로 했다.

## 결과

실제 Terra API, 2회 실행:

| | 1회 | 2회 |
|---|---|---|
| 채점 대상 전체 | 26/26 | 26/26 |
| 새 진척 케이스(채점 6개) | 6/6 | 6/6 |

**Terra 는 암시적 진척 보고도 status 변경으로 살린다.** 현재 상태와 같으면 `is_meaningful=false`
로 정확히 거르고, done 작업의 재개(done → in_progress)도 잡는다 — 검색 후보에 done Task 를
포함해야 하는 근거가 된다.

관찰 케이스는 실행마다 판단이 달랐다:

| 케이스 | 1회 | 2회 |
|---|---|---|
| "결제 API 연동 중인데 문서가 좀 헷갈리네요." (현재 in_progress) | `is_meaningful=true`, status=in_progress | `is_meaningful=false` |
| "회원가입 이메일 인증 기능 절반 정도 했어요." (현재 in_progress) | `is_meaningful=true`, status=in_progress | 같음 |

두 케이스 모두 `is_meaningful=true` 여도 status 가 현재 값과 같아서 실제로 바뀌는 필드가 없다.
BE 의 `apply_task_updates()`는 같은 값을 건너뛰므로 Task 는 안 바뀌지만, **승인 요청은 하나 생겨
PM 에게 의미 없는 카드가 뜬다.** 진척률은 Task 에 `progress` 필드가 있지만 Terra 응답에 그 칸이
없어서 반영할 방법이 없다.

### 발견한 문제 — 상태만 바뀐 경우 category 가 decision

상태만 바뀌는 채점 케이스 7개(기존 3 + 신규 4)가 2회 모두 `category=decision` 으로 나왔다.
`JUDGE_CATEGORIES`(schedule/assignee/scope/decision/none)에 상태 변경에 해당하는 값이 없어서다.
판정 자체는 맞지만, 뒤에서 payload 를 만들 때 category 만 보고 필드를 고르면 status 가 빠진다
("decision → 바꿀 Task 필드 없음"으로 읽힌다). 이번 PR 에서는 고치지 않고 기록만 한다.

## 다음

- category 처리 방식 결정: (A) payload 를 만들 때 `status` 는 category 와 무관하게 항상 확인,
  (B) `JUDGE_CATEGORIES`에 status 값 추가(BE `/extractions` 확장의 `category` 와도 맞춰야 함)
- 바뀌는 필드가 없는 `is_meaningful=true`(status 가 현재 값과 같음)를 파이프라인에서 걸러
  빈 승인 요청을 만들지 않기 — Luna Phase 2 / `to_item()` 구현 때 반영
- 진척률(`progress`) 반영은 범위 밖 — 필요해지면 Terra 응답에 칸 추가
