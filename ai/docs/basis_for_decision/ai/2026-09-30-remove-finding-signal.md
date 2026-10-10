# JudgeFinding.signal 제거 — 진척 보고는 프롬프트로만 살린다

- 날짜: 2026-09-30
- 이슈: 없음 — PR #109 리뷰 대화(letsgojh) 후속
- PR: (이 PR)
- 브랜치: fix/109-remove-signal

## 한 일

- `shared/schemas.py` — `JudgeFinding.signal`, `SIGNAL_DECISION` / `SIGNAL_PROGRESS` / `FINDING_SIGNALS` 삭제
- `judge/semantic_judge.py` — `_valid_signal()` 삭제. 프롬프트에서 signal 표시 지시를 빼고
  "진행상황 공유도 포함한다"는 조항은 **그대로 유지**
- `judge/eval_golden_set.py` — 축 분류(decision/progress) 정확도 리포트 삭제
- `judge/golden_set/` — `signal: "progress"` 라벨 46건 삭제. `should_flag: true` 는 유지
  (진척 보고는 여전히 1단계가 골라야 하는 문장이다). note/description 의 progress 표현도 정리
- `tests/test_semantic_judge.py` — signal 파싱·라벨 검증 테스트 2개 삭제. 완료 보고가 1단계에서
  살아남는지 보는 테스트는 유지

## 왜

`signal` 은 #96(`2026-09-26-finding-signal-axis.md`)에서 "2단계가 진척 보고를 `is_meaningful=False`
로 버릴 것"이라고 보고 1단계에서 미리 축을 갈라 두려고 넣었다.

#109 E2E 에서 Terra 2단계만으로 진척 보고가 오판 없이 처리됐다.

| 발화 | 2단계 | 결과 |
|---|---|---|
| "검색 성능 개선 어제 다 끝냈어요" | `is_meaningful=True`, `status=done` | 진행 중 → 완료 |
| "색상 팔레트 계속 정리하고 있어요" (이미 진행 중) | `status=in_progress` | 변경 없음, item 없음 |

파이프라인 어디에서도 `signal` 을 읽지 않았고, 진척 보고가 살아남은 건 프롬프트의 FYI 제외
조항을 "포함"으로 바꾼 덕분이었다. 그래서 필드만 지우고 프롬프트 변경은 남긴다.

## 결과

- `tests/shared`, `test_semantic_judge.py`, `test_final_judge.py` 51 passed
- 실제 Luna 로 골든셋 평가는 다시 돌리지 않았다. 프롬프트에서 signal 표시 지시만 빠졌고 포함/제외
  기준은 그대로라 통과율 변화는 없을 것으로 보지만, 확인은 필요하다(`python -m judge.eval_golden_set`)

## 다음

- 실제 Luna 로 골든셋 재평가 — 통과율이 #96 때(320/341)와 비슷한지
