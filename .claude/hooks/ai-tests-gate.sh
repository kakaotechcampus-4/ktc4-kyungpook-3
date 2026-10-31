#!/usr/bin/env bash
# Stop hook — ai/ 의 파이썬 코드가 바뀐 채로 응답을 끝내려 하면 ai pytest 를 돌리고, 실패하면 끝내지 못하게 막는다.
#
# 통과시키는 경우: git 저장소 밖, ai venv 없음(FE·BE 팀원), ai/*.py 변경 없음, 같은 변경 상태로 이미 통과함.
# 막는 경우: pytest 실패. exit 2 + stderr 로 실패 출력을 Claude 에게 돌려준다.
# 연속 3번 막으면 게이트를 열고 사용자에게 알린다(무한 루프 방지).
# 상태는 .git 안(ai-test-gate/)에 둔다. 워크트리마다 따로다.
set -u
cat >/dev/null   # hook 입력(JSON)은 쓰지 않는다

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
PY="$ROOT/ai/.venv/bin/python"
[ -x "$PY" ] || exit 0

cd "$ROOT" || exit 0
git status --porcelain -- ai/ | grep -q '\.py$' || exit 0

STATE=$(git rev-parse --path-format=absolute --git-path ai-test-gate)
mkdir -p "$STATE"
KEY=$( { git diff HEAD -- ai/; git ls-files -o --exclude-standard -z -- 'ai/*.py' | xargs -0 -r cat; } \
      | sha256sum | cut -d' ' -f1 )
[ "$(cat "$STATE/passed" 2>/dev/null)" = "$KEY" ] && exit 0

OUT=$(cd ai && "$PY" -m pytest -q -x -p no:cacheprovider 2>&1)
if [ $? -eq 0 ]; then
  echo "$KEY" > "$STATE/passed"
  rm -f "$STATE/blocks"
  exit 0
fi

N=$(( $(cat "$STATE/blocks" 2>/dev/null || echo 0) + 1 ))
if [ "$N" -gt 3 ]; then
  rm -f "$STATE/blocks"
  printf '{"systemMessage": "ai pytest 가 3번 연속 실패한 채로 끝났습니다. 실패가 남아 있습니다."}\n'
  exit 0
fi
echo "$N" > "$STATE/blocks"
{
  echo "ai/ pytest 가 실패했다 (게이트 ${N}/3). 원인을 고치고 다시 돌려라. 고칠 수 없으면 실패 내용을 사용자에게 그대로 보고하라."
  echo "$OUT" | tail -40
} >&2
exit 2
