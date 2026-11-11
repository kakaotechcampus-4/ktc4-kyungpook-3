# 마일스톤 구현 결과

## 작업 근거와 요약

M7 plan.md 는 비어 있다. 이번 작업은 #175 멘토 리뷰(고민 3, `deploy/ec2-deploy.sh` 인라인 리뷰)를 반영하라는 사용자 지시를 근거로 했다. 전체 계획 M7 의 남은 작업 중 "CI 산출물 배치, 마이그레이션, 재시작과 이전 버전 복귀 절차 작성"에 해당한다.

1. 배포 전에 같은 커밋으로 ai·backend·frontend CI 를 모두 돌리고, 하나라도 실패하면 배포하지 않는다.
2. 배포 스크립트가 녹음 확인부터 봇 재시작까지 잠금 파일을 쥔다. 봇 쪽 확인은 AI 에 요청했다.
3. 되돌리기 절차와 마이그레이션 호환 원칙을 문서로 남겼다.

백엔드 CI 보완(마이그레이션·이미지·린트 검사)은 M0 범위라 [M0 결과](../m0/result.md)에 적었다.

### 운영 모니터링 (#675, 2026-11-11)

이슈 #675 와 설계 확정 댓글(2026-11-10)을 근거로 했다. 전체 계획 M7 의 "관찰" 범위에 해당한다. Grafana Cloud 무료 플랜에 서버 상태와 KPI 를 모아 보는 데 필요한 저장소 쪽 작업을 했다. 서버 설치와 Grafana 연결은 사람이 [모니터링 문서](../../../../deploy/monitoring/README.md)대로 한다.

1. `kpi` 스키마에 행 단위 view 3개와 시드 공간 제외 표를 만들었다. ID·이름·제목·본문은 넣지 않는다.
2. 바깥 확인용 `GET /api/v1/health/ready` 를 더했다. DB 가 끊기면 503 `DATABASE_UNAVAILABLE` 이다.
3. Alloy 설정, PDC 실행 스크립트, 읽기 전용 계정 SQL, 설치·운영 문서를 `deploy/monitoring/` 에 두었다. 자동 배포에는 넣지 않았다.

## 실제 구현 및 관련 코드

| 변경 | 위치 |
|---|---|
| 배포 전 CI 세 개를 `workflow_call` 로 부르고 `deploy` 잡이 `needs` 로 기다림. OIDC 권한은 deploy 잡에만 둠 | [deploy.yml](../../../../.github/workflows/deploy.yml) |
| ai·frontend CI 에 `workflow_call` 트리거만 추가(검사 내용은 그대로) | [ai-ci.yml](../../../../.github/workflows/ai-ci.yml), [frontend-ci.yml](../../../../.github/workflows/frontend-ci.yml) |
| 재시작 잠금 `ai/recordings/restart.lock`. 최대 60초 기다리고 못 잡으면 봇 재시작을 건너뛰고 기준 커밋 유지 | [ec2-deploy.sh](../../../../deploy/ec2-deploy.sh) |
| 배포 흐름, 되돌리기, 마이그레이션 원칙 | [배포 안내](../../../../deploy/README.md) |
| PR #190 리뷰 반영: 잠금 파일을 만들거나 열지 못하면 스크립트가 꺼지지 않고 봇 재시작만 건너뜀(60초 초과와 같은 처리) | [ec2-deploy.sh](../../../../deploy/ec2-deploy.sh) |
| PR #190 리뷰 반영: 대기 중이던 수동 실행(mode=all)도 새 push 에 취소되고, 그 배포는 바뀐 파트만 올린다는 안내 | [배포 안내](../../../../deploy/README.md) |
| 봇 쪽 잠금 사용 규칙 요청 | [요청](../../requests/bot-restart-lock.md) |
| #675: KPI view(`kpi.meeting_fact`·`extraction_item_fact`·`approval_fact`)와 `kpi.excluded_workspace`. PostgreSQL 전용이고 다른 DB 에서는 아무것도 하지 않음 | [마이그레이션](../../../migrations/versions/c4f7a2d91e3b_add_kpi_views.py), [테스트](../../../tests/test_migration_kpi_views.py), [README KPI view](../../../README.md) |
| #675: DB 까지 확인하는 ready 엔드포인트와 `DATABASE_UNAVAILABLE`(503) | [health.py](../../../app/api/health.py), [서비스](../../../app/services/health.py), [테스트](../../../tests/api/test_health_ready.py) |
| #675: Alloy·PDC·읽기 계정·시드 제외 설정과 설치 문서 | [deploy/monitoring](../../../../deploy/monitoring/README.md), [파일 검사 테스트](../../../tests/deploy/test_monitoring_files.py) |
| #675: KPI 수집 방법 갱신 | [추가 지표](../../../../docs/techspec/metrics.md) |

