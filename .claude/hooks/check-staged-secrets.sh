#!/usr/bin/env bash
# PreToolUse(Bash) 훅: `git commit` 이 포함된 명령 직전에 스테이징된 변경에서
# 비밀값 패턴을 찾고, 걸리면 exit 2 로 커밋을 막는다. 이유는 stderr 로 낸다.
#
# 검사 대상
#   1. AWS 액세스 키        AKIA[0-9A-Z]{16}
#   2. GitHub 토큰          ghp_[A-Za-z0-9]{36}
#   3. 개인 키 블록         -----BEGIN ... PRIVATE KEY-----
#   4. 비밀번호 대입        password [:=] 값   (대소문자 무시)
#   5. .env 파일 추가       .env, .env.local, .env.production 등
#
# 오탐을 줄이는 예외 (4번에는 전부, 5번에는 ①만 적용. 1~3번은 ④만 적용)
#   ① .env.example / .env.sample / .env.template 은 추가해도 된다.
#      값이 비어 있거나 자리표시자인 견본 파일이기 때문이다.
#   ② 값이 비었거나 자리표시자면 통과한다.
#      예: `PASSWORD=`, `<비밀번호>`, `${DB_PASSWORD}`, `changeme`, `your-password`, `****`
#   ③ 코드 파일(.py .ts .tsx .js .jsx .mjs .cjs .java .kt .go .sh)은 따옴표로 감싼
#      문자열 리터럴일 때만 잡는다. `password: str`, `password=form.password`,
#      `password = os.environ[...]` 같은 타입 표기·변수 전달은 비밀값이 아니다.
#   ④ 줄에 `secret-scan: allow` 가 있으면 그 줄은 건너뛴다. 시드 코드에 공개로
#      정의된 데모 계정 비밀번호를 문서에 옮길 때처럼, 사람이 공개해도 된다고
#      확인한 값에만 붙인다.
#   ⑤ 테스트·목 경로(tests/, __tests__/, mocks/, e2e/, test_*.py, *_test.py,
#      *.test.*, *.spec.*)는 4번 검사에서 뺀다. 로그인 픽스처의 가짜 비밀번호가
#      매번 걸리기 때문이다. 1~3번은 테스트 경로에서도 검사한다.
#
# 한계
#   - 훅은 명령 실행 전에 돈다. `git add x && git commit` 처럼 한 명령 안에서
#     스테이징하면 아직 인덱스에 없으므로, 이때와 `commit -a` 일 때는 HEAD 대비
#     작업 트리 변경 전체를 함께 본다(과검출 쪽으로 기운다). 새 파일은 이 경우
#     잡지 못하므로 `git add` 와 `git commit` 을 나눠 실행하는 편이 정확하다.
#   - 패턴 검사일 뿐이다. 통과가 비밀값이 없다는 보증은 아니다.
#
# 병합 중일 때
#   병합 중(MERGE_HEAD 가 있을 때)에는 상대 브랜치의 변경 전체가 "추가된 줄"로 보인다.
#   그 줄은 이미 상대 브랜치에 들어가 있는 내용이라 여기서 막아도 고칠 수 없다. 그래서 병합 중에는
#   HEAD 와 MERGE_HEAD 양쪽 모두에 없던 줄, 곧 충돌을 풀면서 새로 생긴 줄과 파일만 검사한다.

set -u

input="$(cat)"

# stdin JSON 에서 값을 꺼낸다. jq → python 순으로 시도하고, 둘 다 없으면 빈 값.
json_get() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    local py; py="$(command -v python3 || command -v python)"
    printf '%s' "$input" | "$py" -c '
import json, sys
try:
    v = json.load(sys.stdin)
    for k in sys.argv[1].strip(".").split("."):
        v = v.get(k) if isinstance(v, dict) else None
    print(v if isinstance(v, str) else "", end="")
except Exception:
    pass
' "$1" 2>/dev/null
  fi
}

cmd="$(json_get .tool_input.command)"
# 파서가 없으면 원문 JSON 을 그대로 본다. `git commit` 탐지에는 충분하다.
[ -n "$cmd" ] || cmd="$input"

# `git commit` (사이에 `-C dir`, `-c k=v` 같은 전역 옵션 허용) 이 없으면 관여하지 않는다.
commit_re='(^|[^[:alnum:]_./-])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+commit([^[:alnum:]_-]|$)'
printf '%s' "$cmd" | grep -Eq "$commit_re" || exit 0

cwd="$(json_get .cwd)"
[ -n "$cwd" ] && [ -d "$cwd" ] && cd "$cwd" 2>/dev/null
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

G=(git -c core.quotepath=false)
diff_opts=(-U0 --no-color --no-ext-diff)

scope="스테이징된 변경"
diff_text="$("${G[@]}" diff --cached "${diff_opts[@]}" 2>/dev/null)"
added_files="$("${G[@]}" diff --cached --name-only --diff-filter=A 2>/dev/null)"

# 같은 명령 안에서 스테이징이 일어나면 작업 트리 변경도 본다 (위 "한계" 참고).
if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_])git[[:space:]]+(add|stage)([[:space:]]|$)|commit[[:space:]]+(-[[:alpha:]]*a[[:alpha:]]*|--all)([[:space:]]|$)'; then
  scope="스테이징된 변경 + 작업 트리 변경(한 명령 안에서 스테이징해 과검출될 수 있음)"
  diff_text="$diff_text
$("${G[@]}" diff HEAD "${diff_opts[@]}" 2>/dev/null)"
fi

