"""AI Hub 464 form 표기를 학습 정답 문자열로 바꾼다. 쓸 수 없는 발화는 None."""
import re

PAIR = re.compile(r"\(([^()]*)\)/\(([^()]*)\)")
NOISE = re.compile(r"/\([a-z_]+\)")
NATIVE = re.compile(r"(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔)(?=\s|[가-힣])")
QUESTION = re.compile(r"(까|나요|죠)$")
STATEMENT = re.compile(r"(요|다)$")


def clean(form):
    s = form
    while True:
        m = PAIR.search(s)
        if not m:
            break
        left, right = m.group(1), m.group(2)
        s = s[:m.start()] + (right if re.search(r"[0-9A-Z]", right) and not NATIVE.match(left) else left) + s[m.end():]
    s = NOISE.sub(" ", s)
    if "(())" in s or "@이름" in s or "@상호명" in s or re.search(r"@[가-힣]+\d", s) or "*" in s:
        return None
    s = re.sub(r"\(@([^()]*)\)", r"\1", s)
    s = re.sub(r"(?<!\S)[가-힣]{1,2}~(?!\S)", " ", s)
    s = s.replace("@", "").replace("~", "").replace("`", "'")
    if re.search(r"[()/]", s):
        return None
    s = " ".join(s.split())
    if not s:
        return None
    if s[-1] not in ".?!":
        if QUESTION.search(s):
            s += "?"
        elif STATEMENT.search(s):
            s += "."
    return s
