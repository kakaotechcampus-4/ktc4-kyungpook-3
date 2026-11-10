#!/usr/bin/env bash
# 로컬 부하테스트(#688). 레포 루트에서:
#   loadtest/run.sh up               스택을 띄우고 공간 LT_WORKSPACES(기본 5)개를 심사 시드로 채운다
#   loadtest/run.sh web|handoff      시나리오 하나를 돌린다. 결과는 LT_OUT(기본 mm/eval-runs/loadtest/<시각>-<이름>)
#   loadtest/run.sh down             스택과 테스트 데이터를 지운다
# 부하 단계는 LT_LEVELS=10,25,50 처럼, 단계 길이는 LT_STAGE_SECONDS 로 바꾼다.
# 운영: BASE_URL=https://... LT_SSH=ktc-server LT_TARGETS="mm-prod-api-1 mm-prod-db-1 unit:mm-worker unit:mm-bot host" LT_READONLY=1
set -euo pipefail
cd "$(dirname "$0")"

STATE="${LT_STATE:-$HOME/Desktop/kakaotech4/secrets/loadtest-local.sh}"
export LT_WORKSPACES="${LT_WORKSPACES:-5}"
export LT_EMAIL_PATTERN='lt-w{w}-p{n}@example.com'
compose() { docker compose -f compose.yml "$@"; }

# 이 스택에서만 쓰는 값이라 실행마다 새로 만들어 secrets 에 둔다. 화면에 찍지 않는다
if [ ! -f "$STATE" ]; then
  umask 077
  printf 'export LT_SERVICE_TOKEN=%s\nexport LT_PASSWORD=%s\n' \
    "$(openssl rand -hex 24)" "Lt$(openssl rand -hex 12)9" > "$STATE"
fi
. "$STATE"

case "${1:-}" in
  up)
    compose up -d --build --wait
    for w in $(seq 1 "$LT_WORKSPACES"); do
      compose exec -T -e SERVICE_TOKEN="$LT_SERVICE_TOKEN" -e DEMO_PM_PASSWORD="$LT_PASSWORD" \
        -e DEMO_MEMBER_PASSWORD="$LT_PASSWORD" api python -m app.cli.seed_demo \
        --email-pattern "lt-w$w-p{n}@example.com" --workspace-name "부하 공간 $w" >/dev/null
      echo "공간 $w 시드 완료"
    done
    ;;
  web|handoff)
    out="${LT_OUT:-$HOME/Desktop/카테캠 아이디어톤/mm/eval-runs/loadtest/$(date +%Y%m%d-%H%M%S)-$1}"
    mkdir -p "$out"
    if [ -n "${LT_SSH:-}" ]; then
      ssh -F "$HOME/Desktop/kakaotech4/secrets/ssh_config" "$LT_SSH" python3 - $LT_TARGETS < sampler.py > "$out/server.csv" &
    else
      python3 sampler.py mm-loadtest-api-1 mm-loadtest-db-1 > "$out/server.csv" &
    fi
    sampler=$!
    trap 'kill $sampler 2>/dev/null' EXIT
    K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT="$out/report.html" K6_WEB_DASHBOARD_PERIOD=2s \
      k6 run --summary-export "$out/summary.json" --out "json=$out/k6.json.gz" \
      "$1.js" | tee "$out/k6.txt"
    kill $sampler
    python3 report.py "$out"
    chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$chrome" --headless=new --hide-scrollbars --window-size=1400,2400 --virtual-time-budget=5000 \
      --screenshot="$out/report.png" "file://$out/report.html" 2>/dev/null
    "$chrome" --headless=new --hide-scrollbars --window-size=900,840 \
      --screenshot="$out/server.png" "file://$out/server.svg" 2>/dev/null
    echo "결과: $out"
    ;;
  down)
    compose down -v
    ;;
  *)
    sed -n 2,6p "$0"; exit 2
    ;;
esac
