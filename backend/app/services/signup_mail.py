"""가입 인증 메일의 HTML. 메일 앱은 CSS 지원이 제각각이라 표 배치와 인라인 스타일만 쓴다."""

_FONT = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif"

_TEMPLATE = f"""\
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;">Manager's Manager 가입을 마치려면 이메일을 인증해 주세요.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="max-width:560px;font-family:{_FONT};color:#171717;">
<tr><td style="padding-bottom:24px;border-bottom:2px solid #171717;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;"><img src="cid:logo" width="36" height="36" alt=""
  style="display:block;border-radius:8px;"></td>
<td style="font-size:20px;font-weight:700;letter-spacing:-0.2px;">Manager's Manager</td>
</tr></table>
</td></tr>
<tr><td style="padding-top:40px;font-size:26px;line-height:34px;font-weight:700;">가입 인증 코드</td></tr>
<tr><td style="padding-top:24px;">
<div style="font-size:40px;line-height:48px;font-weight:700;letter-spacing:8px;">{{code}}</div>
</td></tr>
<tr><td style="padding-top:32px;font-size:15px;line-height:24px;">
안녕하세요.<br>
위 코드를 가입 화면에 입력해 이메일을 인증해 주세요.<br>
코드는 10분 뒤 만료됩니다.
</td></tr>
<tr><td style="padding-top:24px;font-size:15px;line-height:24px;">
코드가 만료되었다면 가입 화면에서 새 코드를 받아 주세요.<br>
직접 요청하지 않으셨다면 아무것도 하지 않으셔도 됩니다. 계정은 만들어지지 않습니다.
</td></tr>
<tr><td style="padding-top:40px;">
<div style="border-top:2px solid #171717;padding-top:24px;font-size:13px;line-height:20px;color:#666666;">
이 메일은 발신 전용입니다.<br>
© 2026 Manager's Manager
</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"""


def render(code: str) -> str:
    """서버가 만든 숫자 코드만 넣으므로 이스케이프하지 않는다."""
    return _TEMPLATE.format(code=code)
