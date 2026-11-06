#!/usr/bin/env bash
# Elice 전사가 멈췄을 때 쓰는 GPU 서버를 켜고 끈다. 운영자의 Mac 에서 개인 AWS 계정으로 돌린다. 절차는 README.md.
# 서버는 지우지 않고 꺼 둔다. setup 이 대기 서버를 한 번 만들고, on 은 start, off 는 stop 이다.
#
#   gpu-stt.sh setup <운영 서버 공인 IP>
#   gpu-stt.sh on [--hours N]
#   gpu-stt.sh off
#   gpu-stt.sh destroy
#   gpu-stt.sh status
#
# 같은 계정에 다른 작업의 gpu-stt-* 자원이 있다. 이 스크립트의 자원은 태그 Role=stt-fallback 이 정확히 붙은
# 것뿐이다. 이름이나 와일드카드로 찾은 것은 절대 끄지 않는다.
set -euo pipefail
umask 077

SECRETS=${GPU_STT_SECRETS:-$HOME/Desktop/kakaotech4/secrets}
STATE=$SECRETS/gpu-stt
AMI=${GPU_STT_AMI:-ami-0ed9be81325b96adf}
INSTANCE_TYPE=g4dn.xlarge
CA_ON_PROD=/etc/mm/gpu-stt-ca.pem

ROLE_FILTER=Name=tag:Role,Values=stt-fallback
TAGS='{Key=Name,Value=gpu-stt-fallback},{Key=Role,Value=stt-fallback}'
UP=pending,running
STANDBY=$UP,stopping,stopped
NOT_GONE=$STANDBY,shutting-down
SETUP_STOP_HOURS=1
DEFAULT_STOP_MINUTES=180
STOPPING_NOTE='stop 은 약 400초 걸리고 그동안 on 으로 켤 수 없습니다.'

# 셸에 다른 계정의 키가 있으면 AWS_PROFILE 보다 먼저 쓰여 엉뚱한 계정을 건드린다
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
export AWS_SHARED_CREDENTIALS_FILE=$SECRETS/aws-personal-credentials
export AWS_CONFIG_FILE=/dev/null AWS_PROFILE=personal AWS_REGION=ap-northeast-2 AWS_PAGER=

die() {
  echo "gpu-stt: $*" >&2
  exit 1
}

usage() {
  die "사용법: gpu-stt.sh setup <운영 서버 공인 IP> | on [--hours N] | off | destroy | status"
}

fallback_ids() {
  aws ec2 describe-instances --filters "$ROLE_FILTER" "Name=instance-state-name,Values=$1" \
    --query 'Reservations[].Instances[].InstanceId' --output text
}

fallback_rows() {
  aws ec2 describe-instances --filters "$ROLE_FILTER" "Name=instance-state-name,Values=$1" --output text --query \
    "Reservations[].Instances[].[InstanceId, State.Name, LaunchTime, Tags[?Key=='StopAt'] | [0].Value]"
}

g_family_up() {
  aws ec2 describe-instances --filters 'Name=instance-type,Values=g*' "Name=instance-state-name,Values=$UP" \
    --output text --query "$1"
}

local_time() {
  date -r "$1" '+%Y-%m-%d %H:%M %Z' 2>/dev/null || date -d "@$1" '+%Y-%m-%d %H:%M %Z'
}

ensure_security_group() {
  local prod_ip=$1 want rules perms
  SG_ID=$(aws ec2 describe-security-groups --filters "$ROLE_FILTER" \
    --query 'SecurityGroups[].GroupId' --output text)
  if [ -z "$SG_ID" ]; then
    SG_ID=$(aws ec2 create-security-group --group-name gpu-stt-fallback --description 'STT fallback server' \
      --tag-specifications "ResourceType=security-group,Tags=[$TAGS]" --query GroupId --output text)
  fi

  want="tcp 8000 8000 $prod_ip/32"
  rules=$(aws ec2 describe-security-groups --group-ids "$SG_ID" --output text --query \
    "SecurityGroups[0].IpPermissions[].join(' ', [IpProtocol, to_string(FromPort), to_string(ToPort), join(',', IpRanges[].CidrIp)])")
  if [ "$rules" != "$want" ]; then
    perms=$(aws ec2 describe-security-groups --group-ids "$SG_ID" \
      --query 'SecurityGroups[0].IpPermissions' --output json)
    if [ "$perms" != "[]" ]; then
      aws ec2 revoke-security-group-ingress --group-id "$SG_ID" --ip-permissions "$perms" >/dev/null
    fi
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
      --protocol tcp --port 8000 --cidr "$prod_ip/32" >/dev/null
  fi
}

