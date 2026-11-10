# #669 회의 기록 편집 PR 리뷰 반영

- 기록일은 2026-11-11이다. 작업은 2026-11-10에 인계받아 시작했다.
- 근거는 사용자의 PR #645·#669 인계 및 리뷰 반영 지시와 [PR #669](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/669)의 리뷰 4건이다.
- 마일스톤 계획 밖 이슈 작업으로 기록한다. 계획과 파트 README는 수정하지 않았고 마일스톤 완료를 판정하지 않는다.

## 실제 구현과 리뷰 대응

| 대상 | 처리와 근거 |
|---|---|
| 연결되지 않은 태스크 해제 | `project_map._visible_links`에서 현재 보이는 짝만 해제한다. 연결이 없거나 이미 뗀 짝이면 200 상세 응답을 유지하고 `TopicTaskDetach`·`edited_at`을 만들거나 바꾸지 않는다. 없는 태스크, 다른 공간의 태스크와 삭제된 태스크의 404 검사는 유지했다 |
| 재실행 계약 | 팀원이 고친 결정을 고정하고 고친 주제를 보존하는 규칙, 같은 주제·같은 문장의 유일한 결정으로 뒤집기를 옮기는 동작을 계약 표에 반영했다. 대응을 확정할 수 없는 경우의 시간순 재요약과 사람이 고정한 결정의 직접 확인도 구분했다 |
| `invalid`와 이전 결정 | 기존 동작을 유지했다. 후속 결정의 무효화만으로 이전 방침을 재채택했다고 볼 수 없어 이전 결정을 자동으로 되살리지 않는다. 유효한 결정이 비어 있을 수 있다는 한계와 이번 리뷰의 판단을 기록했다 |
| 동시 편집 | 마지막으로 처리된 저장을 유지했다. 요청 버전과 충돌 복구를 함께 추가하는 변경은 이번 범위에서 제외하고, 오래된 화면의 덮어쓰기를 막지 않는다는 사실을 FE 계약과 0067에 명시했다. 과거 결정 이유를 추정하지 않았다 |

구현은 [요약 서비스의 `detach_task`](../../../../backend/app/services/summary.py), 회귀는 [주제·결정 API 테스트](../../../../backend/tests/api/test_topic_decision_edit.py)에 있다. 계약은 [BE·AI](../../../../backend/docs/contracts/backend-ai-contract.md#회의-요약)와 [FE §4.4.3](../../contracts/frontend-api-contract.md#443-회의-기록-고치기-605-2026-11-10)에 반영했다. 판단 근거는 [0067의 리뷰 보완](../../../../ai/docs/basis_for_decision/ai/2026-11-10-0067-human-record-edits-survive-resummary.md)에 있다.

## 검증

수정 전 두 API 회귀가 각각 불필요한 `edited=true`와 반복 요청의 수정 시각 변경으로 실패했다. 부모도 인계 당시 `detach_task`를 메모리에서 불러와 같은 두 실패를 재현했다. 수정 후 연결 없는 요청이 주제를 고정하지 않고 다음 재요약의 고아 제거를 막지 않는 것도 확인했다.

Windows 공통 BE Python과 `TEST_DATABASE_URL=''`로 `backend/`에서 아래 명령을 실행했다.

```powershell
python -m pytest -q -p no:cacheprovider tests/api/test_topic_decision_edit.py tests/api/test_transcript_edit.py tests/api/test_summary_queue.py tests/api/test_summary_save.py tests/api/test_summary_lifecycle.py tests/api/test_project_map.py tests/api/test_meeting_deletion.py tests/api/test_meeting_deletion_rollout.py
```

결과는 304 passed, 322 skipped다. Python은 저장소 루트의 `backend/.venv/Scripts/python.exe`를 사용했다. PostgreSQL 사례와 전용 경합 검사는 환경이 없어 건너뛰었다. 변경한 BE 파일의 Ruff와 `git diff --check`도 통과했다. 두 사용자 동시 편집, 실서버와 UI는 실행하지 않았다.

## 계획 대비 변경과 남은 범위

- 선행 #645의 리뷰 수정과 최신 develop을 일반 merge로 반영했다. PR의 base는 develop 그대로이며 이력을 재작성하지 않았다.
- 마이그레이션과 편집 요청 스키마는 바꾸지 않았다. #645와 같은 AI 코드·테스트를 사용하며, AI 검증은 #645 결과에서 구분해 기록한다.
- 버전 기반 편집 충돌 방지는 후속 선택지다. `invalid` 정책을 바꾸려면 이전 결정의 재채택 의미를 별도로 정해야 한다.
- `deslop` 스킬이 없어 전용 검사는 수행하지 못했고 독립 검토와 실제 테스트로 확인했다.

## 2026-11-11 PR 동기화 복구

원격 브랜치 `feature/605-record-edits`는 `07059bda`였지만 PR API의 `head.sha`와 `refs/pull/669/head`는 이전 `fe76543f`에 머물렀다. GraphQL에서도 같은 PR의 `headRef.target.oid`와 `headRefOid`가 각각 두 값으로 달랐다. 원본 저장소와 브랜치 이름은 일치했고 native stack은 없었다. 새 커밋의 Actions 실행도 없었다. 따라서 로컬 커밋이나 push 누락, 조회 화면만의 캐시가 아니라 GitHub의 PR 전용 ref 갱신이 멈춘 상태로 좁혔다. GitHub 내부에서 처음 갱신이 누락된 이유까지는 확인하지 못했다.

코드를 바꾸지 않은 `2eaa5ee1`을 일반 push해 새 `synchronize` 처리를 요청했다. 직후 소스 ref, REST·GraphQL의 PR head가 모두 `2eaa5ee1`로 일치했고 AI·BE·FE Actions 실행이 새로 생성됐다. 기존 커밋을 재작성하거나 base를 바꾸지 않았다. GitHub 공식 저장소의 [유사 ref 불일치 보고](https://github.com/github/gh-stack/issues/519)에도 새 일반 push로 복구한 사례가 있지만, 그 보고는 native stack 사례이므로 이 PR과 원인까지 같다고 단정하지 않는다.

재확인은 `python .verify/pr-review-takeover/inspect_669_sync.py`, `python .verify/pr-review-takeover/check_ci.py`와 원격 `refs/pull/669/head` 조회로 했다. 이 로컬 helper들은 저장소에 포함하지 않는다. 최신 커밋의 CI 완료 여부는 아래 후속 검증에서 별도로 기록한다.

## 선행 #645 CI 수정 반영

#645의 BE CI 실패는 새 승인 대기 규칙과 develop의 데모 시드가 충돌한 것이었다. `b0085119`의 수정을 일반 merge해 이 PR에도 반영한다. 승인 완료 회의 5개와 독립된 pending 시연 회의를 분리하고, 새 추출만 정상 PM 승인 API를 거친다. 기존 추출과 사용자의 처리 상태는 보존한다. 선행 수정의 PostgreSQL·SQLite 시드 전체 **129 passed**, 별도 독립 SQLite 검토 **40 passed, 25 skipped**와 세부 근거는 [#645 후속 결과](../645-summary-review/result.md#2026-11-11-ci-실패-후속-수정)에 있다. 이 PR의 최신 원격 CI는 병합 후 커밋을 기준으로 따로 확인한다.
