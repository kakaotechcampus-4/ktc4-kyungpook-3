#!/usr/bin/env bash
# EC2 배포 스크립트. .github/workflows/deploy.yml 이 SSM 으로 git 을 새 커밋까지 올린 뒤 ubuntu 사용자로 부른다.
#
#   bash /opt/mm/deploy/ec2-deploy.sh <배포 전 커밋> [changed|all]
#
# changed(기본)는 배포 전 커밋과 지금 HEAD 사이에 바뀐 파트만 다시 올린다. all 은 세 파트를 모두 올린다.
# 문서·테스트만 바뀐 파트는 건너뛴다. 봇 재시작은 진행 중인 녹음을 끊기 때문이다.
# git 갱신은 이 스크립트 밖(deploy.yml)에서 한다. 실행 중인 스크립트 파일을 git 이 덮어쓰면 bash 가 바뀐 줄을 읽는다.
set -euo pipefail

REPO=/opt/mm
FRONT_OUT=/srv/mm/frontend
OLD=${1:?배포 전 커밋을 넘겨야 한다}
MODE=${2:-changed}

cd "$REPO"
NEW=$(git rev-parse HEAD)
echo "배포 ${OLD:0:7} -> ${NEW:0:7} (mode=$MODE)"

# 파트($1 디렉토리)를 다시 올려야 하는가. 문서·테스트만 바뀌었으면 아니다.
# grep -q 로 바로 끝내지 않는다. pipefail 이라 앞 명령이 SIGPIPE 를 받으면 바뀐 파트를 건너뛴다.
changed() {
  [ "$MODE" = all ] && return 0
  [ -n "$(git diff --name-only "$OLD" "$NEW" -- "$1/" | grep -vE '\.md$|/(docs|tests|decision_log)/' || true)" ]
}

wait_health() {
  for _ in $(seq 1 30); do
    curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1 && { echo "health ok"; return 0; }
    sleep 2
  done
  echo "health 확인 실패. docker compose -f backend/docker-compose.prod.yml logs api 로 확인한다" >&2
  return 1
}

if changed backend; then
  echo "== backend"
  # 마이그레이션은 컨테이너가 시작하면서 먼저 올린다(backend/Dockerfile CMD)
  (cd backend && docker compose -f docker-compose.prod.yml up -d --build)
  wait_health
  # 이번 빌드로 이름을 잃은 옛 이미지만 지운다. 볼륨(DB 데이터)은 건드리지 않는다
  docker image prune -f >/dev/null
else
  echo "== backend 변경 없음"
fi

if changed frontend; then
  echo "== frontend"
  # 운영 빌드는 환경 변수가 없어도 된다. API 는 같은 출처 /api/v1 이고 MSW 는 개발 서버에서만 켜진다
  (cd frontend && npm ci --no-audit --no-fund && npm run build)
  sudo rsync -a --delete frontend/dist/ "$FRONT_OUT"/
else
  echo "== frontend 변경 없음"
fi

if changed ai; then
  echo "== ai"
  if [ "$MODE" = all ] || ! git diff --quiet "$OLD" "$NEW" -- ai/requirements.txt; then
    if command -v uv >/dev/null; then
      (cd ai && uv pip install --python .venv/bin/python -r requirements.txt)
    else
      (cd ai && .venv/bin/python -m pip install -r requirements.txt)
    fi
  fi
  # 워커는 SIGTERM 을 받으면 하던 회의를 마치고 끝난다(mm-worker.service TimeoutStopSec)
  sudo systemctl restart mm-worker
  # 2분 안에 쓰인 wav 가 있으면 녹음 중으로 보고 봇은 그대로 둔다
  if [ -n "$(find ai/recordings -name '*.wav' -mmin -2 2>/dev/null)" ]; then
    echo "녹음 중이라 봇은 재시작하지 않았다. 녹음이 끝난 뒤 deploy 를 수동 실행(all)한다" >&2
  else
    sudo systemctl restart mm-bot
  fi
  systemctl is-active mm-bot mm-worker
else
  echo "== ai 변경 없음"
fi

echo "배포 완료 ${NEW:0:7}"
