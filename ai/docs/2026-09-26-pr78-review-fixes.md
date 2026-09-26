# PR #78 멘토 리뷰(ai/judge 파트) 반영

- 날짜: 2026-09-26
- 이슈: 없음 — PR #78(develop → main) 리뷰 코멘트(minsang0850) 대응
- 브랜치: refactor/ai-review-week7
- 작성자: 유재환

## 한 일

- `judge/final_judge.py::_parse_terra_response`, `judge/semantic_judge.py::_valid_indices` —
  `matched_candidate_index`/`indices` 검증을 `isinstance(idx, int)` → `type(idx) is int`로
  강화. bool이 int 서브클래스라 `true`/`false`가 0/1번 항목으로 오인되던 버그
- `judge/final_judge.py::_numbered_candidates` — Terra 프롬프트에 `content_snippet` 추가
  (title만으론 "카카오만 지원" vs "카카오·구글 지원" 같은 범위 변경 판단 불가).
  `judge/golden_set_stage2/cases.json`에 검증 케이스 2개 추가
- `judge/eval_final_judge.py` — 성공 행과 ERROR 행의 딕셔너리 키가 달라 하나의 CSV로 합쳐
  쓰면 `rows[0]` 기준 헤더가 `ValueError`로 죽던 문제. success/errors 두 파일로 분리
- `judge/semantic_judge.py` — `FindingExtractionUnavailableError` 신설. Phase 1(Luna)도
  Terra처럼 규칙 기반 폴백 없이 에러를 던지도록 통일(원래 합의된 방향인데 미반영 상태였음).
  `{"findings": null}`처럼 값이 리스트가 아닌 malformed 응답도 `TypeError` 없이 처리
- `shared/schemas.py::JudgeResult`, `judge/final_judge.py` — `matched_notion_page_id` 필드
  추가. `task_id`가 없는(우리 DB Task와 아직 연결 안 된) Notion 후보를 골라도 어떤 페이지인지
  정보가 남도록 함
- PR #78 인라인 코멘트 4건 답변(봇 연결 범위, 근거 앵커/담당자 인덱스 분리, FYI 제외로 인한
  상태 신호 손실, `extract`/`judge` 역할 분담) — 코드 변경 없이 코멘트로 답변

## 왜

PR #78에 멘토가 `ai/judge/` 관련으로 "고칠점" 5건, "고민" 4건을 남김. 버그성 지적(bool 오인,
content_snippet 누락, CSV 크래시, task_id 없는 후보 정보 손실, Luna 폴백 정책 불일치)은 전부
코드로 고치고, 설계 차원 질문은 코멘트로 답변한 뒤 필요한 건 아래 "다음"으로 분리.

## 결과

| 항목 | 값 |
|---|---|
| 관련 테스트 | 58개 통과 (discord/pydantic 등 미설치 의존성 있는 capture/stt/extract 제외) |
| 커밋 | 4개, `refactor/ai-review-week7` 브랜치 |

## 다음

- `refactor/ai-review-week7` push 후 `develop`로 PR 생성
- `_LUNA_SYSTEM_PROMPT`의 진행상황 FYI 제외 조항 재설계 필요 — 완료 보고까지 걸러서 2단계
  `status: done` 판정이 도달 못 함. 단 `golden_set/long_sentences/case_02`("오탐 방지
  테스트")와 전제가 충돌해서 원 담당자(Y-Jimin, PR #76) 확인 필요
- `extract/llm.py` ↔ `judge/*` 역할 재구성 필요 — 관련성 필터 통합 + 담당자/할일 추출을
  Terra 2단계 이후로 옮기기로 한 결정이 코드엔 반영 안 됨(`DraftResult.structured`에만
  흔적). decision_log 기록 + 봇 파이프라인(`capture/recorder.py`) 연결 변경 필요
