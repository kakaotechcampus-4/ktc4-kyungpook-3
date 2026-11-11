#!/usr/bin/env bash
# PostToolUse(Edit|Write) 훅: docs/, ai/docs/, 루트 README.md 를 고친 직후
# 남은 `[확인 필요]` 표시 개수를 알려 준다. 알림 전용이며 아무것도 막지 않는다.
# 세는 범위는 submission-polish 스킬의 작업 1 과 같다.

set -u

input="$(cat)"

path=""
if command -v jq >/dev/null 2>&1; then
  path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)"
else
  # jq 가 없을 때의 대체. 경로에 큰따옴표가 들어가는 경우는 다루지 않는다.
  path="$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
fi
[ -n "$path" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$root" ] && [ -d "$root" ] || exit 0

# Windows 경로(역슬래시, JSON 이스케이프 포함)를 슬래시로 맞춘 뒤 저장소 기준 상대 경로로 바꾼다.
norm() { printf '%s' "$1" | sed 's#\\\\#/#g; s#\\#/#g'; }
path="$(norm "$path")"
root="$(norm "$root")"
rel="${path#"$root"/}"

case "$rel" in
  docs/*|ai/docs/*|README.md) ;;
  *) exit 0 ;;
esac

cd "$root" 2>/dev/null || exit 0
targets=()
for t in docs README.md ai/docs; do [ -e "$t" ] && targets+=("$t"); done
[ "${#targets[@]}" -gt 0 ] || exit 0

count="$(grep -rn '확인 필요\]' "${targets[@]}" 2>/dev/null | wc -l | tr -d '[:space:]')"
msg="남은 [확인 필요] 표시: ${count}건 (docs, README.md, ai/docs)"

# systemMessage 는 사용자 화면에, additionalContext 는 모델에게 전달된다.
printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$msg" "$msg"
