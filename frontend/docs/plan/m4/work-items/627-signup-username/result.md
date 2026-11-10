# #627 가입 아이디와 카카오 가입 화면

2026-11-10 [#627](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/627)을 구현했다. 마일스톤 계획 밖 이슈 작업이며 전체 계획은 수정하지 않았다. BE [#626](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/626)이 아직 병합되지 않아 MSW 로만 확인했다. 두 PR 은 같은 배포에 들어가야 한다.

## 배경

카카오 계정에 이메일이 없는 사람이 있어 초대를 이메일 대신 아이디로 바꾼다. 그래서 모든 계정에 아이디가 있어야 한다. BE #626 이 가입·사용자 응답에 아이디를 더하고, 카카오 가입에서 이메일·비밀번호·병합을 없앴다. 이 작업은 그에 맞춘 화면이다.

## 변경

- **사용자 모양.** `UserDto`·`User` 에 `username` 을 더하고 `email` 을 nullable 로 바꿨다. 초대의 `accepted_user.email` 도 nullable 이다. 컴파일러가 가리킨 사용처(MSW 초대·탈퇴 handler, 계정 연결 끊기 확인 창, 테스트 픽스처)를 고쳤다.
- **아이디 확인 상태 기계.** `entities/user` 에 규칙·정규화(`username.ts`), `fetchUsernameAvailability`·`updateUsername`, 상태 훅 `useUsernameCheck`, 칸 `UsernameField` 를 뒀다. 가입(`features/auth`)과 설정(`features/username-change`)이 같이 쓴다. 상태는 `idle`·`checking`·`available`·`unavailable(taken|invalid|current)`·`failed` 하나다. 가입·저장 가능은 `available` 이고 확인한 값이 지금 입력과 같을 때로 파생한다. 같은 값으로 되돌리면 다시 쓸 수 있다. 확인 중 입력이 바뀌면 앞 요청을 끊는다. 가입·변경 응답의 409 `USERNAME_TAKEN` 과 400 username 칸 오류는 같은 상태에 들어가 칸 오류가 된다.
- **가입.** 요청은 판별 유니온 `SignupInput`(`email` | `kakao`)이다. 옛 `linkKakao`·`verificationToken: string | null` 조합을 지웠다. `SignupSteps` 는 이메일 가입만 다루고, 프로필 단계에서 아이디·이름·비밀번호를 받는다. 카카오 가입(`KakaoSignup`)은 대기 확인 뒤 프로필 단계를 바로 그리고 아이디·이름만 받는다. 이름은 닉네임으로 채운다. 프로필 단계의 종류도 판별 유니온 `SignupProfile` 이고 종류마다 되돌아갈 길(이메일 바꾸기·증명 만료 / 대기 만료)을 들고 있다. `firstSignupStep`·`emailLocked`·`KAKAO_EMAIL_TAKEN_MESSAGE`·`SignupEmailStep` 의 카카오 가지를 지웠다. 첫 포커스는 아이디 칸이다.
- **카카오 병합 안내 제거.** 로그인 화면의 `email_exists` 문구와 `shared/lib/oauth` 의 실패 사유 장치(`OAUTH_REASONS`·`OAuthReason`·`readOAuthReason`·`oauth_reason` 붙이기·지우기)를 지웠다. 다른 사용처는 없었다.
- **사용자 메뉴.** 이름 아래가 `email ?? username` 이다.
- **설정 계정 절.** 알림 다음에 `계정` 절을 뒀다. 이메일(없으면 `이메일 없음` 과 카카오로 로그인하는 계정이라는 설명), 아이디 칸·중복 확인·저장이 있다. 모든 역할이 쓴다. 바꾼 채 나가면 이탈 확인을 건다. 저장은 `PATCH /users/me` 이고 #594 처럼 누를 때의 세션으로만 보낸다. 응답은 `userSchema` 로 읽고 세션 캐시의 `user` 를 바꾼다. 응답을 읽지 못하면 쓰기 토스트와 세션 `새로고침` 이다(D-184).
- **MSW.** 픽스처 계정의 아이디는 BE 마이그레이션 규칙으로 정했다(`pm@example.com` → `userpm`, `minsu@example.com` → `minsu`). 픽스처 계정에 카카오 `kakao-pm` 을 이어 뒀다. `GET /auth/username-availability`, `PATCH /users/me` 를 더했고 `POST /auth/signup` 을 새 계약(카카오 가입에 비밀번호·증명이 있으면 400, 아이디 필수·규칙, 충돌 순서 이메일 → 카카오 → 아이디, 카카오 가입 계정은 이메일·비밀번호 없음)으로 바꿨다. 카카오 대기는 `{ kakaoId, nickname }` 이다. 모의 카카오는 이어진 계정이면 로그인, 아니면 가입 화면이고 이메일 구분을 지웠다. 시나리오 `username-taken`·`username-race`·`kakao-account` 를 더했다.
- **문서.** [계약](../../../../contracts/frontend-api-contract.md) §4.1 표·예시, §4.1.4 의 #627 변경, 새 §4.1.6 아이디. [D-182](../../../../decision/frontend-decisions.md) 에 2026-11-10 갱신 문단을 더했다. 새 결정 번호는 쓰지 않았다.

## 설계에서 정한 것

- 설정 목차에 있던 누를 수 없는 `내 계정` 항목(준비 중)을 지웠다. 이제 `계정` 절이 그 자리다. 둘을 함께 두면 같은 이름이 두 번 보인다.
- 중복 확인 결과 중 저장해 지금 내 아이디가 된 값의 `available` 은 지난 확인으로 보고 `idle` 로 돌린다. 저장 뒤 `저장` 이 다시 켜지지 않는다.
- 확인 중 입력이 바뀌어 끊은 요청은 `checking` 을 지운다. 같은 값으로 돌아와도 끝나지 않을 확인 중 표시가 남지 않는다.

## 검증

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm run format:check` | 이 작업이 바꾼 파일은 모두 통과. 기준 커밋(`6f959a7d`)부터 맞지 않던 9 파일(`.verify/design-627.md`, `meetingMinutesRaces`·`meetingProcessing`·`processingToast` 테스트, `signupCode.ts`, `workspace/model/mapper.ts`, MSW `fixtures/workspace.ts`·`handlers/integration.ts`, `types/api/integration.ts`)은 건드리지 않았다 |
| 바꾼 곳 테스트 | 마지막 코드에서 두 묶음으로 `--maxWorkers=1`. 가입·카카오·설정·앱 셸·모의 서버·스키마 28 파일 481 건, 탈퇴·인증·초대·비밀번호 재설정·푸시 계정·`entities/user`·`features/auth`·`features/member-invite` 27 파일 252 건 모두 통과. 전체 `npm run test` 는 돌리지 않았다 |
| E2E | 기대값만 고쳤고 로컬에서 돌리지 않았다. CI 가 돈다 |

- 이슈 「테스트」 항목
  - 카카오 가입은 이메일 단계 없이 아이디와 이름만 받고 이름 칸에 닉네임이 미리 들어 있다: `app/signupFlow.test.tsx` 「카카오 가입 (#627)」.
  - 이메일 가입은 코드 확인 뒤 아이디·이름·비밀번호를 받는다: 「프로필 단계」 첫 테스트.
  - 중복 확인 전이거나 확인 뒤 아이디를 바꾸면 가입할 수 없다: 「아이디 중복 확인 (#627)」.
  - 가입 응답이 아이디 중복이면 아이디 칸에 오류가 뜬다: 이메일·카카오 가입 둘 다.
  - 이메일 없는 카카오 사용자도 설정과 사용자 메뉴가 깨지지 않는다: `app/settingsAccount.test.tsx`, `app/appShell.test.tsx` 「이메일 없는 계정 (#627)」.
- 설정 아이디 변경: 같은 아이디(요청 없이 `current`), 남의 아이디 409, 규칙 밖(요청 없이 / 서버 400), 그 밖의 실패, 응답을 읽지 못한 쓰기, 이탈 확인, 일반 팀원.
- API·MSW: `entities/user/api/username.test.ts`(중복 확인, 변경, 시나리오), `entities/user/api/auth.test.ts`(새 가입 본문과 409·400 순서).
- 고친 기존 테스트: `signupStep.test.ts`, `schemas.test.ts`, `kakaoLogin.test.tsx`, `mockKakao.test.ts`, `returnParams.test.ts`, `consentFlow.test.tsx`, `authRules.test.ts`, `persistence.test.ts`, `types/api/auth.test.ts`, `settingsPage.test.tsx`, `mapper.test.ts`, 아이디를 더한 픽스처 리터럴. 화면 가입 도우미 `walkSignup` 과 API 도우미 `signUpVerified` 는 아이디를 받고, 주지 않으면 이메일 앞부분으로 만든다.
- E2E: `signup-kakao.e2e.ts` 의 카카오 가입·이어진 계정·만료 뒤 다시 시작을 새 흐름으로 바꾸고 이메일 충돌·카카오 이메일 없음 테스트를 지웠다. 공용 `signUp` 과 화면에서 직접 가입하는 `account-withdrawal`·`auth-limits`·`consent-published` 에 아이디 확인을 더했다.

## 확인하지 않은 것

- BE #626 과의 실서버 왕복. 계약은 BE 브랜치 코드를 읽어 대조했다.
- 실제 카카오 로그인.
- 확인 중 요청을 끊은 것은 MSW 가 받은 요청의 `signal` 로 보이지 않았다. 끊긴 뒤 같은 값으로 돌아와도 확인 중 표시가 남지 않는 화면 동작으로 확인했다.