## 완료조건 확인

M7 plan.md 가 비어 있어 완료조건이 없다. 전체 계획의 M7 완료 기준("배포와 재시작 후 데이터·작업이 보존되고, 장애 복구 절차를 다른 팀원이 재현할 수 있다")은 판정하지 않았다.

| 조건 | 상태 | 근거 |
|---|---|---|
| 리뷰: 같은 커밋의 검사 성공을 배포 조건으로 | 구현됨 · GitHub 실행 미검증 | actionlint 통과. 실제 push 실행은 머지 뒤 확인 |
| 리뷰: 녹음 시작과 재시작이 같은 잠금 사용 | 배포 쪽 구현됨 · 봇 쪽 미구현 | 잠금 시뮬레이션 통과. 봇은 AI 요청 |
| 리뷰: 되돌리는 방법과 마이그레이션 호환 범위 기록 | 문서화됨 · 절차 미실행 | 백업·downgrade 명령은 운영에서 실행하지 않음 |
| #675: Grafana 가 읽을 KPI view | 구현됨 · 로컬 PostgreSQL 검증 · 운영 미적용 | 아래 검증 내역 |
| #675: 바깥 확인 경로 | 구현됨 · 운영 미확인 | 테스트 통과. 운영 도메인의 `/health` 응답 모양은 확인하지 않음 |
| #675: Alloy·PDC·Grafana·공개 링크 | 문서화됨 · 서버 설치 미실행 | 설정 파일 내용과 스크립트 거부 경로만 테스트 |

## 검증 내역

2026-10-09 로컬(Windows, Docker Desktop)에서 실행했다.

- `rhysd/actionlint:1.7.7` 로 deploy·backend-ci·ai-ci·frontend-ci 검사: 오류 없음
- `koalaman/shellcheck:v0.10.0` 로 `deploy/ec2-deploy.sh` 검사: 경고 없음. `bash -n` 통과
- `ubuntu:24.04` 컨테이너에서 잠금 시뮬레이션
  - 배포가 쥔 동안 봇 방식(`flock -n`)은 거절됨
  - 봇이 2초 쥔 동안 배포 방식(`flock -w`)은 2초 기다린 뒤 잡음
  - 놓지 않으면 대기 시간 뒤 실패함
  - 다른 사용자(mm)가 만든 0644 파일을 ubuntu 가 읽기로 열어 잠금
- 실제 서버 배포, GitHub Actions 에서의 reusable workflow 실행은 확인하지 않았다
- PR #190 리뷰 반영 뒤 같은 날 다시 확인
  - shellcheck 0.10.0: 경고 없음. `bash -n` 통과
  - 바뀐 잠금 구간을 `ubuntu:24.04` 에서 일반 사용자로 실행: 권한 없는 기존 파일과 만들 수 없는 경로는 경고 후 `complete=0` 으로 계속, 정상 파일은 재시작, 다른 프로세스가 쥔 잠금은 대기 시간 뒤 건너뜀. 네 경우 모두 종료 코드 0, 이후 stderr 출력 유지

- #675 (2026-11-11, 로컬)
  - `backend/` 에서 `ruff check --no-cache .` 통과. `pytest -q -p no:cacheprovider`(sqlite) 3216 passed, 2275 skipped
  - KPI view 테스트 11개를 로컬 PostgreSQL 16(`mm_test`, `TEST_DATABASE_URL`)에서 통과. 같은 DB 로 전체 테스트를 돌려 5407 passed, 70 skipped(view 수정 커밋 전 기준)
  - 빈 DB(`mm_migrate`)에서 `alembic upgrade head` 성공, `alembic check` "No new upgrade operations detected", `alembic downgrade -1` 뒤 `kpi` 스키마 없음, 다시 upgrade 성공
  - ready 테스트 3개, 모니터링 파일 테스트 8개 통과. `run-pdc.sh` 의 실제 `docker run`, Alloy·PDC·Grafana Cloud·Synthetic 연결은 실행하지 않았다

