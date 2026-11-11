# 0057. 이름으로 지목한 담당자(thirdname)는 추출기가 고친 이름 대신 원문 언급을 BE 에 보낸다

- 날짜: 2026-11-07
- 상태: 결정됨

## 배경

BE 에 보내는 `assignee_raw` 는 두 경로 모두 `assignee_resolved or mention` 이었다(legacy `capture/handoff.py` 의 `to_extraction_items`, judge `judge/pipeline.py` 의 `_assignee`). 그래서 thirdname 이어도 추출기가 이름을 고쳐 `assignee_resolved` 에 넣으면 원문 대신 고친 이름이 갔다. 프롬프트는 resolved 를 second·thirdpronoun 에만 채우라고 하지만 코드는 막지 않았다.

BE #464 는 thirdname 항목을 추출 때 못 찾고 PM 이 고르며 `save_alias=true` 로 승인하면 `assignee_raw` 를 다듬어 확인된 별칭(0.9)으로 배운다. 추출기가 STT 가 받아 적은 "화은"을 "하은"이나 "김하은"으로 고쳐 보내면, 쓸모없는 글자가 확인된 별칭이 되고 배워야 할 "화은"은 배우지 못한다. 골든셋·테스트·평가 결과에서 thirdname 에 resolved 가 채워진 사례는 찾지 못했다. 구조상 가능하지만 관측되지 않은 위험이다.

## 검토한 선택지

- 보내는 두 곳에서 second·thirdpronoun·thirdrole 만 resolved 를 보내고 그 밖은 원문 언급을 보낸다: 계약이 그대로이고 두 줄이다. 대신 추출기가 STT 오인식을 바로잡아 바로 찾히던 thirdname 항목은 PM 확인으로 넘어간다. 그 이득이 실제로 있었다는 증거는 없다.
- POST /extractions 항목에 `assignee_resolved` 를 새로 보내 BE 가 원문으로 찾고 실패하면 resolved 로 찾되 학습은 원문만 한다: 매칭 이득을 지킨다. 대신 BE 계약이 바뀌고 두 파트 작업이며 관측된 필요가 없다.
- BE 혼자 다듬은 글자가 `evidence_quote` 에 있을 때만 배운다: AI 변경이 없다. 대신 judge 의 `evidence_quote` 는 마지막 근거 줄뿐이라 맞는 별칭도 놓칠 수 있다.

## 결정

첫째 안을 고른다. 계약을 바꾸지 않고 학습되는 글자를 원문으로 고정한다. 덤으로 first·group·none 은 resolved 도 원문도 보내지 않고 None 을 보낸다(BE 가 "우리" 같은 글자를 별칭으로 조회해 hold 로 돌리지 않게).

적용 범위: 원문 전송은 새 할 일(create) 항목과 그 항목에 합친 담당 발화에만 쓴다. BE 가 별칭을 배우는 때는 create 승인뿐이라, 기존 할 일 수정과 담당자 변경 카드는 예전처럼 고친 이름(`assignee_resolved`, 없으면 원문)을 보낸다. STT 오인식 원문이 가서 예전에 찾히던 담당자가 not_found 가 되는 것을 피한다.

사용자와 함께 정한 범위(2026-11-07):

- thirdrole 은 이번에 바꾸지 않는다. 지금처럼 푼 이름을 보내고, 원문("백엔드 리더")을 보낼지는 별도 이슈로 다룬다.
- 1인칭을 thirdname 으로 잘못 분류해 "제가"가 "제"로 학습될 위험(`judge/eval_results/2026-10-02-final-speaker.json` 의 "제가 정리할게요")은 이번 범위 밖이다. BE 에서 거른다(#502, `alias_learning.py` 의 1인칭 거르기).
- 배포 전에 저장된 thirdname 항목은 학습 대상에서 빼지 않는다. 관측된 사례가 없고 PM 이 별칭 글자를 보고 승인한다.

회의록 초안(`draft/doc_draft.py`), 알림(`capture/notify.py`), legacy 흔들림 판정(`extract/llm.py`)은 resolved 를 그대로 쓴다. BE 로 가는 `assignee_raw` 만 바뀐다.

## 다시 볼 조건

- thirdname 항목이 PM 확인으로 많이 넘어가 불편이 보이면 둘째 안(resolved 를 따로 보내기)을 BE 와 다시 논의한다.
- thirdrole 원문 전송은 [0060](2026-11-09-0060-thirdrole-sends-original-mention.md) 에서 정했다(#522, 2026-11-09). thirdrole 도 이 기록의 thirdname 과 같은 규칙을 쓴다.
- 1인칭 오분류로 이상한 별칭이 실제로 저장되면 AI 쪽 방어를 다시 본다.
