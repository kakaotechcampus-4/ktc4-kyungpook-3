# 마일스톤 구현 결과

## 작업 근거와 요약

M3 plan.md 는 비어 있다. 이번 작업은 #229(추출 근거를 발화 seq 로 연결해 evidence 저장)의 BE 작업 목록을 근거로 했다. #124 에서 근거를 `evidence` 테이블로 옮긴 뒤 행을 만드는 코드가 없어, 추출 조회의 `evidence` 가 항상 null 이었다.

추출 등록 항목에 `evidence_seqs`(근거 발화의 seq 목록)를 받아 `evidence` 로 저장한다. 찾은 발화 중 seq 가 가장 큰 발화를 대표 근거로 보고, 승인 요청 근거·별칭 판정 로그·추출 조회에 쓴다. 하나도 못 찾으면 지금처럼 요청의 세 필드(`evidence_quote`·`evidence_speaker`·`evidence_at_ms`)를 쓴다. 1인칭 담당자는 요청의 `evidence_speaker` 를 먼저 쓰고, 없을 때는 요청한 seq 중 가장 큰 발화(결론 발화)를 찾았을 때만 그 화자를 쓴다.

## 실제 구현 및 관련 코드

| 변경 | 위치 |
|---|---|
| `ExtractionItemCreate.evidence_seqs: list[int] \| None`. 원소는 0 ~ 2^31-1(발화 저장 API 의 seq 범위), 항목마다 최대 100개(`MAX_EVIDENCE_SEQS`). 벗어나면 400 | `app/schemas/meeting.py` |
| 요청 전체의 seq 로 이 회의의 `source` 를 한 번에 읽고, 항목 저장 뒤 seq 마다 `evidence`(type=`task`) 저장. 같은 seq 는 한 번만, 없는 seq 는 건너뛰고 항목마다 경고 로그 한 줄 | `app/api/extractions.py` `_sources_by_seq`, `_add_item_evidence` |
| 대표 근거를 가장 작은 seq 에서 가장 큰 seq 로 변경(추출 조회, auto 되돌리기 승인 요청) | `app/api/extractions.py` `_representative_evidence` |
| 승인 요청 payload(생성·수정)의 근거 세 키는 대표 근거 발화로 채움. 발화가 없으면 요청의 세 필드. 둘을 섞지 않음. 1인칭 담당자는 `evidence_speaker`, 없으면 결론 발화(가장 큰 seq)를 찾았을 때만 그 화자 uid. 화자가 없으면 `assignee_raw` 를 별칭으로 찾지 않고 not_found(`hold`) | `app/api/extractions.py` `create_extraction`, `_representative_source`, `_request_evidence`, `_request_task_update` |
| 별칭 판정 로그에 대표 근거 발화의 `source_id` 기록 | `app/services/matching.py` `log_resolution` |
| 계약·설명 | [AI 계약](../../contracts/backend-ai-contract.md), [Backend README](../../../README.md) |

## 완료조건 확인

M3 plan.md 가 비어 있어 완료조건이 없다. 마일스톤 완료를 판정하지 않았다. 아래는 #229 BE 작업 목록의 테스트 항목이다(`tests/api/test_extraction_evidence.py`).

| 조건 | 상태 | 근거 |
|---|---|---|
| seq 여러 개 저장 | 충족 | `test_evidence_seqs_saved_as_task_evidence` |
| 없는 seq 건너뛰기(다른 회의의 seq 포함) | 충족 | `test_evidence_seqs_skip_unknown_seq` |
| 같은 seq 중복 | 충족 | `test_evidence_seqs_duplicate_saved_once` |
| 1인칭 화자 | 충족 | `test_first_person_assignee_prefers_evidence_speaker`, `test_first_person_source_without_speaker_uses_evidence_speaker`, `test_first_person_without_speaker_skips_alias_lookup` |
| 대표 근거(가장 큰 seq) | 충족 | `test_detail_evidence_uses_task_source_with_largest_seq`, `test_evidence_seqs_saved_as_task_evidence` |
| 승인 payload | 충족 | `test_create_approval_evidence_uses_representative_source`, `test_update_approval_evidence_uses_representative_source` |
| seq 를 못 찾으면 1인칭·승인 payload 가 세 필드로 동작 | 충족 | 위 1인칭 테스트의 `[99]` 경우, `test_create_approval_evidence_uses_representative_source` 의 못 찾은 경우 |
| 별칭 판정 로그 `source_id` | 충족 | `test_alias_log_records_representative_source` |
| `backend/README.md`·BE 계약 문서에 규칙 반영 | 충족 | 이 커밋의 문서 변경 |

