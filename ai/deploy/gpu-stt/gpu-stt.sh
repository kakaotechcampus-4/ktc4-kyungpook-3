#!/usr/bin/env bash
# Elice 전사가 멈췄을 때 쓰는 GPU 서버를 켜고 끈다. 운영자의 Mac 에서 개인 AWS 계정으로 돌린다. 절차는 README.md.
#
#   gpu-stt.sh setup <운영 서버 공인 IP>
#   gpu-stt.sh on [--hours N]
#   gpu-stt.sh off
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
NOT_GONE=pending,running,stopping,stopped,shutting-down

# 셸에 다른 계정의 키가 있으면 AWS_PROFILE 보다 먼저 쓰여 엉뚱한 계정을 건드린다
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
export AWS_SHARED_CREDENTIALS_FILE=$SECRETS/aws-personal-credentials
export AWS_CONFIG_FILE=/dev/null AWS_PROFILE=personal AWS_REGION=ap-northeast-2 AWS_PAGER=

die() {
  echo "gpu-stt: $*" >&2
  exit 1
}

usage() {
  die "사용법: gpu-stt.sh setup <운영 서버 공인 IP> | on [--hours N] | off | status"
}

fallback_ids() {
  aws ec2 describe-instances --filters "$ROLE_FILTER" "Name=instance-state-name,Values=$1" \
    --query 'Reservations[].Instances[].InstanceId' --output text
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
  fi
  if [ ! -s "$STATE/api.key" ]; then
    openssl rand -hex 24 >"$STATE/api.key"
  fi
}

cmd_setup() {
  local prod_ip=${1:-}
  [[ $prod_ip =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || usage
  mkdir -p "$STATE"
  ensure_security_group "$prod_ip"
  ensure_eip
  ensure_cert_and_key
  printf 'EIP_ALLOC=%s\nEIP=%s\nSG_ID=%s\nPROD_IP=%s\n' "$EIP_ALLOC" "$EIP" "$SG_ID" "$prod_ip" >"$STATE/env.tmp"
  mv "$STATE/env.tmp" "$STATE/env"
  echo "준비됐습니다. 고정 IP $EIP, 8000 포트는 $prod_ip 에서만 열립니다."
}

write_user_data() {
  local name
  {
    printf '#!/bin/bash\n'
    # 맨 앞에 둔다. 뒤 단계가 실패해도 켜진 채 남지 않게 한다
    printf 'shutdown -h +%d\n' "$(($1 * 60))"
    printf 'umask 077\ncd /opt/m\n'
    for name in cert.pem key.pem api.key; do
      printf "cat > /opt/m/fallback-%s <<'END_OF_FILE'\n" "$name"
      cat "$STATE/$name"
      printf 'END_OF_FILE\n'
    done
    cat <<'SERVE'
HF_HOME=/opt/m/hf nohup /opt/m/vllm-env/bin/vllm serve openai/whisper-large-v3 \
  --served-model-name openai/whisper-large-v3 --dtype float16 --host 0.0.0.0 --port 8000 \
  --api-key "$(cat /opt/m/fallback-api.key)" \
  --ssl-keyfile /opt/m/fallback-key.pem --ssl-certfile /opt/m/fallback-cert.pem \
  --gpu-memory-utilization 0.6 --limit-mm-per-prompt '{"audio":1}' \
  >/var/log/vllm.log 2>&1 </dev/null &
SERVE
  } >"$USER_DATA"
}

launch() {
  local hours=$1 tags
  # 태그는 만드는 호출에 같이 싣는다. 따로 붙이다 끊기면 off 가 찾지 못하는 GPU 가 남는다
  tags="$TAGS,{Key=TerminateAt,Value=$(($(date +%s) + hours * 3600))}"
  write_user_data "$hours"
  if ! INSTANCE_ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --security-group-ids "$SG_ID" --instance-initiated-shutdown-behavior terminate \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeInitializationRate=300,DeleteOnTermination=true}' \
    --tag-specifications "ResourceType=instance,Tags=[$tags]" "ResourceType=volume,Tags=[$TAGS]" \
    --user-data "file://$USER_DATA" --query 'Instances[0].InstanceId' --output text 2>"$RUN_ERROR"); then
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
  fi
}

cmd_on() {
  local hours=3 found
  if [ $# -gt 0 ]; then
    [ "$1" = --hours ] && [ $# -eq 2 ] || usage
    hours=$2
  fi
  [[ $hours =~ ^[1-9][0-9]*$ ]] || usage
  [ -f "$STATE/env" ] || die "먼저 setup 을 돌립니다."
  . "$STATE/env"

  USER_DATA=$(mktemp)
  RUN_ERROR=$(mktemp)
  trap 'rm -f "$USER_DATA" "$RUN_ERROR"' EXIT

  found=$(fallback_ids "$UP")
  if [ -n "$found" ]; then
    INSTANCE_ID=${found%%[[:space:]]*}
    echo "켜져 있는 $INSTANCE_ID 를 그대로 씁니다. 종료 시각은 부팅 때 정해져 --hours 로 바뀌지 않습니다."
  else
    launch "$hours"
    echo "$INSTANCE_ID 를 켰습니다."
  fi

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
  ids=$(fallback_ids "$NOT_GONE")
  if [ -n "$ids" ]; then
    # id 가 여럿이면 공백으로 나뉜다. 일부러 따옴표 없이 넘긴다
    aws ec2 terminate-instances --instance-ids $ids >/dev/null
    aws ec2 wait instance-terminated --instance-ids $ids || true
  fi
  remaining=$(fallback_ids "$NOT_GONE")
  if [ -n "$remaining" ]; then
    die "아직 꺼지지 않았습니다: $remaining"
  fi
  echo "Role=stt-fallback 인스턴스 0대. 고정 IP 는 남겨 둡니다."
}

cmd_status() {
  local rows id state launched at types
  rows=$(aws ec2 describe-instances --filters "$ROLE_FILTER" "Name=instance-state-name,Values=$NOT_GONE" \
    --output text --query \
    "Reservations[].Instances[].[InstanceId, State.Name, LaunchTime, Tags[?Key=='TerminateAt'] | [0].Value]")
  if [ -z "$rows" ]; then
    echo "Role=stt-fallback 인스턴스 0대"
  else
    while read -r id state launched at; do
      echo "$id $state 시작 $launched 종료 예정 $(local_time "$at")"
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
  setup | on | off | status) ;;
  *) usage ;;
esac
[ -f "$AWS_SHARED_CREDENTIALS_FILE" ] || die "$AWS_SHARED_CREDENTIALS_FILE 가 없습니다."
"cmd_$command" "$@"
