# JudgeResult 스키마 확정 (Terra 2단계 출력 타입)

- 날짜: 2026-09-23
- 이슈: #63
- PR: #68
- 브랜치: feat/63-terra-stage2

## 한 일

- `shared/schemas.py`의 `JudgeResult`에서 `confidence`, `method` 필드 제거
- `is_new: bool`, `matched_task_id: str | None`, `status: str | None` 필드 추가
- `status` 값은 BE `TaskStatus` enum(`todo|in_progress|blocked|done`)과 동일하게 맞춤
- `is_meaningful=False`의 의미(새 내용이라 후보 없음이 아니라, candidates 비교 후 실제로
  바꿀 게 없는 경우)를 docstring에 명시

## 왜

Terra 2단계(`judge/final_judge.py`, 아직 미구현)가 candidates 와 비교해서 "새 항목 생성 / 기존 항목
수정 / 아무것도 안 함"을 구분해야 하는데, 기존 `JudgeResult`엔 이걸 표현할 필드가 없었다. `confidence`/
`method`는 실제로 쓰는 곳이 없어서 같이 정리했다(규칙 기반 폴백을 Terra 2단계에서는 안 두기로 함).

## 결과

`JudgeResult`를 참조하는 코드/테스트가 아직 없어서(구현 전) 이번 변경으로 깨진 곳은 없음.
전체 테스트(`.venv/bin/python -m pytest`) 통과 확인.

## 다음

- `judge/final_judge.py` 구현 (judge_rules / judge_llm / judge 디스패처, `semantic_judge.py`와 같은 구조)
- fixture `JudgeInput` 샘플 (candidates 없음 / 확실한 매치 / 애매한 경계) 준비
- `tests/test_final_judge.py` 작성