생략·빈 배열(`test_evidence_seqs_empty_or_omitted_saves_nothing`), 범위 밖 seq(`test_evidence_seqs_out_of_range_rejected`), 개수 상한(`test_evidence_seqs_too_many_rejected`), 경고 로그 한 줄(`test_evidence_seqs_skip_warns_once_per_item`)도 테스트했다.

## 검증 내역

2026-10-30 로컬(SQLite)에서 `pytest -q` 실행: `test_extraction_evidence.py` 18 passed, 전체 664 passed, 198 skipped. `ruff check .` 통과. 코드 변경만 빼고 돌리면 seq 로 발화를 찾는 경우의 새 테스트 5개가 실패하는 것을 확인했다.

같은 날 코드 리뷰 반영(seq 범위 제한, 경고 로그 한 줄, 1인칭 `evidence_speaker` 우선) 뒤 다시 실행: `test_extraction_evidence.py` 25 passed, 전체 671 passed, 198 skipped. `ruff check .` 통과. 반영한 코드만 빼면 범위·경고 테스트 4건과 1인칭 테스트 2건이 실패하는 것을 확인했다. PostgreSQL 로는 돌리지 않았다.

2026-10-31 PR 리뷰 반영(결론 발화를 못 찾으면 1인칭 화자를 쓰지 않음, 화자가 없는 1인칭은 별칭으로 찾지 않음, 항목마다 seq 100개 상한) 뒤 다시 실행: `test_extraction_evidence.py` 29 passed, 전체 675 passed, 198 skipped. `ruff check .`(0.14.0) 통과. 반영한 코드만 빼면 1인칭 테스트의 `(None, [2, 99])` 경우, 별칭 조회 테스트의 seq 없는 경우, 개수 상한 테스트가 실패하는 것을 확인했다.

## 계획 대비 변경

이슈의 "1인칭 화자(`source.member_id`·`speaker_discord_user_id`)" 중 `speaker_discord_user_id` 만 쓴다. 지금의 `resolve_speaker` 에 넘겨 지운 팀원을 거르는 확인을 그대로 거치기 위해서다. 1인칭 화자는 이슈 규칙 ③·⑦(seq 로 찾으면 seq 우선)과 달리 요청의 `evidence_speaker` 를 먼저 쓴다. 코드 리뷰에서 "가장 큰 seq 가 빠지면 더 앞 발화가 대표가 되어, 다른 사람이 1인칭 담당자로 확정되고 auto 로 태스크까지 생길 수 있다"는 지적이 나왔다. `evidence_speaker` 는 AI 가 결론을 말한 사람으로 직접 보낸 값이라 먼저 쓰고, 없을 때만 대표 근거 발화의 화자를 쓴다. PR 리뷰에서 `evidence_speaker` 가 없을 때도 같은 일이 생긴다는 지적이 나와(예: `[2, 99]` 에서 99 가 없으면 일을 요청한 2번 화자가 담당자), 대표 근거 발화가 요청한 seq 중 가장 큰 것일 때만 그 화자를 쓰고 아니면 화자가 없는 1인칭 항목(`hold`)으로 둔다. 항목 전체를 `hold` 로 돌리는 것보다 좁게, 화자 판정에만 적용했다. 화자가 없는 1인칭 항목은 원래 `assignee_raw`("제가")를 별칭으로 찾아 판정 로그에 쌓였고, 이름이 오면 화자를 모르는데도 그 사람으로 확정될 수 있었다. 이 경로로 가는 경우가 늘어서 함께 고쳤다. 별칭으로 찾지 않고 not_found 로 두되, 원문은 언급 표시로 남겨 judge·legacy 모두 `hold` 다. 보여 주는 근거(승인 요청, 추출 조회)는 하나라도 찾았으면 찾은 것 중 가장 큰 seq 발화를 그대로 쓴다. AI 에는 PR 로 알린다.

## 남은 작업과 제한 사항

- AI 가 아직 `evidence_seqs` 를 보내지 않는다. 보내기 전까지 `evidence` 는 저장되지 않고 동작은 이전과 같다. AI 요청은 이 PR 머지 뒤 따로 정리한다.
- 근거 발화 전체를 응답에 싣는 것과 task 에 바로 붙는 근거(`evidence.task_id`)는 #229 범위 밖이다.

## 관련 기록

없음.