ensure_eip() {
  local found
  found=$(aws ec2 describe-addresses --filters "$ROLE_FILTER" \
    --query 'Addresses[].[AllocationId,PublicIp]' --output text)
  if [ -z "$found" ]; then
    found=$(aws ec2 allocate-address --domain vpc \
      --tag-specifications "ResourceType=elastic-ip,Tags=[$TAGS]" \
      --query '[AllocationId,PublicIp]' --output text)
  fi
  read -r EIP_ALLOC EIP <<<"$found"
}

ensure_cert_and_key() {
  local cert=$STATE/cert.pem key=$STATE/key.pem
  # IP 만 바뀌어도 SAN 이 어긋나 운영 서버의 검증이 실패한다
  if [ ! -s "$key" ] || ! openssl x509 -in "$cert" -noout -text 2>/dev/null | tr -d ' ' | grep -Fqx "IPAddress:$EIP"; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 400 -subj /CN=gpu-stt-fallback \
      -addext "subjectAltName=IP:$EIP" -keyout "$key" -out "$cert" >/dev/null 2>&1 \
      || die "인증서를 만들지 못했습니다."
    echo "인증서를 새로 만들었습니다. 운영 서버의 $CA_ON_PROD 도 바꿔야 합니다."
    CERT_RENEWED=1
  fi
  if [ ! -s "$STATE/api.key" ]; then
    openssl rand -hex 24 >"$STATE/api.key"
  fi
}

