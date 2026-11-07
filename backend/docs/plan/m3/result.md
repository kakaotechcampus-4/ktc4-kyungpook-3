# 마일스톤 구현 결과

## 작업 근거와 요약

M3 plan.md 는 비어 있다. 이번 작업은 #229(추출 근거를 발화 seq 로 연결해 evidence 저장)의 BE 작업 목록을 근거로 했다. #124 에서 근거를 `evidence` 테이블로 옮긴 뒤 행을 만드는 코드가 없어, 추출 조회의 `evidence` 가 항상 null 이었다.

추출 등록 항목에 `evidence_seqs`(근거 발화의 seq 목록)를 받아 `evidence` 로 저장한다. 찾은 발화 중 seq 가 가장 큰 발화를 대표 근거로 보고, 승인 요청 근거·별칭 판정 로그·추출 조회에 쓴다. 하나도 못 찾으면 지금처럼 요청의 세 필드(`evidence_quote`·`evidence_speaker`·`evidence_at_ms`)를 쓴다. 1인칭 담당자는 요청의 `evidence_speaker` 를 먼저 쓰고, 없을 때는 요청한 seq 중 가장 큰 발화(결론 발화)를 찾았을 때만 그 화자를 쓴다.

2026-11-06 에 #459(승인 때 별칭 학습)의 BE PR ② 를 더했다. 근거는 이슈 #459 의 "정한 규칙"과 설계 확정 댓글이다. 추출 때 담당자를 별칭으로 찾지 못한 이름 지목 항목을 PM 이 담당자를 골라 승인하면서 `save_alias=true` 를 보내면, 회의에서 부른 말을 다듬어 그 팀원의 확인된 별칭으로 저장한다. 이를 위해 추출 항목에 `assignee_type` 을 저장한다. 님·조사 후보 검색과 팀원 이름·디스코드 닉네임 별칭은 PR ① 범위다.

## 실제 구현 및 관련 코드

| 변경 | 위치 |
|---|---|
| `ExtractionItemCreate.evidence_seqs: list[int] \| None`. 원소는 0 ~ 2^31-1(발화 저장 API 의 seq 범위), 항목마다 최대 100개(`MAX_EVIDENCE_SEQS`). 벗어나면 400 | `app/schemas/meeting.py` |
| 요청 전체의 seq 로 이 회의의 `source` 를 한 번에 읽고, 항목 저장 뒤 seq 마다 `evidence`(type=`task`) 저장. 같은 seq 는 한 번만, 없는 seq 는 건너뛰고 항목마다 경고 로그 한 줄 | `app/api/extractions.py` `_sources_by_seq`, `_add_item_evidence` |
| 대표 근거를 가장 작은 seq 에서 가장 큰 seq 로 변경(추출 조회, auto 되돌리기 승인 요청) | `app/api/extractions.py` `_representative_evidence` |
| 승인 요청 payload(생성·수정)의 근거 세 키는 대표 근거 발화로 채움. 발화가 없으면 요청의 세 필드. 둘을 섞지 않음. 1인칭 담당자는 `evidence_speaker`, 없으면 결론 발화(가장 큰 seq)를 찾았을 때만 그 화자 uid. 화자가 없으면 `assignee_raw` 를 별칭으로 찾지 않고 not_found(`hold`) | `app/api/extractions.py` `create_extraction`, `_representative_source`, `_request_evidence`, `_request_task_update` |
| 별칭 판정 로그에 대표 근거 발화의 `source_id` 기록 | `app/services/matching.py` `log_resolution` |
| 계약·설명 | [AI 계약](../../contracts/backend-ai-contract.md), [Backend README](../../../README.md) |


#459 PR ②:

