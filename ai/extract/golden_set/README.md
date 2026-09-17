# extract/golden_set/

Phase 1(추출) 채점용 골든셋. `extract/eval_golden_set.py`가 이 안의 `*.json`을 전부 읽어
추출기(`extract/llm.py`)를 채점한다.

## 케이스 형식

```json
{
  "case_id": "case_01",
  "scenario": "single_sentence | short_exchange | full_meeting | correction | dense_multi_task | unknown_speaker",
  "description": "이 케이스가 뭘 검증하는지 한 줄",
  "note": "(선택) 알려진 한계나 다음 이터레이션 계획 등 채점 결과를 해석할 때 필요한 맥락",
  "reference_date": "YYYY-MM-DD",
  "speaker_names": {"화자키": "표시 이름"},
  "turns": [{"speaker": "화자키", "text": "..."}],
  "expected": [
    {
      "sentence": "extract.text.split_sentences 로 이 turns 를 쪼갰을 때 나오는 문장과 정확히 같아야 함",
      "is_task": true,
      "assignee_type": "first|second|thirdname|thirdpronoun|thirdrole|all|none",
      "assignee_mention": "원문에 나온 호칭 그대로. first/all/none 이면 null",
      "assignee_resolved": "second/thirdpronoun 을 문맥으로 풀었을 때 기대하는 실제 이름 (그 외 생략)",
      "due_date": "YYYY-MM-DD 또는 null",
      "task_keywords": ["예측 task 텍스트에 이 키워드들이 다 포함돼야 정답으로 침 (선택, 생략 가능)"]
    }
  ]
}
```

담당자 타입의 의미와 "무엇을 할일로 볼 것인가"는 **`extract/TASK_CRITERIA.md` 가 원본**이다. gold 를
찍기 전에 그 문서를 먼저 읽고, 기준과 어긋나는 케이스가 나오면 문서부터 고친다.

**프롬프트 few-shot 예시와 여기 문장이 겹치면 안 된다.** 겹치면 시험 문제를 미리 보여주고 시험 치는
꼴이라 점수가 부풀려진다 — 예시는 `extract/prompts.py` 안에 따로 창작해 둔 문장만 쓴다.

`expected`는 turns 를 문장 단위로 쪼갰을 때 나오는 **모든** 문장을 순서대로 다 적어야 한다(할일이
아닌 문장도 `is_task: false`로 포함) — 그래야 오탐(false positive)까지 채점된다. 로더
(`extract/eval_golden_set.py::load_case`)가 실제 `split_sentences` 결과와 `expected`의 문장 목록이
다르면 즉시 에러를 낸다(오타 방지).

## 시나리오 종류

- **single_sentence**: 맥락 없는 문장 하나(또는 한 발화). 순수 span 추출 + 날짜 파싱만 검증.
- **short_exchange**: 2~4턴 정도의 짧은 대화. 3인칭 지정이 옆 턴 화자 참조로 안 깨지는지.
- **full_meeting**: 14턴 전체 회의(잡담·크로스토크·정정·그룹 태스크 다 섞임). 노이즈 내성.
- **correction**: 같은 화자가 나중에 마감/담당자를 바꿔 말하는 경우. 지금(v1)은 병합 기능이
  없어서 두 발화가 별개 항목으로 잡히는 게 "정상"이다 — 나중에 병합 기능이 생기면 이 케이스들의
  gold 를 "최종 병합 결과" 관점으로 다시 정의해야 한다.
- **dense_multi_task**: 한 문장에 담당자·마감이 다른 할일이 여러 개 섞인 경우. 지금 추출기는
  "문장 하나 = 할일 하나"를 가정해서 못 쪼갤 걸로 예상되는 케이스 — 알려진 한계를 드러내는 용도.
- **full_meeting** 중 `long_meeting`은 기존 긴 케이스 4개를 잡담으로 이어붙인 **파생 케이스**다
  (81턴 / 약 10분). 내용이 중복이라 전체 집계에 이중 계산되니, 원본만 보려면
  `python -m extract.eval_golden_set -k meeting_` 처럼 `-k` 로 거른다. **원본의 gold 를
  고치면 `long_meeting` 도 같이 고쳐야 한다.**
- **unknown_speaker**: `speaker_names`가 비어 있을 때(화자 표시 이름을 못 받은 경우) 본인 지칭이
  깨지는지 확인.

## 새 케이스 추가하는 법

1. `turns`를 정하고, `python -c "from extract.text import split_sentences; ..."`로 실제 쪼개지는
   문장 목록을 뽑는다(또는 그냥 `extract/eval_golden_set.py`를 한번 돌려서 에러 메시지로 확인).
2. 그 문장 목록 순서 그대로 `expected`를 채운다.
3. `python -m extract.eval_golden_set` 로 로더 검증(문장 불일치 시 에러) + 점수 확인.
