# 마일스톤 구현 결과

## 작업 근거와 요약

M0 plan.md 는 비어 있다. 이번 작업은 #175 멘토 리뷰의 배포 조건 연결과 함께 백엔드 CI 를 보완하라는 사용자 지시를 근거로 했다. 전체 계획 M0 의 남은 작업 중 "빈 DB 초기화와 기존 DB 업그레이드를 CI에서 검증한다"의 앞부분(빈 DB 초기화)에 해당한다.

backend-ci 에 린트, 빈 Postgres 마이그레이션, 운영 이미지 빌드 잡을 더했다. 이 CI 는 PR 과 develop 배포 전(deploy.yml)에 모두 돈다. 배포 연결은 [M7 결과](../m7/result.md)에 적었다.

## 실제 구현 및 관련 코드

| 잡 | 하는 일 |
|---|---|
| lint | `ruff check .` (규칙은 [ruff.toml](../../../ruff.toml), ruff 기본값 E4·E7·E9·F) |
| test | 기존 pytest. pgvector 서비스와 `TEST_DATABASE_URL` 그대로 |
| migrations | 따로 띄운 pgvector Postgres 에 `alembic upgrade head` 후 `alembic check`(모델과 마이그레이션 차이) |
| image | 운영 Dockerfile 빌드 후 컨테이너에서 `import app.main` |

- 워크플로: [backend-ci.yml](../../../../.github/workflows/backend-ci.yml)
- `requirements-dev.txt` 에 `ruff==0.14.0` 추가
- 기존 위반 3건 수정
  - `app/api/meetings.py` 의 맨 `except:` 를 `except ValueError:` 로 바꿈(`json.loads` 실패만 받음)
    - PR #190 리뷰 반영: JSON 으로는 맞지만 객체가 아닌 요약(목록·문자열·숫자)도 응답 스키마(`dict | None`)에서 500 이 나서 `None` 으로 바꿈. 테스트는 `tests/api/test_meeting_derived_fields.py`
  - `app/api/members.py`, `tests/api/test_task_actor.py` 의 쓰지 않는 import 삭제

## 완료조건 확인

M0 plan.md 가 비어 있어 완료조건이 없다. 마일스톤 완료를 판정하지 않았다.

| 조건 | 상태 | 근거 |
|---|---|---|
| 전체 계획: 빈 DB 초기화를 CI 에서 검증 | 구현됨 · GitHub 실행 미검증 | 로컬 pgvector 에서 같은 명령 통과 |
| 전체 계획: 기존 DB 업그레이드를 CI 에서 검증 | 미구현 | 운영 데이터와 비슷한 기존 DB 를 만드는 방법이 정해지지 않음 |

## 검증 내역

2026-10-09 로컬(Windows, Docker Desktop)에서 실행했다.

- `pgvector/pgvector:pg16` 빈 DB 에 `alembic upgrade head`: 마지막 리비전 `a2c7e5d91b48` 까지 성공
- `alembic check`: "No new upgrade operations detected."
- `ruff check .` (0.14.0): 위반 3건 수정 뒤 "All checks passed!"
- `docker build` 후 `python -c "import app.main"`: 성공
- `pytest -q -rs`(pg 테스트 포함): 662 passed, 1 skipped(SQLite 의 FOR UPDATE 미지원으로 원래 건너뛰는 테스트)
- `rhysd/actionlint:1.7.7`: 오류 없음
- GitHub Actions 에서의 실제 실행은 PR 을 연 뒤 확인한다
- PR #190 리뷰 반영 뒤(2026-10-09): 회의록 요약 테스트 5개 추가. 수정 전 코드로는 목록·문자열·숫자 3개가 실패하고 수정 뒤 통과. SQLite 전체 `pytest -q` 492 passed, 176 skipped. `ruff check .` 통과. pg 포함 전체 실행은 다시 하지 않았다

## 계획 대비 변경

계획이 비어 있어 비교할 대상이 없다.

## 남은 작업과 제한 사항

- 기존 데이터가 있는 DB 에서의 업그레이드 검증은 하지 않는다
- downgrade 는 검사하지 않는다. 운영에서도 자동으로 실행하지 않는다([배포 안내](../../../../deploy/README.md))
- ruff 는 기본 규칙만 쓴다. 규칙을 늘리면 기존 코드 정리가 함께 필요하다

## 관련 기록

없음
