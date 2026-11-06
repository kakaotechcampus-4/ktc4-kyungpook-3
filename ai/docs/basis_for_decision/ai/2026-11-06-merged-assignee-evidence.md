# 합친 카드의 1인칭 담당자를 말한 사람으로 찾게 하다

- 날짜: 2026-11-06
- 이슈: #420
- PR: 미정
- 브랜치: fix/420-merged-assignee-speaker
- 작성자: 김동우

## 한 일

- `judge/pipeline.py` `_merge_into` 가 담당 분류로 합칠 때 근거 문장, 화자, 시각을 그 발화 값으로 옮기게 했다.
- 근거 필드를 만드는 코드를 `_evidence` 로 묶어 `to_item` 과 같이 쓴다.
- 합친 담당자와 그 뒤 마감 발화를 다루는 테스트 두 개를 더했다.

## 왜

뒤 발화가 담당을 정해도 근거 화자가 앞 카드 값이라 BE 가 다른 사람을 담당자로 찾았다. 선택지는 [0045](2026-11-06-0045-merged-assignee-evidence.md).

## 결과

- `cd ai && .venv/bin/python -m pytest -o addopts="" -q`: 1284 통과
- 고치기 전 새 테스트 두 개는 `evidence_speaker` 가 `uid_alice` 로 남아 실패했다.
- BE 계약 변경은 없다. 유료 호출 없음(0원).
- 실제 회의 데이터로는 아직 돌려 보지 않았다.

## 다음

#229 의 `evidence_seqs` 를 이어서 싣는다.
