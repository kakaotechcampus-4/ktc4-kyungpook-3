# 0011. Terra 2단계는 규칙 기반 폴백을 안 두고, task_id 는 인덱스로 받는다

- 날짜: 2026-09-23
- 상태: 결정됨

## 배경

`judge/final_judge.py`(Terra 2단계)를 `semantic_judge.py`(Terra 1단계)와 같은 패턴으로
만들면서, 두 가지를 1단계와 다르게 가기로 했다.

## 결정 1 — 규칙 기반 폴백을 두지 않는다

1단계(`semantic_judge.py`)는 Luna 가 없으면 정규식 기반 `extract_findings_rules`로 폴백한다.
2단계도 처음엔 같은 패턴(`judge_rules`, 임베딩 유사도 threshold 로만 새 항목/기존 수정을
가르는 규칙)을 만들었다.

그런데 2단계 판단의 핵심은 "발화 내용이 candidate 의 현재 값과 실제로 다른가"를 비교하는
것인데, 규칙 기반은 이 비교를 할 능력이 없다 — 기껏해야 유사도 threshold 로 "관련 있어 보이는
후보가 있다/없다"만 알 수 있고, "이미 반영된 내용이라 무시"(`is_meaningful=false`) 판단은
아예 불가능하다. 신뢰할 수 없는 결과를 그럴듯하게 내는 것보다, 토큰/키가 없으면 그냥 막는 게
낫다고 판단했다. `judge()`는 이제 Terra 키가 없거나 파싱에 실패하면 `JudgeUnavailableError`를
던진다.

**Luna(1단계)의 규칙 기반 폴백 제거는 지민님이 별도로 진행하기로 함 — 이 결정은 2단계
(final_judge.py)에만 적용된다.**

## 결정 2 — matched_task_id 는 문자열이 아니라 인덱스로 받는다

Terra 응답에 `task_id`를 직접 문자열로 쓰게 하면, LLM 이 존재하지 않는 ID를 지어내거나
오타를 낼 위험이 있다(환각). 대신 프롬프트에 candidates 를 번호(`[0]`, `[1]`, ...)로 나열하고
Terra 는 `matched_candidate_index`(정수)만 답하게 한 뒤, 코드에서
`judge_input.candidates[idx].task_id`로 변환한다. 인덱스가 범위 밖이면 파싱 실패로 처리한다
(`_parse_terra_response`).

## 재검토 조건

Terra 모델이 구조화된 출력(response_format 의 enum/참조 제약)을 더 강하게 지원하게 되면
인덱스 방식 대신 직접 참조가 안전해질 수 있다 — 그때 재검토.
