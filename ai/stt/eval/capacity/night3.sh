#!/usr/bin/env bash
# 서버 처리 용량 측정 셋째 밤(#154). 첫째·둘째 밤에 로컬 모델로 잰 전사 시나리오를 Elice 로 다시 잰다.
#
#   bash stt/eval/capacity/night3.sh DATA_DIR RUN_DIR
#
# ELICE_API_KEY 와 ELICE_STT_BASE_URL 이 환경에 있어야 한다. 없으면 아무것도 하지 않고 끝난다. 값은 출력하지 않는다.
# night.sh 와 같은 사본, 같은 파이썬, 같은 기록기·BE 측정기·멈춤 장치·nice 규칙이다. RUN_DIR 은 새 폴더를 준다.
# DATA_DIR 에는 two-person, m01, m02, real929 회의 폴더가 있다. long-10·long-30·long-60 은 없으면 night2 처럼 만든다.
#
# 유료다. 모든 전사 호출(예열 1초 포함)이 RUN_DIR/elice_spend.jsonl 에 비용을 먼저 예약하고, 합이 CAP_KRW
# (기본 1500원)를 넘을 호출은 보내지 않는다. 워커 2개 시나리오의 두 프로세스도 같은 장부를 쓴다.
# 시나리오 도중에 상한에 걸리면 남은 호출이 실패한 줄로 남고 rc 는 0 이다. 뒤 시나리오는 남은 몫이 1초 예열에도
# 모자라면 예열에서 곧바로 실패하고, 그보다 남았으면 남은 몫만큼 돌다 같은 꼴로 끝난다. 거절은 장부에 남지
# 않고 stats.failed 로는 시간 초과·429 와 갈리지 않는다. 결과 JSON 의 refused 가 0 보다 크면 상한에 걸린 시나리오다.
# 첫째·둘째 밤 audio_sent_s 로 셈한 예상은 약 9,830초, 983원이다. 재시도는 넣지 않은 값이다.
# 장부와 상한은 보낸 오디오 초 × 6원/60초로 센 추정이다. 실제 청구액과 같은지는 아직 확인하지 않았다.
# 비싼 긴 회의를 뒤에 두어 상한에 걸려도 앞의 실측을 잃지 않게 한다.
# 회의록 줄(lines-*.json)은 RUN_DIR 에 남긴다. 전사 문장이라 레포 결과 폴더로 옮기지 않는다.
# 판단 경로 추출 비교(judge_diff)는 유료라 여기서 돌리지 않는다. 따로 승인받은 상한으로 돈다.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "사용: night3.sh DATA_DIR RUN_DIR" >&2
  exit 2
fi
for v in ELICE_API_KEY ELICE_STT_BASE_URL; do   # 이름만 본다. 값은 출력하지 않는다
  if [ -z "${!v:-}" ]; then
    echo "$v 가 환경에 없다" >&2
    exit 1
  fi
done
AI_DIR=$(cd "$(dirname "$0")/../../.." && pwd)
mkdir -p "$2"
DATA_DIR=$(cd "$1" && pwd)
RUN_DIR=$(cd "$2" && pwd)
cd "$AI_DIR"                     # python -m stt... 은 ai/ 안에서만 찾는다

PY=${PY:-/opt/mm/ai/.venv/bin/python}
BOT_CGROUP=/sys/fs/cgroup/system.slice/mm-bot.service
SELF_CGROUP=/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)   # systemd-run 으로 띄우면 측정 단위 전체의 메모리
EVENTS=$RUN_DIR/events.jsonl
PIDS=$RUN_DIR/pids
RUNNER=("$PY" -m stt.eval.capacity.runner)
OUT=(--out-dir "$RUN_DIR" --pids-file "$PIDS")
# 과금 단위를 확인하지 못해 장부는 호출마다 최소 MIN_BILL_S 초로 적는다(보수 계산). 실제 청구는 장부보다 크지 않다
ELICE=(--backend elice --spend-file "$RUN_DIR/elice_spend.jsonl" --cap-krw "${CAP_KRW:-1500}" --min-bill-s "${MIN_BILL_S:-60}")
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

two_workers() {   # 워커 2개. 두 회의를 다른 프로세스에서 동시에 전사한다. 두 프로세스가 같은 장부를 쓴다
  local a b rc=0
  "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/m01" --label w2-m01 "${ELICE[@]}" "${OUT[@]}" \
    > "$RUN_DIR/workers2-m01.log" 2>&1 &
  a=$!
  "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/m02" --label w2-m02 "${ELICE[@]}" "${OUT[@]}" \
    > "$RUN_DIR/workers2-m02.log" 2>&1 &
  b=$!
  wait "$a" || rc=$?
  wait "$b" || rc=$?
  return "$rc"
}

