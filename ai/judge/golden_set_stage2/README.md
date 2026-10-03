# judge/golden_set_stage2/

Terra 2단계(`judge/final_judge.py`) 검증용 골든셋. 1단계 `golden_set/`과 달리 여기서 보는 건
"이 발화가 후보로 남을 가치가 있는가"가 아니라 **"candidates 와 비교했을 때 새 항목인지,
기존 항목 수정인지, 아무것도 안 바꿔도 되는지"**입니다.

## `cases.json` 형식

케이스가 전부 하나의 JSON 배열(`cases.json`)에 들어있습니다 — 1단계 골든셋과 달리 케이스마다
`JudgeInput`(text + candidates 여러 개)이라는 중첩 구조라서, 파일을 20개로 쪼개는 것보다 한
파일에서 쭉 훑어보는 게 검토하기 편합니다.

```jsonc
{
  "description": "이 케이스가 뭘 검증하는지",
  "judge_input": {
    "source": "meeting",
    "text": "...",
    "candidates": [{"notion_page_id": "...", "task_id": "...", "title": "...", "similarity": 0.6}]
  },
  "expected": {
    "is_meaningful": true,
    "is_new": false,
    "matched_task_id": "task_xxx",
    "category": "schedule",   // 있으면 채점, 없으면 관찰만
    "status": "done"          // 있으면 채점, 없으면 관찰만
  },
  "observe_only": false        // true면 is_meaningful/is_new 도 채점 안 하고 실제 판단만 출력
}
```

`is_meaningful`/`is_new`/`matched_task_id`는 `expected`가 있으면 항상 채점합니다.
`category`/`status`는 판단이 더 주관적일 수 있어서 `expected`에 그 키가 있을 때만 채점하고,
없으면 실제 값을 출력만 합니다(참고용).

## 겨냥하는 것

- **새 항목**(1~2, 12~13, 20번): candidates 없음 / 있어도 무관함 — `is_new=true`
- **기존 수정**(3, 5~8, 11, 15~17번): 일정/담당자/상태/범위 각각 하나씩 — `matched_task_id`가
  올바른 후보를 가리키는지
- **이미 반영된 내용**(4, 14번): candidate 의 현재 값과 발화 내용이 실제로 같음 —
  `is_meaningful=false`
- **다중후보 구분**(9, 10번): 후보가 여러 개일 때 진짜 맞는 것/새 항목인지 구분
- **부정문**(11번): "안 넣기로 했다" — 그 자체가 유효한 범위 변경 결정임을 확인
- **경계 케이스**(18, 19번, `observe_only`): 결론 없이 보류되거나 막연한 언급 — 정답을 강제하지
  않고 실제 판단만 관찰
- **암시적 진척 보고**(23~25, 28번): "붙였고요", "마쳤다고 보고함", "정리하고 있어요", "다시 작업
  들어갑니다"처럼 상태를 직접 말하지 않는 진척 보고 — 1단계가 넘기는 progress 발화를 `status`
  변경으로 살리는지
- **이미 반영된 진척**(26, 27번): 발화가 말하는 상태가 후보의 현재 `status`와 같음 —
  `is_meaningful=false`
- **바뀌는 것 없음**(29, 30, 33, 34번): 진행 중 + 애로사항, 상태가 그대로인 진척률, 감상, 질문 —
  `is_meaningful=false`
- **상태만 바뀜**(6, 7, 17, 23~25, 28번): `category=status`
- **필드 없는 진짜 결정**(31, 32번): 응답 형식 · 구현 방식을 새로 정함 — 바뀌는 필드는 없어도
  `is_meaningful=true`, `category=decision` (바뀌는 것 없음 기준에 같이 걸리지 않는지)
- **상태 + 일정 동시 변경**(35번): status=blocked 만 채점, category 는 관찰

이 골든셋은 실행할 때마다 결과가 살짝 다를 수 있습니다(LLM 비결정성) — 한 번 실패했다고 바로
프롬프트를 고치기보다는 몇 번 더 돌려보고 같은 실패가 반복되는지 판단하세요.
