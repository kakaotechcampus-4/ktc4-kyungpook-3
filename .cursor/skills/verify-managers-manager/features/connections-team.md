# 설정에서 Discord·팀 연결

온보딩에서 Discord를 건너뛴 PM이 설정에서 연결하고 팀원 연결 창으로 이동한다. 새로고침과 설정 재방문 뒤에도 연결 상태가 남는다.

## Sub-features

- `connect-discord`는 설정에서 모의 OAuth 허용 후 팀 화면으로 이동한다.
- `resume-dialog`는 새로고침 뒤에도 팀원 연결 창을 유지한다.
- `defer-members`는 연결을 미루고 미연결 계정 영역을 표시한다.
- `persist-connection`은 설정 재방문 뒤 연결 상태와 온보딩 저장 요청 부재를 확인한다.
- `add-without-discord`는 Discord 서버에 아무도 없는 연결된 공간에서 이름으로 팀원을 추가하고, 새로고침 뒤 그 팀원 줄에서 아이디로 초대한다(#660).

## How to get to it (user POV)

- 헤더 **내 계정** → **설정** 또는 `/workspaces/ws_03/settings`로 간다.
- **Discord 연결하기**를 누른 뒤 모의 연결을 허용하면 `/workspaces/ws_03/members?connect=members`로 이동한다.
- 팀 화면의 연결 창에서 **나중에 하기**를 선택한다.

## Driving it with Playwright

Preconditions:

- `settings-discord-skipped`는 온보딩을 마친 ws_03 PM이다. Discord와 팀원 연결을 건너뛰었으며 Notion만 연결됐다.
- 테스트는 자체 새 컨텍스트를 사용한다. 이미 연결된 사용자 세션으로 대체하지 않는다.

- **실행.** `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run connections`로 실제 PM 연결 테스트 한 개를 실행한다.
- **연결.** `getByTestId('discord-connection')`의 **연결 안 됨**을 확인한다. 영역 내 **Discord 연결하기**를 누르고 **모의 Discord 연결**에서 **연결 허용**을 누른다. URL이 `/members?connect=members`이고 **팀원 연결** 대화상자에 `@jihun_dev의 팀원 이름` 입력이 보인다.
- **새로고침과 보류.** `page.reload()` 후 같은 입력이 보이는지 확인한다. **나중에 하기**를 누르면 URL의 `connect`가 사라지고 **연결되지 않은 계정** 영역에 `jihun_dev`가 남는다.
- **후속 상태.** `/workspaces/ws_03/settings`로 다시 이동해 Discord 영역의 정확한 **연결됨**을 확인한다. 온보딩 PATCH 요청이 0회라는 단언도 증거에 포함한다.
- **프로필 메뉴 진입.** 자동 테스트는 설정 주소로 시작한다. 메뉴 진입도 요청에 포함되면 `getByRole('button', { name: /^내 계정/ }).click()` 후 `getByRole('menuitem', { name: '설정', exact: true }).click()`을 추가로 확인한다. 이 동작은 `auth`의 공간 전환 테스트에도 있다.

- **이름 추가와 초대.** `settings-discord-empty`로 `/workspaces/ws_01/members`에 간다. **팀원 관리** → **팀원 연결** 대화상자의 `팀원 이름` 입력에 이름을 적고 **추가**를 누르면 **추가한 팀원** 목록에 보인다. **나중에 하기** 후 새로고침하면 그 이름의 region에 **초대**가 있다. **아이디**에 `doyun`을 넣고 **찾기** → **초대하기** 후 **대기**가 새로고침 뒤에도 남는다.

## Gotchas

- **나중에 하기**는 팀원 연결 성공이 아니다. 이 여정은 Discord 연결과 팀원 연결 보류를 검증한다. 실제 팀원 매핑은 `auth`의 PM 연결 여정으로 확인한다.
- `settings-team.e2e.ts`의 나머지 너비별 테스트는 준비 과정에 Notion DELETE를 사용한다. 기본 필터는 그 테스트를 제외한다.
- 모의 연결 성공은 실제 Discord 서버 권한·봇 초대의 증거가 아니다.
- 초기 생성 시 이 전체 여정을 Chromium에서 통과했다. `.verify/managers-manager/2026-11-03T10-17-42-625Z-connections-54f7ef6a/`에 Doctor·trace·PNG·결과·종료된 포트 확인을 보관했다.
