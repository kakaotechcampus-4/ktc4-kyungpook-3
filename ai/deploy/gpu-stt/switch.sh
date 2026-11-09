#!/usr/bin/env bash
# 운영 워커가 GPU 대기 서버를 켜고 끄는 스위치(Lambda 함수 URL)를 개인 AWS 에 만든다. 절차는 README.md.
# 운영 서버에는 전체 권한 키 대신 이 스위치의 주소와 토큰만 둔다. 만드는 일만 관리자 권한이 필요해서
# 프로필은 돌릴 때 고른다.
#
#   AWS_PROFILE=<관리자 프로필> switch.sh setup    역할, 정책, 함수, 예약 동시성 1, 함수 URL, 토큰, 장부
#   AWS_PROFILE=<관리자 프로필> switch.sh update   switch/handler.py 를 고친 뒤 코드만 올린다
#
# 다시 돌려도 있는 것은 그대로 둔다. 정책과 예약 동시성만 이 파일의 값으로 다시 맞춘다.
set -euo pipefail
umask 077

SECRETS=${GPU_STT_SECRETS:-$HOME/Desktop/kakaotech4/secrets}
STATE=$SECRETS/gpu-stt
HANDLER=$(cd "$(dirname "$0")" && pwd)/switch/handler.py
NAME=mm-gpu-switch
LEDGER=/mm/gpu-stt/ledger
REGION=ap-northeast-2

TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
ROLE_TAG='"StringEquals":{"aws:ResourceTag/Role":"stt-fallback"}'
INSTANCES="arn:aws:ec2:$REGION:*:instance/*"
# 함수가 실패했을 때 원인을 볼 곳이 여기뿐이다. 핸들러는 토큰과 요청 본문을 출력하지 않는다
LOG_GROUP="arn:aws:logs:$REGION:*:log-group:/aws/lambda/$NAME"
# 계정 ID 를 레포에 두지 않으려고 계정 자리는 * 로 둔다. 역할이 있는 계정의 자원만 해당된다.
# ForAllValues 는 태그 키가 없는 요청도 통과시키니 Null 로 막는다
POLICY='{"Version":"2012-10-17","Statement":['\
'{"Effect":"Allow","Action":"ec2:DescribeInstances","Resource":"*"},'\
'{"Effect":"Allow","Action":["ec2:StartInstances","ec2:StopInstances"],"Resource":"'$INSTANCES'","Condition":{'$ROLE_TAG'}},'\
'{"Effect":"Allow","Action":"ec2:CreateTags","Resource":"'$INSTANCES'","Condition":{'$ROLE_TAG','\
'"ForAllValues:StringEquals":{"aws:TagKeys":["StopAt"]},"Null":{"aws:TagKeys":"false"}}},'\
'{"Effect":"Allow","Action":["ssm:GetParameter","ssm:PutParameter"],"Resource":"arn:aws:ssm:'$REGION':*:parameter'$LEDGER'"},'\
'{"Effect":"Allow","Action":"logs:CreateLogGroup","Resource":"'$LOG_GROUP'"},'\
'{"Effect":"Allow","Action":["logs:CreateLogStream","logs:PutLogEvents"],"Resource":"'$LOG_GROUP':*"}]}'

# 셸에 남은 키는 AWS_PROFILE 보다 먼저 쓰여 엉뚱한 계정을 건드린다
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
export AWS_REGION=$REGION AWS_PAGER=

die() {
  echo "switch: $*" >&2
  exit 1
}

usage() {
  die "사용법: AWS_PROFILE=<관리자 프로필> switch.sh setup | update"
}

# 있으면 0, 없으면 1. 조회가 끊긴 것을 없다고 보면 토큰과 장부를 새로 만들어 버리니 그 밖의 실패는 멈춘다
exists() {
  local missing=$1 err
  shift
  err=$(aws "$@" 2>&1 >/dev/null) && return 0
  if grep -q "($missing)" <<<"$err"; then
    return 1
  fi
  echo "$err" >&2
  die "AWS 호출이 실패했습니다: $1 $2"
}

epoch() {
  date -j -u -f '%Y-%m-%dT%H:%M:%S' "${1%%[+Z.]*}" +%s 2>/dev/null || date -u -d "$1" +%s
}

tmp_files() {
  WORK=$(mktemp -d "$STATE/switch.XXXXXX")
  trap 'rm -rf "$WORK"' EXIT
}

build_zip() {
  zip -qj "$WORK/switch.zip" "$HANDLER"
}

# 토큰을 명령 인자에 싣지 않는다. 인자는 같은 Mac 의 ps 에 보인다
write_env() {
  printf '{"Variables":{"SWITCH_TOKEN":"%s"}}' "$(cat "$STATE/switch.token")" >"$WORK/env.json"
}

find_standby() {
  local rows
  rows=$(aws ec2 describe-instances --output text --query 'Reservations[].Instances[].[State.Name, LaunchTime]' \
    --filters Name=tag:Role,Values=stt-fallback Name=instance-state-name,Values=pending,running,stopping,stopped)
  # 대기 서버가 있는 계정인지도 이것으로 확인한다
  [ "$(grep -c . <<<"$rows")" = 1 ] \
    || die "Role=stt-fallback 대기 서버가 1대가 아닙니다. 이 프로필이 대기 서버의 계정인지 보고 gpu-stt.sh setup 을 먼저 돌립니다."
  read -r STANDBY_STATE STANDBY_LAUNCH <<<"$rows"
}