# 데이터 폴더를 먼저 본다. 이름이 틀리면 트랙 0개로 아무것도 재지 않은 채 밤이 끝난다
for d in two-person m01 m02 real929; do
  if ! ls "$DATA_DIR/$d"/*.wav > /dev/null 2>&1; then
    echo "$DATA_DIR/$d 에 wav 가 없다" >&2
    exit 1
  fi
done
# 합성 회의는 기록기를 켜기 전에 만든다. 둘째 밤에 만든 것이 있으면 그대로 써서 로컬 결과와 같은 입력이다
synth long-10 10 > "$RUN_DIR/synth-long10.log" 2>&1
synth long-30 30 > "$RUN_DIR/synth-long30.log" 2>&1
synth long-60 60 > "$RUN_DIR/synth-long60.log" 2>&1
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

scenario seq-two "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/two-person" --label two --repeat 3 \
  "${ELICE[@]}" "${OUT[@]}"
# golden.score 의 결과 파일 이름에는 회의 이름이 없어서 tag 로 가른다. 회의록 줄은 추출 비교의 입력이다
scenario golden-m01-elice "${NICE[@]}" "${RUNNER[@]}" golden --session "$DATA_DIR/m01" --tag m01 --save-lines \
  "${ELICE[@]}" "${OUT[@]}"
scenario golden-m02-elice "${NICE[@]}" "${RUNNER[@]}" golden --session "$DATA_DIR/m02" --tag m02 --save-lines \
  "${ELICE[@]}" "${OUT[@]}"
scenario botlag-m01 "${RUNNER[@]}" botlag --tracks-dir "$DATA_DIR/m01" "${ELICE[@]}" "${OUT[@]}"
scenario threads "${NICE[@]}" "${RUNNER[@]}" threads --tracks-dir "$DATA_DIR/m01" --tracks-dir "$DATA_DIR/m02" \
  "${ELICE[@]}" "${OUT[@]}"
scenario workers2 two_workers
# 같은 회의 N 개가 같이 끝난 경우. 회의마다 워커 6개라 API 에 최대 6N 개가 한꺼번에 간다
scenario multi-2 "${NICE[@]}" "${RUNNER[@]}" multi --tracks-dir "$DATA_DIR/m01" --n 2 "${ELICE[@]}" "${OUT[@]}"
scenario multi-3 "${NICE[@]}" "${RUNNER[@]}" multi --tracks-dir "$DATA_DIR/m01" --n 3 "${ELICE[@]}" "${OUT[@]}"
scenario multi-5 "${NICE[@]}" "${RUNNER[@]}" multi --tracks-dir "$DATA_DIR/m01" --n 5 "${ELICE[@]}" "${OUT[@]}"
# 워커 수에 따른 한 회의의 벽시계. 워커 6은 위의 golden-m01-elice 와 botlag-m01 이다
scenario seq-m01-w1 "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/m01" --label m01-w1 --workers 1 \
  "${ELICE[@]}" "${OUT[@]}"
scenario seq-m01-w3 "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/m01" --label m01-w3 --workers 3 \
  "${ELICE[@]}" "${OUT[@]}"
# 실녹음은 회의록 줄(lines-real929-elice-1.json)을 남긴다. 판단 경로 추출 비교(judge_diff)의 입력이다
scenario seq-real929 "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/real929" --label real929-elice --save-lines \
  "${ELICE[@]}" "${OUT[@]}"
# 턴마다 묶음 하나(--no-pack-turns)로 한 번 더. 단어 시각이 없어 지금 설정의 묶음 한 줄이 다른 턴을 덮는지 견준다
scenario golden-m01-elice-turn "${NICE[@]}" "${RUNNER[@]}" golden --session "$DATA_DIR/m01" --tag m01-turn --save-lines \
  --no-pack-turns "${ELICE[@]}" "${OUT[@]}"
scenario golden-m02-elice-turn "${NICE[@]}" "${RUNNER[@]}" golden --session "$DATA_DIR/m02" --tag m02-turn --save-lines \
  --no-pack-turns "${ELICE[@]}" "${OUT[@]}"
scenario seq-real929-turn "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/real929" --label real929-elice-turn \
  --save-lines --no-pack-turns "${ELICE[@]}" "${OUT[@]}"
# 비싼 긴 회의는 맨 뒤다. 상한에 걸려도 앞의 실측은 남는다
scenario seq-long10 "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/long-10" --label long-10 --repeat 3 \
  "${ELICE[@]}" "${OUT[@]}"
scenario seq-long30 "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/long-30" --label long-30 \
  "${ELICE[@]}" "${OUT[@]}"
scenario seq-long60 "${NICE[@]}" "${RUNNER[@]}" seq --tracks-dir "$DATA_DIR/long-60" --label long-60 \
  "${ELICE[@]}" "${OUT[@]}"
