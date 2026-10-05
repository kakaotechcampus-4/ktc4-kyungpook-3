#!/usr/bin/env bash
# EC2 배포 스크립트. .github/workflows/deploy.yml 이 SSM 으로 git 을 새 커밋까지 올린 뒤 ubuntu 사용자로 부른다.
#
#   bash /opt/mm/deploy/ec2-deploy.sh <git 갱신 전 커밋> [changed|all]
#
# changed(기본)는 마지막으로 끝까지 성공한 배포와 지금 HEAD 사이에 바뀐 파트만 다시 올린다. all 은 세 파트를 모두 올린다.
# 성공한 배포 커밋은 .git/mm-deployed-sha 에 남긴다. git HEAD 는 배포가 실패해도 이미 새 커밋이라 기준으로 쓸 수 없다.
# 그 기록이 없을 때(첫 배포)만 넘겨받은 git 갱신 전 커밋을 기준으로 적는다.
# 문서·테스트만 바뀐 파트는 건너뛴다. 봇 재시작은 진행 중인 녹음을 끊기 때문이다.
# git 갱신은 이 스크립트 밖(deploy.yml)에서 한다. 실행 중인 스크립트 파일을 git 이 덮어쓰면 bash 가 바뀐 줄을 읽는다.
set -euo pipefail

REPO=/opt/mm
FRONT_OUT=/srv/mm/frontend
STATE="$REPO/.git/mm-deployed-sha"   # .git 안이라 git status 에 안 잡히고 fast-forward 를 막지 않는다
MODE=${2:-changed}

cd "$REPO"
NEW=$(git rev-parse HEAD)
if ! { [ -s "$STATE" ] && git cat-file -e "$(cat "$STATE")^{commit}" 2>/dev/null; }; then
  # 기준을 먼저 적어 둔다. 첫 배포가 실패해도 다음 배포가 같은 기준에서 다시 시작한다
  echo "${1:?git 갱신 전 커밋을 넘겨야 한다}" > "$STATE"
fi
OLD=$(cat "$STATE")
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

# 녹음 중인 회의가 있나. 매니페스트가 recording 이고 그 회의 잠금을 누가 쥐고 있으면 녹음 중이다.
# wav 수정 시각으로는 못 가린다. 트랙은 다음 소리가 올 때에야 앞의 빈 구간을 무음으로 채운다(capture/track_writer.py).
# 잠금까지 보는 이유는 봇이 녹음 중에 죽으면 매니페스트가 recording 으로 남기 때문이다. 그때 잠금은 OS 가 풀었다.
recording_now() {
  local m
  for m in ai/recordings/session_*.json; do
    [ -e "$m" ] || continue
    grep -qE '"status": *"recording"' "$m" || continue
    flock -n "${m%.json}.lock" true 2>/dev/null || return 0
  done
  return 1
}

complete=1   # 건너뛴 일 없이 끝까지 올렸나. 아니면 기록을 남기지 않아 다음 배포가 다시 올린다

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
  # try-restart 는 켜져 있는 유닛만 다시 띄운다. 봇 모드로 돌 때 꺼 둔 워커를 켜면 봇과 회의를 두고 다툰다.
  # 워커는 SIGTERM 을 받으면 하던 회의를 마치고 끝난다(mm-worker.service TimeoutStopSec)
  sudo systemctl try-restart mm-worker
  if recording_now; then
    complete=0
    # ::warning:: 으로 시작하는 줄은 Actions 실행 화면에 경고로 뜬다
    echo "::warning::녹음 중이라 mm-bot 은 재시작하지 않았다. 녹음이 끝난 뒤 deploy 를 수동 실행하면 다시 올린다"
  else
    sudo systemctl try-restart mm-bot
  fi
  for u in mm-bot mm-worker; do
    echo "$u: $(systemctl is-active "$u" || true)"
  done
else
  echo "== ai 변경 없음"
fi

if [ "$complete" = 1 ]; then
  echo "$NEW" > "$STATE"
  echo "배포 완료 ${NEW:0:7}"
else
  echo "배포는 끝났지만 건너뛴 일이 있어 기준 커밋을 ${OLD:0:7} 로 둔다. 다음 배포가 그 뒤 변경을 다시 올린다"
fi
