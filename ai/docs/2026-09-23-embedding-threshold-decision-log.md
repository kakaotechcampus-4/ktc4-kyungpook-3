# 임베딩 유사도 threshold 0.4 결정 근거 기록

- 날짜: 2026-09-23
- 이슈: Refs #64
- PR: #66
- 브랜치: docs/64-embedding-threshold-decision-log
- 작성자: 유재환

## 한 일

PR #65 검증 결과를 바탕으로 임베딩 유사도 threshold를 0.4로 정한 근거를
`decision_log/0010-embedding-similarity-threshold.md`에 남겼다.

## 왜

threshold처럼 정답이 없는 트레이드오프 결정은 코드/커밋 메시지에 "무엇을 했는지"만 남고
"왜 그렇게 했는지"는 금방 사라지므로, `decision_log/` 컨벤션에 따라 별도로 기록했다
([[2026-09-23-embedding-threshold-eval]] 참고 — 검증 자체는 그쪽에 있고 여기는 결정 근거만).

## 결과

| 항목 | 값 |
|---|---|
| 명확한 불일치 최고점 | 0.33 |
| 명확한 매치 최저점 | 0.42 |
| 결정된 threshold | 0.4 |

threshold는 "후보로 넘길 가치가 있는가"를 거르는 낮은 문턱일 뿐, 같은 task인지 최종 판단은
Terra 2단계가 문맥으로 한다는 점도 함께 기록.

## 다음

이 threshold를 BE의 `search_similar_tasks` 구현에 전달.
