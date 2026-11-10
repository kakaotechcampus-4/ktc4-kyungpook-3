# #645 승인 뒤 요약 PR 리뷰 반영

- 기록일은 2026-11-11이다. 작업은 2026-11-10에 인계받아 시작했다.
- 근거는 사용자의 PR #645·#669 인계 및 리뷰 반영 지시와 [PR #645](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/645)의 리뷰 10건이다.
- 마일스톤 계획 밖 이슈 작업으로 기록한다. 계획과 파트 README는 수정하지 않았고 마일스톤 완료를 판정하지 않는다.

## 실제 구현과 리뷰 대응

| 대상 | 처리와 근거 |
|---|---|
| 승인 대기 CLI 종료 코드 | `--run`과 `--all`에서 `awaiting_approval` 행을 `result=left`로 출력하고 종료 코드 2를 반환한다. 승인 대기 회의를 직접 claim하거나 LLM에 보내지 않는다 |
| CLI 비용 대상 | 줄 세우기는 `requested`·`queued`·`awaiting_approval` 전체의 워커 처리 예정액을 추정한다. 직접 실행과 미리 보기는 각각의 대상만 계산하고 출력에 범위를 적는다. 단가와 추정식은 바꾸지 않았다 |
| 가짜 BE 계약 | `rejected_items`, `status`, `cleared`, `scope`를 포함한다. 승인 대기 회의를 claim하지 않는 워커 검증을 추가했다 |
| 저장된 요약 상태 | 재처리 표시가 없는 요약은 승인된 태스크를 나중에 지워도 `done`이다. `force=true`면 현재 승인 상태를 다시 판정한다 |
| 용어 순서와 상한 | Python의 Unicode 코드 포인트 순서로 정렬한다. 전체 목록 제공은 유지했다. 용어를 버릴 기준이나 입력 크기 측정 근거가 없어 임의 상한을 추가하지 않았다 |
| 합친 카드의 회의별 값 | PM이 수정하지 않으면 각 회의 항목의 값, 수정하면 각 항목에 PM 수정값을 덮는 기존 계약을 API 테스트로 고정했다 |
| 회의 삭제와 승인 보정값 | 삭제 원문과 승인 payload를 지우는 기존 경계를 유지했다. 처리된 합친 카드에서 한 회의를 지우면 살아 있는 회의가 보정값을 잃고 원래 항목값으로 돌아오는 한계를 API 테스트와 두 계약에 명시했다. `task_update`는 정상 합치기 대상이 아니다 |
| 결정 번호 중복 | 인계 전 커밋 `f3bb86de`에서 0066으로 변경됐다. 0059의 번복 링크, 진행 로그와 실제 파일명을 확인했다 |
| 운영자 조회 N+1 | 회의마다 `item_fate.readiness`를 읽는 동작을 유지했다. 판정 소유권과 일괄 조회를 함께 바꾸는 최적화는 이번 정확성 수정에서 제외했다. 성능을 측정하거나 개선했다고 보고하지 않는다 |
| 독립 검토 | 생성 시각 동률에서 출력 순서를 가정한 기존 테스트 두 곳을 확인했다. 승인 카드는 태스크 ID로 찾고 반환값은 항목별로 검증한다 |

구현은 [CLI](../../../../ai/capture/backfill_summaries.py), [가짜 BE](../../../../ai/tests/capture/fake_be.py), [요약 서비스](../../../../backend/app/services/summary.py)에 있다. 회귀는 [CLI 테스트](../../../../ai/tests/capture/test_backfill_summaries.py), [워커 테스트](../../../../ai/tests/capture/test_summary_sweep.py), [API 테스트](../../../../backend/tests/api/test_summary_queue.py)에 있다.

## 검증

수정 전 부모와 구현 담당이 CLI 4건과 완료 요약 상태 1건의 실패를 확인했다. 독립 검토에서 기존 테스트의 순서 가정도 실패로 재현했다.

| 환경과 명령 | 결과 |
|---|---|
| WSL Ubuntu 24.04, Python 3.12.3. `ai/`에서 `.venv-wsl/bin/python -m pytest -q -o addopts= -p no:cacheprovider --tb=short` | 3058 passed, 26 skipped |
| Windows의 공통 BE 가상환경, `TEST_DATABASE_URL=''`. `backend/`에서 `python -m pytest -q -p no:cacheprovider tests/api/test_summary_queue.py tests/api/test_summary_save.py tests/api/test_summary_lifecycle.py tests/api/test_project_map.py tests/api/test_meeting_deletion.py tests/api/test_meeting_deletion_rollout.py` | 227 passed, 245 skipped |
| BE `ruff check app/services/summary.py tests/api/test_summary_queue.py` | 통과 |
| `git diff --check` | 통과 |

BE Python은 저장소 루트의 `backend/.venv/Scripts/python.exe`를 사용했다. PostgreSQL 환경이 없어 해당 사례와 PostgreSQL 전용 경합 검사는 건너뛰었다. Windows의 AI 전체 실행은 `resource`·`fcntl` 수집 오류로 끝났다. 일부 capture 테스트도 환경·프로세스 제약으로 실패해 WSL에 저장소 의존성을 설치하고 위 전체 테스트를 실행했다. 환경 문제를 제품 코드 변경으로 우회하지 않았다.

## 계획 대비 변경과 남은 범위

- 최신 develop을 일반 merge했다. FE 계약 충돌에서는 develop의 `processing`과 이 PR의 승인 대기 필드를 함께 보존했다.
- 실제 모델 호출, 운영 재처리, 요약 스위치 활성화, 배포는 하지 않았다.
- 회의 삭제 후 승인값 소실, 용어 무제한 제공, 운영자 목록 조회 최적화는 위 표의 한계로 남는다.
- `deslop` 스킬은 설치 목록과 로컬 경로에서 찾지 못했다. 별도 검토, Ruff와 실제 회귀 테스트로 변경을 확인했다.

계약은 [BE·AI](../../../../backend/docs/contracts/backend-ai-contract.md#회의-요약)와 [FE](../../contracts/frontend-api-contract.md)에 반영했다. 기존 판단 근거는 [0066](../../../../ai/docs/basis_for_decision/ai/2026-11-10-0066-summary-after-approval.md)에 있다.
