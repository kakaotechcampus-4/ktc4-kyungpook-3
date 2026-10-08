# 배포

EC2 한 대에 백엔드(API·DB 컨테이너), 프론트엔드 정적 파일, 녹음 봇·AI 워커(systemd)를 함께 올린다.

## 흐름

1. develop 에 push 되면 [deploy.yml](../.github/workflows/deploy.yml)이 같은 커밋으로 ai·backend·frontend CI 를 모두 돌린다. 하나라도 실패하면 배포하지 않는다.
2. 세 검사가 통과하면 SSM 으로 서버의 `/opt/mm` 을 그 커밋까지 fast-forward 하고 [ec2-deploy.sh](ec2-deploy.sh)를 실행한다.
3. 스크립트는 마지막으로 끝까지 성공한 배포(`.git/mm-deployed-sha`) 이후 바뀐 파트만 다시 올린다. 백엔드 컨테이너는 시작하면서 `alembic upgrade head` 를 먼저 한다.
4. 녹음 중이면 봇을 재시작하지 않고 기준 커밋을 그대로 둔다. 녹음이 끝난 뒤 Actions 에서 deploy 를 수동 실행하면 다시 올린다.

배포는 한 번에 하나씩 돈다. 대기 중인 배포가 있는데 새 push 가 오면 대기 중이던 것은 취소되고 새 커밋이 배포된다(새 커밋이 앞의 변경을 포함한다).

## 녹음과 봇 재시작

스크립트는 녹음 중인지 확인할 때부터 봇을 다시 띄울 때까지 `ai/recordings/restart.lock` 을 쥔다. 60초 안에 못 잡으면 봇 재시작을 건너뛰고 다음 배포에 맡긴다.

봇이 새 녹음을 시작할 때 이 잠금을 확인해야 확인과 재시작 사이의 틈이 닫힌다. 봇 쪽은 아직 구현되지 않았다([요청](../backend/docs/requests/bot-restart-lock.md)). 그 전까지는 이 틈이 남지만, 배포 순서와 상관없이 지금보다 나빠지지는 않는다.

## 되돌리기

`mm-deployed-sha` 는 다음 배포의 비교 기준일 뿐이다. 서비스나 DB 를 이전 상태로 되돌리지 않는다.

### 코드만 되돌릴 때

문제 커밋을 develop 에서 `git revert` 하고 머지한다. CI 를 통과하면 자동으로 배포된다. 서버는 빌드 뒤 이름을 잃은 옛 이미지를 지우므로(`docker image prune -f`) 백엔드는 이전 이미지로 바로 바꾸지 못하고 다시 빌드한다.

### 마이그레이션이 들어간 커밋을 되돌릴 때

revert 만 하면 DB 는 코드에 없는 리비전에 남는다. 그러면 새 컨테이너의 `alembic upgrade head` 가 리비전을 찾지 못해 API 가 뜨지 않는다. 둘 중 하나로 한다.

- 권장: 되돌리는 내용을 새 마이그레이션으로 만들어 앞으로 배포한다. 리비전 순서가 끊기지 않는다.
- revert 가 꼭 필요하면 revert 를 머지하기 전에 서버에서 지금 이미지로 리비전을 내린다. 먼저 백업한다.

```bash
cd /opt/mm
docker compose -f backend/docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > ~/mm-backup-$(date +%F-%H%M).sql
docker compose -f backend/docker-compose.prod.yml run --rm api alembic downgrade <되돌릴 커밋 직전 리비전>
```

downgrade 와 revert 배포 사이에는 새 코드가 옛 스키마에서 돈다. 이 시간을 줄이려면 revert PR 을 먼저 열어 CI 를 통과시켜 두고, downgrade 직후 머지한다. 위 백업·downgrade 명령은 아직 운영에서 실행해 보지 않았다.

## 마이그레이션 호환 원칙

되돌리면 이전 코드가 새 스키마 위에서 돌 수 있다. downgrade 는 자동으로 실행하지 않으므로, 마이그레이션은 이전 코드와도 맞게 만든다.

- 컬럼·테이블 추가는 이전 코드가 몰라도 되게 한다. 새 컬럼은 nullable 이거나 서버 기본값을 둔다.
- 삭제와 이름 변경은 두 번에 나눈다. 먼저 코드가 더는 쓰지 않게 배포하고, 다음 배포에서 지운다.
- NOT NULL 은 값을 채우는 마이그레이션 뒤에 건다.
- backend-ci 의 migrations 잡이 빈 Postgres 에 `alembic upgrade head` 와 `alembic check`(모델과 마이그레이션 차이)를 확인한다. 기존 운영 데이터 위에서의 업그레이드는 검사하지 않는다.

## 수동 실행

Actions → deploy → Run workflow 에서 develop 을 고른다. mode 를 all 로 고르면 세 파트를 모두 다시 올린다. 수동 실행도 세 CI 를 먼저 통과해야 한다.
