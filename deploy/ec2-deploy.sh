#!/usr/bin/env bash
# EC2 배포 스크립트. .github/workflows/deploy.yml 이 SSM 으로 git 을 새 커밋까지 올린 뒤 ubuntu 사용자로 부른다.
#
#   bash /opt/mm/deploy/ec2-deploy.sh <git 갱신 전 커밋> [changed|all]
#
# changed(기본)는 마지막으로 끝까지 성공한 배포와 지금 HEAD 사이에 바뀐 파트만 다시 올린다. all 은 세 파트를 모두 올린다.
# 성공한 배포 커밋은 .git/mm-deployed-sha 에 남긴다. git HEAD 는 배포가 실패해도 이미 새 커밋이라 기준으로 쓸 수 없다.
# 그 기록이 없을 때(첫 배포)만 넘겨받은 git 갱신 전 커밋을 기준으로 적는다.
# 문서·테스트·평가 데이터만 바뀐 파트는 건너뛴다. 봇 재시작은 진행 중인 녹음을 끊기 때문이다.
# git 갱신은 이 스크립트 밖(deploy.yml)에서 한다. 실행 중인 스크립트 파일을 git 이 덮어쓰면 bash 가 바뀐 줄을 읽는다.
#
# 빌드·설치 출력은 ~/mm-deploy.log 에만 쓰고, 실패했을 때 끝부분만 보여 준다. SSM 은 출력의 앞 24,000자만 돌려줘서
# 빌드 로그를 그대로 내보내면 뒤의 결과 줄이 잘리고, 저장소가 공개라 Actions 로그도 누구나 볼 수 있다.
set -euo pipefail

REPO=/opt/mm
FRONT_OUT=/srv/mm/frontend
STATE="$REPO/.git/mm-deployed-sha"   # .git 안이라 git status 에 안 잡히고 fast-forward 를 막지 않는다
# 녹음 확인부터 봇 재시작까지 쥐는 잠금. 봇이 새 녹음을 시작할 때 같은 파일을 잡아 보면 그 사이에 녹음이 시작되지 않는다.
# 봇 쪽 사용 규칙은 backend/docs/requests/bot-restart-lock.md. ai/recordings 는 봇과 이 스크립트(ubuntu)가 함께 쓰고 git 이 무시한다.
# /tmp 를 쓰지 않는 이유: deploy.yml 이 /tmp/mm-deploy.lock 을 root 로 배포 내내 쥐고, systemd 가 서비스마다 /tmp 를 나눌 수 있다
RESTART_LOCK="$REPO/ai/recordings/restart.lock"
RESTART_LOCK_WAIT=60   # 봇은 녹음을 시작하는 짧은 순간만 쥔다. 이보다 오래 못 잡으면 무언가 멈춘 것이다
LOG="$HOME/mm-deploy.log"
MODE=${2:-changed}

cd "$REPO"
: > "$LOG"
NEW=$(git rev-parse HEAD)
if ! { [ -s "$STATE" ] && git cat-file -e "$(cat "$STATE")^{commit}" 2>/dev/null; }; then
  # 기준을 먼저 적어 둔다. 첫 배포가 실패해도 다음 배포가 같은 기준에서 다시 시작한다
  echo "${1:?git 갱신 전 커밋을 넘겨야 한다}" > "$STATE"
fi
OLD=$(cat "$STATE")
echo "배포 ${OLD:0:7} -> ${NEW:0:7} (mode=$MODE)"

# 파트($1 디렉토리)를 다시 올려야 하는가. 문서·테스트·평가 데이터만 바뀌었으면 아니다.
# grep -q 로 바로 끝내지 않는다. pipefail 이라 앞 명령이 SIGPIPE 를 받으면 바뀐 파트를 건너뛴다.
changed() {
  [ "$MODE" = all ] && return 0
  [ -n "$(git diff --name-only "$OLD" "$NEW" -- "$1/" \
    | grep -vE '\.md$|/(docs|tests|decision_log|eval_results)/|/golden_set[^/]*/|^ai/stt/eval/' || true)" ]
}

