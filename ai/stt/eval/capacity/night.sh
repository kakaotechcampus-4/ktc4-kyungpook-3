#!/usr/bin/env bash
# 서버 처리 용량 측정을 밤에 한 번에 돌린다(#154).
#
#   bash stt/eval/capacity/night.sh DATA_DIR RUN_DIR
#
# 서버의 /home/ubuntu/capacity/code/ai 사본에서 돈다고 본다. 켜 둔 봇의 /opt/mm/ai 와 폴더가 섞이지 않는다.
# 파이썬은 봇의 venv 를 빌려 쓴다. 다른 것을 쓰려면 PY 를 준다.
# DATA_DIR 에는 two-person, m01, m02, long-60 회의 폴더가 있다. 결과 JSON 과 로그는 RUN_DIR 에 쌓는다.
#
# 시나리오마다 앞뒤로 RUN_DIR/events.jsonl 에 시각을 남긴다. 보고서가 서버 기록과 BE 응답 시간을 이 구간으로
# 자른다. 시나리오가 실패하거나 기록기의 멈춤 장치에 꺼져도(rc 143) 끝 시각과 rc 를 남기고 다음으로 간다.
# 시나리오는 운영 워커와 같게 nice -n 10 으로 돌린다. 봇 방식(botlag)만 봇처럼 nice 없이 돈다. 기록기와 BE
# 측정기도 nice 없이 둔다. 부하 중에 표본이 밀리면 재려는 값이 흐려진다.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "사용: night.sh DATA_DIR RUN_DIR" >&2
  exit 2
fi
AI_DIR=$(cd "$(dirname "$0")/../../.." && pwd)
mkdir -p "$2"
DATA_DIR=$(cd "$1" && pwd)
RUN_DIR=$(cd "$2" && pwd)
cd "$AI_DIR"                     # python -m stt... 은 ai/ 안에서만 찾는다

PY=${PY:-/opt/mm/ai/.venv/bin/python}
export HF_HUB_OFFLINE=1          # 모델은 미리 받아 둔다. 로드 시간에 Hub 확인이 섞이지 않게
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

two_workers() {   # 워커 2개. 두 회의를 다른 프로세스에서 동시에 전사한다. 모델도 둘 올라간다
  local a b rc=0
  "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/m01" --label w2-m01 "${OUT[@]}" > "$RUN_DIR/workers2-m01.log" 2>&1 &
  a=$!
  "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/m02" --label w2-m02 "${OUT[@]}" > "$RUN_DIR/workers2-m02.log" 2>&1 &
  b=$!
  wait "$a" || rc=$?
  wait "$b" || rc=$?
  return "$rc"
}

# 데이터 폴더를 먼저 본다. 이름이 틀리면 트랙 0개로 아무것도 재지 않은 채 밤이 끝난다
for d in two-person m01 m02; do
  if ! ls "$DATA_DIR/$d"/*.wav > /dev/null 2>&1; then
    echo "$DATA_DIR/$d 에 wav 가 없다" >&2
    exit 1
  fi
done
if ! ls "$DATA_DIR/long-60"/*.wav > /dev/null 2>&1; then   # 60분 합성 회의는 정렬본 둘을 번갈아 이어 만든다
  "$PY" -m stt.eval.capacity.synth --source "$DATA_DIR/m01" --source "$DATA_DIR/m02" --out "$DATA_DIR/long-60" \
    --minutes 60 --gap 5 > "$RUN_DIR/synth.log" 2>&1
fi
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
sleep 120
event end idle 0

scenario seq-two "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/two-person" --label two --repeat 3 "${OUT[@]}"
# golden.score 의 결과 파일 이름에는 회의 이름이 없어서 tag 로 가른다
for m in m01 m02; do
  scenario "golden-$m-turbo" "${NICE[@]}" "${RUNNER[@]}" golden --session "$DATA_DIR/$m" --tag "$m" "${OUT[@]}"
done
for m in m01 m02; do             # 계획의 S4. small int8 beam 1
  scenario "golden-$m-small" "${NICE[@]}" "${RUNNER[@]}" golden --session "$DATA_DIR/$m" --model small --beam 1 \
    --tag "$m" "${OUT[@]}"
done
scenario botlag-m01 "${RUNNER[@]}" botlag --tracks-dir "$DATA_DIR/m01" "${OUT[@]}"
scenario threads "${NICE[@]}" "${RUNNER[@]}" threads --tracks-dir "$DATA_DIR/m01" --tracks-dir "$DATA_DIR/m02" "${OUT[@]}"
scenario seq-long60 "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/long-60" --label long-60 "${OUT[@]}"
# 메모리를 가장 많이 쓴다. 멈춤 장치에 꺼지거나 스왑을 남겨도 앞의 실측을 잃지 않게 맨 뒤에 둔다
scenario workers2 two_workers
