# 0060. 역할로 지목한 담당자(thirdrole)도 추측 이름 대신 역할 원문을 BE 에 보낸다

- 날짜: 2026-11-09
- 상태: 결정됨 (이슈 #522, 같은 PR 에서 BE 가 thirdrole 별칭 학습을 다시 켬)
- 이전 결정: [0057](2026-11-07-0057-thirdname-sends-original-mention.md) — thirdname 만 원문으로 바꾸고 thirdrole 은 별도 이슈로 미룸

## 배경

0057 뒤에도 thirdrole 은 두 경로 모두 `assignee_resolved`(문맥으로 추측한 이름, 없으면 None)를 `assignee_raw` 로 보냈다(legacy `capture/handoff.py` 의 `to_extraction_items`, judge `judge/pipeline.py` 의 `_assignee`). BE 는 원문과 추측을 구분할 수 없어 추측한 이름이 확인된 별칭이 될 수 있다며 thirdrole 을 별칭 학습에서 뺐고(#464 리뷰), AI 가 역할 원문을 보내면 다시 켜겠다고 #522 로 요청했다.

사실 확인:

- 두 프롬프트 모두 resolved 를 second·thirdpronoun 에만 채우고 다른 타입이면 null 이라고 시킨다(`extract/prompts.py`, `judge/semantic_judge.py`). 그래서 지금 thirdrole 항목은 대개 None 이 가서 BE 에서 hold 다. thirdrole 에 resolved 가 채워진 관측 사례는 골든셋·평가 결과에서 찾지 못했다.
- 원문은 이미 남아 있다. legacy 는 thirdrole 의 mention 을 지우지 않고 judge 는 raw 를 지우지 않는다.

## 검토한 선택지

- **A. thirdrole 을 thirdname 과 같은 규칙에 넣는다**: 새 할 일(create)과 그 카드에 합친 담당 발화는 원문, 기존 할 일의 담당자 변경(update)은 `resolved or 원문`. #501 과 규칙이 하나로 합쳐진다. BE 는 create·merge 승인 때만 배우므로 학습 위험은 막힌다. 대가: update 카드에는 추측 이름이 갈 수 있다(학습 대상이 아니고 update 는 늘 PM 검토).
- **B. thirdrole 은 언제나 원문**: BE 가 thirdrole 의 raw 를 늘 원문으로 믿을 수 있다. 대가: update 카드에서 드물게 채워지던 추측 이름이 사라지고 0057 규칙과 갈라진다.
- **C. 원문과 추측을 따로 보내는 필드를 더한다**: 승인 카드의 제안 담당자를 추측 이름으로 채울 수 있다. 대가: BE 계약 변경, 관측된 필요 없음(0057 이 같은 이유로 뺌).

## 결정

A 를 고른다(사용자와 2026-11-09 확정, #522 댓글). judge 는 `_NOT_ALIAS_TYPES = {second, thirdpronoun}` 로 줄이고, 원문을 별칭 조회 키로 보내는 타입을 `_ORIGINAL_MENTION_TYPES = {thirdname, thirdrole}` 로 묶었다. legacy 는 resolved 를 쓰는 타입을 second·thirdpronoun 으로 줄였다(legacy 항목은 모두 create). `shared/schemas.py` 는 주석만 고쳤고 필드는 그대로다.

같이 정한 것:

- BE 변경(`LEARNABLE_ASSIGNEE_TYPES` 에 thirdrole 추가, BE 계약·README)은 같은 PR 에 넣는다. develop 머지 때 AI·BE 가 함께 배포돼 "AI 먼저, BE 나중" 순서가 필요 없다.
- 배포 전에 저장된 thirdrole 대기 카드는 학습에서 거르지 않는다. 대부분 None 이고, PM 이 카드의 글자를 보고 "별칭에도 등록"을 고른다(0057 의 thirdname 과 같은 판단).
- 학습한 별칭이 전사 힌트(`GET .../members/names` 의 `aliases` → `stt/backend.py` 의 `member_forms`)에 들어가 오인식 철자("화은")를 굳힐 수 있다. PM 이 확인한 별칭이라 담당자 매칭 해는 적고, 비용은 회의록 표기와 힌트 길이다. 이번에는 막지 않는다.
- legacy 경로의 1인칭 오분류율은 측정 도구만 넣었다(`extract/eval_golden_set.py` 의 `--set speaker|all`, `--runs`, `--out`). 실제 측정(최대 약 186회 LLM 호출)은 하지 않았다.

PR #607 리뷰에서 더 정한 것(2026-11-09):

- 프롬프트가 thirdrole 의 resolved 를 비워 두므로 update 카드에는 사실상 원문이 간다. 그래서 예전에는 `_has_change` 에서 버려지던 역할 담당 변경 발화가 update 카드로 올라온다. update 는 늘 PM 검토이고 BE 가 역할 별칭으로 못 찾으면 PM 이 담당자를 고르므로 의도한 동작으로 둔다.
- **별칭 글자 다듬기의 기준: "찾기는 넓게, 저장은 좁게".** 역할어는 받침으로 끝나는 말이 많아("팀장은") 리뷰에서 역할만 "은"·"분"을 더 떼자는 안이 나왔고 한때 그렇게 고쳤다. 그런데 이름이 thirdrole 로 오면(AI 오분류, 배포 전 옛 카드의 추측 이름) "화은" → "화", "김하은" → "김하"처럼 글자가 잘린 채 확인된 별칭(0.9)이 됐다(`/code-review`). 지적이 나올 때마다 규칙을 덧대지 않으려고 기준을 먼저 정했다.
  - 찾기 후보는 넓게 만든다. 긴 후보부터 찾고 한 글자로 찾히면 확인 필요라(#463) 후보를 더 만들어도 잘못 확정되지 않는다. 그래서 "분"을 님·씨와 같은 호칭으로 후보에 넣었다(BE `name_candidates`·AI `_name_candidates`). "디자이너가"에서 배운 "디자이너"가 "디자이너분이"로 찾힌다.
  - 저장 글자는 좁게 다듬는다. 더 떼면 손상된 글자가 조용히 남고, 덜 떼면 별칭이 좁을 뿐이다. "팀장은"으로 저장돼도 다음에 "팀장이"로 오면 그 표현은 이미 찾히는 표현이 아니라 다시 학습 후보가 되고, PM 이 고르면 "팀장"을 배워 메워진다. 그래서 떼는 글자는 BE 규칙 ⑤(#459, 끝 조사 한 번·"은" 제외·끝 "님")에서 넓히지 않는다.
  - 저장 규칙은 담당자 종류와 상관없이 하나다. 학습 여부는 AI 분류를 믿지만 다듬기는 분류를 믿지 않는다.
  - 저장 글자는 늘 원문의 찾기 후보 중 하나다(BE 테스트가 지킴).
  - 알려진 한계: 끝 글자가 조사와 같은 말을 조사 없이 부르면("보안 전문가") 규칙 ⑤가 끝 "가"를 떼어 "보안 전문"이 저장된다. 이 PR 전부터 있던 규칙이고, 다음 회의의 "보안 전문가가"에서 "보안 전문가"를 배워 메워진다. "보안 전문"은 그 글자로만 찾혀 해가 없다.
- 역할 별칭은 이름 별칭과 같은 종류(`nickname`, source `learned`)로 저장한다. 별칭 글자("BE 리더", "팀장")로 PM 이 역할임을 알아볼 수 있어 종류를 새로 두지 않았다(FE·계약 변경을 피함).

회의록 초안(`draft/doc_draft.py`), 알림(`capture/notify.py`), legacy 흔들림 판정(`extract/llm.py`)은 resolved 를 그대로 쓴다. BE 로 가는 `assignee_raw` 만 바뀐다.

## 다시 볼 조건

- thirdrole 카드에서 PM 직접 지정이 많은데 역할 별칭이 쌓이지 않으면 C 안을 BE 와 다시 논의한다.
- 학습 별칭이 쌓이면 [0024](../member/2026-10-13-0024-member-name-hint.md) 의 다시 볼 조건대로 전사 힌트가 이름 자리를 더 고치는지, 오인식 철자를 굳히는지 잰다. 출처로 거르려면 BE 응답 변경이 필요하다.
- 역할 별칭의 삭제·정정이 관측되거나, 역할어가 thirdname 으로 분류돼 학습한 역할 별칭으로 옛 담당자에게 auto 가 되면 역할 별칭을 따로 표시하는 종류(예: `alias_type=role`)를 두고 그 별칭으로 찾은 담당자는 확인 필요로 둘지 검토한다(#607 리뷰).
- legacy 1인칭 오분류 측정 결과가 judge(#502, 약 1%)보다 크게 나쁘면 legacy 프롬프트나 BE 1인칭 거르기를 다시 본다.