# 추가된 줄만 "경로<TAB>내용" 형태로 만든다. 허용 표시(예외 ④)가 있는 줄은 버린다.
annotate() {
  awk '
    /^\+\+\+ / { f = substr($0, 5); sub(/^b\//, "", f); next }
    /^\+/      { print f "\t" substr($0, 2) }
  ' | grep -v 'secret-scan: allow' | LC_ALL=C sort -u
}
added_lines="$(printf '%s\n' "$diff_text" | annotate)"

# 병합 중이면 상대 브랜치에 이미 있는 줄과 파일을 뺀다 (위 "병합 중일 때" 참고).
if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
  scope="$scope (병합 중: 상대 브랜치에 이미 있는 내용 제외)"
  theirs_lines="$("${G[@]}" diff --cached MERGE_HEAD "${diff_opts[@]}" 2>/dev/null | annotate)"
  added_lines="$(LC_ALL=C comm -12 <(printf '%s\n' "$added_lines") <(printf '%s\n' "$theirs_lines"))"
  theirs_files="$("${G[@]}" diff --cached MERGE_HEAD --name-only --diff-filter=A 2>/dev/null | LC_ALL=C sort -u)"
  added_files="$(LC_ALL=C comm -12 <(printf '%s\n' "$added_files" | LC_ALL=C sort -u) <(printf '%s\n' "$theirs_files"))"
fi

findings=""
add_finding() { findings="${findings}${findings:+
}$1"; }

# 출력에 비밀값 전체가 남지 않도록 내용은 앞부분만 보여 준다.
show() { awk -F '\t' -v label="$1" '{ print "  [" label "] " $1 ": " substr($2, 1, 60) (length($2) > 60 ? "…" : "") }'; }

# 1~3. 형식이 뚜렷한 키. 경로 예외 없이 검사한다.
hit="$(printf '%s\n' "$added_lines" | grep -E 'AKIA[0-9A-Z]{16}' | show 'AWS 액세스 키')"
[ -n "$hit" ] && add_finding "$hit"
hit="$(printf '%s\n' "$added_lines" | grep -E 'ghp_[A-Za-z0-9]{36}' | show 'GitHub 토큰')"
[ -n "$hit" ] && add_finding "$hit"
hit="$(printf '%s\n' "$added_lines" | grep -E -e '-----BEGIN .* PRIVATE KEY-----' | show '개인 키')"
[ -n "$hit" ] && add_finding "$hit"

# 4. 비밀번호 대입. 예외 ①②③⑤ 를 적용한다.
hit="$(printf '%s\n' "$added_lines" | awk -F '\t' '
  {
    path = $1; line = $0; sub(/^[^\t]*\t/, "", line)
    lpath = tolower(path)

    # 예외 ①: 견본 env 파일
    if (lpath ~ /(^|\/)\.env\.(example|sample|template)$/) next
    # 예외 ⑤: 테스트·목 경로
    if (lpath ~ /(^|\/)(tests?|__tests__|mocks?|__mocks__|e2e)\// ) next
    if (lpath ~ /(^|\/)test_[^\/]*\.py$/ || lpath ~ /_test\.(py|go)$/ || lpath ~ /\.(test|spec)\.[a-z]+$/) next

    low = tolower(line)
    if (!match(low, /password["\047]?[ \t]*[:=][ \t]*[^ \t]+/)) next
    val = substr(line, RSTART, RLENGTH)
    sub(/^[^:=]*[:=][ \t]*/, "", val)

    # 예외 ③: 코드 파일은 따옴표 문자열 리터럴만
    is_code = (lpath ~ /\.(py|ts|tsx|js|jsx|mjs|cjs|java|kt|go|sh)$/)
    quoted = (val ~ /^["\047]/)
    if (is_code && !quoted) next

    gsub(/^["\047`]+|["\047`,;)}]+$/, "", val)
    lval = tolower(val)

    # 예외 ②: 빈 값·자리표시자·환경 변수 참조
    if (lval == "" || lval ~ /^#/) next
    if (lval ~ /^(<|\$|\{\{|%\(|\*\*\*|\.\.\.|xxx)/) next
    if (lval ~ /^(changeme|change[-_]me|your[-_]|example|placeholder|dummy|todo|null$|none$|true$|false$)/) next
    if (lval ~ /^(os\.environ|process\.env|settings\.|env\(|getenv)/) next

    print path "\t" line
  }' | show '비밀번호 대입')"
[ -n "$hit" ] && add_finding "$hit"

# 5. .env 파일 추가. 견본 파일(예외 ①)만 허용한다.
if printf '%s' "$scope" | grep -q '작업 트리'; then
  added_files="$added_files
$("${G[@]}" ls-files --others --exclude-standard 2>/dev/null)"
fi
hit="$(printf '%s\n' "$added_files" | awk '
  {
    n = split($0, parts, "/"); base = tolower(parts[n])
    if (base ~ /^\.env(\..+)?$/ && base !~ /^\.env\.(example|sample|template)$/)
      print "  [.env 파일 추가] " $0
  }' | sort -u)"
[ -n "$hit" ] && add_finding "$hit"

[ -z "$findings" ] && exit 0

{
  echo "커밋 차단: ${scope}에서 비밀값으로 보이는 내용을 찾았습니다."
  printf '%s\n' "$findings"
  echo "조치: 값을 지우거나 환경 변수·시크릿 저장소로 옮긴 뒤 다시 스테이징하세요."
  echo "공개해도 되는 값임을 사람이 확인했다면 그 줄에 'secret-scan: allow' 주석을 답니다."
  echo "(검사 규칙과 예외: .claude/hooks/check-staged-secrets.sh 상단 주석)"
} >&2
exit 2
