# 0014. 상태만 바뀌는 발화의 category — `status` 를 따로 두지 않고 지금은 decision 으로 둔다

- 날짜: 2026-09-30
- 상태: 보류 (decision 빈 update 처리를 바꿀 때 다시 본다)

## 배경

Terra 2단계의 `category`는 "무엇이 바뀌는가"를 매긴다. 값은 `schedule`(마감) · `assignee`(담당) ·
`scope`(범위) · `decision`(그 외 합의·결정) · `none` 다섯 가지이고, **상태 변경에 해당하는 값이 없다.**
진행 상태는 category 와 별개로 `JudgeResult.status` 에 담긴다.

그래서 "검색 성능 개선 다 끝냈어요"처럼 상태만 바뀌는 발화는 맞는 칸이 없어 Terra 가 "그 외"인
`decision` 을 고른다. #99 검증에서 상태만 바뀌는 케이스 7개가 2회 모두 `decision` 이었고, 파이프라인
E2E(#109)에서도 같았다.

그 결과 decision 에 성격이 다른 발화가 섞인다.

| 발화 (기존 Task) | 실제 의미 | 바뀌는 필드 |
|---|---|---|
| "검색 성능 개선 다 끝냈어요" | 상태 변경 | status |
| "결제 API 연동 중인데 문서가 헷갈리네요" (이미 진행 중) | 바뀌는 것 없음 | 없음 |
| "결제 API 응답은 JSON:API 형식으로 통일하기로 해요" | 필드에 안 담기는 결정 | 없음 |

## 검토한 선택지

- **A. category 에 `status` 추가** — 상태만 바뀌면 `status` 를 고르게 한다. decision 의 의미가 원래대로
  "필드에 안 담기는 결정"으로 돌아온다. 대신 `JUDGE_CATEGORIES`, Terra 프롬프트, stage2 골든셋 기대값,
  BE `/extractions` 의 `category` 를 같이 바꿔야 한다.
- **B. 지금처럼 두고, 읽는 쪽이 category 와 무관하게 status 를 본다** — `to_item()` 이 이미 이렇게 한다
  (#109). 상태 변경은 status 필드가 실제로 바뀌므로 빈 update 가 아니고, 그대로 BE 로 간다. 바꿀 것이 없다.

## 결정

**B 로 둔다.** 상태 변경 자체는 status 필드로 정확히 반영되고 있어서, category 가 decision 으로 나와도
동작에 문제가 없다. A 는 분류를 깔끔하게 하는 개선이지 지금 막힌 문제를 푸는 해결책이 아니다.

다만 decision 에 섞인 나머지 둘(바뀌는 것 없음 / 필드에 안 담기는 결정)은 category 도 같고 바뀌는 필드도
없어서 구분이 안 된다. 그래서 지금은 decision 이면서 바뀌는 필드가 없으면 **둘 다 빈 update 로 버린다**
(scope 만 예외로 보낸다). "JSON:API 로 통일" 같은 결정이 빠지는 한계가 있다.

## 다시 볼 조건

- decision 도 scope 처럼 바뀌는 필드가 없어도 보내기로 할 때 — 그 전에 "바뀌는 게 없는 발화"를 Terra 가
  `is_meaningful=false` 로 먼저 걸러내도록 기준을 강화해야 하고, 그 작업과 함께 A 를 적용한다
- category 를 PM 화면 표시나 통계처럼 **값 자체로** 쓰기 시작할 때 — 상태 변경이 decision 으로 보이면 안 된다
