# 결과 — 가입 이름 100자와 로그인 시도 제한 429 반영 (#446·#457)

- 기록일: 2026-11-07
- 대상: [#446](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/446), [#457](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/457)
- 기준: develop `fde92d13`(#481 병합 뒤). PR은 아직 만들지 않았다.
- 상태: **두 이슈의 FE 할 일을 반영했다.** MSW 기준으로 검증했다. #457의 BE PR #456은 병합 전이다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 두 이슈의 BE 요청과 마지막 댓글의 FE 반영 방침(2026-11-07, 감독 세션이 사용자 대신 정한 기본값)이다.

- #446. BE가 가입 이름을 검증한다(PR #445 병합). 전에는 100자를 넘는 이름이 폼을 통과해 BE 400을 받고 폼 상단의 일반 문구 「요청 내용을 다시 확인해 주세요.」로만 보였다. 이제 이름 칸 아래에 「이름은 100자 이하로 입력해 주세요.」가 보이고 요청을 보내지 않는다.
- #457. BE가 로그인 실패 횟수를 제한한다(PR #456 열림). 전에는 429가 모르는 코드라 「문제가 생겼어요. 잠시 후 다시 시도해 주세요.」로 보였다. 이제 서버 문구 「로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.」가 폼 상단에 보인다.

## 실제 구현 및 관련 코드

- [schemas.ts](../../../src/features/auth/model/schemas.ts): 가입 `name`을 앞뒤 공백을 지운 뒤 1~100자로 검사한다. 길이는 UTF-16 단위다. 코드 포인트로 세는 BE보다 엄격해서 폼을 통과한 이름이 길이로 400이 되지 않는다.
- [errors.ts](../../../src/shared/api/errors.ts)·[errorMessages.ts](../../../src/shared/api/errorMessages.ts): `TOO_MANY_LOGIN_ATTEMPTS`와 서버 문구를 그대로 더했다. 화면 코드([LoginForm](../../../src/features/auth/ui/LoginForm.tsx))는 바꾸지 않았다. 401처럼 비필드 오류라 기존 경로로 보인다.
- 재시도: [queryClient.ts](../../../src/shared/api/queryClient.ts)는 네트워크 오류·408·5xx만 다시 보내고 mutation은 다시 보내지 않는다. 429를 다시 보내지 않는 것은 기존 `queryClient.test.ts`가 확인한다. 바꾸지 않았다.
- MSW 가입([auth.ts](../../../src/shared/mock/handlers/auth.ts)): BE `validate_name`을 옮겼다. Python `str.strip()`과 같은 공백 집합으로 앞뒤를 지우고, 코드 포인트로 100자, 제어문자·서로게이트·줄 구분자·글자 방향 제어 문자, 보이는 글자가 없는 이름을 400 `INVALID_REQUEST`(`details.fields`의 `loc` `['body','name']`)로 거절한다. 본문 검증이 중복 이메일 확인보다 먼저다. 응답 `user.name`은 지운 값이다.
- MSW 로그인: 이메일별 실패 횟수를 모의 db `loginLimit`에 둔다. BE처럼 10번째 실패는 401이고 그 뒤 15분 동안 맞는 비밀번호도 429다. `details.retry_after_seconds`와 `Retry-After` 헤더가 같은 값이다. 로그인에 성공하거나 비밀번호 재설정을 마치면 그 이메일의 기록을 지운다. IP 제한과 15분 실패 창은 흉내 내지 않는다.
- 시나리오 `login-rate-limited`: 비로그인이고 `pm@example.com`이 이미 막혀 있다. 남은 시간은 900초로 답한다. 모의 db 버전이 15가 되었다([persistence.ts](../../../src/shared/mock/persistence.ts)).
- [계약 §4.1.2·§4.1.3](../../contracts/frontend-api-contract.md): 가입 이름 규칙과 로그인 429를 합의·현재 구현으로 나눠 적었다.

### 방침에 따른 선택

- 429 문구는 다른 오류 문구의 해요체와 달리 서버 문장을 그대로 쓴다. 남은 시간은 보이지 않고, 계정이 잠겼다고 말하지 않는다. 없는 이메일도 같은 응답이라 잠금을 단정하면 틀린 안내가 된다.
- 로그인 화면의 「비밀번호를 잊으셨나요?」는 켜지 않았다. #451(PR #458)이 BE 메일 설정 뒤에 켠다.
- 폼은 보이지 않는 글자·제어문자를 검사하지 않는다. 입력창으로 넣기 어려운 글자이고 이슈가 요청한 것은 길이다. 그런 이름은 BE 400으로 폼 상단 일반 문구가 보인다.

### 테스트

고치기 전에 실패하는 테스트를 먼저 썼다.

- [schemas.test.ts](../../../src/features/auth/model/schemas.test.ts): 101자 이름은 `nameTooLong`, 100자와 앞뒤 공백을 뺀 100자는 통과.
- [authFlow.test.tsx](../../../src/app/authFlow.test.tsx): 101자 이름은 이름 칸 오류·포커스이고 `POST /auth/signup`이 없다. `login-rate-limited`에서 맞는 비밀번호로 로그인하면 서버 문구 alert만 보이고 `/login`에 남는다.
- [authRules.test.ts](../../../src/shared/mock/authRules.test.ts): MSW 가입 이름 규칙의 거절 9가지와 허용(앞뒤 공백, 이모지 100자, ZWJ), 규칙 위반과 중복 이메일이 함께면 400, 로그인 제한의 횟수·만료·성공 초기화·다른 이메일·재설정 해제·시나리오.
- [auth-limits.e2e.ts](../../../e2e/auth-limits.e2e.ts): 실제 Chromium에서 두 여정. 검증 스킬 `verify-managers-manager`의 `auth`에 넣었다.

## 검증

- 바꾼 곳의 Vitest와 전체 게이트 결과는 PR 본문에 적는다.
- 브라우저(MSW): `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run auth --grep '101자 이름|시도 제한'` 2개 통과. 응답 429·`Retry-After: 900`, alert 문구, 남은 시간·잠금 문구 없음, 「비밀번호를 잊으셨나요?」 비활성을 확인했다. 스크린샷은 커밋하지 않는 로컬 증거다.

## 남은 작업과 제한 사항

- BE PR #456이 병합·배포되면 실서버에서 429와 문구를 확인하고 계약 §1의 서버 오류 코드 목록에 `TOO_MANY_LOGIN_ATTEMPTS`를 넣는다.
- 429 문구와 비밀번호 찾기 링크를 켜지 않는 결정은 감독 세션의 기본값이다. 사용자가 바꾸면 문구 한 줄과 #451의 링크로 따라간다.
- 실서버 왕복은 확인하지 않았다.
