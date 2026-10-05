#!/usr/bin/env bash
# 서버 처리 용량 측정 둘째 밤(#154). 준비 단계 메모리, 10·30분 회의, 9/29 실녹음을 잰다.
#
#   bash stt/eval/capacity/night2.sh DATA_DIR RUN_DIR
#
# night.sh 와 같은 사본, 같은 파이썬, 같은 기록기·BE 측정기·멈춤 장치·nice 규칙이다. RUN_DIR 은 새 폴더를 준다.
# 구간 이름이 night.sh 와 겹쳐(env, idle) 같은 폴더에 쌓으면 보고서가 구간을 헷갈린다.
# DATA_DIR 에는 m01, m02(합성 재료), real929(9/29 실녹음) 회의 폴더가 있다. long-60·long-10·long-30 은 없으면 만든다.
# 실녹음 두 실행은 회의록 줄(lines-*.json)을 RUN_DIR 에 남긴다. 전사 문장이라 레포 결과 폴더로 옮기지 않는다.
# 판단 경로 추출 비교(judge_diff)는 유료라 여기서 돌리지 않는다. 따로 승인받은 상한으로 돈다.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "사용: night2.sh DATA_DIR RUN_DIR" >&2
  exit 2
fi
AI_DIR=$(cd "$(dirname "$0")/../../.." && pwd)
mkdir -p "$2"
DATA_DIR=$(cd "$1" && pwd)
RUN_DIR=$(cd "$2" && pwd)
cd "$AI_DIR"                     # python -m stt... 은 ai/ 안에서만 찾는다

PY=${PY:-/opt/mm/ai/.venv/bin/python}
export HF_HUB_OFFLINE=1          # 모델은 미리 받아 둔다(small 포함). 로드 시간에 Hub 확인이 섞이지 않게
BOT_CGROUP=/sys/fs/cgroup/system.slice/mm-bot.service
SELF_CGROUP=/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)   # systemd-run 으로 띄우면 측정 단위 전체의 메모리
EVENTS=$RUN_DIR/events.jsonl
PIDS=$RUN_DIR/pids
RUNNER=("$PY" -m stt.eval.capacity.runner)
OUT=(--out-dir "$RUN_DIR" --pids-file "$PIDS")
NICE=(nice -n 10)
: > "$PIDS"

event() {   # event start|end 시나리오 [rc]
  local rc=""
  if [ $# -ge 3 ]; then rc=", \"rc\": $3"; fi
  printf '{"ts": %s, "event": "%s", "scenario": "%s"%s}\n' "$(date +%s.%N)" "$1" "$2" "$rc" >> "$EVENTS"
}

scenario() {   # scenario 이름 명령...   실패해도 rc 를 남기고 돌아온다
  local name=$1 rc=0
  shift
  event start "$name"
  "$@" > "$RUN_DIR/$name.log" 2>&1 || rc=$?
  event end "$name" "$rc"
  # 끝난 프로세스의 pid 를 지운다. 번호가 다른 프로세스에 다시 쓰이면 멈춤 장치가 그 프로세스를 끈다
  : > "$PIDS"
}

synth() {   # synth 폴더 분   없으면 정렬본 둘을 번갈아 이어 합성 회의를 만든다
  if ls "$DATA_DIR/$1"/*.wav > /dev/null 2>&1; then return 0; fi
  "${NICE[@]}" "$PY" -m stt.eval.capacity.synth --source "$DATA_DIR/m01" --source "$DATA_DIR/m02" \
    --out "$DATA_DIR/$1" --minutes "$2" --gap 5
}

# 데이터 폴더를 먼저 본다. 이름이 틀리면 트랙 0개로 아무것도 재지 않은 채 밤이 끝난다
for d in m01 m02 real929; do
  if ! ls "$DATA_DIR/$d"/*.wav > /dev/null 2>&1; then
    echo "$DATA_DIR/$d 에 wav 가 없다" >&2
    exit 1
  fi
done
synth long-60 60 > "$RUN_DIR/synth-long60.log" 2>&1   # prep 이 합성보다 먼저 돌아서 60분은 여기서 만든다
if [ -f "$AI_DIR/../COMMIT" ]; then cp "$AI_DIR/../COMMIT" "$RUN_DIR/COMMIT"; fi   # 사본에는 .git 이 없다

scenario env "${RUNNER[@]}" env --out-dir "$RUN_DIR"

# 서버 기록기(1초마다 메모리·CPU·프로세스별 PSS, 멈춤 장치)와 BE 응답 측정기
"$PY" -m stt.eval.capacity.sampler --out "$RUN_DIR/sampler.jsonl" --pids-file "$PIDS" --cgroup "$BOT_CGROUP" \
  --cgroup "$SELF_CGROUP" \
  > "$RUN_DIR/sampler.log" 2>&1 &
SAMPLER=$!
"$PY" -m stt.eval.capacity.probe --out "$RUN_DIR/probe.jsonl" > "$RUN_DIR/probe.log" 2>&1 &
PROBE=$!
stop_monitors() {
  kill "$SAMPLER" "$PROBE" 2>/dev/null || true
  wait "$SAMPLER" "$PROBE" 2>/dev/null || true
}
trap stop_monitors EXIT          # 중간에 멈춰도 둘을 끈다

event start idle                 # 아무것도 안 할 때의 서버와 BE 응답
sleep 60
event end idle 0

# 계획의 준비 단계와 실행 단계 메모리 분리. 실행 단계는 같은 회의의 seq 결과(첫째 밤 seq-long60)와의 차로 본다
scenario prep-long60 "${NICE[@]}" "${RUNNER[@]}" prep --tracks-dir "$DATA_DIR/long-60" --label long-60 "${OUT[@]}"
scenario synth-long10 synth long-10 10
scenario synth-long30 synth long-30 30
scenario seq-long10 "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/long-10" --label long-10 --repeat 3 "${OUT[@]}"
scenario seq-long30 "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/long-30" --label long-30 --repeat 1 "${OUT[@]}"
# 실녹음은 회의록 줄을 남긴다. 판단 경로 추출 비교의 입력이다
scenario seq-real929-turbo "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/real929" --label real929 \
  --save-lines "${OUT[@]}"
scenario seq-real929-small "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/real929" --label real929-small \
  --model small --beam 1 --save-lines "${OUT[@]}"
