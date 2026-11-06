# 결과 — 비밀번호 재설정 마무리: 로그인 링크와 BE 명세 대조 (#451)

- 기록일: 2026-11-06
- 대상: [#451](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/451)(#356 후속)
- 기준: develop `41d81d68`. PR은 아직 만들지 않았다.
- 상태: **이슈의 할 일 4개를 반영했다.** MSW 기준으로 검증했다. 운영 메일 설정 전이라 실서버와 실제 메일은 미검증이다.
- 병합 조건: BE가 운영 메일 설정 완료를 #356에 알린 뒤 병합한다. 2026-11-06 기준 알림이 없다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #451이다.

1. 로그인 화면의 「비밀번호를 잊으셨나요?」가 `/forgot-password`로 가는 링크가 됐다. 전에는 누를 수 없는 버튼이었다(D-005).
2. BE 명세(#356 마지막 BE 댓글)와 develop의 BE 코드를 FE 요청 함수·매퍼·MSW·계약과 대조했다. 어긋난 두 곳은 FE를 BE에 맞췄다.
   - 비밀번호 길이를 FE도 BE처럼 코드 포인트로 센다. 전에는 UTF-16 단위라 `😀😀😀😀1` 같은 값이 FE를 통과하고 BE에서 400이 됐다.
   - MSW 회원가입이 BE처럼 본문 검증(비밀번호 규칙)을 이미 있는 이메일 확인보다 먼저 한다. 약한 비밀번호와 이미 있는 이메일이 함께 오면 409가 아니라 400 `INVALID_REQUEST`다.
3. D-005·D-006 상태와 [API 계약 §4.1.1·§1·§5.1](../../contracts/frontend-api-contract.md)을 구현 사실로 바꿨다.
4. E2E를 로그인 링크에서 시작하게 하고 사용한·무효 링크, 규칙 위반, 메일 불가(503)를 더했다.

## 명세 대조

| 항목 | BE(develop 코드) | FE 상태 |
|---|---|---|
| request | 메일 설정이 없으면 503 `MAIL_UNAVAILABLE`, 있으면 언제나 200 `{}` | 맞음. 503은 요청 화면에 「지금은 메일을 보낼 수 없어요. 잠시 뒤 다시 시도해 주세요.」 |
| verify | 200 `{expires_at, email_masked}`, 가리는 규칙은 아이디가 3자 이상이면 앞 2자, 아니면 앞 1자 + `***` | 맞음. MSW `maskEmail`이 같은 규칙 |
| confirm | 200 `{}`, 그 계정 세션 전부 삭제, 새 세션 없음 | 맞음. FE는 세션 상태를 비우고 `/login`에 안내를 띄운다 |
| 쓸 수 없는 토큰 | verify·confirm 400 `PASSWORD_RESET_TOKEN_INVALID`, `details.reason` = `invalid`·`used`·`expired` | 맞음. 화면 문구가 셋을 나눈다. 모르는 값은 `invalid` |
| 규칙 위반 | confirm 400 `INVALID_REQUEST`(`details.fields`), 토큰 유지 | 맞음. 새 비밀번호 칸 아래 오류이고 같은 링크로 다시 보낼 수 있다 |
| 길이 세는 단위 | `len()`(코드 포인트) | **고침.** UTF-16 단위였다 |
| 링크 | `{APP_BASE_URL}/reset-password#token=` | 맞음. fragment에서 읽고 verify 전에 주소에서 지운다 |
| 회원가입 | 규칙 위반이면 400(이미 있는 이메일이어도) | 화면은 같은 규칙을 먼저 검사한다. **MSW 순서를 고침** |
| 오류 코드 | `PASSWORD_RESET_TOKEN_INVALID(400)`, `MAIL_UNAVAILABLE(503)` | 맞음. `shared/api` 목록과 문구에 있다 |

## 실제 구현 및 관련 코드

- [LoginForm.tsx](../../../src/features/auth/ui/LoginForm.tsx): 비활성 버튼을 `GuardedLink`(`paths.forgotPassword()`)로 바꿨다. 글자는 `text-dim` 13px, 마우스를 올리면 `text-sub`다. 포커스 표시는 전역 `:focus-visible` 규칙(2px 실선)을 그대로 받는다.
- [schemas.ts](../../../src/features/auth/model/schemas.ts): `newPassword`의 길이 검사를 `[...value].length`로 바꿨다. 가입과 재설정이 같이 쓴다.
- [validation.ts](../../../src/shared/mock/validation.ts): MSW 본문 검증(필수 문자열, 비밀번호 규칙, 400 `details.fields` 모양)을 한 곳에 모았다. [재설정 handler](../../../src/shared/mock/handlers/passwordReset.ts)의 같은 코드를 지우고, [회원가입 handler](../../../src/shared/mock/handlers/auth.ts)가 이것으로 BE 순서를 따른다.
- 약한 비밀번호로 MSW에 가입하던 통합 테스트 두 파일의 입력을 규칙에 맞게 고쳤다.

## 독립 리뷰 반영 (2026-11-06)

Codex 독립 리뷰가 PR #404에서 들어온 재설정 화면의 중간 결함 2건을 찾았다. 둘 다 회귀 테스트를 먼저 써서 고치기 전 실패를 확인한 뒤 고쳤다.

1. 늦은 변경 응답이 다른 계정의 세션을 비웠다. 계정 A의 링크로 변경을 보내고 응답을 기다리는 사이 계정 B로 로그인하면, A의 늦은 성공이 B의 세션 캐시를 비우고 `/login`으로 보내며 B의 푸시 구독까지 풀었다. 이제 [ResetPasswordForm.tsx](../../../src/features/auth/ui/ResetPasswordForm.tsx)가 제출할 때 세션 범위(`captureSessionScope`)를 잡아 confirm에 취소 신호를 넘기고, 오류 표시와 [useFinishPasswordReset.ts](../../../src/features/auth/model/useFinishPasswordReset.ts)의 정리는 같은 세션일 때만 한다. 서버에서 A의 비밀번호가 바뀌었을 수는 있다. 그래도 B의 세션·구독에는 영향이 없다.
2. 같은 화면의 새 메일 링크를 무시했다. `/reset-password#token=A`를 연 뒤 같은 화면에서 `#token=B`로 오면 주소만 지우고 A의 토큰과 확인 결과를 계속 썼다. 무효가 된 A 대신 최신 B를 열어도 바꿀 수 없었고, A가 다른 계정의 유효한 링크면 A의 비밀번호를 바꿨다. 이제 [useResetLink.ts](../../../src/features/auth/model/useResetLink.ts)가 새 기록 항목으로 온 `#token=`을 새 링크로 보고 토큰·확인 결과·변경 거절을 바꾼다. 확인 Query의 key는 토큰 대신 링크 번호를 붙여 링크마다 나뉘고, 앞 링크의 진행 중 확인은 취소된다.

## 완료조건 확인

| 이슈 #451의 할 일 | 상태 | 근거 |
|---|---|---|
| 명세 대조 | 충족 | 위 표. `schemas.test.ts`(이모지), `auth.test.ts`(약한 비밀번호 + 이미 있는 이메일 → 400) |
| 로그인 화면 링크 | 충족(MSW) | `authFlow.test.tsx`(href, 클릭, Tab 순서 이메일 → 링크 → 비밀번호, Enter), E2E `color-contrast.e2e.ts`(4.5:1 이상), Storybook `로그인_기본` play(로컬 미실행, CI가 돌린다) |
| 결정 기록·계약 | 충족 | [결정](../../decision/frontend-decisions.md) D-005·D-006, [API 계약](../../contracts/frontend-api-contract.md) §1·§4.1.1·§5.1 |
| 검증(MSW) | 충족(MSW) | E2E `password-reset.e2e.ts` 6개, `passwordReset.test.tsx`의 서버 400 뒤 같은 토큰 재시도 |

## 설계 결정

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| 늦은 변경 응답의 범위 | 제출할 때 잡은 세션 범위가 지금 세션일 때만 정리·이동 | 화면이 떠났는지(mounted)로 막기: 같은 계정이 로그인 화면에 머문 경우와 다른 계정으로 로그인한 경우를 가르지 못한다. 프로젝트의 다른 늦은 작업도 세션 범위로 막는다 |
| 같은 화면의 새 링크 | 기록 항목(`location.key`)이 바뀌고 `#token=`이 있으면 새 링크 | 해시 문자열 비교: 같은 링크를 다시 열 때 새로 확인하지 못한다. 토큰을 Query key에: 공용 캐시 식별자에 원문 토큰이 남는다 |
| 길이 차이 | FE를 코드 포인트로 센다 | 그대로 두기: FE를 통과한 값이 서버에서 400이 되어 화면이 「요청 내용을 다시 확인해 주세요.」만 보인다. BE를 바꾸기: 이 이슈는 FE를 BE에 맞추는 일이다 |
| MSW 회원가입 | BE처럼 본문 검증을 409보다 먼저 한다 | 그대로 두기: MSW가 BE가 내지 않는 응답을 내어 테스트가 실제와 다른 순서를 굳힌다 |
| 링크 위치·포커스 순서 | 비밀번호 라벨 줄 오른쪽에 두고 DOM 순서대로 이메일 → 링크 → 비밀번호 | 비밀번호 칸 뒤로 옮기기: 디자인 캔버스(Login)의 자리와 달라진다. `tabIndex=-1`: 키보드로 닿을 수 없다 |
| 규칙 위반 경로의 검증 | E2E는 클라이언트 오류와 confirm 요청 0건, 서버 400 뒤 같은 토큰 재시도는 Vitest의 1회 override | 실제 handler로 서버 400 만들기: 클라이언트 규칙이 BE와 같아 화면으로는 닿지 않는다 |

## 검증

- Chromium E2E(MSW): `verify-managers-manager` 스킬의 `run auth --grep '재설정|링크|503|규칙에 어긋난'`로 6개 통과. 증거는 저장소 밖에 둔다(`.verify/`, git 제외).
- 전체 검사 결과는 PR 본문에 적는다.

## 남은 것

- 리뷰 결함 2건의 브라우저 E2E는 더하지 않았다. 같은 문서에서 fragment만 바꾸는 이동과 응답 보류 중 다른 계정 로그인은 Vitest(실제 라우터·Query·MSW)로 확인했다.
- 운영 메일 설정 뒤 실서버에서 실제 메일 링크로 바꾸고 새 비밀번호로 로그인하는 확인(D-116 최종 배포 E2E, #357).
- MSW 회원가입은 이메일 형식과 정규화(pydantic `EmailStr`)를 흉내 내지 않는다. 이번 범위는 비밀번호 규칙과 순서다.
- 포커스 테두리는 전역 규칙(오프셋 -1px)이라 13px 글자의 「?」 끝에 조금 걸친다. 다른 글자 링크와 같은 규칙이라 따로 바꾸지 않았다.
