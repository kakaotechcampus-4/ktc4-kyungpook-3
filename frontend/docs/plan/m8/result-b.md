# M8-B 구현 결과 — 설정·팀 연결 관리 (B-1)

- 기록일: 2026-10-31
- 대상: [M8 계획](plan.md) B 절(이슈 #244)의 B-1, 구현 순서 1~7
- 상태: **B-1의 프론트엔드·MSW 구현과 AC-B-01~AC-B-08의 근거를 확보했다.**
  - 최종 게이트는 Node v24.11.0, HEAD `8d0cf3b`에서 실행했다. 전체 Vitest는 기본 설정에서 병렬 부하로 한 번에 통과하지 못했다. 그래서 `--maxWorkers=2`로 돌려 exit 0을 얻었다. 아래 「전체 Vitest」 절에 두 실행을 나눠 적었다.
  - B-2(구현 순서 8~12)는 선행 결정 대기라 구현하지 않았다. 따라서 M8-B 전체의 완료로 기록하지 않는다.
  - 실제 Discord·Notion 연동은 미검증 연동 과제로 남는다.

## 작업 근거와 요약

코디네이터 지시에 따라 브랜치 `feature/244-m8-settings-team`에서 B-1을 구현했다. 기준은 develop `ff9467e`이고 커밋은 11개다. push·PR은 하지 않았다.

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

### B-2 — 선행 결정 대기, 구현하지 않음

계획 구현 순서 8~12는 착수하지 않았다. 팀 페이지·라우트에 develop 대비 차이가 없다(V2·V3).

- 8: 팀 화면 구성과 `연결되지 않은 계정` 영역(D-076, D-030, D-031)
- 9: 온보딩 뒤의 팀원 연결 재진입 화면·경로와 무매핑 이탈(D-074·D-075)
- 10: 설정에서 Discord 연결 성공 뒤 팀원 연결로 이동(D-074). 지금은 성공 뒤 설정에 머문다.
- 11: `연결 끊기`·`속성 다시 맞추기`·`채널 바꾸기`(5-b)
- 12: 일반 팀원의 팀·설정 표시 범위

걸린 결정은 다음과 같다([계획](plan.md) B 「선행 결정」).

- **결정 5(열림):** 설정·팀 화면의 항목 범위와 권한. MSW의 PM 전용 쓰기는 서버 제약을 맞춘 것이다. 이 결정의 권한 기본값을 확정한 것이 아니다.
- **결정 5-a(열림):** 팀원 연결 재진입과 `연결되지 않은 계정`을 팀과 설정 중 어디에 둘지. D-074의 이동 목적지와 재진입 형태도 이 결정으로 정해진다.
- **결정 5-b(열림):** `연결 끊기`·`속성 다시 맞추기`·`채널 바꾸기`를 포함할지.
- **확정된 사실(2026-10-30 사용자 답변):** 팀 화면은 설정과 **별도 페이지**다.

`settings-unmapped` 시나리오와 `features/member-mapping`은 B-2가 쓸 준비물이다. 온보딩 뒤 매핑 화면의 PM 체크 정책(계획 질문 6)도 정하지 않았다.

### 계약 갱신 — 이번 작업 범위 밖

[계약](../../contracts/frontend-api-contract.md) §4.3의 OAuth `start`·`callback` 표기와 현재 코드 대조 표가 백엔드 구현보다 뒤처져 있다. §5.8 설정 항목에도 이번 Discord 연결 영역이 반영되지 않았다. 계획 13단계의 `contract-update` 스킬 대상이며 이번 기록 작업에서는 수정하지 않았다.

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

### 그 밖의 제한

- Discord 영역의 리드 문구, `revoked`의 `연결 끊김`, 일반 팀원 요청 안내는 온보딩 문구를 바탕으로 정했다. 제품 문구 검토를 받지 않았다.
- `MemberMappingFields`는 온보딩 모양(`tone="onboarding"`)을 그대로 쓴다.
- [frontend/README.md](../../../README.md)의 시나리오 목록에 새 시나리오 세 개가 없다. 보호 대상이라 이번에 고치지 않았다. [MSW 안내](../../msw-guide.md)에는 추가했다.

### 파트 README 갱신 제안

세 브랜치(#243·#244·#245) 병합 뒤 한 번에 반영할 문장 제안이다. 따옴표 안의 링크 경로는 각 README 기준이다.

- [마일스톤 안내](../README.md)의 M8 행 상태 칸: "B(#244)는 B-1(설정 Discord·Notion 연결, MSW PM 전용 쓰기, 매핑 폼 분리)을 구현하고 `[B 결과](m8/result-b.md)`에 AC-B-01~08의 프론트·MSW 근거를 기록했다. B-2(팀 화면·팀원 연결 재진입·연결 끊기)는 결정 5·5-a·5-b 대기. 완료 판정 없음"
- [Frontend README](../../../README.md) 상태 문단의 M8 문장: "M8-B는 `[결과](docs/plan/m8/result-b.md)`에 B-1의 AC-B-01~08 프론트·MSW 기준 근거와 Node v24.11.0 게이트(전체 Vitest는 `--maxWorkers=2`에서 통과, 기본 설정은 이 기계의 병렬 부하로 타임아웃)를 기록했다. B-2는 선행 결정 대기이고 실제 Discord·Notion 연동은 미검증이다."

## 관련 기록

- [팀원 매핑·설정 연결 슬라이스 위치](basis-for-decision/2026-10-31-member-mapping-integration-connection-slices.md)
- [MSW 연결 쓰기를 PM 전용으로 맞추는 선택](basis-for-decision/2026-10-31-msw-pm-only-connection-writes.md)
- [M8 계획](plan.md) B 절
- [MSW 사용 안내](../../msw-guide.md) 「설정 연결 (M8-B)」
