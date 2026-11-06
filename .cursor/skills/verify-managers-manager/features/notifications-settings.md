# 설정의 알림(메시지·알림 설정)

PM이 설정 화면의 알림 절에서 재촉 토글과 재촉 규칙을 바꾸면 메시지·알림 설정 API(`GET`·`PATCH /workspaces/{id}/message-settings`)에 저장된다. 일반 팀원은 같은 값을 읽기만 한다(#340).

## Sub-features

- `persist-switch`는 재촉 토글을 끄고 새로고침한 뒤에도 꺼져 있는지 확인한다.
- `nudge-rule`은 재촉 규칙 `며칠 전`·`몇 시`를 바꾸면 토글 이름이 규칙을 따르고(`마감 2일 전 18:00에 담당자에게 DM`) 새로고침 뒤에도 남는지 확인한다.
- `member-read-only`는 일반 팀원에게 토글·규칙 선택·PM 알림 방식이 비활성인지 확인한다.

## How to get to it (user POV)

- 헤더 **내 계정** → **설정** → 목차 **알림**, 또는 `/workspaces/ws_01/settings`로 간다.
- 재촉 토글 아래의 두 선택 상자(접근 이름 **재촉 며칠 전**, **재촉 보낼 시각**)로 규칙을 고른다.

## Driving it with Playwright

Preconditions:

- `settings-unmapped`는 ws_01 PM이다. 메시지·알림 설정은 저장 전 기본값(`saved: false`, 하루 전 09:00)이다.
- `settings-member`는 같은 ws_01의 일반 팀원이다.

- **실행.** `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run notifications`로 `settings-notifications.e2e.ts`의 두 테스트를 실행한다.
- **규칙과 토글.** `getByLabel('재촉 며칠 전').selectOption({ label: '마감 2일 전' })`, `getByLabel('재촉 보낼 시각').selectOption({ label: '18:00' })` 뒤 `getByRole('switch', { name: '마감 2일 전 18:00에 담당자에게 DM' })`를 눌러 끈다.
- **후속 상태.** `page.reload()` 뒤 같은 이름의 토글이 꺼져 있고 두 선택 상자의 값이 `2`·`18`이다. MSW 모드는 모의 DB를 같은 탭의 sessionStorage에 두므로 새 문서도 저장 값을 읽는다.
- **일반 팀원.** 토글, 두 선택 상자, **둘 다** 라디오가 비활성이다.

## Gotchas

- 메시지 화면의 마감 기준 보낼 시각(`마감 2일 전` 카드)은 D-117에 따라 E2E에 넣지 않았다. `src/app/messagesMsw.test.tsx`가 규칙별 카드를 본다. 브라우저에서 확인하려면 규칙을 바꾼 같은 탭에서 `/workspaces/ws_01/messages?review=bd_01`로 이동한다.
- 모의 저장은 실제 DB 행의 증거가 아니다. 운영 서버의 저장은 별도 연동 검증이 필요하다.
- 스케줄러(재촉 제안·자동 승인)는 MSW가 흉내 내지 않는다. 규칙을 바꿔도 모의 묶음은 다시 만들어지지 않는다.
