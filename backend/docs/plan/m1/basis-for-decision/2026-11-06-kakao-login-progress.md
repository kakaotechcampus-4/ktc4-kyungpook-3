# 가입 이메일 인증과 카카오 로그인을 더했다

- 날짜: 2026-11-06
- 이슈: #427
- PR: #454
- 브랜치: feature/427-kakao-login-signup
- 작성자: 김동우

## 한 일

- 가입 전 이메일 코드 인증: `POST /auth/signup/code`, `/signup/code/confirm`. 코드는 HMAC 으로 저장하고 10분 유효, 코드당 5회, 재발송 60초, 시간당 5회다
- `POST /auth/signup` 이 본문 이메일을 받지 않고 증명 토큰이나 카카오 대기 쿠키의 인증된 이메일로만 계정을 만든다
- 카카오 로그인: `GET /auth/kakao/start`, `/callback`, `/pending`. callback 은 계정을 만들지 않는다
- 프론트: 이메일, 코드, 프로필 세 단계 가입, 카카오 연결 가입, 카카오 버튼, 실패 안내. Google 비활성 버튼을 지웠다
- 인증 화면을 휴대폰 폭에 맞췄다. 나머지 화면은 FE 요청으로 넘긴다
- 가입 인증 메일을 로고가 들어간 HTML 로 보낸다. 텍스트 본문도 함께 보낸다
- 기존 계정에 카카오를 처음 이으면 계정 이메일로 연결 알림을 보낸다
- 코드 메일에 전체 시간당 20통 상한을 두었다
- 메일 실패 로그에서 메일 종류를 뺐다

## 왜

남이 팀원 이메일로 먼저 가입해 초대를 가져가는 구멍을 막고 카카오로도 들어오게 하려고 했다. 선택의 근거는 [결정 기록](2026-11-06-kakao-login-decision.md).

## 결과

| 항목 | 값 |
|---|---|
| backend pytest sqlite | 1932 통과, 1383 건너뜀 |
| backend pytest PostgreSQL | 3271 통과, 44 건너뜀 |
| alembic | 빈 PostgreSQL 에서 upgrade, check, downgrade, upgrade 통과 |
| frontend vitest | 3362 통과 |
| frontend e2e | 149 통과, 1 실패. `tasks-approval.e2e.ts` 의 키보드 시나리오이고 이번 변경 전 develop 에서도 실패한다 |
| 비용 | 0원 |

실제 메일은 Gmail 계정으로 가입 코드 API 를 호출해 받아 봤다. 실제 카카오 로그인은 아직 안 했고 가짜 카카오 서버로 확인했다.

## 다음

- 서버 `.env` 에 SMTP 값과 카카오 키를 넣는다. SMTP 가 없으면 코드 요청이 503 이라 새 가입이 막힌다
- 카카오 앱 등록 뒤 실제 로그인을 확인한다
- 인증 외 화면의 휴대폰 지원은 FE 요청 이슈로 넘긴다