ensure_ledger() {
  local closed=
  exists ParameterNotFound ssm get-parameter --name "$LEDGER" && return 0
  # 꺼 둔 대기 서버의 마지막 세션(setup 첫 부팅이나 앞선 수동 켜기)은 장부가 생기기 전 일이다.
  # 닫힌 것으로 두지 않으면 첫 켜기가 그 세션을 StopAt 까지 센다
  [ "$STANDBY_STATE" != stopped ] || closed=$(epoch "$STANDBY_LAUNCH")
  aws ssm put-parameter --name "$LEDGER" --type String --value "{\"used_s\": 0, \"closed\": [$closed]}" >/dev/null
}

ensure_role() {
  if ! exists NoSuchEntity iam get-role --role-name "$NAME"; then
    aws iam create-role --role-name "$NAME" --assume-role-policy-document "$TRUST" >/dev/null
  fi
  aws iam put-role-policy --role-name "$NAME" --policy-name "$NAME" --policy-document "$POLICY"
}

create_function() {
  local role i
  role=$(aws iam get-role --role-name "$NAME" --query Role.Arn --output text)
  build_zip
  write_env
  # 막 만든 역할은 몇 초 동안 Lambda 가 맡지 못한다
  for i in 1 2 3 4 5 6 7 8 9 10; do
    aws lambda create-function --function-name "$NAME" --runtime python3.12 --handler handler.lambda_handler \
      --role "$role" --timeout 30 --memory-size 128 --zip-file "fileb://$WORK/switch.zip" \
      --environment "file://$WORK/env.json" >/dev/null 2>"$WORK/error" && break
    if ! grep -q 'cannot be assumed' "$WORK/error" || [ "$i" = 10 ]; then
      cat "$WORK/error" >&2
      die "함수를 만들지 못했습니다."
    fi
    sleep 6
  done
  aws lambda wait function-active-v2 --function-name "$NAME"
}

ensure_function() {
  local current
  if ! exists ResourceNotFoundException lambda get-function --function-name "$NAME"; then
    create_function
    return
  fi
  current=$(aws lambda get-function-configuration --function-name "$NAME" \
    --query Environment.Variables.SWITCH_TOKEN --output text)
  [ "$current" != "$(cat "$STATE/switch.token")" ] || return 0
  # secrets 의 토큰을 잃었을 때 새 토큰으로 맞춘다. 운영 서버의 env 도 다시 써야 한다
  write_env
  aws lambda update-function-configuration --function-name "$NAME" --environment "file://$WORK/env.json" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$NAME"
  echo "토큰을 새로 만들어 함수에 넣었습니다. 운영 서버의 GPU_SWITCH_TOKEN 도 바꿔야 합니다."
}

ensure_url() {
  local policy=
  if ! exists ResourceNotFoundException lambda get-function-url-config --function-name "$NAME"; then
    aws lambda create-function-url-config --function-name "$NAME" --auth-type NONE >/dev/null
  fi
  if exists ResourceNotFoundException lambda get-policy --function-name "$NAME"; then
    policy=$(aws lambda get-policy --function-name "$NAME" --query Policy --output text)
  fi
  # 주소는 누구나 부를 수 있고 토큰은 함수가 확인한다. 앞선 실행이 URL 만 만들고 끊겼을 수 있어 따로 본다
  case $policy in
    *'"function-url"'*) ;;
    *) aws lambda add-permission --function-name "$NAME" --statement-id function-url \
      --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null ;;
  esac
  case $policy in
    *'"function-url-invoke"'*) ;;
    *) aws lambda add-permission --function-name "$NAME" --statement-id function-url-invoke \
      --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null ;;
  esac
  aws lambda get-function-url-config --function-name "$NAME" --query FunctionUrl --output text >"$STATE/switch-url"
}

cmd_setup() {
  find_standby
  mkdir -p "$STATE"
  tmp_files
  [ -s "$STATE/switch.token" ] || openssl rand -hex 32 >"$STATE/switch.token"
  ensure_ledger
  ensure_role
  ensure_function
  # URL 보다 먼저 건다. 동시에 두 번 돌면 장부를 읽고 쓰는 사이에 서로 덮는다
  aws lambda put-function-concurrency --function-name "$NAME" --reserved-concurrent-executions 1 >/dev/null
  ensure_url
  echo "스위치가 준비됐습니다. 주소는 $STATE/switch-url, 토큰은 $STATE/switch.token 에 있습니다."
}

cmd_update() {
  exists ResourceNotFoundException lambda get-function --function-name "$NAME" || die "함수가 없습니다. 먼저 setup 을 돌립니다."
  mkdir -p "$STATE"
  tmp_files
  build_zip
  aws lambda update-function-code --function-name "$NAME" --zip-file "fileb://$WORK/switch.zip" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$NAME"
  echo "함수 코드를 올렸습니다."
}

[ $# -eq 1 ] || usage
case $1 in
  setup | update) ;;
  *) usage ;;
esac
[ -n "${AWS_PROFILE:-}" ] || die "AWS_PROFILE 로 관리자 권한 프로필을 고릅니다. 운영 서버에 두는 키가 아닙니다."
[ -f "$HANDLER" ] || die "$HANDLER 가 없습니다."
"cmd_$1"
