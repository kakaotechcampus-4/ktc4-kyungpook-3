# M8-B 구현 결과 — 설정·팀 연결 관리

- 기록일: 2026-10-31
- 대상: [M8 계획](plan.md) B 절(이슈 #244). B-1(구현 순서 1~7)과, 결정 5 해결 뒤의 설정·팀 화면 재작업(구현 순서 8~12에 해당)
- 상태: **설정·팀 화면을 디자인 캔버스(Settings·Team 아트보드) 기준으로 구현했다.**
  - 결정 5는 2026-10-31 사용자 요청으로 "디자인 캔버스의 Settings·Team 아트보드를 기준으로 한다"로 풀렸다([결정 기록](basis-for-decision/2026-10-31-settings-team-follow-design-canvas.md)). 5-a·5-b도 아트보드로 정했다.
  - 계획의 B-2 AC(`AC-B-1x`)는 계획에 아직 없다. 이 작업에서는 계획을 고치지 않으므로 재작업은 코디네이터 지시의 완료 기준(아래 「재작업 — 디자인 캔버스 기준」)으로 기록하고, M8-B 전체 완료로 표시하지 않는다.
  - B-1의 AC-B-01~09 기록은 아래 B-1 절에 그대로 둔다. AC-B-05(성공 뒤 설정 유지)는 재작업의 D-074 이동으로 동작이 바뀌었다.
  - 실제 Discord·Notion 연동은 미검증 연동 과제로 남는다.
  - 2026-11-01 검증(VR-B, FAIL·발견 10건) 뒤 수정 라운드에서 발견 10건을 모두 반영했다(아래 「수정 라운드 — VR-B 검증 결과 반영」). VR-08의 `팀 삭제` 좌우 패딩만 공용 버튼 크기 때문에 남겼다. 수정 뒤 typecheck·lint·format:check·전체 test(`--maxWorkers=2`)·build·test:storybook이 모두 exit 0이다.
  - 2026-11-02 사용자 추가 요청으로 설정 진입을 헤더 왼쪽 워크스페이스 메뉴에서 오른쪽 프로필(아바타) 메뉴로 옮기고, 그 메뉴를 논모달로 바꿨다(아래 「추가 요청 — 설정 진입을 프로필 메뉴로」).
  - 같은 날 후속 지적으로, 프로필 메뉴에서 설정으로 옮겨 가면 포커스가 아바타에 남던 것을 설정 제목으로 옮겼다(같은 절 「후속 — 설정으로 옮긴 뒤의 포커스」).
  - 2026-11-05 알림 절을 메시지·알림 설정 API 에 연결했다(아래 「2026-11-05 알림 절의 설정 저장 API 연결 (#340)」).

## 2026-11-07 회의 채팅 채널 고르기 (#429)

### 작업 근거와 요약

- 근거는 이슈 #429 본문과 FE 진행 기본값 댓글(2026-11-07), BE 설계 #428 과 구현 PR #432(2026-11-06 develop 병합), 코디네이터 작업 지시다. M8 계획에는 이 작업의 완료조건이 없어 아래는 이슈의 요청에 대응시킨다. M8-B 전체 완료로 표시하지 않는다.
- PM 이 설정 연결 탭의 Discord 카드 아래 `회의 채팅 채널` 칸에서 연결한 서버의 텍스트 채널을 고르고 저장하면 매일 09:00 채팅 자동 수집이 켜진다. `사용 안 함` 을 저장하면 꺼진다. 일반 팀원에게는 칸이 없다. 온보딩에는 넣지 않았다.

### 실제 구현 및 관련 코드

- 응답 타입 [integration.ts](../../../src/shared/types/api/integration.ts)와 엔티티 [연동 API](../../../src/entities/integration/api/integrations.ts): 연결 조회의 `discord.chat_channel` 을 `discord.chatChannel` 로 바꾸고, 채널 목록(`['workspace', id, 'discord-channels']`)·저장·해제를 더했다.
- 저장 훅 [useChatChannelSetting](../../../src/features/integration-connection/model/useChatChannelSetting.ts): 세션 범위(`captureSessionScope`)를 잡아 세션이 끝났으면 보내지 않고 늦은 응답은 버린다. 성공하면 저장한 공간의 연동 캐시에 결과를 쓰고 다시 받는다. 중복 저장을 막고 자동 재시도는 없다.
- 실패 문구 [chatChannelMessages.ts](../../../src/features/integration-connection/lib/chatChannelMessages.ts): `DISCORD_CHANNEL_NOT_ACCESSIBLE` 의 `need=read` 는 채널 권한에 봇을 추가하라고, `need=send` 는 메시지 보내기 권한을 주라고 알린다. `DISCORD_CHANNEL_NOT_FOUND` 면 채널 목록을 다시 받는다. 공용 문구 표([errorMessages.ts](../../../src/shared/api/errorMessages.ts))에 두 코드를 더했다.
- 칸 [ChatChannelField](../../../src/features/integration-connection/ui/ChatChannelField.tsx)와 선택 상자 [ChannelSelect](../../../src/features/integration-connection/ui/ChannelSelect.tsx): Discord 가 연결돼 있지 않으면 비활성과 연결 안내, 켜거나 바꿀 때 저장 전 안내, `저장`·`되돌리기`, 목록 오류의 다시 시도. 선택 상자는 공용 선택 상자(#471)가 develop 에 없어 네이티브 `<select>` 다.
- 연결 끊기 확인 창 [ConnectionActions](../../../src/features/integration-connection/ui/ConnectionActions.tsx): 채팅 채널이 있으면 `회의 채팅 채널(#이름) 수집도 함께 꺼져요.` 를 덧붙인다. 끊은 뒤 캐시의 채팅 채널도 비운다.
- MSW [handlers/integration.ts](../../../src/shared/mock/handlers/integration.ts): 채널 목록·저장·해제를 BE 순서와 오류 그대로 흉내낸다. 모의 채널 네 개 중 `#운영-비공개` 는 읽기, `#공지` 는 보내기 권한이 없다. Discord 연결 해제는 채팅 채널도 지운다. 모의 DB 버전 15.
- E2E [settings-team.e2e.ts](../../../e2e/settings-team.e2e.ts)에 고르기·실패 안내·저장·새로고침·끊기 확인 문구 여정을 더했다.

### 완료조건 확인

| 이슈의 요청 | 상태 | 근거 |
|---|---|---|
| Discord 항목 아래 `회의 채팅 채널`(PM 만), 미연결이면 비활성과 연결 안내 | 충족(MSW) | `settingsConnections.test.tsx`(비활성·목록 요청 없음·일반 팀원 칸 없음) |
| 선택지는 BE 채널 목록과 `사용 안 함`(해제) | 충족(MSW) | `settingsConnections.test.tsx`(목록·DELETE), 엔티티 API 테스트 |
| 저장 전 안내 | 충족(MSW) | `settingsConnections.test.tsx`, E2E 여정, 결정 기록 |
| 저장 실패 시 BE 오류와 고칠 방법 | 충족(MSW) | `settingsConnections.test.tsx`(`need=read`·`need=send`·`NOT_FOUND`), `chatChannelMessages.test.ts`, E2E 여정 |
| 연결 해제 확인 문구에 채팅 채널 해제 | 충족(MSW) | `settingsConnections.test.tsx`, E2E 여정 |

### 검증 내역

- 2026-11-07, Node v24.11.0. 검사 결과는 아래 「전체 검사」에 적는다.
- 브라우저(MSW): `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run connections --grep '회의 채팅 채널|PM 이 설정에서 Discord|설정·팀 화면은'` 5개 통과(실행 `2026-11-06T18-00-38-939Z-connections-e4dd57f0`, 포트 닫힘 확인). 같은 묶음의 첫 실행은 내가 쓴 토스트 선택자가 두 요소에 맞아 실패했고 선택자를 고친 뒤 통과했다. 화면 증거는 `frontend/.verify/evidence/`(커밋하지 않음).

### 계획 대비 변경

- 계획에 이 작업이 없다. 이슈와 지시에 따른 추가 작업이다.
- 연결 조회 응답 모양이 바뀌어 여러 테스트의 연동 응답 리터럴에 `chat_channel: null` 을 더했다.

### 남은 작업과 제한 사항

- 실제 BE·Discord 서버와 붙인 저장·공지는 확인하지 않았다. MSW 기준이다.
- #471 병합 뒤 `ChannelSelect` 를 공용 선택 상자로 바꾼다.
- 카드의 `채널 바꾸기` 자리 버튼과 이 칸의 뜻이 겹친다. 정리는 제품 결정이 필요하다([결정 기록](basis-for-decision/2026-11-07-chat-channel-save-flow.md)).
- 안내 문구와 위치는 #429 의 FE 기본값이다. PM·디자인 검토는 받지 않았다.
- 전체 Storybook play 와 전체 E2E 는 CI 에 맡겼다.

## 2026-11-05 알림 절의 설정 저장 API 연결 (#340)

### 작업 근거와 요약

- 근거는 이슈 #340(BE→FE 요청과 2026-11-05 BE 댓글)과 코디네이터 작업 지시다. BE 는 PR #341 로 `GET`·`PATCH /workspaces/{workspace_id}/message-settings` 를 병합·배포했다. M8 계획에는 이 작업의 완료조건이 없어 아래는 지시의 할 일에 대응시킨다. M8-B 전체 완료로 표시하지 않는다.
- 사용자가 정한 것(2026-11-05): 재촉 시각은 0~23시 정시를 모두 고른다(야간 제한 없음). 며칠 전은 0~3. 설정을 바꿔도 이미 만든 재촉 제안은 그대로라는 점을 짧게 안내하고, 자동 승인·`due_reminder` 를 끈 경우의 예외도 틀리지 않게 맞춘다.
- 알림 절은 이제 서버 값을 읽고, PM 이 바꾸면 바꾼 키만 저장한다. 일반 팀원은 읽기만 한다. 재촉 규칙이 토글 제목과 메시지 화면의 마감 기준 보낼 시각을 함께 정한다.

### 실제 구현 및 관련 코드

- 응답 타입 [messageSettings.ts](../../../src/shared/types/api/messageSettings.ts), 엔티티 [entities/message-settings](../../../src/entities/message-settings/index.ts)(매퍼·조회·변경, 재촉 규칙 문구 `nudgeRule.ts`). 쿼리 키는 `['workspace', id, 'message-settings']` 다.
- 변경 훅 [useMessageSettings](../../../src/features/message-settings/model/useMessageSettings.ts): mutation `scope` 로 한 공간의 변경을 순서대로 보내고, 진행 중 변경을 서버 값 위에 겹쳐 보인다. 실패하면 겹침이 사라져 값이 돌아오고 토스트 `알림 설정을 저장하지 못했어요` 가 뜬다.
- [NotificationSection](../../../src/pages/settings/ui/NotificationSection.tsx)과 문구 함수 [notificationCopy.ts](../../../src/pages/settings/lib/notificationCopy.ts): 재촉 규칙 선택 두 개(`재촉 며칠 전`·`재촉 보낼 시각`), 규칙을 따르는 토글 제목, `pms[].discord_linked` 기준 `웹으로만` 안내, 이미 만든 제안 안내와 예외 문구, 저장만 되는 두 항목의 준비 중 문구.
- 메시지 화면 [SendTimingPicker](../../../src/widgets/message-inbox/ui/SendTimingPicker.tsx)·[format.ts](../../../src/widgets/message-inbox/lib/format.ts): 마감 기준 카드의 제목·시각이 공간의 규칙을 따른다. 규칙을 받기 전·실패면 고를 수 없다.
- MSW [handlers/messageSettings.ts](../../../src/shared/mock/handlers/messageSettings.ts): 기본값·`saved`, PM 아닌 `PATCH` 403, 형식 오류 400. 모의 DB 버전 10.
- E2E [settings-notifications.e2e.ts](../../../e2e/settings-notifications.e2e.ts)와 검증 스킬의 `notifications` 여정.

### 완료조건 확인

| 지시의 할 일 | 상태 | 근거 |
|---|---|---|
| GET 으로 읽고 바꾼 키만 PATCH, 저장 전 기본값·`saved: false` | 충족(MSW) | `settingsPage.test.tsx`, 엔티티 API 테스트, 브라우저 확인의 PATCH 본문 |
| 일반 팀원 읽기 전용, 실패 시 되돌리고 안내 | 충족(MSW) | `settingsPage.test.tsx`(403·500 되돌림), E2E 일반 팀원 테스트 |
| 화면 키를 API 이름에 맞춤 | 충족 | 응답 타입은 API 이름 그대로, 화면 모델은 매퍼 한 곳에서 camelCase 로 1:1 대응 |
| 재촉 규칙 입력과 토글 제목·메시지 보낼 시각 반영 | 충족(MSW) | `messagesMsw.test.tsx` 규칙별 카드, 브라우저 확인(`마감 당일 09/24 18:00`) |
| `웹으로만` 안내를 `pms[].discord_linked` 로 | 충족 | `notificationCopy.test.ts`, `settingsPage.test.tsx` |
| 자동 승인 묶음의 승인자 표시 | 해당 없음 | 승인자를 보이는 곳이 없다(메시지 화면은 이름 없이 `승인함`) |
| DTO·쿼리·MSW·테스트·스토리, 계약 갱신 | 충족 | 커밋 목록, [계약 §5.7](../../contracts/frontend-api-contract.md) |

### 검증 내역

- 2026-11-05, Node v24.11.0. `npm run typecheck`·`npm run lint`·`npm run build` exit 0. 마지막 커밋 뒤 typecheck·lint 다시 exit 0.
- `npm run format:check` exit 1. 경고는 git 에서 제외한 로컬 작업 지시 `.verify/brief.md` 한 파일이다. 저장소 파일은 `npx prettier --check src e2e docs/contracts/frontend-api-contract.md` 로 통과했다.
- `npm run test -- --maxWorkers=1`: 212개 파일 중 2개, 2,555개 중 2개 실패. `session.test.tsx` 는 단독 재실행에서 통과해 부하로 본다. `meetingProcessing.test.tsx` 의 한 건은 이번 변경 탓이었다(메시지 화면이 설정을 조회한다). 단언을 고친 뒤 그 파일 35개가 통과했다. 고친 뒤 전체 묶음은 다시 돌리지 않았다.
- 브라우저(MSW): `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run notifications` 2개 통과(실행 `2026-11-05T11-01-04-208Z-notifications-480f51c7`, 포트 닫힘 확인). 별도 스크립트로 규칙을 2일 전 18시·당일 18시로 바꾸고 메시지 화면 카드를 확인했다(로컬 증거 `frontend/.verify/picker-evidence/`, 커밋하지 않음).

### 계획 대비 변경

- 계획에 이 작업이 없다. 지시에 따른 추가 작업이다.
- 메시지 화면 시작 요청 단언(`meetingProcessing.test.tsx`)에 설정 조회를 더했다. 보낼 시각 선택이 규칙을 읽어서다.

### 남은 작업과 제한 사항

- 실서버(운영 BE)와의 연동은 확인하지 않았다. MSW 기준이다.
- 전체 Storybook play 와 전체 E2E 는 CI 에 맡겼다.
- 규칙을 바꾸면 옛 규칙으로 잡힌 묶음의 시각은 새 규칙 시각과 달라 `직접 정하기` 카드로 보인다. 서버 응답에 시각의 출처가 없어 화면이 가를 수 없다.
- 설정 저장이 끝나기 전에 다른 화면으로 옮기면 그 요청이 끊길 수 있다. 막지 않았다.
- `pm_alert_method`·`minutes_summary` 는 BE 가 저장만 한다. 동작이 생기면 준비 중 문구를 지운다.

### 관련 기록

- [BE 결정 기록](../../../../backend/docs/plan/m6/basis-for-decision/2026-11-04-message-settings.md)
- [API 계약 §5.7](../../contracts/frontend-api-contract.md)

## 재작업 — 디자인 캔버스 기준 (결정 5 해결 뒤)

### 작업 근거

코디네이터 지시(2026-10-31): 사용자가 브라우저(MSW)에서 설정·팀 화면이 디자인과 다르다고 지적했다. 팀 화면은 자리표시자였고 설정은 이름 입력과 두 연결 영역뿐이었다. 두 화면을 `docs/design/canvas/Team.dc.html`·`Settings.dc.html` 그대로 만들고, API·MSW가 없는 동작은 정적으로라도 보이게 하며 그 차이를 이 문서에 적으라는 지시다. 완료 기준은 "아트보드와 항목·문구·상태가 일치함을 스크린샷과 차이표로 보이고 typecheck·lint·format:check·test(`--maxWorkers=2`)·build·test:storybook exit 0, 커밋 생성"이다.

### 아트보드 영역·상태와 현재 화면의 차이

시작 상태는 이 작업 전 HEAD `dd253ce`의 화면이다. "지금"은 이번 커밋 뒤다.

**Team 아트보드**

| 영역·상태 | 아트보드 | 작업 전 | 지금 |
|---|---|---|---|
| 제목·설명 | `팀` 28px, "진행률은 팀원이 직접 말한 값입니다. 옆에 적힌 기준 날짜를 함께 보세요." | `팀원` + "이후 마일스톤" 안내 | 같음. 인원수 없음(D-076) |
| `팀원 관리` 버튼 | 우상단, 사람 아이콘 | 없음 | 같음. PM만. 팀원 연결 창을 연다 |
| 팀원 머리 줄 | 이름 1~2자 원 30px, 이름 14.5px, 직무 12px, 상태 배지 | 이름 목록 | 원·이름·배지 같음. 직무 칸은 `PM`/`팀원`(직무 데이터 없음). 서버를 떠난 팀원은 `· Discord 서버를 나갔어요`(D-031) |
| 상태 배지 `위험`·`주의`·`정상` | 강조색 점 배지·먹 점 배지·컨트롤 면 | 없음 | 같음. 판정은 막힘·기한 지남 → 위험, 7일 안 마감 → 주의 |
| 맡은 일 줄 | 제목, `MM/DD 기준 · 출처`, 마감, 상태 칩 58px | 없음 | 제목·마감·상태 칩 같음. 기준 날짜는 태스크 수정일이고, 출처(`본인 발언` 등) 대신 진행률(`진행 40%`)이 있으면 붙인다. 출처는 태스크 이력을 태스크마다 불러야 해서 뺐다 |
| 마감 없음 | `마감 미정 — 확인 필요`, 마감 칸 `— —` | 없음 | 같음 |
| 상태 칩 문구 | `시작 전`·`진행 중`·`완료` | 없음 | 제품 공통 라벨 `할 일`·`진행 중`·`막힘`·`완료`(`TASK_STATUS_LABEL`) |
| 먼저 챙길 것 | 강조 테두리 카드, 문장, `메시지 초안 보기` | 없음 | 같음. 기한 지남 → 막힘 → 곧 마감 순으로 한 건. 버튼은 메시지 화면 링크(메시지 화면은 준비 중, D-171). 챙길 일이 없으면 카드를 그리지 않는다 |
| 연결되지 않은 계정 | `?` 원, 아이디, `연결`, DM 안내 | 없음 | 같음. 제목에 인원수 없음(D-076). 봇 제외. `연결`은 PM만 |
| 연결되지 않은 계정 — 빈·미연결·오류·로딩 | 아트보드에 없음 | 없음 | 모두 연결됨 안내 / Discord 미연결 안내 + `설정에서 Discord 연결하기`(PM) / 인라인 오류·다시 시도 / Skeleton |
| 앞으로 7일 | 7칸, 오늘 강조 테두리·`오늘`, 마감 칩(`이름 · 진행률`) | 없음 | 같음 |
| 앞으로 7일 — 점선 칩(`09/15 → 09/17`) | 마감 변경 제안 | 없음 | **없음.** 마감 변경 승인 대기를 칸에 그리려면 승인 목록 조합이 필요해 이번 범위에서 뺐다 |
| 로딩·오류 | 아트보드에 없음 | Skeleton·인라인 오류 | 팀원 목록 Skeleton, 팀원·태스크 조회 오류는 인라인 오류·다시 시도 |
| 팀원 연결 창 | 아트보드에 없음(SetupMembers 줄 모양) | 없음 | 모달. 줄·PM 체크·검증은 온보딩과 같은 폼, 입력칸은 제품 모양. `나중에 하기`·`저장` |

**Settings 아트보드**

| 영역·상태 | 아트보드 | 작업 전 | 지금 |
|---|---|---|---|
| 목차 | `설정` 22px, 일반·연결·자동 반영·알림·팀원·내 계정, 지금 절은 선택 면 | 없음 | 같음. 절로 옮기고 제목에 포커스. `팀원`은 팀 화면 링크. `내 계정`은 누를 수 없는 항목(화면 없음, 헤더의 `내 계정` 메뉴가 계정 조작을 맡는다) |
| 본문 첫 절 | `연결` | 이름 입력 | `일반`(워크스페이스 이름, 저장 API 없음, `되돌리기`)을 맨 앞에 두고 그 아래 `연결`이다. 목차 첫 항목이 `일반`이고 이 입력이 이탈 확인 회귀 테스트 대상이라 남겼다 |
| 연결 머리 | `연결` + "연결을 끊으면…" | `Discord 연결`·`Notion 연결` 두 절 | 같음 |
| 연결 카드 | 40px 아이콘 상자(입력 경계), 이름 14.5px, `연결됨` 배지, 설명 줄, 버튼 둘 | 둥근 줄, 배지, 연결 버튼 | 같음. 설명 줄은 연동 이름 + `연결 MM/DD HH:mm`(읽는 채널·마지막 쓰기 데이터 없음). 미연결이면 연결하면 하는 일 |
| `채널 바꾸기`·`속성 다시 맞추기` | 컨트롤 면 버튼 | 없음 | 같음(PM). API가 없어 누르면 준비 중 토스트 |
| `연결 끊기` | 투명 버튼 | 없음 | 같음(PM). 확인 모달 → `DELETE` 성공 뒤 미연결(D-137). 실패하면 모달에 오류 |
| 미연결·끊김·준비 중·확인 중·취소·실패 | 아트보드에 없음 | 있음(B-1) | 배지 문구·연결 버튼(컨트롤 면)·안내를 카드 아래에 그대로 둔다 |
| 자동 반영 기준 | 선택지 셋, 가운데 선택, 셋째는 지원하지 않음 | 없음 | 같음. 저장 API 없음 — 화면 안에서만 고르고 새로 열면 가운데 |
| 알림 | 토글 셋(켬·켬·끔) | 없음 | 같음. 저장 API 없음 — 화면 안에서만 켜고 끈다 |
| 이 팀 삭제하기 | 강조 테두리 카드, `팀 삭제` | 없음 | 같음(PM). API가 없어 준비 중 토스트 |
| 일반 팀원 | 아트보드에 없음 | 상태·요청 안내 | 같은 안내. 관리 버튼·팀 삭제·`되돌리기` 없음, 워크스페이스 이름·선택지·토글 꺼짐(이름 칸은 수정 라운드 VR-07에서 껐다) |

**두 화면 공통**

- 휴대폰 폭(390px)에서는 두 화면 모두 가로로 넘친다(문서 폭 650px). 기존 대시보드도 같은 폭에서 같다. <1024px은 범위 미결이라 휴대폰 배치를 만들지 않았다(D-123·D-124, 디자인 시스템 §10).
- 날짜는 실행하는 날의 서울 오늘이다. MSW 픽스처의 마감이 9월이라 브라우저(2026-10-31)에서는 모든 팀원이 `위험`이고 앞으로 7일이 비어 있다. 스토리는 오늘을 픽스처 날짜(2026-09-18)로 고정해 아트보드처럼 채운다.
- 코디네이터 지시의 시나리오 이름 `settings-discord-unmapped`·`settings-discord-member`는 저장소에 없다. 같은 용도의 `settings-unmapped`·`settings-member`로 확인했다.

### 시각 확인

이 워크트리의 개발 서버(`VITE_ENABLE_MSW=true npx vite --port 5222`)를 Playwright로 열어 아트보드 HTML과 나란히 비교했다. 스크린샷은 워크트리의 `.playwright-mcp/shots/`(커밋하지 않음)에 있다.

| 파일 | 내용 |
|---|---|
| `design-Team-1440.png`, `design-Settings-1440.png` | 아트보드 |
| `team-1440.png`, `team-1024.png`, `team-1360.png`, `team-390.png` | `settings-unmapped`의 팀 화면 |
| `settings-1440.png`, `settings-1024.png`, `settings-1360.png`, `settings-390.png` | 같은 시나리오의 설정 |
| `team-skipped-1440.png`, `settings-skipped-1440.png` | `settings-discord-skipped`(ws_03) |
| `team-member-1440.png`, `settings-member-1440.png` | `settings-member` |
| `team-dialog-1440.png` | 팀원 연결 창 |

1024·1360px에서 두 화면의 `scrollWidth`는 `clientWidth`와 같았다. 390px은 650/390이다(위 공통 항목).

### 구현

경로는 `frontend/` 기준이다.

- **팀 화면** — [widgets/team](../../../src/widgets/team/index.ts)
  - 순수 판정 [team.ts](../../../src/widgets/team/lib/team.ts): 상태 배지, 팀원별 일 정렬, 먼저 챙길 것, 앞으로 7일, 연결되지 않은 계정·비활성 팀원, 아바타 글자.
  - [TeamOverview](../../../src/widgets/team/ui/TeamOverview.tsx)는 팀원·태스크·연동·Discord 사용자를 함께 부르고 영역마다 로딩·오류를 그린다. Discord 미연결은 연동 상태나 409 `INTEGRATION_NOT_CONNECTED`로 안다.
  - [MemberConnectDialog](../../../src/widgets/team/ui/MemberConnectDialog.tsx)는 `features/member-mapping`의 폼을 쓴다. 줄은 창을 연 때 한 번 만든다. PM 체크를 요구하지 않는다(D-075).
  - [MembersPage](../../../src/pages/members/ui/MembersPage.tsx)는 `connect=members`로 창을 열고 닫는다. 열 때 기록을 추가하고 그 기록에 `connectPushed`를 남긴다. 닫을 때 그 표시가 있으면 기록을 한 칸 돌아가고, 없으면(주소로 바로 왔거나 D-074로 왔으면) replace로 파라미터만 지운다(수정 라운드 VR-06). 일반 팀원에게는 창이 없다.
- **설정 화면** — [SettingsPage](../../../src/pages/settings/ui/SettingsPage.tsx)와 같은 폴더의 목차·절 컴포넌트.
- **연결 카드** — [DiscordConnectionSection](../../../src/features/integration-connection/ui/DiscordConnectionSection.tsx)·[NotionConnectionSection](../../../src/features/integration-connection/ui/NotionConnectionSection.tsx)을 캔버스 카드로 바꿨다. 제목은 `h3`이고 읽는 이름은 `Discord 연결`·`Notion 연결`이다(기존 포커스·테스트 이름 유지). Discord는 연결이 확인되면 `paths.membersConnect`로 간다(D-074).
- **연결 끊기** — [disconnectIntegration](../../../src/entities/integration/api/integrations.ts), [useDisconnectIntegration](../../../src/features/integration-connection/model/useDisconnectIntegration.ts), [ConnectionActions](../../../src/features/integration-connection/ui/ConnectionActions.tsx).
- **공용** — 아이콘 `users`·`alert`(Team 캔버스 경로), 날짜 `monthDayOf`·`formatSeoulMonthDayTime`, `MemberMappingFields`의 `tone`(기본 `onboarding`).
- **테스트·스토리**
  - 단위: [team.test.ts](../../../src/widgets/team/lib/team.test.ts)(10), 날짜 표기, 연동 해제 API.
  - 통합: [team.test.tsx](../../../src/app/team.test.tsx)(재작업 7 → 수정 라운드 뒤 9), [settingsPage.test.tsx](../../../src/app/settingsPage.test.tsx)(7 → 9).
  - 스토리: `M8 팀/화면`(6: PM 기본·팀원·Discord 미연결·팀원 연결 창·로딩·오류), `M8 설정/화면`(3: PM 연결됨·PM Discord 미연결·팀원).
  - E2E: 새 파일·사례 없음. [settings-team.e2e.ts](../../../e2e/settings-team.e2e.ts)의 OAuth 왕복을 D-074 도착으로 바꾸고, 세 너비 테스트에 팀 화면 넘침 검사를 더했다(테스트 수 4 그대로).
  - Storybook 회귀 블록([stories.sb.ts](../../../e2e/storybook/stories.sb.ts))은 바꾸지 않았다. `m8-` 접두어로 새 스토리를 함께 모은다.

### 기존 테스트 단언 변경

| 위치 | 바꾼 것 | 이유 |
|---|---|---|
| `routes.test.tsx`, `appShell.test.tsx`(2곳), `lateAsyncRaces.test.tsx`, `meetingProcessing.test.tsx` | 팀 화면 제목 `팀원` → `팀` | 자리표시자 제목이 Team 아트보드의 `팀`이 됐다 |
| `pages.test.tsx` 5xx 재시도 | 업무 요청 전체 2건 → 팀원 조회 2건 | 팀 화면이 태스크·연동·Discord 사용자도 함께 부른다. 재시도 규칙(1초 뒤 한 번)은 그대로 본다 |
| `notionConnection.test.tsx` 첫 테스트 | 버튼 없음 → `속성 다시 맞추기`·`연결 끊기`, `h2` 목록 → 설정 절 다섯 + `h3` 두 카드 | 연결된 카드에 아트보드의 관리 버튼이 있고 절이 늘었다 |
| `settingsConnections.test.tsx` | Notion 버튼 없음 → `연결하기` 없음, 성공 복귀 두 건 → 팀원 연결 창 도착 | 같은 관리 버튼, 그리고 D-074 이동 |
| Discord·Notion 스토리 `PM_연결됨` | 버튼 없음 → 관리 버튼 둘 | 같은 관리 버튼 |
| `settings-team.e2e.ts` 첫 테스트 | 성공 뒤 설정 유지 → 팀원 연결 창, 새로고침 뒤에도 창, `나중에 하기`, 설정에서 연결됨 | D-074 이동 |
| `appShell.test.tsx`(탭 다섯과 설정을 차례로 그리는 1건), `meetingProcessing.test.tsx`(StrictMode 탭 넷 1건) — a1ef0fc | 테스트 한도 기본 5초 → 10초. 단언은 그대로 | 팀·설정이 자리표시자에서 조회 넷과 창을 그리는 실제 화면이 되어 전체 실행 부하에서 5초를 넘겼다. 같은 저장소의 `lateAsyncRaces`·`meetingMinutes*`가 이미 10초다 |
| `team.test.tsx`, `settingsPage.test.tsx` 파일 — a1ef0fc | `vi.setConfig({ testTimeout: 15_000 })`. 단언은 그대로 | 앱 전체를 그리고 조회·창·토스트를 실제로 거친다. `dashboard.test.tsx`·`tasks.test.tsx`와 같은 15초다. VR-B는 단언 삭제·완화가 없고 근본 원인이 jsdom의 앱 전체 렌더 비용이라 타당하다고 판정했다 |
| 수정 라운드 | 단언 추가만 | 아래 「수정 라운드」의 「기존 테스트 변경」 |

### 재작업 검증

Node v24.11.0, `frontend/`. 무거운 명령은 공통 잠금 래퍼(`heavy.sh`) 아래에서 실행했다.

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck` | 0 | 커밋 9daeb91·f8b6095 전 작업 트리 |
| `npm run lint` | 0 | 같음. FSD 경계 포함 |
| `npm run format:check` | 0 | 같음 |
| `npx playwright test e2e/settings-team.e2e.ts e2e/signup-onboarding.e2e.ts e2e/select-switch.e2e.ts e2e/meeting-keyboard.e2e.ts --workers=2` (`E2E_PORT=5212`) | 1 → 0 | 첫 실행은 `settings-team` 첫 테스트가 `getByText('연결됨')` 두 요소(배지·설명 줄의 `Discord 연결됨`)로 strict 위반. `exact` 로 고친 뒤 12 통과 |
| `npm run test -- --maxWorkers=2` (HEAD `35fc6b4`) | 1 | 165 files / 1846 tests 중 2 실패. ① `meetingProcessing.test.tsx` StrictMode 탭 이동 — 팀 탭 제목을 `팀원` 으로 기다리는 단언을 이번 변경에서 놓쳤다(실제 회귀). b7657e1 로 고친 뒤 단독 31/31 통과. ② `meetingRoutes.test.tsx` 일반 팀원 업로드 → 태스크 이동의 `findByRole` 미발견 — 단독 재실행 통과. 이 기계의 부하 실패로 본다 |
| `npm run build` | 0 | |
| `npm run test:storybook` (`STORYBOOK_E2E_PORT=6212`) | 미완료 | 실행 중 기계 메모리 부족으로 Claude Code 가 작업을 중단시켰다. 결과 없음 |
| (a1ef0fc) | — | 앱 수준 검사 네 곳의 시간 한도를 올렸다(「기존 테스트 단언 변경」의 a1ef0fc 두 줄). 이 커밋 뒤의 실행은 아래 VR-B 행과 「수정 라운드」의 검증 표에 있다 |
| VR-B `npm run test -- --maxWorkers=2` (HEAD `a1ef0fc`, 검증 에이전트) | 1 | 165 files / 1846 tests 중 `onboardingMembers.test.tsx` 2건 5초 초과. 같은 파일 단독 2차 34/34 통과, develop `ff9467e` 스냅샷에서도 같은 파일이 4건 5초 초과로 실패했다 — 부하성이며 이 브랜치 결함이 아니다 |
| VR-B `npm run build` (HEAD `a1ef0fc`) | 0 | |
| VR-B `npm run test:storybook` (HEAD `a1ef0fc`) | 1 | 119 통과 / 2 실패. `M8 팀/화면`의 `로딩`·`오류`가 렌더에서 죽었다(VR-01). 수정 라운드에서 고쳤다 |

- 변경 중 단독 실행: `team.test.ts` 10, `team.test.tsx` 7, `settingsPage.test.tsx` 7, `settingsConnections`·`notionConnection`·`pages` 45, `appShell`·`routes`·`lateAsyncRaces` 65 모두 통과.
- b7657e1 뒤의 전체 Vitest 와 `test:storybook` 은 다시 실행하지 않았다(메모리 부족 중단 뒤 재실행 지시 대기).

## 수정 라운드 — VR-B 검증 결과 반영

### 작업 근거

코디네이터 지시(2026-11-01): 검증 에이전트 보고서 VR-B(기준 `ff9467e...a1ef0fc`, 판정 FAIL, major 3·minor 7)의 발견을 코드에서 재현·확인한 뒤 고친다. 전체 vitest의 `onboardingMembers` 시간 초과는 develop에서도 나는 부하성이라 수정 대상이 아니다. 계획(`plan.md`)은 읽기만 했고 수정하지 않았다.

### 발견별 처리

| 발견 | 처리 | 확인한 원인 | 고친 것 | 잡는 테스트 |
|---|---|---|---|---|
| VR-01 major — 팀 스토리 `로딩`·`오류` 렌더 실패 | 수정 | `.storybook/preview.tsx`는 `parameters.msw`를 배열로 펼치는데 두 스토리가 `{ handlers: [...] }` 객체를 넘겼다 | [TeamOverview.stories.tsx](../../../src/widgets/team/ui/TeamOverview.stories.tsx)의 두 스토리가 배열을 넘긴다 | 두 스토리의 play(기존). `test:storybook` 121 통과 |
| VR-02 major — 저장 중 Esc·바깥 클릭으로 창이 닫히고 실패가 사라짐 | 수정 | 저장 중 상태가 안쪽 폼에만 있고 창은 `onOpenChange`를 그대로 넘겼다. 닫히면 폼이 사라져 실패를 보일 곳이 없었다 | [MemberConnectDialog](../../../src/widgets/team/ui/MemberConnectDialog.tsx)가 저장 중 여부를 갖고(폼이 제출 처리 안에서 알린다) 그동안 Esc·덮개의 닫기 요청을 무시한다. `저장` 성공과 `나중에 하기`(저장 중 비활성)는 그대로 닫는다 | `team.test.tsx` 「저장하는 동안에는 Esc·바깥 클릭으로 창이 닫히지 않고, 실패하면 창 안에 오류가 남는다」 |
| VR-03 major — 팀원 조회 실패 시 창이 계속 뼈대 | 수정 | 창 자료(`mappingSource`)가 Discord 사용자 오류만 보고 팀원 오류는 보지 않았다 | [TeamOverview](../../../src/widgets/team/ui/TeamOverview.tsx)가 받은 팀원이 없을 때의 팀원 오류를 먼저 보고 창에 오류·`다시 시도`(팀원 재조회)·`닫기`를 보인다. 받은 자료가 없을 때만 오류로 본다 — 다시 받다 실패해도 열린 창의 입력을 지우지 않는다(Discord 사용자에도 같은 규칙) | `team.test.tsx` 「팀원 조회가 실패하면 창도 뼈대에 머물지 않고 오류·다시 시도·닫기를 보인다」(다시 시도 뒤 줄이 보이는 것까지) |
| VR-04 minor — 끊기 성공 뒤 재조회 실패면 `연결됨` 유지 | 수정 | 성공 뒤 `invalidateQueries`만 했다. 재조회 실패는 던지지 않아 이전 데이터가 남았다 | [useDisconnectIntegration](../../../src/features/integration-connection/model/useDisconnectIntegration.ts)이 서버 2xx 뒤 그 provider를 미연결(서버의 행 삭제와 같은 값)로 캐시에 쓰고 다시 받는다. 서버 성공 뒤 반영이라 D-137에 맞는다 | `settingsPage.test.tsx` 「끊은 뒤 연동 상태를 다시 받지 못해도 서버가 끊은 결과대로 미연결을 보이고 제목으로 포커스를 옮긴다」(Discord) |
| VR-05 minor — 끊기 성공 뒤 포커스가 body | 수정 | 창을 연 `연결 끊기`가 끊기면 사라져 창이 포커스를 돌려줄 곳이 없었다 | [useFocusAfterDisconnect](../../../src/features/integration-connection/model/useFocusAfterDisconnect.ts): 끊기 성공을 알린 뒤 카드가 미연결로 다시 그려지면 카드 제목(`h3`, `tabIndex={-1}`)으로 옮긴다. Discord 제목에도 `tabIndex={-1}`을 줬다. 새 `연결하기` 버튼 대신 제목을 고른 이유: 공용 `Button`이 ref를 받지 않아 공용 변경이 필요하고, 제목 다음 Tab이 바로 그 버튼이다 | 기존 Notion 끊기 테스트에 `toHaveFocus()` 단언 추가, 위 VR-04 테스트(Discord) |
| VR-06 minor — 버튼으로 닫으면 같은 주소 기록이 남음 | 수정 | 열 때 push, 닫을 때 replace라 `?connect` 없는 같은 주소가 한 칸 더 남았다 | [MembersPage](../../../src/pages/members/ui/MembersPage.tsx)가 열 때 기록 state에 `connectPushed`를 남기고, 닫을 때 그 표시가 있으면 `navigate(-1)`, 없으면(주소로 바로 왔거나 D-074) 지금처럼 replace | `team.test.tsx` 「`팀원 관리`로 연 창…」에 닫기가 POP으로 첫 기록에 돌아온다는 단언, 「주소의 `connect=members`로 오면…」에 `나중에 하기`가 REPLACE라는 단언 |
| VR-07 minor — 일반 팀원도 이름 칸을 고칠 수 있음 | 수정(코드) | `WorkspaceNameField`가 역할을 받지 않았다. 결정 기록의 권한 항목(일반 팀원은 읽기만)과 다른 유일한 조작이었다 | [SettingsPage](../../../src/pages/settings/ui/SettingsPage.tsx)에서 일반 팀원에게 이름 칸을 `disabled`로 두고 `되돌리기`를 그리지 않는다. 선택지·토글과 같은 꺼짐이다(`readOnly`는 입력 모양이 그대로라 고칠 수 있는 칸으로 오해한다). 결정 기록의 권한 문장에 이름 칸을 명시했다 | `settingsPage.test.tsx` 일반 팀원 사례에 이름 칸 비활성·`되돌리기` 없음 단언 |
| VR-08 minor — 목차·`팀 삭제` 글자 14px | 수정(부분) | 빌드 CSS가 `.text-control{color:var(--color-control)}`다. `--text-control`(13px)과 `--color-control`의 이름이 겹쳐 글자색만 만든다 | [SettingsNav](../../../src/pages/settings/ui/SettingsNav.tsx) 항목을 `text-[13px] leading-none`으로, [DeleteTeamSection](../../../src/pages/settings/ui/DeleteTeamSection.tsx) 버튼에 `text-[13px]`. 전역 `text-control`·공용 Button은 건드리지 않았다. **`팀 삭제` 좌우 패딩(시안 16, 앱 20)은 남겼다** — 공용 `md`의 `px-20`이 생성 CSS에서 `px-16`보다 뒤라 className으로 덮이지 않고, 클래스 덮어쓰기는 [클래스 결정](../m2/basis-for-decision/2026-09-16-no-cn-clsx-tailwind-merge.md)이 금한다. 폭은 80.8px이다(시안 72.8) | `settingsPage.test.tsx` 「캔버스 실측…」의 클래스 단언, 브라우저 실측 13px |
| VR-09 minor — `md-compact` 버튼 34px | 수정 | 시안은 `height:34px; min-height:36px`, 공용 `md-compact`는 `h-34`뿐이다 | 팀 `팀원 관리`와 설정 카드 버튼 다섯 자리(`채널 바꾸기`·`속성 다시 맞추기`·`연결 끊기`·두 `연결하기`)에 `min-h-[36px]`(카드 버튼은 [connectionStyles](../../../src/features/integration-connection/ui/connectionStyles.ts)의 `CARD_BUTTON`). `팀원 관리`에는 `gap-7`도 준다(생성 CSS에서 `gap-6` 뒤라 적용됨, 실측 7px). 공용 `md-compact`는 바꾸지 않았다 | `settingsPage.test.tsx` 「캔버스 실측…」, Discord 끊기 테스트의 `연결하기`, `team.test.tsx` `팀원 관리`의 클래스 단언. 브라우저 실측 36px |
| VR-10 minor — 결과 문서·결정 기록 | 수정 | — | 이 절, 「기존 테스트 단언 변경」의 a1ef0fc 두 줄, 「재작업 검증」의 a1ef0fc·VR-B 행. [결정 기록](basis-for-decision/2026-10-31-settings-team-follow-design-canvas.md) 30행의 절 이름을 「아트보드 영역·상태와 현재 화면의 차이」로 고쳤다 | — |

공용 토큰 이름 충돌(`--text-control`과 `--color-control`)은 공용 `Button`의 `sm`/`md`에도 있다. develop부터 있던 문제이고 이 브랜치 범위 밖이라 별도 이슈 후보로 남긴다.

### 기존 테스트 변경

모두 단언 추가다. 기존 기대값을 바꾸거나 지운 것은 없다.

- `team.test.tsx` 「`팀원 관리`로 연 창…」: 버튼 클래스(VR-09)와 닫은 뒤 POP·첫 기록 key(VR-06) 단언을 더했다.
- `team.test.tsx` 「주소의 `connect=members`로 오면…」: 창이 열린다는 단언에 더해 `나중에 하기`가 replace로 파라미터만 지우는지 본다. VR-06 뒤에도 직접 도착은 뒤로 가지 않아야 하기 때문이다.
- `settingsPage.test.tsx` 「연결 끊기는 확인을 거쳐…」: 제목 포커스 단언(VR-05).
- `settingsPage.test.tsx` 일반 팀원 사례: 이름 칸·`되돌리기` 단언을 더하고 제목을 「이름·자동 반영 기준·알림은 읽기만 하고, 되돌리기·연결 끊기와 팀 삭제가 없다」로 바꿨다(VR-07).

### 커밋

| 커밋 | 발견 |
|---|---|
| 570d3f0 | VR-01 |
| eaf1dd9 | VR-02, VR-03 |
| 1175148 | VR-06 |
| 13fa284 | VR-04, VR-05 |
| 1b4b6ab | VR-07 |
| a9321ab | VR-08, VR-09 |
| 이 문서의 커밋 | VR-10 |

### 검증

Node v24.11.0, `frontend/`. 무거운 명령은 공통 잠금 래퍼(`heavy.sh`) 아래에서 하나씩 실행했다. 코드 커밋 a9321ab 뒤의 작업 트리다(이후는 문서만 바뀜).

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | FSD 경계 포함 |
| `npm run format:check` | 0 | |
| `npm run test -- --maxWorkers=2` | 0 | 165 files / 1850 tests 통과, 503초. 이번 실행에서는 `onboardingMembers` 시간 초과도 없었다 |
| `npm run build` | 0 | |
| `npm run test:storybook` (`STORYBOOK_E2E_PORT=6212`) | 0 | 121 통과(VR-B의 실패 2건 포함) |
| 브라우저 확인 (Vite 5212 + Playwright Chromium 한 탭, 스크립트로 실행한 뒤 서버 종료) | 0 | 1360px. 목차 13px·36px, `팀 삭제` 13px·36px(폭 80.8), 카드 버튼·`팀원 관리` 36px(간격 7px). Notion·Discord 끊기 뒤 포커스가 각 카드 `h3`. 연동 재조회 500에서도 `연결 안 됨`·`Notion 연결하기`. 저장 대기 중 Esc·덮개 클릭 뒤에도 창 1개, 실패 뒤 창 안에 「일부 팀원을 저장하지 못했어요…」와 입력 유지. 팀원 403에서 창에 `다시 시도`·`닫기`, 뼈대 없음. 대시보드 → 팀 → 창 열고 닫기 → 뒤로 한 번에 대시보드. 일반 팀원 이름 칸 비활성·`되돌리기` 없음 |

- 변경 중 단독 실행: `team.test.tsx` 9, `settingsPage.test.tsx` 9, `settingsConnections`·`notionConnection` 39, `appShell`·`notionConnection`·`pages` 53 모두 통과. 새 테스트는 고치기 전에 실패하는 것을 먼저 확인했다(VR-02·03·04·05·06·07).
- 전체 E2E(`npm run test:e2e`)는 이번 지시의 필수 명령이 아니라 돌리지 않았다. 새 E2E도 더하지 않았다.

## 추가 요청 — 설정 진입을 프로필 메뉴로

### 작업 근거

코디네이터가 전한 사용자 요청(2026-11-02): "설정 페이지는 헤더 우측의 프로필을 눌렀을 때 논모달 창에서 접근할 수 있도록 한다." 그 전에는 설정이 왼쪽 워크스페이스 메뉴의 `워크스페이스 설정` 줄에만 있었고, 프로필 메뉴에는 `로그아웃` 하나뿐이었다. 계획(`plan.md`)은 읽기만 했다.

### 결정

- **옮긴다(둘 다 두지 않는다).** 워크스페이스 메뉴의 `워크스페이스 설정` 줄을 지우고 프로필 메뉴의 계정 정보 아래·`로그아웃` 위에 `설정`을 둔다. 아이콘은 기존 `settings`, 글자·간격은 `로그아웃` 줄과 같다.
  - 디자인 캔버스와의 차이: [Main](../../design/canvas/Main.dc.html) 아트보드는 팀 메뉴 끝에 `팀 설정 · 초대` 줄을 두고, 아바타(`지훈`)는 메뉴가 없는 원이다. [Settings](../../design/canvas/Settings.dc.html) 아트보드의 아바타도 같다. 이번 변경은 캔버스보다 사용자 요청을 따른 것이다.
  - 끊기는 진입이 없다: 프로필 메뉴는 워크스페이스 메뉴와 같은 [AppHeader](../../../src/widgets/app-shell/ui/AppHeader.tsx)에 역할과 무관하게 함께 그려진다. 따라서 PM·일반 팀원 모두 같은 화면에서 설정에 갈 수 있다. 온보딩 화면은 두 메뉴가 모두 없어 달라지는 것이 없다. 선택 화면(`/workspaces`)은 프로필 메뉴만 있고 아직 고른 공간이 없으므로 `설정`을 두지 않는다(`workspaceId`가 있을 때만 그린다). 팀 화면 `SideCards`·팀원 연결 창·대시보드·Notion 차단 모달의 설정 링크는 건드리지 않았다.
- **논모달은 이 메뉴에만 `modal={false}`로 준다.** 공용 [DropdownMenu](../../../src/shared/ui/dropdown-menu/DropdownMenu.tsx)는 Radix 기본값(모달)이다. 모달일 때 Radix는 메뉴 밖을 `aria-hidden`으로 숨기고 body에 `pointer-events: none`과 스크롤 잠금을 건다. 공용 래퍼의 기본값은 바꾸지 않아 워크스페이스 메뉴는 그대로 모달이다. 논모달에서도 바깥 클릭·Esc로 닫히고, Esc로 닫으면 아바타로 포커스가 돌아오며, Enter/Space 열기·화살표 이동은 Radix가 그대로 한다.
- **이동은 기존 관문을 탄다.** 워크스페이스 메뉴가 쓰던 `useGuardedNavigate`로 `paths.settings(workspaceId)`에 간다. 공간 id는 `AppHeader`가 워크스페이스 메뉴에 주던 것과 같은 prop으로 받는다.

### 구현

- [UserMenu](../../../src/widgets/app-shell/ui/UserMenu.tsx): 선택 prop `workspaceId`, `설정` 줄, `modal={false}`.
- [AppHeader](../../../src/widgets/app-shell/ui/AppHeader.tsx): `UserMenu`에 `workspaceId`를 넘긴다.
- [WorkspaceMenu](../../../src/widgets/app-shell/ui/WorkspaceMenu.tsx): `워크스페이스 설정` 줄을 지웠다. [WorkspaceBadge](../../../src/widgets/app-shell/ui/WorkspaceBadge.tsx)의 `DashedIcon`은 이제 `plus`만 받는다.

### 테스트

새 테스트는 [appShell.test.tsx](../../../src/app/appShell.test.tsx) 「프로필 메뉴의 설정 (#244)」 다섯 개다. 구현 전에는 앞의 네 개가 실패했다. 마지막 선택 화면 사례는 원래 통과한다. 공간 없이 `설정`을 그리지 않게 막는 회귀 테스트다. `modal={false}`만 되돌리면 논모달 사례와 바깥 클릭 사례가 다시 실패하는 것도 확인했다.

- 아바타를 열면 항목이 `설정`·`로그아웃` 순서이고, `설정`을 고르면 `/workspaces/ws_01/settings`로 간다.
- 저장하지 않은 변경이 있으면 이탈 확인을 거친다. `계속 작성하기`는 그대로 두고, `버리고 나가기`는 설정으로 간다.
- 메뉴가 열려 있어도 주요 화면 탭과 본문 제목에 `aria-hidden`·`inert` 조상이 없고, body가 `pointer-events: none`이 아니다. 열린 채로 `태스크` 탭을 누르면 이동한다.
- Space로 열리고 바깥을 누르면 닫힌다.
- 선택 화면의 프로필 메뉴에는 `설정`이 없다.

[AppShell 스토리](../../../src/widgets/app-shell/ui/AppShell.stories.tsx) `계정_메뉴_열림`의 play에 항목 순서와 헤더 비숨김 단언을 더했다. M8 회귀 블록(`stories.sb.ts`)은 건드리지 않았다.

기존 단언 변경 — 모두 설정 위치가 바뀌어서다.

- 「헤더에 5개 탭이 있고 설정은 탭이 아니라 워크스페이스 메뉴에 있다」 → 「…프로필 메뉴에 있다」. 워크스페이스 메뉴에 `워크스페이스 설정`·`설정`이 없고 프로필 메뉴에 `설정`이 있는지 본다.
- 「다른 마일스톤의 임시 화면도 셸 안에서 탭으로 오간다」: 설정으로 가는 마지막 단계를 프로필 메뉴로 바꿨다.
- 「계정 메뉴도 같은 규칙이다」: 열었을 때 처음 고른 항목이 `로그아웃`에서 `설정`으로 바뀌었다(위에 줄이 생겼다). 화살표로 `로그아웃`에 가는 단언을 더했다.
- [select-switch.e2e.ts](../../../e2e/select-switch.e2e.ts): 설정에 들어가는 단계를 프로필 메뉴로 바꿨다. 새 E2E는 더하지 않았다.

### 검증

Node v24.11.0, `frontend/`. 코드 커밋 af4efd2의 작업 트리다. 다른 워커와 함께 돌아 메모리가 모자랐다. 앞 명령은 공통 잠금 래퍼(`heavy.sh`) 아래에서 실행했다. 23개 파일 재실행부터는 코디네이터 지시(메모리 여유 확인)에 따라 래퍼 없이 하나씩 실행했다.

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | |
| `npx vitest run src/app/appShell.test.tsx` (변경 중) | 1 | 26개 중 25개 통과. 남은 1건 「헤더에서 미완료 공간에 들어가면…」은 5초 시간 초과다. 변경 전 HEAD에서도 같은 시간 초과가 나서 부하성으로 봤다 |
| `npx playwright test e2e/select-switch.e2e.ts` (`E2E_PORT=5244`) | 1 | 두 시나리오 모두 첫 `page.goto`에서 30초 시간 초과가 났다(차가운 dev 서버) |
| 같은 파일 `--workers=1` 재시도 | 1 | 키보드 시나리오는 통과했다. 설정 시나리오는 첫 `page.goto` 시간 초과였다 |
| 설정 시나리오만 `--workers=1 --repeat-each=2` | 1 | 1회차는 `page.goto` 시간 초과, 2회차(서버가 데워진 뒤)는 프로필 메뉴 단계를 포함해 끝까지 통과했다 |
| `npm run test -- --maxWorkers=2` (첫 시도) | — | 하네스가 메모리 부족으로 끊었다. 결과 없음 |
| `npm run test -- --maxWorkers=2` (재시도) | 1 | 155 files 중 142 통과, 1795 tests 중 1763 통과, 4146초. 실패 32건은 5·10초 시간 초과 25건, 워커 응답 없음, 단언 1건(`tasks` 목록 0개)이다. 10개 파일은 워커가 뜨지 못했다 |
| 실패·미실행 23개 파일 `npx vitest run --maxWorkers=1` | 1 | 21 files 중 19 통과(`appShell` 포함). `logout` 1건, `notionConnection` 9건이 실패했다(시간 초과 6건과 그 뒤 단언). 2개 파일은 워커가 뜨지 못했다 |
| 남은 4개 파일 단독(`logout`·`meetingMinutesRaces`·`onboardingCreate`·`notionConnection`) | 0 | 각각 5·4·23·26 통과. 전체 실행의 실패는 모두 부하성이다 |
| `npm run build` | 0 | |
| `npm run test:storybook` (`STORYBOOK_E2E_PORT=6244`) | 0 | 121 통과. 이 묶음은 `계정_메뉴_열림` 스토리를 돌리지 않는다 |
| 빌드한 Storybook에서 두 메뉴 스토리를 Playwright로 연 일회성 확인 | 0 | `계정_메뉴_열림`: play 오류 없음, 항목 `설정`·`로그아웃`, body `pointer-events` 비어 있음, 루트 숨김 없음, `overflow: visible`. `워크스페이스_메뉴_열림`: play 오류 없음, `pointer-events: none`, 루트 숨김, `overflow: hidden`. 워크스페이스 메뉴는 그대로 모달임을 확인했다 |

- 일회성 확인 스크립트는 저장소 밖(작업 임시 폴더)에 두었다. M8 회귀 블록을 건드리지 않으려고 `stories.sb.ts`에 이 스토리를 더하지 않았다.

### 후속 — 설정으로 옮긴 뒤의 포커스

**지적.** 코디네이터가 전한 사용자 지적(2026-11-02): "설정 누르고 나서 프로필 아이콘 focus 되면 안되지 않나?" 프로필 메뉴에서 `설정`을 고르면 메뉴가 닫히면서 Radix 기본 동작(`onCloseAutoFocus`, 트리거로 복귀)이 아바타에 포커스를 돌려 포커스 표시가 보였다. 다른 화면으로 옮긴 뒤에는 이전 화면의 메뉴 트리거에 포커스가 남으면 안 된다.

**처리**(커밋 d27f0de)

- [UserMenu](../../../src/widgets/app-shell/ui/UserMenu.tsx): `설정`이 실제로 다른 경로로 옮겼을 때만 `onCloseAutoFocus`에서 `preventDefault()`로 트리거 복귀를 막는다. 이동 여부는 [useGuardedNavigate](../../../src/shared/lib/unsaved-changes/useGuardedNavigate.ts)가 돌려준다. 이 훅과 `guardLeave`가 "지금 다른 경로로 옮겼는가"를 boolean으로 돌려주게 했다. 기존 호출부는 반환값을 쓰지 않아 바뀌지 않는다. Esc·바깥 클릭, 설정 화면에서 다시 `설정`을 고른 경우(같은 경로)는 지금처럼 아바타로 돌아온다. 공용 [DropdownMenu](../../../src/shared/ui/dropdown-menu/DropdownMenu.tsx) 기본값은 바꾸지 않았다.
- 이탈 확인의 `계속 작성하기`: 수정 전에도 아바타로 돌아오지 않고 body로 떨어졌다(새 테스트로 확인). 메뉴 항목이 사라진 뒤 확인 창이 열려, 공통 [Modal](../../../src/shared/ui/modal/Modal.tsx)이 기억할 "연 요소"가 없었기 때문이다. 이동이 확인 창에 붙잡히면 `UserMenu`가 먼저 아바타로 포커스를 옮긴다. 그래서 그 창을 연 요소가 아바타가 되고 닫으면 아바타로 돌아온다.
- 도착 지점: [SettingsPage](../../../src/pages/settings/ui/SettingsPage.tsx)는 들어오면 화면 제목 `h1`(`tabIndex=-1`)에 `focus({ preventScroll: true })`를 준다. 목차가 절 제목에 포커스를 주는 방식과 같다. 포커스 표시는 절 제목과 같이 `focus-visible:outline-none`으로 끈다. `section=notion`으로 오면(차단 모달 → Notion 연결) 기존처럼 Notion 카드 제목이 포커스를 가져가므로 `h1`에는 두지 않는다. 이 값은 들어온 주소로 한 번만 정한다.
- 앱에는 경로 이동 때 포커스를 옮기는 공통 장치가 없다. 지시에 따라 이번에는 설정 화면에만 두었다(아래 「남은 작업」).

**WorkspaceMenu 확인(고치지 않음).** 같은 문제가 왼쪽 워크스페이스 메뉴의 이동 항목에도 있는지 일회성 테스트(저장소에 남기지 않음)로 확인했다.

| 항목 | 옮긴 뒤 포커스 |
|---|---|
| 다른 완료 공간 고르기(대시보드로) | 워크스페이스 메뉴 트리거에 남는다. 같은 문제다 |
| 미완료 공간 고르기(온보딩으로) | body. 온보딩 화면에는 헤더 메뉴가 없어 트리거가 사라진다 |
| `새 워크스페이스 만들기` | body(위와 같은 이유) |
| `워크스페이스 목록` | body(선택 화면에는 워크스페이스 메뉴가 없다) |

**테스트.** [appShell.test.tsx](../../../src/app/appShell.test.tsx) 「프로필 메뉴의 설정 (#244)」에 세 개를 더했다.

- 마우스로 `설정`을 고르면 설정 제목에 포커스가 있다. Radix 복귀는 다음 태스크라서, 제목에 온 뒤 50ms 더 기다려도 제목이고 아바타가 아님을 본다.
- 키보드(Enter)로 골라도 같다.
- 이동 없이 닫히면 아바타로 돌아온다. Esc와, 이탈 확인의 `계속 작성하기`다.

수정 전에는 셋 모두 실패했다. 앞의 둘은 아바타 포커스, 셋째는 `계속 작성하기` 뒤 body 포커스 때문이다. `preventDefault()`만 빼면 앞의 둘이, 아바타로 먼저 옮기는 줄만 빼면 셋째가 다시 실패하는 것도 확인했다. 기존 「저장하지 않은 변경이 있으면 이탈 확인을 거친다」에는 `버리고 나가기` 뒤 설정 제목 포커스 단언을 덧붙였다. 기존 단언은 바꾸지 않았다. [unsavedChanges.test.tsx](../../../src/shared/lib/unsaved-changes/unsavedChanges.test.tsx)의 `guardLeave` 두 사례에는 반환값(true·false) 단언을 더했다. AppShell 스토리는 고치지 않았다.

**검증**(Node v24.11.0, `frontend/`, 코드 커밋 d27f0de의 작업 트리)

| 명령 | exit | 결과 |
|---|---|---|
| `npx vitest run src/app/appShell.test.tsx -t "프로필 메뉴의 설정"` (수정 전) | 1 | 8개 중 새 3개 실패 |
| 같은 명령 (수정 뒤) | 0 | 8 통과 |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | |
| `npx vitest run <파일> --maxWorkers=1`: `appShell`·`unsavedChanges`·`settingsConnections`·`notionConnection`·`UnsavedChangesPrompt`·`pages` | 0 (각각) | 29·8·13·26·16·6 통과. 뒤의 넷은 설정 화면의 첫 포커스와 관문 반환값 변경이 닿는 파일이라 함께 돌렸다 |
| `npm run build` (잠금 래퍼 아래) | 0 | |
| 5222 개발 서버(MSW)에서 Playwright 한 탭 | — | 대시보드에서 아바타를 마우스로 열고 `설정` 클릭 → `/workspaces/ws_01/settings`, `activeElement`는 `H1 설정`, 아바타 포커스 아님. 제목은 `:focus-visible`이지만 `outline-style: none`이고 스크린샷에도 테두리가 없다. Esc로 닫으면 아바타로 돌아왔다 |

- 전체 Vitest와 `test:storybook`은 지시에 따라 돌리지 않았다(직전 커밋에서 실행, 변경이 작고 스토리 변경 없음).

## B-1 작업 근거와 요약

코디네이터 지시에 따라 브랜치 `feature/244-m8-settings-team`에서 B-1을 구현했다. 아래 B-1 절의 화면 설명(설정에 머무는 Discord 성공, 팀 자리표시자 등)은 그 시점의 기록이며 위 재작업으로 바뀌었다. 기준은 develop `ff9467e`이고 커밋은 11개다. push·PR은 하지 않았다.

계획 파일은 작업 시작 전부터 미커밋 변경이 있었다. 구현·검증·이 기록 작업 모두 그 파일을 수정하거나 커밋하지 않았다. V3 리뷰 시점과 이 기록 작업 시작 시점의 SHA256이 `335e75d7…9499c4`로 같다.

| 커밋 | 구현 순서 | 내용 |
|---|---|---|
| 37dd43c | 1 | MSW의 연동 해제·팀원 생성과 수정·모의 OAuth 완료를 PM만 허용(`requirePmRole`, `connectionWrites.test.ts`) |
| 77f7bda | 2 | 시나리오 `settings-discord-skipped`·`settings-unmapped`·`settings-member`와 시나리오 테스트 |
| e33df05 | 3 | 매핑 모델을 `features/member-mapping`으로 이동. 매핑 테스트는 기대값 그대로 `memberMapping.test.ts`로 이동 |
| a6ddc2d | 4 | `useMemberMappingForm`·`MemberMappingFields` 분리. `MembersStep`은 확인 완료·나중에 하기·나가기 저장만 맡음 |
| dfa3368 | 5 | `features/notion-connection` → `features/integration-connection` 개명, `useIntegrationConnection` 일반화, `useNotionConnection`은 D-098·`section=notion` 래퍼 |
| e89c468 | 6 | `DiscordConnectionSection`·스토리, 설정 화면 조립, `settingsConnections.test.tsx`, Notion 제목 단언 한 줄(승인) |
| 5a7a207 | 7 | `settings-team.e2e.ts`, `support.ts` 시나리오 타입, Storybook 회귀의 M8 수집 |
| aeb8370 | 수정 | Discord 스토리·테스트가 복귀 안내 뒤 연동 상태를 기다리게 함(`test:storybook` 첫 실패 원인) |
| 2d95c5a | 7 | 사용자 지시에 따라 E2E를 OAuth 왕복·새로고침과 너비·키보드로 축소 |
| 79c2a30 | 테스트 | 시나리오 독립성 테스트 한 개의 한도를 30초로 둠 |
| 8d0cf3b | 7 | 너비 E2E가 Notion도 끊고 이름 입력→Discord→Notion 연결 버튼의 Tab 순서를 확인 |

## 실제 구현 및 관련 코드

경로는 `frontend/` 기준이다.

- **MSW 권한**
  - [auth-guard.ts](../../../src/shared/mock/auth-guard.ts)에 `requirePmRole`을 추가했다.
  - 이 검사를 [integration.ts](../../../src/shared/mock/handlers/integration.ts)의 `DELETE`, [member.ts](../../../src/shared/mock/handlers/member.ts)의 `POST`·`PATCH`, [mockOAuth.ts](../../../src/shared/mock/oauth/mockOAuth.ts)의 성공 결과에 걸었다.
  - 선택 근거는 [결정 기록](basis-for-decision/2026-10-31-msw-pm-only-connection-writes.md)에 있다.
- **시나리오** — [scenarios.ts](../../../src/shared/mock/scenarios.ts)
  - `settings-discord-skipped`: 온보딩을 마친 새 공간 `ws_03`. Discord·팀원 연결 단계는 건너뜀이고 Notion만 연결됐다. 팀원은 생성자 PM 하나다.
  - `settings-unmapped`: 픽스처 그대로의 `ws_01`. Discord 연결됨, 미매핑 사용자·서버를 떠난 사용자·봇이 있다. B-2 화면용 시작 데이터만 제공하며 UI는 없다.
  - `settings-member`: `ws_01`의 일반 팀원. Discord는 미연결, Notion은 연결됨이다.
  - 브라우저 저장 모양은 바뀌지 않아 `MOCK_DB_VERSION`(2)은 올리지 않았다.
- **매핑 모델·폼** — [features/member-mapping](../../../src/features/member-mapping/index.ts)
  - 모델은 내용 변경 없이 옮겼다.
  - 폼 훅은 [useMemberMappingForm](../../../src/features/member-mapping/model/useMemberMappingForm.ts)이고, 줄 UI는 [MemberMappingFields](../../../src/features/member-mapping/ui/MemberMappingFields.tsx)다.
  - 온보딩 [MembersStep](../../../src/widgets/onboarding/ui/MembersStep.tsx)은 이 둘을 조합한다.
- **설정 연결** — [features/integration-connection](../../../src/features/integration-connection/index.ts)
  - [useIntegrationConnection](../../../src/features/integration-connection/model/useIntegrationConnection.ts)은 `(workspaceId, provider, { returnPath, connectedTo })`를 받는다.
  - 같은 화면의 다른 provider가 성공 복귀를 확인하는 동안에는 연동 Query 구독을 끈다. 그러지 않으면 Notion 확인 중에 Discord 영역이 Query를 먼저 물어 기존 `connecting` 테스트가 깨졌다.
  - [DiscordConnectionSection](../../../src/features/integration-connection/ui/DiscordConnectionSection.tsx)은 `connectedTo: null`이라 성공 뒤 설정에 머문다. D-074 이동은 B-2다.
  - 슬라이스 위치의 근거와 옛 경로 대응은 [결정 기록](basis-for-decision/2026-10-31-member-mapping-integration-connection-slices.md)에 있다.
- **설정 화면** — [SettingsPage](../../../src/pages/settings/ui/SettingsPage.tsx)는 기존 이름 입력 한 칸, Discord 영역, Notion 영역을 차례로 둔다. 두 영역의 `canManage`는 `workspace.role`이 정한다. 플레이스홀더 설명은 바뀐 범위에 맞게 고쳤다.
- **테스트·스토리**
  - 통합 테스트: [settingsConnections.test.tsx](../../../src/app/settingsConnections.test.tsx)
  - MSW 테스트: [connectionWrites.test.ts](../../../src/shared/mock/connectionWrites.test.ts), [scenarios.test.ts](../../../src/shared/mock/scenarios.test.ts)
  - 스토리: [DiscordConnectionSection.stories.tsx](../../../src/features/integration-connection/ui/DiscordConnectionSection.stories.tsx)(7개)
  - E2E: [settings-team.e2e.ts](../../../e2e/settings-team.e2e.ts)(4건), [stories.sb.ts](../../../e2e/storybook/stories.sb.ts)의 M8 수집
- 백엔드·계약 문서·라우트(`pages/members`, `routes.tsx`, `shared/config/routes.ts`)에는 develop 대비 커밋 차이가 없다(V2·V3 리뷰의 `git diff --exit-code` 0).

## 완료조건 확인

"충족"은 아래 「검증 내역」의 실행 결과와 V1·V2·V3 리뷰의 정적 대응을 함께 쓴 B-1 판정이다. 실제 서버·외부 OAuth는 포함하지 않는다.

| 계획의 ID | 상태 | 근거 |
|---|---|---|
| AC-B-01 | 충족 (MSW) | [connectionWrites.test.ts](../../../src/shared/mock/connectionWrites.test.ts): PM 성공, 일반 팀원의 `DELETE`(두 provider)·`POST`·`PATCH` 403과 DB 스냅숏 불변, 없는 대상 404 우선, 새 공간 PM 허용, 두 provider 모의 OAuth `failed`·불변. `scenarios.test.ts`의 `settings-member` `DELETE` 403. 기존 일반 팀원 시나리오 테스트 회귀 없음 |
| AC-B-02 | 충족 (MSW) | `scenarios.test.ts`: 세 시나리오의 시작 상태, 모든 시나리오 쌍의 상태 독립성, 만들 때마다 새 객체. E2E가 `?msw-scenario=settings-discord-skipped`로 시작하고 새로고침까지 통과 |
| AC-B-03 | 충족 | 모델 이동은 바이트 동일, 이동한 매핑 describe 3개와 helper는 기존 본문과 동일(V1·V3 대조). `onboardingMembers.test.tsx`·`OnboardingSteps.stories.tsx`·`signup-onboarding.e2e.ts`는 develop과 같은 내용으로 통과. `npm run lint`(FSD 경계) 0 |
| AC-B-04 | 충족 (승인된 단언 변경 1건) | 아래 「계획 대비 변경」의 제목 목록 단언 한 줄 외에 `notionConnection.test.tsx`의 기대값 변경 없음. 복귀 확인·`connecting` 대기·D-098·`section=notion` 포커스·경합 단언 통과. Notion 스토리, `meeting-keyboard.e2e.ts` 통과 |
| AC-B-05 | 충족 (MSW) | `settingsConnections.test.tsx`: 시작 URL·`state`, 성공 뒤 재조회·주소의 복귀 표시 제거·설정 유지, 성공 표시 뒤 재조회 불일치, 취소·실패, 재시도 안내 제거, 조회 오류 재시도, `revoked`. Discord 스토리. E2E의 모의 OAuth 왕복과 새로고침 |
| AC-B-06 | 충족 (MSW) | `settingsConnections.test.tsx`: 연결 전후 온보딩 상태 동일, `PATCH` 0건, `connect_discord`는 `skipped` 유지. E2E의 `PATCH .../onboarding` 0건 |
| AC-B-07 | 충족 (MSW) | `settingsConnections.test.tsx`(`settings-member`): 두 provider 상태·요청 안내·버튼 없음, Discord 연결됨, 버튼을 우회한 OAuth도 실패. Discord 스토리 `팀원_미연결`·`팀원_연결됨`, 기존 Notion 팀원 스토리 |
| AC-B-08 | 충족 | E2E: 1024/1440/1920px에서 페이지 가로 넘침 없음(`scrollWidth`/`clientWidth`). 두 provider 미연결 문구, 이름 입력→Discord→Notion 연결 버튼 Tab 순서, Shift+Tab, Discord에서 Enter로 모의 OAuth 이동. 상태 배지는 문구다. Notion 버튼은 포커스까지 확인했고 Notion의 Enter 이동은 기존 `meeting-keyboard.e2e.ts`가 맡는다. V2가 부분으로 본 연속 Tab은 8d0cf3b로 보완했다 |
| AC-B-09 | 이 문서 | 아래 「검증 내역」의 명령별 종료 코드·Node 버전과, 프론트·MSW 결과와 미검증 연동 과제의 구분. 파트 README는 세 브랜치 병합 뒤 한 번에 갱신하므로 아직 반영하지 않았다(끝의 제안 문장) |

## 검증 내역

모든 명령은 이 워크트리의 `frontend/`에서, Node v24.11.0으로 실행했다. 여러 브랜치(#243·#245)가 같은 기계에서 동시에 검증해 V1·V3는 공통 잠금 래퍼(`heavy.sh`)로 무거운 명령을 순서대로 실행했다. 표의 시간은 잠금 대기를 뺀 실행 시간이다.

### 최종 게이트 — V3 (2026-10-31, HEAD `8d0cf3b`)

| 명령 | exit | 결과 |
|---|---|---|
| `node --version` | 0 | v24.11.0 |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | FSD 경계 검사 포함 |
| `npm run format:check` | 0 | |
| `npm run test -- --maxWorkers=2` | 0 | 162 files / 1820 tests 통과, 934.72초. 기본 5초 한도 유지 |
| `npm run build` | 0 | |
| `npm run test:storybook` (`STORYBOOK_E2E_PORT=6212`) | 0 | 112 통과 |
| `npx playwright test e2e/settings-team.e2e.ts e2e/signup-onboarding.e2e.ts e2e/select-switch.e2e.ts e2e/meeting-keyboard.e2e.ts` (`E2E_PORT=5212`) | 0 | 12 통과(4·3·2·3), 재실행 없음 |

- `node_modules`가 있어 `npm ci`는 실행하지 않았다. 계획의 게이트 첫 단계 중 이것만 V3에서 빠졌다. `npm ci`는 구현 워커가 실행해 exit 0이었다.
- 앱·Storybook 빌드에 생성 CSS의 `color: var(...)` 구문 경고가 있었다. Storybook에는 500kB 초과 청크 경고도 있었다. 모두 exit 0이며 원인 파일은 특정하지 않았다.

### 전체 Vitest — 기본 설정과 `--maxWorkers=2`의 차이

이 기계에서 기본 설정(`npm run test`, 테스트당 5초 한도, 기본 워커 수)의 전체 Vitest는 한 번도 exit 0이 나오지 않았다. 병렬 부하로 이번 변경과 무관한 테스트가 타임아웃했다. 한도는 바꾸지 않았다. 워커 수만 2로 줄인 `npm run test -- --maxWorkers=2`에서 exit 0을 얻었다. 기본 설정 실패 파일의 단독 통과를 전체 통과로 세지 않는다.

| 실행 | 설정 | exit | 결과 |
|---|---|---|---|
| 구현 워커 1~4차 | 기본 1회, `--maxWorkers=4` 1회, 기본 2회(마지막은 잠금 래퍼 아래) | 1 (4회 모두) | 실패 43·37·92·31건 / 약 1820. 실패 목록이 매번 달랐다. DropdownMenu·Popover·logout·boot 등 무관 파일이 포함됐고, 전부 타임아웃 또는 지연 로드된 화면을 `findBy`가 찾지 못한 경우였다. 단언 회귀는 0건 |
| 구현 워커 | `npx vitest run --testTimeout=20000 --maxWorkers=2` (기본 설정 아님) | 0 | 162 files / 1820 tests, 840초 |
| V1 (HEAD `79c2a30`) | `npm run test` (기본) | 1 | 159/162 files, 1814/1820 tests. 실패는 `appShell.test.tsx` 4건(:57·:71·:91·:132), `meetingProcessing.test.tsx` 1건(:162), `meetingUpload.test.tsx` 1건(:112). 모두 5초 타임아웃 또는 `findByRole` 미발견 |
| V1 단독 재실행 | 실패 파일별 `npx vitest run <file> --maxWorkers=1` (한도 그대로) | 0 | appShell 21/21, meetingProcessing 31/31, meetingUpload 38/38. 처음 실패한 테스트들의 단독 실행 시간은 0.9~1.7초 |
| V3 (HEAD `8d0cf3b`) | `npm run test -- --maxWorkers=2` (5초 한도 그대로) | 0 | 162 files / 1820 tests, 934.72초 |

- 구현 워커의 단독 재실행에서 `appShell.test.tsx`는 5초 한도로 2건이 넘쳤다. `--testTimeout=30000 --maxWorkers=1`에서는 21/21 통과했다. 설정·매핑 UI를 그리지 않는 테스트다.
- 코디네이터 지시에는 실패 파일 일부가 기준 커밋에서도 단독 실패했다고 적혀 있다. 이 문서가 근거로 쓴 보고서에는 기준 커밋 실행 기록이 없다.
- V1은 이 실패를 부하·병렬 실행에 민감한 시간·조회 실패로 분류했다. 단독에서도 남는 코드 결함은 찾지 못했다. 다만 기본 전체 게이트 실패를 통과로 바꾸지 않았다(V1 판정 FAIL). V3는 기본 워커 수 실행을 다시 하지 않았다.

### 구현 중 실행 (구현 워커, 2026-10-30~31)

| 명령 | exit | 결과 |
|---|---|---|
| `npm ci` | 0 | |
| `npm run typecheck`·`npm run lint` | 0 | 구현 순서 6 커밋 전 작업 트리. 이후 바뀐 파일은 개별 eslint 0 |
| `npm run format:check`·`npm run build` | 0 | |
| `npm run test:storybook` | 1 → 0 | 첫 실행은 `PM_취소_복귀` play가 버튼을 바로 찾다 실패했다. aeb8370으로 고친 뒤 112 통과 |
| `npm run test:e2e -- e2e/settings-team.e2e.ts e2e/signup-onboarding.e2e.ts e2e/select-switch.e2e.ts e2e/meeting-keyboard.e2e.ts` | 1 → 0 | 앞선 실행은 부하로 `page.goto`·첫 화면 타임아웃. 새 Vite에서 설정 화면 콜드 변환이 0.6초여서 코드 원인은 아니었다. 최종 `--workers=2`(2d95c5a 시점) 12 통과 |

중간 커밋 e33df05·dfa3368은 이후 단계 내용을 빼고 커밋했다. 커밋별 typecheck는 실행하지 않았다(최종 HEAD만 검증).

### V1 (2026-10-31, HEAD `79c2a30`)

typecheck·lint·format:check 0, build 0, `test:storybook` 0(112 통과), `npm run test:e2e -- e2e/settings-team.e2e.ts` 0(4 통과). 전체 Vitest는 위 표대로 exit 1이다.

### 수행하지 않은 검증

- 실제 백엔드·Discord·Notion과의 연동(아래 「남은 작업과 제한 사항」).
- 전체 `npm run test:e2e`. 계획이 지정한 4개 파일만 실행했다.
- 기본 워커 수로 한 번에 통과하는 전체 Vitest.

## 계획 대비 변경

- **기존 테스트 단언 한 줄 변경(승인)**
  - 무엇: [notionConnection.test.tsx](../../../src/app/notionConnection.test.tsx)의 설정 절 `h2` 목록 단언을 `['Notion 연결']`에서 `['Discord 연결', 'Notion 연결']`로 바꿨다. 주석도 "Settings 캔버스의 다른 절(…Discord)은 M8"에서 "M8-B B-1에서 Discord 연결 영역이 함께 있다. 그 밖의 절은 결정 대기"로 바꿨다.
  - 이유: AC-B-04는 기존 Notion 테스트를 기대값 변경 없이 통과하는 것이 조건이다. 하지만 이 단언은 설정에 Discord 영역을 더하는 6단계와 본질적으로 충돌한다. 코디네이터 승인을 받았고 커밋 e89c468 본문에 기록했다.
  - 영향: Notion 동작을 검사하는 기대값은 그대로다. 이 테스트의 제목에는 "Notion 연결 영역만"이라는 과거 표현이 남아 있다. 단언은 새 화면과 맞아 기능 문제는 아니다(V2).
- **시나리오 독립성 테스트 한도 30초(79c2a30)**
  - 무엇: [scenarios.test.ts](../../../src/shared/mock/scenarios.test.ts)의 「시나리오끼리 독립적이다」 테스트 하나에만 `30_000`을 지정했다. 전역 한도와 루프·단언은 그대로다.
  - 이유: 이 테스트는 모든 시나리오 쌍을 적용·비교한다. 시나리오가 30개에서 33개로 늘어 비교가 900쌍에서 1089쌍이 됐다(V1). 구현 워커는 부하 중 단독 실행에서 9.4초를 재고 코디네이터 지시로 한도를 뒀다. #245 브랜치와 같은 방식·같은 값이라 병합 충돌도 줄인다(커밋 본문).
  - 한계: V1의 단독 측정은 3855ms였다. 5초를 넘는다는 수치와 30초가 필요하다는 수치는 독립 재현하지 못했다.
- **E2E 축소와 보완(2d95c5a, 8d0cf3b)**
  - 계획 7단계는 Discord 연결의 성공·취소·실패와 새로고침 뒤 상태를 E2E로 확인하도록 했다. 5a7a207이 그렇게 작성했다.
  - 이후 사용자의 E2E 지양 지시에 따라 2d95c5a에서 취소·실패 2건과 일반 팀원 1건을 뺐다. 이들은 브라우저 없이도 볼 수 있다. 대신 `settingsConnections.test.tsx`의 취소·실패·재조회 불일치·일반 팀원 테스트와 Discord 스토리 `PM_취소_복귀`·`팀원_*`이 맡는다.
  - 남긴 것은 브라우저에서만 볼 수 있는 현재 탭 OAuth 왕복과 sessionStorage 새로고침 복원, 그리고 세 너비의 넘침·키보드 검사다.
  - V2는 두 연결 버튼이 함께 보이는 상태의 연속 Tab 검증이 없다고 지적했다(V2-03). 그 방향은 "새 E2E 파일·사례를 더하지 말고 기존 너비 테스트 안에서 보완"이었다. 8d0cf3b는 기존 너비 테스트에서 PM 모의 `DELETE`로 Notion도 끊고 새로고침한 뒤 Tab 순서를 확인한다. 테스트 수는 4건 그대로다.
  - 테스트 준비용 `DELETE`는 연결 끊기 제품 UI가 아니다. V3는 격리·영속 측면에서 수용 가능하다고 판단했다.
- **폼 본문 위치:** 계획 4단계는 `widgets` 또는 `features`를 후보로 두었다. 구현은 매핑 모델과 같은 `features/member-mapping`에 두었다([결정 기록](basis-for-decision/2026-10-31-member-mapping-integration-connection-slices.md)).
- **설정 연결 슬라이스:** 계획 5단계의 후보 중 새 `features/integration-connection`을 택했다. 기존 `notion-connection`을 개명해 옮겼다(같은 결정 기록).

## 남은 작업과 제한 사항

### B-2 — 결정 5 해결 뒤 재작업으로 구현

B-1 기록 시점에는 계획 구현 순서 8~12가 선행 결정 대기였다. 2026-10-31 결정 5가 "디자인 캔버스의 Settings·Team 아트보드를 기준으로 한다"로 풀려(사용자 결정) 위 「재작업」에서 다음을 구현했다.

- 8: 팀 화면 구성과 `연결되지 않은 계정` 영역(D-076, D-030, D-031)
- 9: 팀 화면의 팀원 연결 창(재진입)과 무매핑 이탈(D-074·D-075)
- 10: 설정에서 Discord 연결이 확인되면 팀원 연결 창으로 이동(D-074)
- 11: `연결 끊기`(서버 반영), `속성 다시 맞추기`·`채널 바꾸기`(API 없음, 준비 중 안내)
- 12: 일반 팀원의 팀·설정 표시 범위(읽기만, 쓰기 조작 없음)

남은 것:

- 계획 B 절의 「선행 결정」 표와 B-2 AC(`AC-B-1x`)는 갱신하지 않았다. 계획 수정은 사용자 요청이 있을 때만 한다.
- 아트보드와 다른 점(위 차이표의 "없음"·대체 표시)은 데이터나 API가 생길 때 다시 맞춘다.
- 온보딩 뒤 팀원 연결 창은 PM 체크를 요구하지 않는다(계획 질문 6, [결정 기록](basis-for-decision/2026-10-31-settings-team-follow-design-canvas.md)). 사용자 확인 전 임시 판단이다.

### 계약 갱신 — 이번 작업 범위 밖

[계약](../../contracts/frontend-api-contract.md) §4.3의 OAuth `start`·`callback` 표기와 현재 코드 대조 표가 백엔드 구현보다 뒤처져 있다. §5.8 설정 항목에도 이번 Discord 연결 영역·연결 끊기·팀 화면이 반영되지 않았다. 자동 반영 기준·알림·팀 삭제·채널·속성 API가 없다는 사실도 계약에 적어야 한다. 계획 13단계의 `contract-update` 스킬 대상이며 이번 기록 작업에서는 수정하지 않았다.

### 미검증 연동 과제

MSW 결과로 대체하지 않는다. 계획 「완료 판정과 미검증 연동 과제」의 항목이 그대로 남는다.

- 실제 Discord 봇 초대 OAuth와 Notion OAuth의 성공·취소·실패 복귀. 배포 도메인과 redirect URI가 필요하다.
- 실제 `GET .../discord/members`가 연결된 서버의 사용자를 돌려주는지
- 실제 서버의 PM 권한 거부(`start` 실패 복귀, `DELETE`·`/members`의 403)와 프론트 안내의 일치
- `revoked` 상태가 실제 서버에서 오는지. Discord 영역의 `연결 끊김` 표시는 MSW로만 확인했다.
- 탈퇴한 팀원의 Discord 사용자를 다시 연결할 때의 500

### 전체 Vitest 환경

기본 설정의 전체 Vitest가 이 기계의 병렬 부하에서 한 번에 통과하지 못한 사실이 남는다(「검증 내역」). 최종 게이트는 `--maxWorkers=2`의 결과다. 다른 기계나 부하가 없는 환경에서 기본 설정으로 다시 확인하지 않았다. 시나리오가 늘면 독립성 테스트가 다시 한도에 가까워질 수 있다.

### 문서 링크

모듈 이동으로 깨진 상대 링크가 7건 있다. 이 문서들은 보호 규칙(계획·refactor 기록)과 미커밋 변경(`plan.md`) 때문에 고치지 않았다. 옛 경로에서 현재 경로를 찾을 때는 [슬라이스 결정 기록](basis-for-decision/2026-10-31-member-mapping-integration-connection-slices.md)의 대응표를 본다.

| 위치 | 깨진 링크 대상(옛 경로) |
|---|---|
| `frontend/docs/plan/m8/plan.md:45` | `src/features/notion-connection/ui/NotionConnectionSection.tsx` |
| `frontend/docs/plan/m8/plan.md:55` | `src/features/onboarding/model/memberMapping.ts` |
| `frontend/docs/plan/m8/plan.md:59` | `src/features/notion-connection/model/useNotionConnection.ts` |
| `frontend/docs/plan/m8/plan.md:80` | `src/features/notion-connection/ui/NotionConnectionSection.stories.tsx` |
| `frontend/docs/plan/m8/plan.md:80` | `src/features/notion-connection/ui/NotionRequiredModal.stories.tsx` |
| `frontend/docs/plan/refactor/plan-onboarding-pm-discord-link.md:18` | `src/features/onboarding/model/memberMapping.ts` |
| `frontend/docs/plan/refactor/result-onboarding-pm-discord-link.md:21` | `src/features/onboarding/model/memberMapping.ts` |

링크는 살아 있지만 안내가 뒤처진 곳도 있다. 아래 위치는 「PM 을 골라 잇기 (#228)」 테스트가 `onboardingModel.test.ts`에 있다고 적고 있다. 이 테스트는 이제 [memberMapping.test.ts](../../../src/features/member-mapping/model/memberMapping.test.ts)에 있다.

- `frontend/docs/plan/refactor/plan-onboarding-pm-discord-link.md:43`
- `frontend/docs/plan/refactor/result-onboarding-pm-discord-link.md:39`, `:71`(테스트 개수)

M5 결정 기록과 인수인계에는 `features/notion-connection`이 링크가 아닌 코드 표기로 남아 있다.

### 경로 이동 뒤 포커스 — 공통 장치 없음

앱에는 경로를 옮긴 뒤 새 화면으로 포커스를 옮기는 공통 장치가 없다. 이번에는 프로필 메뉴의 `설정`만 고쳤다(위 「후속 — 설정으로 옮긴 뒤의 포커스」).

- 설정 화면만 들어올 때 제목에 포커스를 둔다. 다른 화면은 메뉴 트리거나 body에 포커스가 남는다.
- 워크스페이스 메뉴: 다른 완료 공간으로 옮기면 트리거에 남고, 온보딩·만들기·선택 화면으로 가면 body로 떨어진다.
- 공통 장치(경로가 바뀌면 새 화면의 제목이나 `main`으로 옮기는 방식)와 메뉴의 트리거 복귀 끄기를 함께 정해야 한다.

### 그 밖의 제한

- Discord 영역의 리드 문구, `revoked`의 `연결 끊김`, 일반 팀원 요청 안내는 온보딩 문구를 바탕으로 정했다. 제품 문구 검토를 받지 않았다.
- `MemberMappingFields`는 재작업에서 `tone`을 받게 됐다. 온보딩은 기본값(`onboarding`), 팀원 연결 창은 `product`다.
- 팀 화면·설정의 새 문구(먼저 챙길 것 문장, 미연결 안내, 준비 중 토스트)도 제품 문구 검토를 받지 않았다.
- [frontend/README.md](../../../README.md)의 시나리오 목록에 새 시나리오 세 개가 없다. 보호 대상이라 이번에 고치지 않았다. [MSW 안내](../../msw-guide.md)에는 추가했다.

### 파트 README 갱신 제안

세 브랜치(#243·#244·#245) 병합 뒤 한 번에 반영할 문장 제안이다. 따옴표 안의 링크 경로는 각 README 기준이다.

- [마일스톤 안내](../README.md)의 M8 행 상태 칸: "B(#244)는 B-1(설정 Discord·Notion 연결, MSW PM 전용 쓰기, 매핑 폼 분리)과 결정 5(디자인 캔버스 기준) 뒤의 설정·팀 화면(팀원 연결 재진입·연결 끊기)을 구현하고 `[B 결과](m8/result-b.md)`에 근거를 기록했다. 계획의 B-2 AC는 아직 없어 완료 판정 없음"
- [Frontend README](../../../README.md) 상태 문단의 M8 문장: "M8-B는 `[결과](docs/plan/m8/result-b.md)`에 B-1의 AC-B-01~08 프론트·MSW 기준 근거와 Node v24.11.0 게이트(전체 Vitest는 `--maxWorkers=2`에서 통과, 기본 설정은 이 기계의 병렬 부하로 타임아웃)를 기록했다. 설정·팀 화면은 Settings·Team 아트보드 기준으로 만들었고(결정 5), 실제 Discord·Notion 연동은 미검증이다."

## 관련 기록

- [설정·팀 화면을 디자인 캔버스로 정한 선택(결정 5)](basis-for-decision/2026-10-31-settings-team-follow-design-canvas.md)
- [팀원 매핑·설정 연결 슬라이스 위치](basis-for-decision/2026-10-31-member-mapping-integration-connection-slices.md)
- [MSW 연결 쓰기를 PM 전용으로 맞추는 선택](basis-for-decision/2026-10-31-msw-pm-only-connection-writes.md)
- [M8 계획](plan.md) B 절
- [MSW 사용 안내](../../msw-guide.md) 「설정·팀 (M8-B)」
