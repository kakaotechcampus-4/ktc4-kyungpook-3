# 마일스톤 구현 결과

## 작업 근거와 요약

M7 plan.md 는 비어 있다. 이번 작업은 #175 멘토 리뷰(고민 3, `deploy/ec2-deploy.sh` 인라인 리뷰)를 반영하라는 사용자 지시를 근거로 했다. 전체 계획 M7 의 남은 작업 중 "CI 산출물 배치, 마이그레이션, 재시작과 이전 버전 복귀 절차 작성"에 해당한다.

1. 배포 전에 같은 커밋으로 ai·backend·frontend CI 를 모두 돌리고, 하나라도 실패하면 배포하지 않는다.
2. 배포 스크립트가 녹음 확인부터 봇 재시작까지 잠금 파일을 쥔다. 봇 쪽 확인은 AI 에 요청했다.
3. 되돌리기 절차와 마이그레이션 호환 원칙을 문서로 남겼다.

백엔드 CI 보완(마이그레이션·이미지·린트 검사)은 M0 범위라 [M0 결과](../m0/result.md)에 적었다.

## 실제 구현 및 관련 코드

| 변경 | 위치 |
|---|---|
| 배포 전 CI 세 개를 `workflow_call` 로 부르고 `deploy` 잡이 `needs` 로 기다림. OIDC 권한은 deploy 잡에만 둠 | [deploy.yml](../../../../.github/workflows/deploy.yml) |
| ai·frontend CI 에 `workflow_call` 트리거만 추가(검사 내용은 그대로) | [ai-ci.yml](../../../../.github/workflows/ai-ci.yml), [frontend-ci.yml](../../../../.github/workflows/frontend-ci.yml) |
| 재시작 잠금 `ai/recordings/restart.lock`. 최대 60초 기다리고 못 잡으면 봇 재시작을 건너뛰고 기준 커밋 유지 | [ec2-deploy.sh](../../../../deploy/ec2-deploy.sh) |
| 배포 흐름, 되돌리기, 마이그레이션 원칙 | [배포 안내](../../../../deploy/README.md) |
| 봇 쪽 잠금 사용 규칙 요청 | [요청](../../requests/bot-restart-lock.md) |

## 완료조건 확인

M7 plan.md 가 비어 있어 완료조건이 없다. 전체 계획의 M7 완료 기준("배포와 재시작 후 데이터·작업이 보존되고, 장애 복구 절차를 다른 팀원이 재현할 수 있다")은 판정하지 않았다.

| 조건 | 상태 | 근거 |
|---|---|---|
| 리뷰: 같은 커밋의 검사 성공을 배포 조건으로 | 구현됨 · GitHub 실행 미검증 | actionlint 통과. 실제 push 실행은 머지 뒤 확인 |
| 리뷰: 녹음 시작과 재시작이 같은 잠금 사용 | 배포 쪽 구현됨 · 봇 쪽 미구현 | 잠금 시뮬레이션 통과. 봇은 AI 요청 |
| 리뷰: 되돌리는 방법과 마이그레이션 호환 범위 기록 | 문서화됨 · 절차 미실행 | 백업·downgrade 명령은 운영에서 실행하지 않음 |

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

## 계획 대비 변경

이슈 초안의 "바뀌지 않은 파트의 검사는 건너뛴다"를 "매번 세 파트를 모두 검사한다"로 바꿨다. 서버는 마지막 성공 배포 이후 바뀐 파트를 올리는데, 이번 push 의 변경만으로 검사 범위를 정하면 앞서 CI 가 실패한 커밋의 파트가 검사 없이 배포될 수 있기 때문이다. 대신 push 마다 frontend 의 storybook·e2e 까지 돌아 배포가 늦어진다. 근거는 [결정 기록](basis-for-decision/2026-10-09-deploy-ci-gate.md)에 있다.

## 남은 작업과 제한 사항

- 봇이 녹음을 시작할 때 `restart.lock` 을 확인하기 전까지는 확인과 재시작 사이의 틈이 남는다
- 머지 뒤 첫 develop push 에서 CI 세 개 → deploy 순서로 도는지, 실패 시 deploy 가 건너뛰는지 확인해야 한다
- 백업·downgrade 절차는 운영에서 실행해 본 적이 없다. DB 백업·복원 검증은 M7 남은 작업이다
- 서버의 옛 이미지는 배포마다 지워져, 백엔드 되돌리기는 다시 빌드해야 한다

## 관련 기록

- [CI 검사를 배포 조건으로 묶은 방식](basis-for-decision/2026-10-09-deploy-ci-gate.md)
