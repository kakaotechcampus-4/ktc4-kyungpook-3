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

구현은 [CLI](../../../../../../ai/capture/backfill_summaries.py), [가짜 BE](../../../../../../ai/tests/capture/fake_be.py), [요약 서비스](../../../../../../backend/app/services/summary.py)에 있다. 회귀는 [CLI 테스트](../../../../../../ai/tests/capture/test_backfill_summaries.py), [워커 테스트](../../../../../../ai/tests/capture/test_summary_sweep.py), [API 테스트](../../../../../../backend/tests/api/test_summary_queue.py)에 있다.

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

계약은 [BE·AI](../../../../../../backend/docs/contracts/backend-ai-contract.md#회의-요약)와 [FE](../../../../contracts/frontend-api-contract.md)에 반영했다. 기존 판단 근거는 [0066](../../../../../../ai/docs/basis_for_decision/ai/2026-11-10-0066-summary-after-approval.md)에 있다.

## 2026-11-11 CI 실패 후속 수정

사용자가 #669 동기화 복구와 #645 CI 수정을 지시했다. `c07d40ef`의 [BE CI](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/actions/runs/42842946629/job/129922690937)는 데모 시드 테스트 4개가 SQLite·PostgreSQL 양쪽에서 실패해 8 failed, 5584 passed, 71 skipped였다. 기존 데모 회의 5개 모두 pending 카드가 남아 새 승인 대기 규칙에 따라 claim이 거절됐고, 예상 요약 5개 대신 0개가 저장됐다. 부모도 같은 SQLite 실패 4개를 직접 재현했다.

승인 판정은 완화하지 않고 시드를 고쳤다. 기본 데이터의 기존 회의 5개에 `approval_state: approved`를 명시하고 이번 실행에서 새로 만든 추출의 카드를 실제 PM 로그인과 승인 API로 처리한 뒤 고정 요약을 쓴다. 독립된 6번째 회의에는 review·hold 카드가 하나씩 남는다. 최초 정상 결과는 `done=6`, `summaries_written=5`, `summaries_skipped=[]`이고 마지막 회의는 `awaiting_approval`이다. 원래 5개 회의의 원문·항목·요약과 공통 인물·용어는 보존했다.

사용자 지정 데이터의 정책 기본값은 `pending`이다. 독립 검토에서 approved 회의의 merge 입력이 기존 pending 카드를 승인하는 문제를 재현해, approved 정책의 입력은 `create`만 허용하도록 파서에서 제한했다. pending 정책의 기존 merge·update 입력은 유지했다. 서버의 PM 인증, 서비스 토큰 권한, Secure 쿠키 설정과 요약 게이트는 바꾸지 않았다. CLI는 실제 로그인 쿠키를 같은 API의 승인 요청에 보내고 외부 리디렉션을 따르지 않는다.

재실행은 기존 추출의 카드와 요약을 보존한다. 중단된 시드와 사람이 보류한 상태를 구분할 수 없어 기존 추출은 자동 승인하지 않으며, 요약이 없어도 정적 시드 요약을 다시 넣지 않는다. 승인 완료로 선언한 회의의 요약이 없으면 `summaries_skipped`로 보고한다. 부분 시드의 완전 자동 복원보다 사용자의 처리 보존을 택한 근거는 [0066의 CI 통합 기록](../../../../../../ai/docs/basis_for_decision/ai/2026-11-10-0066-summary-after-approval.md#2026-11-11-데모-시드와의-통합)에 있다. [CLI 사용법](../../../../../../backend/README.md#심사용-시드)도 이 제한과 실제 PM 비밀번호 요구를 반영했다. 웹·봇 API 계약은 변경하지 않았다.

### 후속 검증

| 범위 | 실행과 실제 결과 |
|---|---|
| 최종 시드 전체 | WSL Python 3.12, PostgreSQL 16·pgvector의 전용 `mm_ci645_impl_20261111` DB와 SQLite. `tests/api/test_demo_seed_data.py`, `test_demo_seed_accounts.py`, `test_demo_seed_cli.py`, `test_demo_seed_meetings.py`를 `pytest -q -p no:cacheprovider`로 실행해 **129 passed**, skip 없음 |
| 독립 재검토 | SQLite의 data·meeting 파일 전체 **40 passed, 25 skipped**. DB 매개변수에서 PostgreSQL 사례는 이 실행에서 건너뛰었다 |
| 요약·삭제 주변 회귀 | 별도 PostgreSQL DB와 SQLite에서 seed meeting·summary queue·summary save·meeting deletion 4파일을 실행해 331 passed, 8 skipped, 2 failed였다. 두 실패는 로컬 DB 기본 시간대가 Asia/Seoul인 데 따른 기존 UTC 문자열 단언이었다. 전용 DB를 CI와 같은 UTC로 맞춘 뒤 해당 두 테스트를 양 DB에서 다시 실행해 **4 passed**였다. 제품 코드로 환경 차이를 우회하지 않았다 |
| 데이터 보존 | `c07d40ef`의 JSON과 비교해 기존 5개 회의는 정책 필드 외에 같고, 공통 인물·용어도 같은 것을 확인했다 |
| 정적 검사 | 변경 Python 파일 Ruff, `git diff --check`, 추가 상대 링크와 보호 문서 검사 통과 |

HTTP·HTTPS에서의 정상 로그인과 승인, 외부 리디렉션 차단, 기존 pending·반려·PM 수정과 실제 워커 요약의 재실행 보존을 API 회귀로 확인했다. 유료 LLM·임베딩 호출, 운영 시드 실행과 배포는 하지 않았다. 최종 원격 CI는 두 PR의 최신 커밋 체크에서 별도로 확인한다.
