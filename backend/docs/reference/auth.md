# 계정과 인증

[Backend README](../../README.md)로 돌아가기

가입·로그인·세션·비밀번호 재설정과 이름·아이디 규칙을 정리한다.

## 가입과 카카오 로그인

이메일 가입은 이메일을 인증하고 비밀번호를 정한다. 카카오 가입은 카카오 신원만으로 끝나고 이메일과 비밀번호를 두지 않는다(#610). 두 가입 모두 아이디와 이름을 받는다. 결정 근거는 [M1 결정 기록](../plan/m1/basis-for-decision/2026-11-10-signup-username-decision.md), 원본은 `app/api/auth.py`, `app/services/signup_codes.py`, `app/services/kakao_oauth.py`.

| 경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/v1/auth/signup/code` | `{email}` | 200 `{expires_in: 600, resend_after: 60}`. 503 `MAIL_UNAVAILABLE`, 409 `EMAIL_ALREADY_EXISTS`, 429 `SIGNUP_CODE_RATE_LIMITED` |
| `POST /api/v1/auth/signup/code/confirm` | `{email, code}`(숫자 6자리) | 200 `{verification_token, expires_in: 1800}`. 400 `SIGNUP_CODE_INVALID` |
| `POST /api/v1/auth/signup` | 이메일 가입 `{verification_token, password, name, username}`, 카카오 가입 `{link_kakao: true, name, username}` | 201 사용자 정보와 세션 쿠키, 대기 쿠키 삭제 |
| `GET /api/v1/auth/username-availability?username=` | 로그인 없음 | 200 `{available, reason}` |
| `PATCH /api/v1/users/me` | 로그인, `{username}` | 200 바뀐 사용자 정보 |
| `GET /api/v1/auth/kakao/start?next=` | 앱 안 경로 | 302 카카오 동의 화면. 설정 오류면 302 `/login?oauth=kakao&oauth_result=failed` |
| `GET /api/v1/auth/kakao/callback` | 카카오가 부른다 | 항상 302 |
| `GET /api/v1/auth/kakao/pending` | 대기 쿠키 | 200 `{nickname}`(없으면 null). 400 `KAKAO_LINK_EXPIRED` |

- 코드는 6자리, 유효 10분, 코드당 5회, 재발송 60초, 시간당 5회다. 공인 IP 는 시간당 10회(#691), 전체 주소 합계는 시간당 20통이고 넘으면 429 `global` 이다.
- 코드 요청은 재발송·시간당·전체 제한을 모두 본 뒤에 가입 여부를 판단한다.
- DB 에는 HMAC 만 두고 맞으면 코드만 만료시킨다. 행은 재발송 제한과 전체 상한 집계에 남고, 하루 지나면 다음 코드 요청이 지운다.
- 메일은 제목에 코드를 넣지 않고 재설정 메일과 같은 메일 전용 스레드로 보낸다. 보내는 이름은 `SMTP_FROM` 으로 정한다(`Manager's Manager <주소>`).
- SMTP 설정이 없으면 코드 요청이 503 이라 이메일로는 가입할 수 없다([운영 메일 설정](#운영-메일-설정)).

### 가입할 신원

가입은 본문의 이메일을 읽지 않는다. 카카오 가입에 `password`·`verification_token` 이 오면 400 `INVALID_REQUEST` 다.

| `link_kakao` | 대기 쿠키 | 만드는 계정 |
|---|---|---|
| false | 있어도 보지 않는다 | 증명 토큰의 이메일과 비밀번호. 토큰이 없거나 쓸 수 없으면 400 `SIGNUP_VERIFICATION_INVALID` |
| true | 없거나 만료 | 400 `KAKAO_LINK_EXPIRED` |
| true | 있음 | 카카오 id 만. 카카오가 이메일을 줘도 저장하지 않고 비밀번호도 없다 |

겹치면 이메일, 카카오, 아이디 순으로 보고 409 `EMAIL_ALREADY_EXISTS`, `KAKAO_ALREADY_LINKED`, `USERNAME_TAKEN` 중 하나다. 이미 있는 계정의 로그인 방법은 바꾸지 않는다. 전에 카카오로 가입하며 비밀번호를 정한 계정과 카카오가 이어진 이메일 계정은 두 로그인을 그대로 쓴다.

### 아이디

아이디는 영문과 숫자 4 ~ 20자다. 앞뒤 공백을 지우고 소문자로 저장·비교하며 예약어는 막지 않는다. 규칙은 `app/schemas/username.py` 의 `validate_username` 한 곳에 있다.

- 아이디 확인의 `reason` 은 `taken`·`invalid`·null 이다. 규칙 밖 값도 400 이 아니라 `invalid` 이고, 내 아이디도 `taken` 이다.
- `PATCH /users/me` 로 바꾼다. 지금과 같은 값이면 그대로 200, 남의 아이디면 409 `USERNAME_TAKEN`, 규칙 밖이면 400 `INVALID_REQUEST` 다.
- 마이그레이션 전부터 있던 계정은 이메일 앞부분에서 영문·숫자만 남긴 값을 받았다. 4자 미만이면 앞에 `user` 를 붙이고 20자로 자르며, 겹치면 가입 순서대로 뒤에 숫자를 붙였다.
- 이메일 없는 계정이 있으면 이 마이그레이션의 downgrade 는 오류로 멈춘다.

### 카카오 callback

callback 은 위에서부터 먼저 맞는 갈래를 따른다. 사용자를 만들지 않고 같은 이메일의 계정이 있어도 잇지 않는다.

| 조건 | 결과 |
|---|---|
| `error` 있음 | `access_denied` 는 `cancelled`, 나머지는 `failed`. 유효한 state 가 있을 때만 `next` 를 유지한다 |
| state·nonce 불일치, 카카오 토큰·사용자 조회 실패 | `failed`, 원인은 로그에만 남긴다 |
| `(kakao, id)` 계정 있음 | 세션, `/login?next=&oauth=kakao&oauth_result=success` |
| 나머지 | 대기 쿠키를 심고 `/signup?kakao=1&next=` |

대기 쿠키 `kakao_pending` 은 서명, HttpOnly, Secure, SameSite=Lax, Path `/api/v1/auth`, 30분이다. 카카오 id 와 닉네임만 담고 주소에는 싣지 않는다. 서명이지 암호화가 아니므로 카카오가 이메일을 줘도 읽지 않고 담지 않는다.

### 환경변수

`.env.example` 참고.

| 이름 | 값 |
|---|---|
| `KAKAO_REST_API_KEY` | 카카오 개발자 콘솔의 REST API 키 |
| `KAKAO_CLIENT_SECRET` | 카카오 로그인 보안 설정의 Client Secret |
| `KAKAO_REDIRECT_URI` | 콘솔에 등록한 값과 같은 callback. 로컬 `http://localhost:5173/api/v1/auth/kakao/callback`, 운영 `https://<서비스 주소>/api/v1/auth/kakao/callback` |
| `OAUTH_STATE_SECRET` | Notion 연결과 같은 서명 키. 코드 해시 키도 여기서 파생한다 |

## 가입 이름 규칙

`POST /api/v1/auth/signup` 의 `name` 은 앞뒤 공백을 지운 값으로 저장한다. 지운 뒤 비었거나, 보이지 않는 글자(형식 문자·결합 부호)만 있거나, 제어문자·줄 구분자·짝 없는 서로게이트·글자 방향 제어 문자가 있거나, 100자를 넘으면 400 `INVALID_REQUEST` 다. 이미 있는 계정의 이름은 검사하지 않는다. 결정 근거는 [M1 결정 기록](../plan/m1/basis-for-decision/2026-11-06-signup-name-rule.md), 원본은 `app/schemas/name.py` 의 `validate_name`(`NameStr`). [팀원 표시명](#팀원-표시명-규칙)도 같은 규칙을 쓴다.

## 이메일 정규화

가입(`POST /api/v1/auth/signup`)·로그인(`POST /api/v1/auth/login`)·비밀번호 재설정 요청은 이메일의 앞뒤 공백을 지우고 소문자로 바꿔(`@` 앞부분 포함) 비교·저장한다. `Kim@Example.com` 과 `kim@example.com` 은 같은 계정이다. 규칙은 `app/schemas/email.py` 의 `normalize_email`·`NormalizedEmail` 한 곳에 있고, `User` 모델이 저장할 때도 같은 함수를 부른다.

- 응답의 `user.email`·`accepted_user.email`·`email_masked` 는 소문자다.
- 같은 이메일로 동시에 가입하면 하나만 만들어지고 나머지는 409 `EMAIL_ALREADY_EXISTS` 다.
- 기존 계정은 마이그레이션 `537911f267dc` 가 소문자로 바꾸고, 소문자로 같아지는 계정이 있으면 아무것도 바꾸지 않고 멈춘다.
- 이 마이그레이션은 되돌릴 수 없고 배포 전 확인 방법은 그 파일 설명에 있다.
- 결정 근거는 [M1 결정 기록](../plan/m1/basis-for-decision/2026-11-06-email-normalization.md).

## 세션 토큰

세션 토큰은 sha256 해시로 저장하고 쿠키 값을 해시해 찾는다. 만료된 세션은 워커가 지운다. 쿠키 이름(`session_token`)·값·속성·7일 만료·401 `UNAUTHENTICATED` 는 그대로다. 코드는 `app/services/sessions.py`.

- `session.session_token`(String(255), 유일 인덱스 `ix_session_session_token`)에는 쿠키 원문이 아닌 sha256 hex 만 남는다. 원문은 로그인 응답의 쿠키로만 나간다.
- 쓸 때는 `hash_session_token` 을 직접 불러 넣는다. 컬럼 이름은 [마이그레이션 호환 원칙](../../../deploy/README.md)(이름 변경은 두 배포로 나눈다) 때문에 그대로 두었다.
- 로그아웃은 그 쿠키의 세션 한 행만 지운다. 재설정 confirm 은 계정의 세션을 모두 지운다.
- 만료 세션 정리 주기는 `SESSION_SWEEP_INTERVAL_SECONDS`([운영 실행](operations.md#운영-실행-docker)의 세션 sweeper)다. 로그인 시에는 정리하지 않는다.
- 기존 세션은 마이그레이션 `3c9a1f7d2b64` 가 값만 해시로 바꾼다(스키마 변경 없음). 로그인한 사용자는 그대로 로그인되어 있고, 배포 전 확인은 그 파일 설명에 있다.
- 마이그레이션을 되돌리면(downgrade) 해시에서 원문을 알 수 없어 모든 세션이 지워진다. 코드만 되돌리면 옛 코드가 쿠키 원문을 해시와 비교해 401 이 되어 모두 다시 로그인한다(500 은 아니다).
- 결정 근거는 [M1 결정 기록](../plan/m1/basis-for-decision/2026-11-06-session-token-hash.md).

## 로그인 제한

`POST /api/v1/auth/login` 은 실패가 쌓이면 429 `TOO_MANY_LOGIN_ATTEMPTS` 로 막는다. 원본은 `app/services/login_limit.py`, 적용은 `app/api/auth.py` 의 `login`.

| 기준 | 한도(첫 실패부터 창 시작) | 막는 시간 |
|---|---|---|
| 같은 이메일 | 15분 안에 10번 실패 | 10번째 실패 직후 15분(11번째 시도부터 429) |
| 같은 공인 IP | 15분 안에 50번 실패 | 50번째 실패 직후 15분(51번째 시도부터 429) |

- 막힌 동안은 비밀번호가 맞아도 해시 계산 없이 429 를 준다. 이때 시도해도 시간이 늘지 않고 점증 잠금은 없다. 이미 로그인한 세션은 영향이 없다.
- 응답은 이메일 막힘과 IP 막힘이 같고, 있는 이메일과 없는 이메일도 같다. `Retry-After` 헤더와 `details.retry_after_seconds` 는 같은 정수 초(올림, 최소 1)다.
- 시간이 지나면 풀린다. 로그인에 성공하면 그 이메일의 횟수를 지우고, 재설정 confirm 이 commit 된 뒤에도 그 이메일의 막힘을 푼다.
- 시간이 지나기 전에 사용자가 직접 풀 수 있는 방법은 재설정 confirm 뿐이고, 같은 공인 IP 의 막힘은 confirm 으로 풀리지 않는다. 막힌 화면에서 재설정으로 안내하는 것은 FE 몫이다(#554).
- 시도는 사용자 조회와 해시 계산 전에 잠금 안에서 먼저 센다(예약). 틀린 비밀번호는 세고, 500 같은 예기치 못한 오류나 401 이외의 `AppError` 는 예약을 되돌린다.
- IP 는 `request.client.host` 만 읽고 `X-Forwarded-For` 를 직접 읽지 않는다(uvicorn 이 `--proxy-headers` 로 해석한 값). IPv6 는 /64 로 묶는다.
- 사설 주소·해석할 수 없는 값(테스트 기본값 `testclient` 포함)은 IP 제한을 건너뛰고 이메일 제한만 적용한다.
- 로그인 성공 때 IP 쪽은 이번 예약만 되돌린다. IP 전체를 지우면 자기 계정으로 로그인해 초기화할 수 있어서다.
- 같은 공인 IP(교육장 등)에서 실패가 50번 쌓이면 그 IP 전체가 막힌다. 급히 풀어야 할 때는 API 를 재시작한다.
- 저장은 프로세스 메모리라 서버를 재시작하면 모두 풀린다. 항목은 5만 개까지이고 넘치면 만료된 것, 그다음 오래된 것부터 지운다.
- 서버가 단일 프로세스(`--workers 1`)라는 전제다. `--workers` 를 늘리거나 서버를 2대 이상 두면 프로세스마다 횟수가 따로 쌓이므로 저장소부터 다시 설계한다.
- 남이 같은 이메일로 내 계정을 15분 막을 수 있다. #549 에서 (이메일, IP) 조합 키는 다시 버리고 재설정 안내로 완화하기로 했다. 결정 근거와 남은 노출은 [M1 결정 기록](../plan/m1/basis-for-decision/2026-11-06-login-rate-limit.md).

## 비밀번호 재설정

로그인 없이 부르는 경로 3개다. 결정 근거는 [M1 결정 기록](../plan/m1/basis-for-decision/2026-11-05-password-reset.md), 원본은 `app/services/password_reset.py`·`app/services/mailer.py`.

| 경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/v1/auth/password-reset/request` | `{email}` | 메일 설정이 없으면 503 `MAIL_UNAVAILABLE`. 있으면 가입 여부와 상관없이 200 `{}` |
| `POST /api/v1/auth/password-reset/verify` | `{token}` | 200 `{expires_at, email_masked}`. 쓸 수 없으면 400 `PASSWORD_RESET_TOKEN_INVALID` |
| `POST /api/v1/auth/password-reset/confirm` | `{token, new_password}` | 200 `{}`. 그 계정의 세션을 모두 지운다(새 세션은 만들지 않는다) |

- 링크는 `{APP_BASE_URL}/reset-password#token=<토큰>` 이다. 30분 동안 한 번만 쓸 수 있고 DB 에는 sha256 해시만 둔다. 새 토큰을 발급하면 이전 미사용 토큰은 `invalid` 가 된다.
- 요청은 계정마다 60초에 1번, 1시간에 5번이다. 걸려도 응답은 같은 200 이고 이전 링크는 살아 있다. 이메일은 [정규화한 값](#이메일-정규화)으로 찾는다.
- 메일은 응답 뒤 백그라운드에서 보내고, 실패하면 2·4·8초 뒤 3번 더 보낸다. 그래도 실패하면 로그만 남기고(사용자는 다시 요청한다), 서버 재시작 시 보내던 메일은 사라진다.
- 비밀번호는 8자 이상, 숫자(0-9) 하나 이상이다. 회원가입에도 적용되고 어기면 400 `INVALID_REQUEST`.

전체·IP 상한(#550)에 걸려도 응답은 같은 200 `{}` 이고 토큰·메일을 만들지 않으며 이전 링크는 살아 있다. 막힌 이유는 서버 로그(`password reset request blocked: reason=ip|global`)로만 남기고 이메일은 남기지 않는다.

| 상한 | 한도 | 세는 곳 |
|---|---|---|
| 같은 공인 IP(IPv6 는 /64) | 1시간에 5번 | 메모리(재시작하면 풀림) |
| 전체 | 지난 1시간 발급 토큰(쓰거나 무효가 된 것 포함) 10개 | DB(재시작해도 유지) |

- IP 상한은 가입 여부와 상관없이 모든 요청을 세고, 막힌 요청은 세지 않는다. 메일 설정 503 검사 뒤, 첫 DB 조회 전에 막는다.
- IP 판단은 [로그인 제한](#로그인-제한)과 같다. 원본은 `app/services/password_reset_limit.py` 이고 단일 프로세스 전제다.
- 전체 상한은 IP 상한(5)보다 크게 두어 공인 IP 하나로는 다 쓰지 못한다. 사용자 조회 전에 세며, 동시 요청이 몰리면 몇 통 넘을 수 있다.
- 로그인이 잠긴 이메일(#691)은 전체 상한을 보지 않는다. 남이 전체 상한을 채우고 내 이메일로 로그인을 잠가도 재설정 메일은 받는다.
- 계정마다·IP 제한은 그대로다. 근거는 [결정 기록](../plan/m1/basis-for-decision/2026-11-11-auth-abuse-hardening-decision.md).

### 운영 메일 설정

`.env` 에 `SMTP_HOST`·`SMTP_USERNAME`·`SMTP_PASSWORD`·`APP_BASE_URL` 이 모두 있어야 켜진다(나머지는 [.env.example](../../.env.example)). `APP_BASE_URL` 은 PM 글 DM 의 대화 링크에도 쓰이므로 메일을 쓰지 않아도 넣는다. 팀 Gmail 을 쓰는 경우:

1. 팀 전용 Gmail 계정에 2단계 인증을 켠다.
2. Google 계정 > 보안 > 앱 비밀번호에서 비밀번호를 만든다. 일반 비밀번호로는 SMTP 로그인이 안 된다.
3. 서버 `.env` 에 `SMTP_HOST=smtp.gmail.com`, `SMTP_USERNAME=<계정>`, `SMTP_PASSWORD=<앱 비밀번호>`, `APP_BASE_URL=<웹 주소>` 를 넣고 백엔드를 재시작한다.
4. 실제 계정으로 재설정 메일을 받아 링크로 비밀번호를 바꿔 본다. 받은편지함에 없으면 스팸함을 본다.

Gmail 은 하루 발송 한도(약 500통)가 있다. 재설정 메일은 전체 시간당 10통으로 묶지만 같은 계정을 쓰는 가입 인증 메일(#454)의 상한과는 따로라, 두 경로를 하루 내내 채우면 한도를 넘을 수 있다([결정 기록](../plan/m1/basis-for-decision/2026-11-08-reset-mail-cap.md)). 다른 SMTP 로 옮길 때는 환경변수만 바꾼다(포트 465 면 `SMTP_SECURITY=ssl`).

## 팀원 표시명 규칙

`POST /api/v1/members` 와 `PATCH /api/v1/members/{member_id}` 의 `display_name` 은 [가입 이름 규칙](#가입-이름-규칙)을 따른다. 앞뒤 공백을 지운 값으로 저장하고, 어기면 400 `INVALID_REQUEST` 이며 `details.fields[].loc` 에 `display_name` 이 들어간다. 결정 근거는 [M1 결정 기록](../plan/m1/basis-for-decision/2026-11-08-member-display-name-rule.md).

- PATCH 에서 `display_name` 을 빼면 이름을 바꾸지 않고, `null` 을 보내면 400 이다. 이미 저장된 표시명은 검사하지 않는다.
- 같은 워크스페이스의 활성 팀원(삭제·탈퇴 제외)과 이름이 같으면 409 `MEMBER_NAME_DUPLICATED` 다. 원본은 `app/api/members.py` 의 `_ensure_name_free`(#652).
- 앞뒤 공백만 지우고 견주며 대소문자는 그대로 본다(FE `memberNameKey` 와 같다). 공백은 JS `trim` 과 같은 글자(BOM·전각 공백·NBSP 포함)를 지운다.
- `PATCH` 는 이름이 바뀔 때만 보므로 자기 이름을 그대로 보내거나 다른 칸만 고치면 통과한다. 이미 저장된 중복은 그대로 둔다.
- 같은 워크스페이스의 쓰기는 워크스페이스 행 잠금으로 차례로 처리돼, 같은 이름을 동시에 보내면 두 번째가 409 다. DB 제약은 없어서 이 잠금을 거치지 않는 쓰기 경로가 생기면 막지 못한다.