## 계획 대비 변경

이슈 초안의 "바뀌지 않은 파트의 검사는 건너뛴다"를 "매번 세 파트를 모두 검사한다"로 바꿨다. 서버는 마지막 성공 배포 이후 바뀐 파트를 올리는데, 이번 push 의 변경만으로 검사 범위를 정하면 앞서 CI 가 실패한 커밋의 파트가 검사 없이 배포될 수 있기 때문이다. 대신 push 마다 frontend 의 storybook·e2e 까지 돌아 배포가 늦어진다. 근거는 [결정 기록](basis-for-decision/2026-10-09-deploy-ci-gate.md)에 있다.

#675 설계에서 바뀐 것

- `approval_fact` 의 원본 선택을 `SELECT r.*` 에서 쓰는 컬럼 나열로 바꿨다. PostgreSQL 이 `*` 를 펼쳐 `approval_request` 의 모든 컬럼을 view 의존으로 잡아, 쓰지 않는 컬럼도 지울 수 없었기 때문이다(셀프 리뷰에서 발견). view 가 쓰는 컬럼 목록이 README 표와 같은지 테스트로 묶었다.
- Alloy 의 컨테이너 수집을 `docker_only=false` 대신 `docker_only=true` 와 워커·봇 cgroup 허용 목록으로 바꿨다. 수집 시계열을 줄이면서 회의 처리 중 워커 메모리를 보기 위해서다. 서버에서 실제로 잡히는지는 설치 때 확인한다.

## 남은 작업과 제한 사항

- 봇이 녹음을 시작할 때 `restart.lock` 을 확인하기 전까지는 확인과 재시작 사이의 틈이 남는다
- 머지 뒤 첫 develop push 에서 CI 세 개 → deploy 순서로 도는지, 실패 시 deploy 가 건너뛰는지 확인해야 한다
- 백업·downgrade 절차는 운영에서 실행해 본 적이 없다. DB 백업·복원 검증은 M7 남은 작업이다
- 서버의 옛 이미지는 배포마다 지워져, 백엔드 되돌리기는 다시 빌드해야 한다
- 리뷰에서 나온 의존성 버전 고정은 반영하지 않았다. `requirements.txt` 가 하한만 정해 CI 와 서버 빌드가 다른 버전을 받을 수 있다. 잠금 파일 도입은 별도 작업으로 남긴다. 2026-11-11 #694 에서 `requirements.lock` 을 도입해 운영 이미지와 CI 가 같은 잠금으로 설치한다(README "의존성 잠금")
- 리뷰에서 나온 대로, CI 도 배포 워크플로의 동시 실행 제한 안에 있어 머지가 몰리면 다음 커밋은 앞 배포가 끝날 때까지 CI 도 시작하지 못한다. 지금은 감수한다

- #675: 서버에 Alloy·PDC 설치, 읽기 계정 SQL, 시드 공간 제외, Grafana 대시보드·공개 링크, 실제 메모리·시계열 수 기록은 사람이 할 일이다
- #675: 운영 `AUTO_CREATE_ENABLED` 값을 확인하지 않았다. 꺼져 있으면 auto 관련 KPI 가 비어 보인다
- #675: auto 탈락 사유 분포, "켰으면 auto 였을 항목", 409 빈도는 DB 에 없어 로그 수집(Loki) 뒤로 넘겼다
- #675: 알림을 보내지 않아 누가 대시보드를 보기 전까지 장애를 모른다. AWS 실습 환경이 2026-11-20 에 끝나면 새 서버에 다시 설치한다

## 관련 기록

- [CI 검사를 배포 조건으로 묶은 방식](basis-for-decision/2026-10-09-deploy-ci-gate.md)
- [Grafana Cloud 모니터링과 KPI view (#675)](basis-for-decision/2026-11-10-grafana-cloud-monitoring.md)