valid_ip() {
  local octet
  [[ $1 =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  for octet in ${1//./ }; do
    [ "$((10#$octet))" -le 255 ] || return 1
  done
}

cmd_setup() {
  local prod_ip=${1:-}
  valid_ip "$prod_ip" || usage
  mkdir -p "$STATE"
  ensure_security_group "$prod_ip"
  ensure_eip
  ensure_cert_and_key
  printf 'EIP_ALLOC=%s\nEIP=%s\nSG_ID=%s\nPROD_IP=%s\n' "$EIP_ALLOC" "$EIP" "$SG_ID" "$prod_ip" >"$STATE/env.tmp"
  mv "$STATE/env.tmp" "$STATE/env"
  ensure_standby
  echo "준비됐습니다. 고정 IP $EIP, 8000 포트는 $prod_ip 에서만 열립니다."
}

ensure_standby() {
  local found i
  found=$(fallback_ids "$STANDBY")
  if [ -n "$found" ]; then
    # 인증서는 대기 서버의 디스크에 있어 여기서 새로 만들어도 서버에는 닿지 않는다
    [ -z "${CERT_RENEWED:-}" ] || die "대기 서버 $found 에 옛 인증서가 있습니다. destroy 뒤 setup 을 다시 돌립니다."
    return
  fi

  USER_DATA=$(mktemp)
  RUN_ERROR=$(mktemp)
  trap 'rm -f "$USER_DATA" "$RUN_ERROR"' EXIT
  launch
  echo "$INSTANCE_ID 를 만들었습니다. 첫 부팅이 모델을 올린 뒤 스스로 꺼집니다. 약 12분 걸립니다."
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  aws ec2 associate-address --allocation-id "$EIP_ALLOC" --instance-id "$INSTANCE_ID" \
    --allow-reassociation >/dev/null
  # 대기 한 번이 최대 10분이라 첫 부팅과 stop 을 합친 시간을 덮지 못한다
  for i in 1 2 3 4; do
    if aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"; then
      echo "대기 서버 $INSTANCE_ID 를 꺼 두었습니다."
      return
    fi
  done
  die "$INSTANCE_ID 가 꺼지지 않았습니다. status 로 본 뒤 destroy 하고 setup 을 다시 돌립니다."
}

write_user_data() {
  local name
  {
    printf '#!/bin/bash\n'
    # 맨 앞에 둔다. 뒤 단계가 실패해도 켜진 채 남지 않게 한다
    printf 'shutdown -h +%d\n' "$((SETUP_STOP_HOURS * 60))"
    printf 'umask 077\ncd /opt/m\n'
    for name in cert.pem key.pem api.key; do
      printf "cat > /opt/m/fallback-%s <<'END_OF_FILE'\n" "$name"
      cat "$STATE/$name"
      printf 'END_OF_FILE\n'
    done
    # user-data 는 첫 부팅에만 돈다. 그 뒤 start 에서는 cloud-init 이 이 폴더를 부팅마다 돌린다
    printf "cat > /var/lib/cloud/scripts/per-boot/gpu-stt.sh <<'END_OF_BOOT'\n"
    printf '#!/bin/bash\n'
    # 재부팅이 예약을 지운다. 태그를 못 읽어도 켜진 채 남지 않게 먼저 건다
    printf 'shutdown -h +%d\n' "$DEFAULT_STOP_MINUTES"
    cat <<'BOOT'
umask 077
cd /opt/m
imds=http://169.254.169.254/latest
token=$(curl -s -m 2 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' $imds/api/token)
stop_at=$(curl -s -m 2 -H "X-aws-ec2-metadata-token: $token" $imds/meta-data/tags/instance/StopAt)
if [[ $stop_at =~ ^[0-9]+$ ]] && [ "$stop_at" -gt "$(date +%s)" ]; then
  shutdown -h +$(((stop_at - $(date +%s)) / 60 + 1))
fi
HF_HOME=/opt/m/hf nohup /opt/m/vllm-env/bin/vllm serve openai/whisper-large-v3 \
  --served-model-name openai/whisper-large-v3 --dtype float16 --host 0.0.0.0 --port 8000 \
  --api-key "$(cat /opt/m/fallback-api.key)" \
  --ssl-keyfile /opt/m/fallback-key.pem --ssl-certfile /opt/m/fallback-cert.pem \
  --gpu-memory-utilization 0.6 --limit-mm-per-prompt '{"audio":1}' \
  >/var/log/vllm.log 2>&1 </dev/null &
END_OF_BOOT
BOOT
    cat <<'FIRST_BOOT'
chmod 700 /var/lib/cloud/scripts/per-boot/gpu-stt.sh
/var/lib/cloud/scripts/per-boot/gpu-stt.sh
# 모델을 한 번 읽어야 다음 start 가 빠르다. 다 뜬 뒤 꺼지는 것이 setup 이 기다리는 신호다
until [ "$(curl -sk -m 3 -o /dev/null -w '%{http_code}' https://127.0.0.1:8000/health)" = 200 ]; do
  sleep 5
done
shutdown -h now
FIRST_BOOT
  } >"$USER_DATA"
}

explain_failed_start() {
  if grep -q VcpuLimitExceeded "$RUN_ERROR"; then
    {
      echo "gpu-stt: G 계열 vCPU 한도 8 을 넘어 켜지 못했습니다. 이 계정의 다른 인스턴스가 한도를 쓰고 있습니다."
      echo "지금 켜진 G 계열 인스턴스(id, 종류, 이름):"
      g_family_up "Reservations[].Instances[].[InstanceId, InstanceType, Tags[?Key=='Name'] | [0].Value]"
    } >&2
  else
    cat "$RUN_ERROR" >&2
  fi
  exit 1
}

launch() {
  local tags
  # 태그는 만드는 호출에 같이 싣는다. 따로 붙이다 끊기면 스크립트가 찾지 못하는 GPU 가 남는다
  tags="$TAGS,{Key=StopAt,Value=$(($(date +%s) + SETUP_STOP_HOURS * 3600))}"
  write_user_data
  INSTANCE_ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --security-group-ids "$SG_ID" --instance-initiated-shutdown-behavior stop \
    --metadata-options InstanceMetadataTags=enabled \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeInitializationRate=300,DeleteOnTermination=true}' \
    --tag-specifications "ResourceType=instance,Tags=[$tags]" "ResourceType=volume,Tags=[$TAGS]" \
    --user-data "file://$USER_DATA" --query 'Instances[0].InstanceId' --output text 2>"$RUN_ERROR") \
    || explain_failed_start
}

start_standby() {
  # 부팅 스크립트가 이 태그로 종료 시각을 정한다. start 뒤에 쓰면 옛 값을 읽을 수 있다
  aws ec2 create-tags --resources "$INSTANCE_ID" --tags "Key=StopAt,Value=$(($(date +%s) + $1 * 3600))"
  aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null 2>"$RUN_ERROR" || explain_failed_start
}

cmd_on() {
  local hours=3 state
  if [ $# -gt 0 ]; then
    [ "$1" = --hours ] && [ $# -eq 2 ] || usage
    hours=$2
  fi
  [[ $hours =~ ^[1-9][0-9]*$ ]] || usage
  [ -f "$STATE/env" ] || die "먼저 setup 을 돌립니다."
  . "$STATE/env"
  [ -n "$(aws ec2 describe-addresses --filters "Name=allocation-id,Values=$EIP_ALLOC" \
    --query 'Addresses[].AllocationId' --output text)" ] || die "고정 IP 가 없습니다. setup 을 다시 돌립니다."

  RUN_ERROR=$(mktemp)
  trap 'rm -f "$RUN_ERROR"' EXIT

  read -r INSTANCE_ID state _ <<<"$(fallback_rows "$STANDBY")" || true
  case $state in
    stopped)
      start_standby "$hours"
      echo "$INSTANCE_ID 를 켰습니다."
      ;;
    pending | running)
      echo "켜져 있는 $INSTANCE_ID 를 그대로 씁니다. 종료 시각은 부팅 때 정해져 --hours 로 바뀌지 않습니다."
      ;;
    stopping) die "$INSTANCE_ID 가 꺼지는 중입니다. $STOPPING_NOTE 끝난 뒤 on 을 다시 돌립니다." ;;
    *) die "대기 서버가 없습니다. 먼저 setup 을 돌립니다." ;;
  esac

  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  # 켜진 인스턴스를 다시 쓸 때도 붙인다. 앞선 on 이 여기 오기 전에 끊겼을 수 있다
  aws ec2 associate-address --allocation-id "$EIP_ALLOC" --instance-id "$INSTANCE_ID" \
    --allow-reassociation >/dev/null

  cmd_status
  echo
  echo "보안 그룹이 운영 서버만 열어 두어 Mac 에서는 닿지 않습니다. 운영 서버에서 200 이 올 때까지 확인합니다."
  echo "  curl --cacert $CA_ON_PROD https://$EIP:8000/health"
}

cmd_off() {
  local ids remaining
  [ $# -eq 0 ] || usage
  ids=$(fallback_ids "$UP")
  if [ -n "$ids" ]; then
    echo "서버를 끕니다. $STOPPING_NOTE"
    # id 가 여럿이면 공백으로 나뉜다. 일부러 따옴표 없이 넘긴다
    aws ec2 stop-instances --instance-ids $ids >/dev/null
  fi
  ids=$(fallback_ids "$UP,stopping")
  if [ -n "$ids" ]; then
    aws ec2 wait instance-stopped --instance-ids $ids || true
  fi
  remaining=$(fallback_ids "$UP,stopping")
  if [ -n "$remaining" ]; then
    die "아직 꺼지지 않았습니다: $remaining"
  fi
  echo "켜진 Role=stt-fallback 인스턴스 0대. 대기 서버와 고정 IP 는 남겨 둡니다."
}

cmd_destroy() {
  local ids remaining
  [ $# -eq 0 ] || usage
  ids=$(fallback_ids "$NOT_GONE")
  if [ -n "$ids" ]; then
    # id 가 여럿이면 공백으로 나뉜다. 일부러 따옴표 없이 넘긴다
    aws ec2 terminate-instances --instance-ids $ids >/dev/null
    aws ec2 wait instance-terminated --instance-ids $ids || true
  fi
  remaining=$(fallback_ids "$NOT_GONE")
  if [ -n "$remaining" ]; then
    die "아직 지워지지 않았습니다: $remaining"
  fi
  echo "Role=stt-fallback 인스턴스 0대. 고정 IP 는 남겨 둡니다."
}

cmd_status() {
  local rows id state launched at types
  [ $# -eq 0 ] || usage
  rows=$(fallback_rows "$NOT_GONE")
  if [ -z "$rows" ]; then
    echo "Role=stt-fallback 인스턴스 0대"
  else
    while read -r id state launched at; do
      case $state in
        stopped) echo "$id stopped 꺼 둠" ;;
        stopping) echo "$id stopping $STOPPING_NOTE" ;;
        *) echo "$id $state 시작 $launched 종료 예정 $(local_time "$at")" ;;
      esac
    done <<<"$rows"
  fi

  aws ec2 describe-addresses --filters "$ROLE_FILTER" --output text \
    --query "Addresses[].[PublicIp, InstanceId || '미연결']" | while read -r ip attached; do
    echo "고정 IP $ip 연결: $attached"
  done

  types=$(g_family_up "Reservations[].Instances[?!(Tags[?Key=='Role' && Value=='stt-fallback'])][].InstanceType")
  echo "다른 G 계열 인스턴스(종류별 대수):"
  if [ -z "$types" ]; then
    echo "  없음"
  else
    echo "$types" | tr '\t' '\n' | sort | uniq -c
  fi
}

[ $# -gt 0 ] || usage
command=$1
shift
case $command in
  setup | on | off | destroy | status) ;;
  *) usage ;;
esac
[ -f "$AWS_SHARED_CREDENTIALS_FILE" ] || die "$AWS_SHARED_CREDENTIALS_FILE 가 없습니다."
"cmd_$command" "$@"