# 명령 출력을 로그 파일에만 쓴다. 실패하면 끝부분을 보여 주고 실패로 돌아온다.
quiet() {
  local label=$1
  shift
  echo "-- $label" >> "$LOG"
  if ! "$@" >> "$LOG" 2>&1; then
    echo "$label 실패. 서버의 $LOG 끝부분:" >&2
    tail -n 30 "$LOG" >&2
    return 1
  fi
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

# 켜져 있던 유닛만 다시 띄우고 살아났는지 본다. 꺼 둔 유닛은 켜지 않는다(봇 모드로 돌 때 꺼 둔 워커가 봇과 다툰다).
# Restart=always 라 시작하자마자 죽어도 다시 뜨려고 해서, 잠시 기다렸다가 active 인지 확인한다.
restart_if_running() {
  local unit=$1
  if ! systemctl is-active -q "$unit"; then
    echo "$unit 꺼져 있음. 그대로 둔다"
    return 0
  fi
  sudo systemctl restart "$unit"
  sleep 10
  if ! systemctl is-active -q "$unit"; then
    echo "$unit 이 다시 뜨지 않았다:" >&2
    sudo journalctl -u "$unit" -n 15 --no-pager >&2 || true
    return 1
  fi
  echo "$unit 재시작"
}

complete=1   # 건너뛴 일 없이 끝까지 올렸나. 아니면 기록을 남기지 않아 다음 배포가 다시 올린다

if changed backend; then
  echo "== backend"
  # 마이그레이션은 컨테이너가 시작하면서 먼저 올린다(backend/Dockerfile CMD)
  quiet "backend 빌드" docker compose -f backend/docker-compose.prod.yml up -d --build
  wait_health
  # 이번 빌드로 이름을 잃은 옛 이미지만 지운다. 볼륨(DB 데이터)은 건드리지 않는다
  quiet "옛 이미지 정리" docker image prune -f
else
  echo "== backend 변경 없음"
fi

if changed frontend; then
  echo "== frontend"
  # 운영 빌드는 환경 변수가 없어도 된다. API 는 같은 출처 /api/v1 이고 MSW 는 개발 서버에서만 켜진다
  quiet "frontend 의존성 설치" npm --prefix frontend ci --no-audit --no-fund
  quiet "frontend 빌드" npm --prefix frontend run build
  quiet "frontend 복사" sudo rsync -a --delete frontend/dist/ "$FRONT_OUT"/
  echo "frontend 복사 완료"
else
  echo "== frontend 변경 없음"
fi

if changed ai; then
  echo "== ai"
  if [ "$MODE" = all ] || ! git diff --quiet "$OLD" "$NEW" -- ai/requirements.txt; then
    if command -v uv >/dev/null; then
      quiet "ai 의존성 설치" uv pip install --python ai/.venv/bin/python -r ai/requirements.txt
    else
      quiet "ai 의존성 설치" ai/.venv/bin/python -m pip install -r ai/requirements.txt
    fi
    echo "ai 의존성 설치 완료"
  fi
  # 워커는 SIGTERM 을 받으면 하던 회의를 마치고 끝난다(mm-worker.service TimeoutStopSec)
  restart_if_running mm-worker
  mkdir -p ai/recordings
  # 녹음 확인과 재시작 사이에 새 녹음이 시작되지 않게 잠금을 쥔 채로 둘을 한다.
  # 재시작 뒤 살아났는지 기다리는 10초도 쥐고 있어서, 그동안 새 봇의 녹음 시작은 거절된다.
  # 읽기로 연다. flock 은 쓰기 권한이 필요 없어서, 봇이 다른 사용자로 먼저 만든 파일도 잡을 수 있다.
  # 만들거나 열지 못하면(봇 계정이 바뀌어 권한이 다를 때) set -e 로 꺼지지 않고 60초 초과처럼 재시작만 건너뛴다.
  # 묶음의 2>/dev/null 은 묶음 안에서만 적용되고, exec 로 연 8번은 묶음 뒤에도 남는다
  if ! { { [ -e "$RESTART_LOCK" ] || : > "$RESTART_LOCK"; } 2>/dev/null && { exec 8<"$RESTART_LOCK"; } 2>/dev/null; }; then
    complete=0
    echo "::warning::재시작 잠금($RESTART_LOCK)을 만들거나 열지 못해 mm-bot 은 재시작하지 않았다. 파일 권한을 확인한다"
  elif ! flock -w "$RESTART_LOCK_WAIT" 8; then
    complete=0
    echo "::warning::${RESTART_LOCK_WAIT}초 안에 재시작 잠금을 잡지 못해 mm-bot 은 재시작하지 않았다. 다음 배포가 다시 올린다"
  elif recording_now; then
    complete=0
    # ::warning:: 으로 시작하는 줄은 Actions 실행 화면에 경고로 뜬다
    echo "::warning::녹음 중이라 mm-bot 은 재시작하지 않았다. 녹음이 끝난 뒤 deploy 를 수동 실행하면 다시 올린다"
  else
    restart_if_running mm-bot
  fi
  exec 8>&-   # 잠금을 놓는다. 열지 못했으면 닫을 것이 없고, 열리지 않은 번호를 닫아도 오류가 아니다
else
  echo "== ai 변경 없음"
fi

if [ "$complete" = 1 ]; then
  echo "$NEW" > "$STATE"
  echo "배포 완료 ${NEW:0:7}"
else
  echo "배포는 끝났지만 건너뛴 일이 있어 기준 커밋을 ${OLD:0:7} 로 둔다. 다음 배포가 그 뒤 변경을 다시 올린다"
fi
