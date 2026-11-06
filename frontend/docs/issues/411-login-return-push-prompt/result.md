# 결과 — 로그인 뒤 돌아가기와 기기 알림 안내 (#411)

- 기록일: 2026-11-06
- 대상: [#411](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/411)의 요청 2개(AI 파트가 FE에 요청)
- 기준: develop `bd44cec6`. PR은 아직 만들지 않았다.
- 상태: **요청 2개를 반영했다.** MSW 기준으로 검증했고, 실서버와 실제 기기 푸시는 미검증이다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #411이다.

1. 로그인이 풀린 채 리마인드 푸시를 누르면 로그인 뒤 대시보드나 공간 선택으로 가서, 누른 대화·태스크를 잃었다. 이제 로그인이 필요한 주소를 비로그인으로 열면 로그인 뒤 그 주소로 돌아간다. 푸시로 연 주소와 직접 연 주소가 같은 방식이다.
2. 브라우저 알림은 설정의 알림 절에서만 켤 수 있었다. 이제 팀원이 리마인드 대화를 열면 대화 머리 아래에 기기 알림을 켜자는 띠가 보인다. 권한은 띠의 버튼을 누를 때만 묻는다.

## 실제 구현 및 관련 코드

### 로그인 뒤 돌아가기

- [RequireAuth.tsx](../../../src/app/router/guards/RequireAuth.tsx)가 비로그인을 로그인으로 보낼 때 지금 주소(`pathname + search + hash`)를 `/login?next=`로 붙인다. 주소를 만드는 것은 [routes.ts](../../../src/shared/config/routes.ts)의 `paths.login(next)`다.
- [RedirectIfAuthed.tsx](../../../src/app/router/guards/RedirectIfAuthed.tsx)가 로그인 뒤 `next`를 먼저 본다. 쓸 수 없는 값이면 원래 규칙(`postLoginPath`, `authRevisitPath`)대로 간다. 이동은 여전히 이 가드 한 곳에서만 한다.
- [returnPath.ts](../../../src/shared/lib/return-path/returnPath.ts)의 `parseReturnPath`가 `next`를 판정하는 유일한 곳이다. 받는 것은 앱 안 보호 경로(`/workspaces`, `/workspaces/…`, `/onboarding/…`)뿐이다.
  - 버리는 값: `//evil.com`, `/\evil.com`, `https://…`, `javascript:`, 제어 문자, 여러 번 인코딩해 숨긴 `//`·`\`(`%2F%2F`, `%252F%252F`, `%5C`), 점 경로로 빠져나가는 값(`/workspaces/%2e%2e/login`), 2,048자를 넘는 값.
  - 인증 화면(`/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`)과 모의 화면(`/__mock/…`)은 허용 목록 밖이라 자동으로 빠진다.
  - 정규화한 뒤에 검사하고, 정규화한 값을 돌려준다.
- 소속은 여기서 보지 않는다. 돌아간 곳이 소속이 아닌 공간이면 그 경로의 `RequireTeamMember`가 지금처럼 접근 불가 화면을 보인다.
- [useLogout.ts](../../../src/features/auth/model/useLogout.ts)는 직접 로그아웃한 기록 항목(`location.key`)을 [signOutMarker.ts](../../../src/features/auth/model/signOutMarker.ts)에 표시한다. 그 항목에서는 `RequireAuth`가 `next`를 붙이지 않는다. 표시는 다음 로그인([useEnterSession.ts](../../../src/features/auth/model/useEnterSession.ts))과 앱 인스턴스 폐기([createApp.ts](../../../src/app/createApp.ts))에서 지운다.

### 기기 알림 안내 띠

- [BrowserPushPrompt.tsx](../../../src/features/browser-push/ui/BrowserPushPrompt.tsx)가 띠다. [ThreadDetail.tsx](../../../src/widgets/message-inbox/ui/ThreadDetail.tsx)가 대화 머리와 본문 사이에 그린다. 조건은 [viewer.ts](../../../src/widgets/message-inbox/model/viewer.ts)의 `pushPrompt`(팀원만)와 대화에 봇 메시지가 하나 이상 있는 것이다.
- 문구는 사용자 결정(2026-11-05)대로다. 제목 「다음 리마인드를 기기 알림으로 받을까요?」, 설명 「새 리마인드가 오면 이 기기로 바로 알려 드려요.」, 버튼 [알림 켜기] [닫기].
- 띠가 그릴 것은 [pushPrompt.ts](../../../src/features/browser-push/model/pushPrompt.ts)의 `pushPromptView`가 `PushState`마다 하나로 정한다(`hidden`, `offer`, `install`, `failed`). `subscribed`와 `denied`는 `settlesPushPrompt`가 참이라 닫은 것으로 기록한다.
- 닫은 기록은 [pushPromptRecord.ts](../../../src/features/browser-push/lib/pushPromptRecord.ts)가 `localStorage`의 `browser-push-prompt-closed:<사용자 ID>`에 둔다. 닫은 계정은 띠에서 `useBrowserPush`를 붙이지 않는다. 이 기록은 띠를 보일지만 정한다.
- 이미 허용된 기존 구독을 지금 계정으로 옮기는 일은 띠와 따로 한다. [syncPushSubscription.ts](../../../src/features/browser-push/model/syncPushSubscription.ts)의 `useSyncPushSubscription`을 [AuthenticatedLayout.tsx](../../../src/app/router/layouts/AuthenticatedLayout.tsx)가 로그인 세션마다 한 번 부른다. 권한을 묻거나 구독을 새로 만들지 않는다. 독립 리뷰가 찾은 결함에서 나왔다. 띠를 닫은 계정은 세션 만료 뒤 A→B→A로 바뀌어도 재등록을 건너뛰어, 서버 수신자가 B로 남았다.
- iOS에서 홈 화면 앱이 아니면 버튼 없이 설정과 같은 설치 안내와 [닫기]를 보인다. 설정과 띠가 같은 문구를 [copy.ts](../../../src/features/browser-push/ui/copy.ts)에서 가져온다.
- 권한 요청과 구독은 기존 `useBrowserPush().enable`을 그대로 쓴다. 구독 저장([pushApi.ts](../../../src/entities/notification/api/pushApi.ts)의 `savePushSubscription`)은 세션 범위(`isCurrent`, `signal`)를 받는다. 요청 직전에 세대를 확인하고 POST에 `signal`을 넘긴다. 보내는 중 세션이 끝나면 요청이 취소되고 브라우저 구독을 푼다. 전에는 `signal`이 없어 끝난 세션의 POST가 계속 갔다(독립 리뷰 지적).

## 완료조건 확인

이슈의 요청 항목을 완료조건으로 대응시켰다.

| 이슈 #411의 조건 | 상태 | 근거 |
|---|---|---|
| 로그인이 풀린 채 알림·보호 주소를 열면 로그인 뒤 그곳으로 간다 | 충족(MSW) | `loginReturn.test.tsx`(대화·태스크·만료), E2E `login-return.e2e.ts` |
| 사이트 안 경로만 받는다 | 충족 | `returnPath.test.ts` 표, `loginReturn.test.tsx`와 E2E의 외부 `next` 무시 |
| 그 공간의 팀원이 아니면 기존 접근 불가 처리를 따른다 | 충족(MSW) | `loginReturn.test.tsx`의 비소속 공간 테스트 |
| 페이지를 열자마자 권한 창을 띄우지 않는다. 누르면 `enable` | 충족(MSW) | `browserPushPrompt.test.tsx`, E2E `messages-reminder.e2e.ts`의 권한 요청 횟수 |
| 구독했거나 거절했거나 닫았으면 다시 띄우지 않는다 | 충족(MSW) | `browserPushPrompt.test.tsx`의 닫기·거절·이미 구독 테스트, E2E 새로고침 뒤 확인 |
| iOS는 `needs-install` 안내를 그대로 보인다 | 충족(jsdom) | `browserPushPrompt.test.tsx`의 iPhone 사용자 에이전트 테스트. 실제 iOS 기기는 미검증 |

## 설계 결정

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| 돌아갈 곳을 어디에 싣나 | 로그인 주소의 `?next=` | `sessionStorage`: 탭이 같으면 다른 계정에도 남고 지울 시점을 따로 관리해야 한다. 이동 `state`: 새로고침과 OAuth 왕복에서 사라진다 |
| open redirect 판정 | 받는 쪽 한 곳(`parseReturnPath`)에서 허용 목록 + 정규화 뒤 검사 | 거부 목록만: 새 우회 표기가 나올 때마다 빈틈이 생긴다. 보내는 쪽 검사: 주소창 값은 누구나 고칠 수 있어 받는 쪽 검사가 필요하다 |
| 로그아웃 뒤 다른 계정 | 직접 로그아웃한 기록 항목에는 `next`를 붙이지 않는다 | 실험으로 `RequireAuth`의 이동이 로그아웃의 이동을 덮어 `/login?next=<이전 화면>`이 되는 것을 확인했다(MemoryRouter, StrictMode). 표시가 없으면 다음 계정이 이전 계정의 화면으로 간다 |
| 세션 만료 뒤 다른 계정 | `next`를 그대로 쓴다. 소속 가드가 접근을 가른다 | 만료된 계정과 새 계정을 비교하는 기록: 새로고침하면 사라지고, 같은 사람이 다시 로그인하는 흔한 경우에 이득이 없다. 서버 권한과 소속 가드가 이미 보호한다 |
| 회원가입으로 넘어간 경우 | `next`를 넘기지 않는다. 가입 뒤 시작 방식 선택으로 간다 | 새 계정은 어느 공간에도 속하지 않아 그 주소는 늘 접근 불가다. 초대는 시작 화면에서 받는다 |
| 띠의 위치 | 리마인드 대화 머리 아래(사용자 결정) | 메시지 목록 위 카드, 알림 종 팝오버, 앱 전역 띠는 후보안에서 빠졌다 |
| 닫은 기록의 범위 | 이 기기 × 로그인 계정(`localStorage`) | 계정 × 공간: 푸시 구독이 기기 × 계정 단위라(계약 §5.7) 공간마다 같은 질문을 반복한다. 서버 저장: API가 없다 |
| 띠 표시와 계정 동기화 | 띠의 닫음 기록은 띠 표시에만 쓴다. 기존 구독을 지금 계정으로 옮기는 일은 로그인 세션마다 앱 계층에서 한다 | 띠가 붙을 때만 동기화: 띠를 닫은 계정은 세션 만료 뒤 계정이 바뀌어도 서버 수신자가 앞 계정으로 남는다(독립 리뷰가 재현) |
| 누른 뒤의 동작 | 허용: 띠가 사라지고 토스트 「이 기기에서 알림을 받아요.」. 거절: 띠가 사라지고 다시 보이지 않는다. 권한 창을 그냥 닫음: 띠가 남는다. 실패: 띠 안에 실패 문구와 [다시 시도] | 거절 뒤 띠에 안내를 남기기: 설정의 알림 절이 이미 거절 상태와 해결 방법을 보인다 |

## OAuth 로그인 왕복

Google 로그인은 백엔드에 없어 버튼이 비활성이다([AlternativeAuth.tsx](../../../src/features/auth/ui/AlternativeAuth.tsx), D-007). 그래서 OAuth 로그인 왕복은 확인할 대상이 없다. 나중에 붙일 때는 시작 요청에 `next`를 넘기고, 콜백이 `/login?next=…`로 돌아오게 하면 같은 판정을 탄다.

## 검증 내역

| 시점 | 명령·범위 | 결과 |
|---|---|---|
| 구현 전 | 임시 테스트로 `RequireAuth`에 `next`만 붙이고 로그아웃 | 최종 주소 `/login?next=%2Fworkspaces%2Fws_01%2Fmembers`. 로그아웃 표시가 필요하다는 근거다 |
| 커밋 전 | `npm run typecheck`, `npm run lint`, `npm run build` | 통과 |
| 커밋 전 | `npm run format:check` | git에서 제외한 로컬 파일 `.verify/` 2개만 걸렸다. `.verify`를 뺀 `prettier --check`는 통과 |
| 커밋 전 | `npm run test -- --maxWorkers=1` | 227개 파일, 2,703개 테스트 통과 |
| 커밋 전 | `verify-managers-manager`의 `run auth`(MSW 모드 Vite, Chromium) | 19개 통과. 새 `login-return.e2e.ts` 5개 포함. 대화·태스크 복귀, 외부 `next` 2종 무시와 같은 출처 유지, 직접 로그아웃 뒤 `next` 없음 |
| 커밋 전 | `verify-managers-manager`의 `run messages` | 4개 통과. 띠 표시, 열 때 권한 요청 0회, [알림 켜기] 뒤 1회, [닫기] 뒤 새로고침해도 띠와 `/push/` 요청이 없음, 띠가 나타나도 마지막 메시지가 화면 안 |
| 커밋 전 | 같은 E2E에서 수정을 일부러 뺀 실행 | 닫은 기록을 읽지 않게 하면 새로고침 뒤 단언이, 맨 아래 유지를 빼면 마지막 메시지 단언이 실패했다. 테스트가 실제로 결함을 잡는다 |
| 커밋 전 | Storybook `팀원_알림_띠`, `팀원_내_대화` play(Chromium) | 오류 없음. 전체 `test:storybook`은 CI에 맡겼다 |
| 리뷰 수정 뒤 | 푸시·인증 관련 `vitest` 15개 파일(`pushApi`, `browser-push`, `browserPush`, `browserPushPrompt`, `pushAccountSync`, `logout`, `session`, `loginReturn`, `message-inbox`) | 89개 통과 |
| 리뷰 수정 뒤 | 새 테스트의 수정 제거 실험 | `signal`을 빼면 POST 중 세션 종료 테스트가, 레이아웃의 동기화를 빼면 A→B→A 테스트가 마지막 A 단계(소유자 `us_02`)에서 실패했다 |
| 리뷰 수정 뒤 | `verify-managers-manager`의 `run messages` | 4개 통과, `portOpen: false` |

## 남은 작업과 제한 사항

- 세션 만료 뒤 같은 탭에서 다른 계정이 로그인하면 이전 계정의 주소로 간다. 소속이 아니면 접근 불가 화면이고, 같은 공간의 PM이면 원래 볼 수 있는 화면이다.
- 거절한 뒤 브라우저 설정에서 알림을 허용해도 띠는 다시 보이지 않는다. 설정의 알림 절에서 켤 수 있다.
- 닫은 기록은 기기에만 남아 다른 기기에서는 다시 보인다.
- 알림을 허용한 기기는 로그인 세션마다 구독 등록 POST를 한 번 더 보낸다. 같은 endpoint라 결과는 같다. 설정이나 띠를 열면 그쪽도 한 번 보낼 수 있다.
- 로그인 직후의 동기화 POST가 끝나기 전에 세션이 끝나면 브라우저 구독을 푼다. 기존 설정 화면의 확인과 같은 규칙이다. 그때는 알림을 다시 켜야 한다.
- 서버가 이미 처리한 POST는 취소 신호로 되돌릴 수 없다. 로그아웃이 구독을 먼저 지우는 순서는 그대로 둔다.
- 설정 알림 절의 문구는 #423에서 띠와 같은 기준으로 「켜면 새 알림이 올 때 이 기기로 바로 알려 드려요.」로 바꿨다. [#423 결과](../423-accent-red/result.md)
- 실제 푸시 서비스 구독, 실기기 iOS, 실서버 연동은 미검증이다.

## 관련 기록

- 선행: #330(알림·푸시), #364(PWA·푸시 구독·알림 클릭 이동)
- [API 계약 §5.7 알림·푸시](../../contracts/frontend-api-contract.md)
