#!/usr/bin/env bash
# Grafana Cloud 가 DB 컨테이너(db:5432)에 닿게 하는 PDC(Private Data source Connect) 에이전트를 띄운다(#675).
# compose 밖에서 docker run 으로 돌린다. 토큰은 env 파일에서만 읽는다(기본 /etc/mm-monitoring/pdc.env, root 600).
# 다시 실행하면 기존 pdc-agent 컨테이너를 지우고 새로 만든다. root 로 실행한다: sudo deploy/monitoring/pdc/run-pdc.sh
set -euo pipefail

ENV_FILE="${PDC_ENV_FILE:-/etc/mm-monitoring/pdc.env}"
NAME=pdc-agent
# 설치 때 확인: 태그는 docker hub 의 grafana/pdc-agent 에서 확인한 고정값이다. 올릴 때는 새 태그를 확인하고 바꾼다(latest 금지).
IMAGE="grafana/pdc-agent:0.0.67"

if [ "$(id -u)" != "0" ]; then
  echo "root 로 실행해야 한다(sudo)." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "env 파일이 없다: $ENV_FILE" >&2
  exit 1
fi

mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")"
if [ "$mode" != "600" ]; then
  echo "env 파일 권한이 600 이 아니다($mode): $ENV_FILE  ->  chmod 600" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${GCLOUD_PDC_SIGNING_TOKEN:?env 파일에 GCLOUD_PDC_SIGNING_TOKEN 이 없다}"
: "${GCLOUD_PDC_CLUSTER:?env 파일에 GCLOUD_PDC_CLUSTER 가 없다}"
: "${GCLOUD_HOSTED_GRAFANA_ID:?env 파일에 GCLOUD_HOSTED_GRAFANA_ID 가 없다}"

# 이미 있으면 교체한다. 없으면 rm 은 무시한다.
docker rm -f "$NAME" >/dev/null 2>&1 || true

# 설치 때 확인: --read-only·--cap-drop ALL·--tmpfs /tmp 로 에이전트가 뜨는지는 공식 문서에 없는 설정이다.
# 안 뜨면 `docker logs pdc-agent` 로 원인을 보고 필요한 것만 푼다(예: --tmpfs 경로 추가).
# 설치 때 확인: -token·-cluster·-gcloud-hosted-grafana-id 는 PDC 설정 문서의 docker 예시 그대로다.
docker run -d \
  --name "$NAME" \
  --network mm-prod_default \
  --restart unless-stopped \
  --memory 64m \
  --read-only \
  --tmpfs /tmp \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  "$IMAGE" \
  -token "$GCLOUD_PDC_SIGNING_TOKEN" \
  -cluster "$GCLOUD_PDC_CLUSTER" \
  -gcloud-hosted-grafana-id "$GCLOUD_HOSTED_GRAFANA_ID"

docker ps --filter "name=^${NAME}\$" --format '{{.Names}} {{.Status}}'
