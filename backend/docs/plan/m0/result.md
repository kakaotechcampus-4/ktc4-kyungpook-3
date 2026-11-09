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

- [CI의 uv 설치 버전을 고정한다](basis-for-decision/2026-11-08-pin-ci-uv-version.md)

## 2026-11-08 추가: PR 병합 전 CI 도구 설치 안정화

사용자가 PR #454·#518·#524의 검증과 순차 병합을 요청했다. M0 계획은 비어 있으므로 마일스톤 완료를 판정하지 않는다.

백엔드·AI CI에서 `setup-uv@v3`의 latest 다운로드가 HTTP 504로 반복 실패했다. 성공한 #454 lint 작업이 설치한 `0.13.7`을 공식 릴리스와 대조해 같은 버전으로 고정했다. 이 액션이 받지 않는 `python-version` 입력을 제거했고 실제 Python 선택은 기존 `uv venv --python 3.12`를 유지했다. 서비스 코드나 의존성 범위는 변경하지 않았다.

지원 입력은 액션의 `action.yml`, 설치 버전은 실제 성공 작업 로그로 확인했다. 워크플로우의 실제 설치·검사 성공은 이 변경 커밋의 CI에서 확인한다. 이번 수정은 모든 네트워크 장애를 막는 변경이 아니다. 선택과 한계는 위 결정 기록에 남겼다.

## 2026-11-09 추가: 소켓 테스트의 연결과 정리 순서

#572의 처리 가능한 코드·문서를 마무리하라는 사용자 지시에 따라 [PR #589](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/589)에서 테스트 DB의 세션 경계를 보완했다. M0 계획은 여전히 비어 있으므로 마일스톤 완료를 판정하지 않는다.

- [API 공통 픽스처](../../../tests/api/conftest.py)는 기존 메모리 SQLite를 기본으로 유지한다. [소켓 검사](../../../tests/api/test_message_socket.py)만 테스트마다 파일 DB를 사용해 인증과 HTTP 쓰기의 연결을 분리한다. 공유 연결의 인증 세션 종료가 다른 세션의 미완료 메시지를 롤백하던 실제 반례를 확인했다.
- 소켓 픽스처는 `Condition`과 활성 세션 수로 인증 세션의 실제 종료를 관찰한다. 테스트 세션을 먼저 닫아 잠금을 풀고 인증 세션이 모두 닫힌 뒤 기존 `drop_all`로 DB를 정리한다. 취소된 소켓 task의 worker thread가 인증 SQL을 실행하는 중에 `DROP TABLE`이 시작되던 PostgreSQL 교착을 수정한다.
- 로컬 Windows에서 수정 전 PostgreSQL outbox 검사 10회는 본문 10개 통과 뒤 정리 오류 1건이었다. 원본 develop에서도 같은 정리 오류 2건을 재현했다. 수정 후 같은 10회가 정리 오류 없이 통과했다.
- 최종 소켓·탈퇴 모듈은 SQLite·격리 PostgreSQL에서 122개 통과했다. 원래 SQLite 다중 탭 검사는 30회 통과했다. 열린 소켓에서 탈퇴 202, 소켓 종료 4401, 후속 HTTP 401을 두 DB에서 확인한 별도 검사도 2개 통과했다. 기존 테스트 본문 39개와 운영 코드는 변경하지 않았다.
- Windows에는 `SIGALRM`이 없어 로컬 검증 플러그인이 해당 종료 장치만 대체했고, 별도 프로세스 제한을 적용했다. 제출 코드의 프레임 대기 제한 20초는 유지한다. 추가한 세션 정리 대기도 20초 안에 종료되지 않으면 실패하며 프레임 제한을 완화하지 않는다. Ruff·diff 검사와 보호 문서 37개 해시 비교를 통과했다.

이 기록 시점의 최종 Linux 전체 CI와 독립 재검증·병합은 미완료다. 운영 배포나 실계정 검증을 수행한 결과가 아니다. [연결 분리와 세션 종료 관찰 결정](basis-for-decision/2026-11-09-socket-test-session-boundary.md)에 실제 대안과 제약을 기록했다.
