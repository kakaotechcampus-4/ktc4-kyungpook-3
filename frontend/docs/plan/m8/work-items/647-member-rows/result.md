# #647 팀원 관리·온보딩 팀원 연결을 팀원 기준 목록으로

## 작업 근거와 요약

#647을 근거로 한 마일스톤 계획 밖 이슈 작업이다. 배포된 화면에서 겪은 문제를 고친다. 팀원 연결 화면의 줄이 디스코드 계정이고, 이름 칸은 「그 계정에 연결된 팀원의 이름」이었다. 그래서 「누구인가요?」를 잘못 고른 뒤 다시 고르면 연결을 옮기지 않았다. 대신 앞 팀원에 `PATCH display_name` 을 보내 그 팀원의 이름을 바꿨다(옛 `memberMapping.ts` `planRow` 200~206줄). 팀원 이름을 고치는 화면도 없었다.

이 작업으로 팀원 관리 창과 온보딩 4단계가 팀원 한 명이 한 줄인 같은 목록을 쓴다. 줄마다 이름 고치기, 디스코드 계정 고르기, 연결 옮기기·풀기가 있고 바로 저장한다. 연결 안 된 디스코드 계정이나 이름으로 팀원을 추가한다. 결정은 [D-190](../../../../decision/frontend-decisions.md)에 적었다. 팀원 삭제는 BE API 가 없어 넣지 않았다(#637). 그래서 이슈는 닫지 않는다. BE 는 바꾸지 않았다. 전체 계획과 마일스톤 완료 상태도 바꾸지 않았다.

## 실제 구현

| 사용자에게 보이는 것 | 코드 |
|---|---|
| 팀원 한 줄, 계정 고르기 목록의 상태(`연결 안 됨`·`지금 연결됨`·`OO 님에 연결됨`, 봇 제외), 연결 안 된 계정, 계정을 골랐을 때 할 일(잇기·옮기기·없음), 이름 검사(#613 `memberNameKey`, 자기 자신은 뺌) | `src/features/member-mapping/model/memberRows.ts` |
| 줄마다 바로 저장하는 쓰기 실행기. 쓰기는 목록 전체에서 한 번에 하나다 | `src/features/member-mapping/model/useMemberRowWrites.ts` |
| 팀원 목록, 줄, 그 자리 이름 고치기, 옮기기 확인 창 `OO 님에서 옮길까요?` | `src/features/member-mapping/ui/MemberRows.tsx`, `MemberRowItem.tsx`, `MoveConfirm.tsx`, `nameField.ts` |
| 팀원 관리 창. 제목 `팀원 관리`, 줄마다 초대 상태와 조작(`MemberInviteControl`), 아래 버튼 `닫기` 하나. 쓰는 동안 닫히지 않는다. Discord 미연결이면 계정 칸 없이 줄과 이름 추가, 설정 안내 | `src/widgets/team/ui/MemberConnectDialog.tsx` |
| 온보딩 4단계. 초대 없음. `N명 확인 완료`(N = 디스코드에 연결된 팀원 수, 0 이면 비활성, PM 미연결이면 막고 PM 줄로 포커스)와 `나중에 하기`는 단계만 저장한다. Discord 미연결 화면도 같은 목록이다(D-187 의 `다음`·`건너뛰기` 그대로) | `src/widgets/onboarding/ui/MembersStep.tsx` |
| 창 안의 이름 고치기 칸에서 Esc 를 누르면 고치기만 취소하고 창은 닫지 않는다 | `src/shared/ui/modal/Modal.tsx` `onEscapeKeyDown` |
| 재현 시나리오 `member-rows`(ws_01 PM). 이재환(mb_03)이 지훈(`jihun_dev`) 계정에 잘못 이어져 있고, 최지훈(mb_05)은 연결이 없다. `dahye` 는 연결 안 된 계정이다. 정하늘(mb_04)은 서버를 떠난 계정에 연결돼 있다 | `src/shared/mock/scenarios.ts` |

지운 것은 다음과 같다. 옛 계정 기준 매칭(`memberMapping.ts`·`useMemberMappingForm.ts`·`MemberMappingFields.tsx`)과 그 테스트를 지웠다. #613 의 `features/member-add/` 는 목록에 합치고 지웠다. 온보딩 나가기 링크의 저장(`ExitLink` `beforeLeave`)은 쓸 곳이 없어져 지웠다. 줄마다 이미 저장되기 때문이다. PM 체크박스(#228)도 없앴다. PM 도 한 줄이고 그 줄에서 계정을 고른다.

### 연결 옮기기

다른 팀원에 연결된 계정을 고르면 확인 창이 묻는다. 옮기면 앞 팀원에 `PATCH {discord_user_id: null}` 을 보낸 뒤 새 팀원에 `PATCH {discord_user_id}` 를 보낸다. 같은 계정을 두 팀원에 붙일 수 없어서(409 `DISCORD_USER_ALREADY_MAPPED`) 순서가 이렇다. `display_name` 은 보내지 않는다. 취소하면 아무것도 보내지 않는다.

두 번째 요청이 실패하면 앞 팀원의 연결은 이미 풀렸다. 첫 응답을 팀원 캐시에 넣었으므로 앞 팀원 줄은 사실대로 `계정 고르기`(연결 안 됨)로 보인다. 새 팀원 줄에는 `OO 님 연결은 풀었지만 이 팀원에 잇지 못했어요.` 와 서버 문구, `다시 시도` 가 남는다. `다시 시도` 는 새 팀원에 잇는 요청만 다시 보낸다. 근거는 `src/app/memberRows.test.tsx` 의 「옮기기의 잇기가 실패하면 …」 테스트다.

목록을 믿을 수 없을 때(응답을 잃은 뒤 무효로 표시됨)는 보내기 전에 목록을 다시 받는다. 옮기기는 이와 상관없이 앞 팀원을 풀기 전에 늘 다시 받는다(아래 「리뷰 반영」).

### 경합과 쓰기 규칙

- 쓰기는 목록 전체에서 한 번에 하나다. 쓰는 동안 모든 줄의 조작이 잠긴다. 같은 틱의 두 번째 누름은 mutation key 와 ref 로 막는다. 빠른 연속 조작, 두 번 클릭, 같은 계정을 두 줄에서 동시에 고르기가 모두 이것으로 막힌다.
- #594 규칙을 따랐다. 누를 때 세션 범위를 잡고, `mutationFn` 첫 줄에서 세션을 확인한다. 요청에는 그 세션의 `signal` 을 싣는다. 끝난 세션의 응답은 캐시·문구에 남기지 않고 취소는 알리지 않는다.
- 응답을 읽지 못하면(D-184 `INVALID_RESPONSE`) 실패 문구 대신 `변경 결과를 확인하지 못했어요` 토스트를 보이고 팀원 목록을 다시 받는다. 다음 오류에서도 목록을 다시 받는다: 반영됐을 수 있는 실패(네트워크·5xx·모름), 409 `DISCORD_USER_ALREADY_MAPPED`, 반쯤 끝난 옮기기. 다른 4xx 는 문구만 둔다.
- 성공한 쓰기 뒤에는 팀원 목록과 알림 설정을 다시 받는다. PM 의 디스코드 연결이 알림 설정의 PM 연결 상태를 바꾸기 때문이다(#340).

### 계획 대비 변경

- 팀 화면 팀원 줄의 초대 칩·버튼은 지우지 않고 창의 줄에도 둔다. 두 곳은 같은 초대 조회를 써서 한쪽에서 초대를 취소하면 다른 쪽도 바로 바뀐다(관리 세션 결정, `src/app/team.test.tsx` 로 확인).
- 이름 추가 칸은 디스코드 연결 여부와 상관없이 목록 아래에 늘 있다. #613 의 「추가한 팀원」 목록은 없어졌다. 추가한 팀원은 위 목록의 새 줄이다.
- 팀원 목록을 받는 동안 목록 자리에 뼈대를, 받지 못하면 오류와 `다시 시도` 를 보인다. 그래서 #613 의 「받는 동안 추가 칸이 잠긴다」 테스트는 「뼈대를 보이고 받은 뒤 추가한다」로 바뀌었다.
- 표시 이름이 기존 팀원과 같은 계정을 `팀원으로 추가` 하면 보내지 않는다. 대신 `같은 이름의 팀원 OO 님이 있어요. 그 줄에서 이 계정을 골라 주세요.` 를 보인다. 미리 이름으로 추가한 팀원(#613)에 잇는 길은 그 팀원 줄에서 계정을 고르는 것이다.

### 리뷰 반영

독립 리뷰 두 개(Codex, Grok)가 찾은 결함 여섯을 고쳤다. 항목마다 테스트를 먼저 쓰고, 고치기 전 코드에서 실패하는 것을 본 뒤 고쳤다.

| 결함 | 고친 것 | 테스트 |
|---|---|---|
| (높음) 옮기기의 주인 검사가 캐시를 믿었다. 다른 탭이 바꾼 것은 캐시를 무효로 만들지 않아, 앞 팀원의 **지금** 연결(다른 계정)을 풀 수 있었다 | 앞 팀원을 풀기 전에 늘 목록을 서버에서 다시 받는다(재리뷰 뒤로는 `fetchFresh`, 아래 「재리뷰 반영」). 주인이 옮길 팀원이면 요청 없이 끝난다. 확인받은 앞 팀원이면 풀고 잇는다. 그 밖이면 아무것도 보내지 않고 줄에 `그사이 연결이 바뀌었어요. 새 목록에서 다시 골라 주세요.` 를 둔다. 다시 받은 목록이 캐시에 남아 새 상태에서 다시 고른다 | `useMemberRowWrites.test.tsx` 「옮기기 전에 목록이 무효가 아니어도 다시 받는다…」 외 셋. Codex 의 재현(박민수는 1125 로, 1124 는 정하늘로 바뀐 서버, 무효 표시 없는 캐시)에서 박민수에게 가는 PATCH 가 없다 |
| (중간) 온보딩 왼쪽 위 나가기가 줄 쓰기·단계 저장 중에도 나갔다. 실패와 반쯤 끝난 옮기기를 보일 화면이 없어졌다 | `ExitLink` 에 `busy` 를 두었다. 그동안 `aria-disabled` 이고 눌러도 나가지 않는다. 두 분기 모두 `writing || onboarding.isPending` 을 넘긴다 | `onboardingMembers.test.tsx` 「확인 완료 저장 중에는 나가기를 눌러도 나가지 않는다」(되살림), 「줄을 저장하는 동안에는 나가기를 눌러도 나가지 않고…」 |
| (중간) 이름을 고친 뒤 별칭을 다시 받지 않아 팀 화면 칩에 옛 이름이 남았다 | 성공한 쓰기와, 반영됐을 수 있는 실패·응답을 읽지 못함·반쯤 끝난 옮기기에서 팀원과 함께 `memberAliasesQueryOptions` 도 다시 받는다. MSW 는 백엔드처럼 만들 때 이름 별칭, 이름을 바꾸면 옛 이름 별칭 교체, Discord 계정이 바뀌면 닉네임 별칭 정리·추가를 한다 | `teamAliases.test.tsx` 「팀원 관리 창에서 이름을 고치면 펼쳐 둔 별칭도 새 이름으로 바뀐다…」 |
| (중간) 저장하지 않은 이름 고치기가 단계 완료·건너뛰기·창 닫기에서 확인 없이 사라졌다 | `N명 확인 완료`·`나중에 하기`·하단 `다음 단계`·미연결 화면의 `다음`/`건너뛰기`, 창의 `닫기`·Esc·바깥 클릭이 `guardLeave` 를 거친다. 이름 칸 안의 Esc 는 여전히 고치기만 취소한다 | `onboardingMembers.test.tsx` 「`확인 완료` 는 공통 이탈 확인을 거치고…」, 「`나중에 하기` 와 `다음 단계` 도…」, 「이름을 고치다 `건너뛰기` 를 누르면…」, `memberRows.test.tsx` 「고친 이름을 저장하지 않고 `닫기`·Esc·바깥 클릭으로…」 |
| (낮음) 이미 열린 이름 칸의 `저장` 이 다른 쓰기 중에도 눌렸다(요청은 안 나감) | 다른 쓰기 중에는 `저장` 이 잠긴다 | `memberRows.test.tsx` 「다른 줄의 이름을 저장하는 동안 이미 열어 둔 이름 칸의 `저장` 은 잠긴다」 |
| (낮음) 빈 이름이 문구 없이 넘어갔다. 표시 이름이 빈 계정은 이름 없이 추가하려 했다 | 빈 이름 고치기는 칸을 연 채 `이름을 입력해 주세요.` 를 둔다. 칸을 닫는 것은 자기 이름 그대로일 때뿐이다. `팀원으로 추가` 는 표시 이름의 앞뒤 공백을 지우고 비면 사용자명을 쓴다 | `memberRows.test.tsx` 「이름을 비우고 저장하면…」, 「Discord 표시 이름이 공백뿐인 계정을…」, `memberRows.test.ts` 「빈 이름은 보내지 않고…」 |

남는 한계. 다시 받은 뒤 첫 PATCH 를 보내기까지의 짧은 사이에 생긴 변경은 FE 만으로 막지 못한다. BE 의 조건부 해제나 원자 이동 API(#662)가 필요하다.

### 재리뷰 반영

같은 두 리뷰어(Codex, Grok)가 위 반영을 다시 보고 결함 넷을 더 찾았다. 항목마다 재현 테스트를 먼저 쓰고, 고치기 전 코드에서 실패하는 것을 본 뒤 고쳤다.

| 결함 | 고친 것 | 테스트 |
|---|---|---|
| (높음, Codex·Grok) 옮기기의 다시 받기가 확인 전에 날아간 목록 조회에 합류했다. `fetchQuery` 는 진행 중인 같은 key 의 조회를 그대로 돌려준다. 그 조회가 그 전 주인을 읽었으면 다른 계정의 연결을 풀었다 | 다시 받기를 `fetchFresh` 로 바꿨다. 진행 중인 목록 조회를 거두고, 확인 뒤에 출발한 조회의 답으로만 주인을 판정한다. 그 조회의 `signal` 은 Query 의 `signal` 과 누른 세션의 `signal` 을 묶은 것이다(`AbortSignal.any`). 이를 위해 `fetchMembers(workspaceId, signal)` 을 뽑아 `memberListQueryOptions` 도 그것을 쓴다. 응답을 잃은 뒤의 다시 받기도 같은 길을 쓴다 | `useMemberRowWrites.test.tsx` 「옮기기를 확인하기 전에 출발한 목록 조회는 주인 판정에 쓰지 않는다…」(Codex 재현 그대로), 「옮기기 전 목록 조회를 기다리는 사이 세션이 끝나면 그 조회를 끊고…」 |
| (낮음, Grok) 주인이 바뀌어 옮기기를 거절하면 팀원 목록은 새것인데 별칭은 그 전 것이었다 | 거절에서도 별칭을 다시 받는다. 보낸 것은 없지만 거절을 낸 다시 받은 목록은 다른 곳의 쓰기를 담고 있고, 그 쓰기가 별칭도 바꿨다 | `useMemberRowWrites.test.tsx` 「주인이 바뀌어 옮기기를 거절하면 다시 받은 팀원 목록에 맞춰 별칭도 다시 받는다」 |
| (낮음, Grok) Discord 미연결 팀원 관리 창의 `설정에서 Discord 연결하기` 가 쓰는 중에도 페이지를 떠났다 | 쓰는 동안(`useMemberRowsBusy`) 링크가 `aria-disabled` 이고 눌러도 떠나지 않는다. 그 밖에는 전처럼 `GuardedLink` 의 이탈 확인을 거친다 | `team.test.tsx` 「팀원을 추가하는 동안 설정 링크는 잠겨 눌러도 떠나지 않고…」 |
| (낮음, Grok) MSW 의 Discord 닉네임 별칭이 `display_name` 하나로 골랐다. 백엔드는 서버 별명(`nick`) → 계정 표시 이름(`global_name`) 순으로 한글만인 첫 값을 고르고 사용자 이름은 보지 않는다 | 모의 Discord 사용자에 `nick`·`global_name` 을 두고(`MockDiscordUser`, 응답에는 싣지 않는다) 백엔드와 같은 순서로 고른다. 기존 픽스처는 `display_name` 과 맞게 채웠다. `1124` 의 `display_name: null` 은 백엔드라면 사용자 이름이 들어갈 자리지만 화면의 빈 표시 이름 경우를 보려고 그대로 둔다 | `member.integration.test.ts` 「Discord nickname alias on link」 셋 |

### #660 흡수

develop 의 #660(Discord 를 연결한 팀도 서버에 없는 사람을 이름으로 추가, [D-188](../../../../decision/frontend-decisions.md))을 이 브랜치에 merge 했다. 동작은 이 목록 안에 그대로 산다.

- 이름 추가 칸은 이미 Discord 연결 여부와 상관없이 목록 아래에 있다. #660 의 안내 `Discord 서버에 없는 팀원은 이름으로 추가할 수 있어요. …` 는 `MemberRows` 의 이름 추가 칸 위로 옮겼다. Discord 를 연결한 공간에만 보인다.
- 추가한 팀원은 목록의 새 줄이다. 팀원 관리 창에서는 그 줄에 `초대` 가 있다. 나중에 서버에 들어오면 그 줄에서 계정을 골라 `PATCH {discord_user_id}` 하나로 잇는다. 새 팀원을 만들지 않는다.
- #660 의 겹침 잠금 `useMemberAdding` 은 쓰기 실행기가 대신한다. 실행기는 이름 추가를 포함한 모든 쓰기를 하나씩만 보낸다. `추가한 팀원` 목록은 없다. `features/member-add` 는 지운 채로 두었다.
- #660 의 테스트 7개(`team.test.tsx` 4, `onboardingMembers.test.tsx` 3)는 지우지 않고 같은 행동을 새 목록에서 보도록 옮겼다. E2E `e2e/member-add-discord.e2e.ts` 는 창 이름 `팀원 관리`, 창 안의 그 팀원 줄과 `초대`, `닫기` 로 고쳤다. 검증 스킬의 [기능 지도](../../../../../../.cursor/skills/verify-managers-manager/features/connections-team.md)도 새 창에 맞췄다.
- MSW 시나리오는 `settings-discord-empty`(#660)와 `member-rows`(#647) 둘 다 있다.

## 검증

2026-11-10, Node v24.11.0, 브랜치 `feature/647-member-rows`, 워크트리에서 실행했다.

| 명령 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npx prettier --check . '!.verify/**'` | 통과 |
| `npm run build` | 통과(기존 500 kB 청크 경고) |
| `npx vitest run <바꾼 테스트 14개> --maxWorkers=1` | 14 파일 270 테스트 통과 |
| 시나리오 목록을 도는 테스트 5개(`dashboardScenarios`·`taskScenarios`·`meeting` 타입·`persistence`·`browserDb`) | 135 테스트 통과 |
| 문구 수정 뒤 `src/app/team.test.tsx`·`src/app/memberRows.test.tsx` | 35 테스트 통과 |

리뷰 반영과 #660 merge 뒤(2026-11-10, 같은 워크트리) 다시 돌렸다.

| 명령 | 결과 |
|---|---|
| `npm run typecheck`·`npm run lint`·`npx prettier --check . '!.verify/**'` | 통과 |
| `npm run build` | 통과(기존 500 kB 청크 경고, 기존 문서 마크다운의 CSS 경고 1건) |
| `npx vitest run <바꾼 테스트와 바꾼 모듈을 쓰는 테스트 28개> --maxWorkers=1` | 28 파일 465 테스트 통과 |
| `E2E_PORT=5248 npx playwright test e2e/settings-team.e2e.ts e2e/signup-onboarding.e2e.ts e2e/member-add-discord.e2e.ts --workers=1` | 13 통과 |

재리뷰 반영 뒤(2026-11-10, 같은 워크트리) 다시 돌렸다. 새 테스트는 모두 고치기 전 코드에서 먼저 실패했다.

| 명령 | 결과 |
|---|---|
| 고치기 전 `useMemberRowWrites.test.tsx` (진행 중 조회 재현) | 1 실패, 8 통과. 실패 내용은 `PATCH /members/mb_02`·`PATCH /members/mb_03` 이 나간 것이다 |
| 세션 `signal` 을 빼고 `useMemberRowWrites.test.tsx` (세션 종료 재현) | 1 실패, 9 통과 |
| 고치기 전 `useMemberRowWrites.test.tsx` (거절 뒤 별칭) | 1 실패, 10 통과 |
| 고치기 전 `team.test.tsx -t "설정 링크는 잠겨"` | 1 실패 |
| 고치기 전 `member.integration.test.ts` | 2 실패, 15 통과 |
| `npx vitest run <바꾼 테스트와 바꾼 모듈을 쓰는 테스트 22개> --maxWorkers=1` | 22 파일 300 테스트 통과 |
| `npm run typecheck`·`npm run lint`·`npx prettier --check . '!.verify/**'` | 통과 |
| `npm run build` | 통과(기존 500 kB 청크 경고, 기존 CSS 경고 1건) |
| `E2E_PORT=5248 npx playwright test e2e/member-add-discord.e2e.ts e2e/settings-team.e2e.ts --workers=1` | 10 통과 |

재현 테스트(`memberRows.test.tsx` 「이슈의 재현(member-rows)…」)가 버그를 잡는지도 확인했다. 옮기기의 첫 요청을 `display_name` PATCH 로 바꾸면 이 테스트가 실패했다. 확인한 뒤 되돌렸다.

브라우저(MSW, Chromium, 1280·390)에서 다음을 확인했다.

- 팀원 관리 창. 이재환에 잘못 이어진 `@jihun_dev` 를 최지훈 줄에서 고르면 `이재환 님에서 옮길까요?` 가 뜬다. `옮기기` 를 누르면 요청은 `PATCH /members/mb_03 {"discord_user_id":null}` 다음 `PATCH /members/mb_05 {"discord_user_id":"1125"}` 둘뿐이다. 이재환은 이름 그대로 `계정 고르기` 이고, 최지훈은 `@jihun_dev` 다. 새로고침한 뒤에도 같다.
- 온보딩 4단계. Discord·Notion 모의 OAuth 를 거쳐 들어간다. 초대 버튼이 없다. PM 줄에서 계정을 고르고 `@minsu 팀원으로 추가` 를 누른 뒤 이름을 박민수로 고친다. 그다음 `2명 확인 완료` 를 누르면 새 공간 대시보드로 간다.
- 두 화면 모두 가로로 넘치지 않는다.

확인하지 못한 것:

- 전체 `npm run test` 는 CI 가 돈다. Playwright E2E 는 위 세 파일만 돌렸다.
- 실서버(FastAPI)와의 연결은 확인하지 않았다. 요청 형식은 기존 계약 그대로다.
- 휴대폰 폭에서 계정 고르기 Select 가 시트로 열리는 모습은 따로 찍지 않았다.
