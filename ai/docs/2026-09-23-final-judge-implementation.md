# Terra 2단계(final_judge) 구현 + 실제 API 검증

- 날짜: 2026-09-23
- 이슈: #63
- 브랜치: feat/63-terra-stage2
- 작성자: 유재환

## 한 일

- `judge/final_judge.py` — `JudgeInput`(발화 + 기존 Notion 후보)을 받아 새 항목 생성/기존 항목
  수정/변경 없음을 최종 판단. `matched_candidate_index`(정수)로 받아서 `candidates[i].task_id`로
  변환 — Terra가 task_id 문자열을 직접 베끼게 하면 오타/환각 위험이 있어서 인덱스로 받음
- 규칙 기반 폴백 없음(`judge_rules` 안 둠) — Terra 키가 없거나 파싱 실패하면
  `JudgeUnavailableError`를 던짐
- `tests/test_final_judge.py` 9개 — FakeLLM/NullLLM 기반, API 없이 결정적으로 실행
- `judge/golden_set_stage2/`(cases.json 20개) + `judge/eval_final_judge.py` — 실제 Terra API로
  검증하는 스크립트(pytest 미포함)

## 왜

이슈 #63 체크리스트("JudgeInput → Terra 프롬프트 설계", "응답 파싱 → JudgeResult", "fixture로
독립 테스트")를 그대로 구현. 규칙 기반 폴백을 안 둔 건 — 2단계 판단의 핵심이 candidates 비교인데
규칙 기반으로는 이걸 신뢰성 있게 대신할 수 없어서, 토큰/키가 없으면 그냥 막기로 함.

## 결과

첫 실행 18개 채점 대상 중 16개 통과(89%). 실패 2건 원인:
- "결제 환불 처리 로직 구현하기로 했다." — candidate 제목과 같은 내용만 반복하고 담당자/마감일/
  상태 등 실제로 바뀐 값이 없어서 Terra 가 `is_meaningful=false`(이미 반영됨)로 정확히 판단.
  케이스가 새 정보 없이 "매칭+변경있음"을 테스트하려 한 설계 결함이었음 — 마감일을 추가해서 재검증
- "소셜 로그인 버튼은 이번엔 안 넣기로 했다." — `category`만 기대(`scope`)와 다르게(`decision`)
  나옴. 프롬프트에 "취소/제외도 범위 변경(scope)"이라는 기준이 없어서 생긴 경계 모호함 →
  `_terra_user_prompt`에 기준 추가

두 가지 다 고친 뒤 재실행 **18/18 (100%)**. 규칙 기반 폴백을 안 둔 이유·`matched_candidate_index`로
받는 이유는 `decision_log/0011-final-judge-no-rules-fallback-and-candidate-index.md` 참고.

전체 pytest 스위트 통과.

## 다음

- BE와 `JudgeInput`/`matched_task_id` 연동 확인
- `is_new`/`matched_task_id`에 따른 BE 쪽 `task` INSERT/UPDATE + `task_history` 기록 로직은
  BE 책임