| 변경 | 위치 |
|---|---|
| `extraction_item.assignee_type`(VARCHAR(16) NULL)과 마이그레이션 `c4a7e19d5b32`(down `b0d32ee4abcb`) | `app/models/models.py`, `migrations/versions/` |
| 등록 때 `assignee_type` 저장. 모르는 값·16자 초과는 NULL + 경고 로그. 판단에는 보낸 값 그대로 | `app/api/extractions.py` `create_extraction`, `app/services/alias_learning.py` `storable_assignee_type` |
| `thirdrole` 새 항목은 경로와 상관없이 `auto` → `review` | `app/api/extractions.py` `create_extraction` |
| 글자 다듬기(앞뒤 공백 → 끝 조사 한 번 → 끝 님 → 공백 정리), 학습 대상 판정, 이미 누군가 가진 글자 조회, 저장(savepoint 로 유니크 충돌만 삼킴) | `app/services/alias_learning.py` |
| 응답 `alias_candidate`·`alias_text`: 추출 조회 항목, 승인 요청 생성·목록·단건·처리 | `app/schemas/meeting.py`, `app/schemas/approval.py`, `app/api/extractions.py` `get_extraction`, `app/api/approvals.py` `_to_response` |
| `PATCH /approvals/{id}` 의 `save_alias`(기본 false). task_create 승인에서 `create_task` 뒤에 저장 | `app/schemas/approval.py`, `app/api/approvals.py` `_apply_approval` |
| 계약·설명·결정 | [AI 계약](../../contracts/backend-ai-contract.md), [Backend README](../../../README.md#승인-때-별칭-학습), [결정 기록](basis-for-decision/2026-11-06-learn-alias-on-approval.md) |

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


#459 PR ② 는 이슈의 정한 규칙 ④·⑦과 설계 확정 댓글을 조건으로 대응했다(`tests/services/test_alias_learning.py`, `tests/api/test_alias_learning_approval.py`).

| 조건 | 상태 | 근거 |
|---|---|---|
| 등록 때 `assignee_type` 저장, 모르는 값은 NULL | 충족 | `test_extraction_saves_assignee_type`, `test_extraction_unknown_assignee_type_saved_as_null` |
| `thirdrole` 새 항목은 auto 아님 | 충족 | `test_legacy_thirdrole_item_is_not_auto` |
| 다듬기 규칙 | 충족 | `test_trim_alias_text` |
| 물어볼 항목만 `alias_candidate=true` | 충족 | `test_learnable_alias_text_for_unmatched_name_and_role`, `test_learnable_alias_text_is_none_when_not_learnable`, 추출 조회·승인 목록·단건·반려 뒤·수동 생성 API 테스트 |
| `save_alias=true` 승인으로 learned·verified·0.9 저장 | 충족 | `test_save_alias_creates_learned_alias` |
| 저장하지 않는 경우(생략·false·반려·담당자 있던 항목·대상 외 종류·NULL 옛 항목·담당자 미정·수동 승인·task_update·탈퇴하지 않은 누군가가 이미 가짐). 탈퇴 팀원만 가진 글자는 저장함(`test_alias_held_only_by_departed_member_is_still_candidate_and_saved`) 승인은 성공 | 충족 | 같은 파일의 저장 안 됨 테스트들 |
| 1인칭 지칭어(제·저·나·내·저희·우리·본인·본인은, 끝의 도·들 포함)로 다듬어지면 묻지도 저장하지도 않음 | 충족 | `test_learnable_alias_text_is_none_when_not_learnable`, `test_first_person_word_misclassified_as_thirdname_is_not_alias_candidate_and_not_saved` |
| 찾기 후보 중 하나라도 탈퇴하지 않은 팀원이 가졌으면(동명이인 "하은은") 묻지도 저장하지도 않음 | 충족 | `test_alias_form_held_by_two_members_is_not_candidate_and_not_saved`, `test_alias_lookup_forms_include_matching_candidates_and_saved_text` |
| 승인으로 배운 별칭이 다음 회의에서 찾힘(띄어 쓴 님·연속 공백 포함)과 미매칭 목록에서 빠짐 | 충족 | `test_learned_alias_is_found_in_the_next_meeting`, `test_trimmed_text_is_always_one_of_the_matching_candidates` |
| `thirdrole` 은 묻지도 저장하지도 않음 | 충족 | `test_thirdrole_item_is_not_alias_candidate_and_not_saved`, `test_learnable_alias_text_is_none_when_not_learnable` |
| 유니크 충돌을 삼키고 승인 커밋 | 충족(SQLite) | `test_save_alias_ignores_unique_conflict` |

## 검증 내역

2026-10-30 로컬(SQLite)에서 `pytest -q` 실행: `test_extraction_evidence.py` 18 passed, 전체 664 passed, 198 skipped. `ruff check .` 통과. 코드 변경만 빼고 돌리면 seq 로 발화를 찾는 경우의 새 테스트 5개가 실패하는 것을 확인했다.

같은 날 코드 리뷰 반영(seq 범위 제한, 경고 로그 한 줄, 1인칭 `evidence_speaker` 우선) 뒤 다시 실행: `test_extraction_evidence.py` 25 passed, 전체 671 passed, 198 skipped. `ruff check .` 통과. 반영한 코드만 빼면 범위·경고 테스트 4건과 1인칭 테스트 2건이 실패하는 것을 확인했다. PostgreSQL 로는 돌리지 않았다.

2026-10-31 PR 리뷰 반영(결론 발화를 못 찾으면 1인칭 화자를 쓰지 않음, 화자가 없는 1인칭은 별칭으로 찾지 않음, 항목마다 seq 100개 상한) 뒤 다시 실행: `test_extraction_evidence.py` 29 passed, 전체 675 passed, 198 skipped. `ruff check .`(0.14.0) 통과. 반영한 코드만 빼면 1인칭 테스트의 `(None, [2, 99])` 경우, 별칭 조회 테스트의 seq 없는 경우, 개수 상한 테스트가 실패하는 것을 확인했다.


2026-11-06 #459 PR ②: 로컬(SQLite)에서 `ruff check --no-cache .` 통과, `pytest -q -p no:cacheprovider` 전체 1836 passed, 1301 skipped. 새 두 파일은 60 passed, 31 skipped(PostgreSQL 파라미터, `TEST_DATABASE_URL` 없음). 새 테스트는 구현 전에 실패하는 것을 확인했다. 마이그레이션은 DB 로 돌리지 않았다(`alembic upgrade`·`alembic check` 는 CI migrations 잡에서 확인).

2026-11-07 #463 머지 뒤 develop 을 합치고 마이그레이션 `down_revision` 을 `1032faab5855` 로 맞췄다(`ScriptDirectory` 로 최신 단계가 하나인 것만 확인, DB 는 안 씀). 리뷰 반영(도·들, 찾기 후보 전체 비교, #463 과 이어지는 통합 테스트) 뒤 `ruff check --no-cache .` 통과, `pytest -q -p no:cacheprovider` 전체 2114 passed, 1434 skipped(SQLite). 통합 테스트 `test_learned_alias_is_found_in_the_next_meeting` 은 승인 → 다음 회의에서 찾힘과 미매칭 목록에서 빠짐을 띄어 쓴 입력까지 확인한다.

## 계획 대비 변경

이슈의 "1인칭 화자(`source.member_id`·`speaker_discord_user_id`)" 중 `speaker_discord_user_id` 만 쓴다. 지금의 `resolve_speaker` 에 넘겨 지운 팀원을 거르는 확인을 그대로 거치기 위해서다. 1인칭 화자는 이슈 규칙 ③·⑦(seq 로 찾으면 seq 우선)과 달리 요청의 `evidence_speaker` 를 먼저 쓴다. 코드 리뷰에서 "가장 큰 seq 가 빠지면 더 앞 발화가 대표가 되어, 다른 사람이 1인칭 담당자로 확정되고 auto 로 태스크까지 생길 수 있다"는 지적이 나왔다. `evidence_speaker` 는 AI 가 결론을 말한 사람으로 직접 보낸 값이라 먼저 쓰고, 없을 때만 대표 근거 발화의 화자를 쓴다. PR 리뷰에서 `evidence_speaker` 가 없을 때도 같은 일이 생긴다는 지적이 나와(예: `[2, 99]` 에서 99 가 없으면 일을 요청한 2번 화자가 담당자), 대표 근거 발화가 요청한 seq 중 가장 큰 것일 때만 그 화자를 쓰고 아니면 화자가 없는 1인칭 항목(`hold`)으로 둔다. 항목 전체를 `hold` 로 돌리는 것보다 좁게, 화자 판정에만 적용했다. 화자가 없는 1인칭 항목은 원래 `assignee_raw`("제가")를 별칭으로 찾아 판정 로그에 쌓였고, 이름이 오면 화자를 모르는데도 그 사람으로 확정될 수 있었다. 이 경로로 가는 경우가 늘어서 함께 고쳤다. 별칭으로 찾지 않고 not_found 로 두되, 원문은 언급 표시로 남겨 judge·legacy 모두 `hold` 다. 보여 주는 근거(승인 요청, 추출 조회)는 하나라도 찾았으면 찾은 것 중 가장 큰 seq 발화를 그대로 쓴다. AI 에는 PR 로 알린다.


#459 PR ②: 설계 확정 뒤 최종 리뷰에서 "다른 팀원이 이미 가진 글자를 배우면 그 팀원의 매칭이 애매함으로 바뀐다"는 지적이 나왔다. 사용자 확인을 거쳐 그 글자를 누군가 이미 가졌으면 묻지도 저장하지도 않는 것으로 정했다. PR 리뷰(#464) 뒤 탈퇴 팀원의 별칭은 세지 않는 것으로 바꿨다. #463 의 담당자 찾기가 탈퇴자 별칭을 보지 않아서다. 탈퇴자 별칭은 지우지 않고 PM 이 직접 지울 수 있게 둔다. 이슈 규칙 ④ 의 "이미 있으면 조용히 넘어감"을 다른 팀원까지 넓힌 것이다.

PR 리뷰(#464)에서 AI 가 `thirdrole` 일 때 역할 원문 대신 문맥으로 추측한 이름을 `assignee_raw` 로 보낼 수 있다는 지적이 나왔다. BE 는 원문과 추측을 구분할 수 없어, 사용자 확인을 거쳐 규칙 ④ 의 `thirdrole` 을 학습 대상에서 잠시 뺐다. AI 가 역할 원문만 보내게 되면 다시 넣는다.

## 남은 작업과 제한 사항

- AI 가 아직 `evidence_seqs` 를 보내지 않는다. 보내기 전까지 `evidence` 는 저장되지 않고 동작은 이전과 같다. AI 요청은 이 PR 머지 뒤 따로 정리한다.
- 근거 발화 전체를 응답에 싣는 것과 task 에 바로 붙는 근거(`evidence.task_id`)는 #229 범위 밖이다.

- #459 PR ②:
  - `thirdrole` 은 학습 대상에서 뺐다. AI 가 역할 원문 대신 추측한 이름을 보낼 수 있어서다(#464 리뷰). AI 가 역할 원문만 보내게 되면 다시 넣는다. [BE→AI] 요청은 PR 뒤 따로 올린다.
  - FE 안내 창과 `save_alias` 전송, 멤버별 별칭 관리 화면은 [BE→FE] 요청으로 올린다.
  - 승인 목록 조회마다 `extraction_item.approval_id` 로 찾는 조회가 늘었고, 그 칸에는 인덱스가 없다.
  - 한 글자 별칭("환")은 #463 규칙상 찾을 때 확정 매칭되지 않고 PM 확인으로 간다. 미매칭 목록에서는 해결로 빠진다.

## 관련 기록

- [승인 때 별칭 학습: 저장 대상과 판단 위치](basis-for-decision/2026-11-06-learn-alias-on-approval.md)
- [담당자 별칭 자동 채우기 결정](basis-for-decision/2026-11-06-member-alias-auto-fill.md) (#459)

## 2026-11-06 추가: 담당자 별칭 자동 채우기 (#459 PR ①)

### 작업 근거와 구현

이슈 #459(별칭 자동 채우기와 님·조사 처리)의 BE PR ①이다. 사용자가 설계를 확정하고(이슈 설계 확정 댓글 2026-11-06) M3 로 기록하도록 지시했다. M3 plan.md 는 비어 있어 완료조건이 없고, 마일스톤 완료를 판정하지 않는다. 승인 때 별칭 저장(`assignee_type`)은 PR ②에서 한다.

| 변경 | 위치 |
|---|---|
| "님"·조사를 뗀 후보를 긴 것부터 찾고 처음 걸린 후보로 판정. 탈퇴한 팀원 제외. 후보 규칙은 AI `_name_candidates`와 같음 | `app/services/matching.py` `name_candidates`, `resolve_assignee` |
| 미매칭 목록 해결 판정을 같은 후보 규칙으로 | `app/services/matching.py` `resolved_texts`, `app/api/members.py` `list_unresolved_aliases` |
| 팀원 생성·워크스페이스 생성(PM)·이름 변경 때 이름과 성 뗀 이름을 `source=display_name` 별칭으로(확인됨, 1.0). 이름 변경 때 옛 자동 별칭만 정리 | `app/services/member_aliases.py` `name_alias_forms`, `sync_name_aliases`, `app/models/models.py` `AliasSource.DISPLAY_NAME` |
| 디스코드 연결 때 팀원 저장 뒤 한 명 조회(3초)로 한글 닉네임을 `source=discord_profile` 별칭으로(미확인, 0.8). 실패해도 응답 그대로. 계정 변경·해제 때 옛 닉네임 별칭 삭제 | `app/services/discord.py` `get_guild_member`, `app/services/member_aliases.py` `pick_discord_nickname`, `add_discord_nickname_alias`, `remove_discord_profile_aliases` |
| 기존 팀원(탈퇴 제외) 이름 별칭 채우기 | `migrations/versions/1032faab5855_backfill_member_name_aliases.py` |
| 계약·설명 | [AI 계약](../../contracts/backend-ai-contract.md), [Backend README "담당자 별칭"](../../../README.md) |

### 검증

- 2026-11-06 로컬(SQLite, Python 3.12)에서 새 테스트 7개 파일(`tests/services/test_matching_alias.py`, `tests/api/test_unresolved_aliases_candidates.py`, `tests/services/test_member_aliases.py`, `tests/api/test_member_name_aliases.py`, `tests/api/test_member_discord_alias.py`, `tests/services/test_discord.py`, `tests/test_migration_backfill_member_name_aliases.py`): 128 passed, 45 skipped(PostgreSQL 파라미터). 최신 develop 위로 옮긴 뒤 전체 `pytest -q`: 1876 passed, 1315 skipped. `ruff check .` 통과. 경고는 설치된 FastAPI 의 `starlette.testclient` 사용 경고로 이번 변경과 무관하다.
- 최종 리뷰에서 한 PATCH 로 이름과 디스코드 계정을 함께 바꾸면 이름 별칭이 빠지는 문제가 재현되어 고쳤다(디스코드 별칭 삭제를 먼저 flush 하고 이름 별칭을 다시 맞춘다). 회귀 테스트 3개는 고치기 전 실패를 확인했다.
- 각 태스크마다 테스트를 먼저 쓰고 구현 전 실패를 확인했다(후보 함수 ImportError, 별칭 0개, 마이그레이션 파일 없음 등).
- PostgreSQL(`TEST_DATABASE_URL`)과 로컬 DB 의 `alembic upgrade head`·`alembic check` 는 돌리지 않았다. 사용자 결정으로 CI migrations 잡에서 확인한다. 실제 Discord 호출은 하지 않았고 스텁·`httpx.MockTransport` 로 시험했다.

### 차이와 남은 작업

- 이슈 #459 의 규칙과 다른 점은 없다. 설계에서 정한 세부(출처 값, 닉네임 신뢰도, 겹침·탈퇴·계정 변경 처리)는 [결정 기록](basis-for-decision/2026-11-06-member-alias-auto-fill.md)에 있다.
- 이미 디스코드가 연결된 팀원의 닉네임은 채우지 않았다(나중에 정한다).
- FE 알림(`source` 값 `display_name`, 미매칭 판정 기준, 연결 응답 지연 가능)은 PR ② 뒤 `[BE→FE]` 이슈에 묶는다. AI 는 할 일이 없다.
- 이 마이그레이션은 머지된 #345 의 `b0d32ee4abcb` 뒤에 잇는다. 열린 PR #454 의 마이그레이션은 아직 `537911f267dc` 뒤에 있으므로, 이 PR 이 머지되면 #454 가 `down_revision` 을 맞춰야 한다.
