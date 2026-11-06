# 결과 — Storybook 을 지우고 필요한 검사만 RTL·E2E 로 옮기기 (#482)

- 기록일: 2026-11-07
- 대상: [#482](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/482)의 할 일(분류·옮기기·지우기·문서·검증)
- 기준: develop `94c04ddb`. PR은 아직 만들지 않았다.
- 상태: **할 일을 모두 반영했다.** MSW 기준 Vitest·E2E 로 검증했다. CI 통과는 PR 에서 확인한다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #482 와 팀 결정(2026-11-07)이다. Storybook 은 D-141 이 정한 범위보다 커져 화면 단위 스토리까지 늘었고, CI `test:storybook` 이 play 단언까지 봤다. 같은 동작을 E2E·RTL·play 세 곳에서 검사해 화면을 바꿀 때 세 곳을 고쳤다(#423, #424).

이번 작업으로 Storybook 을 모두 지웠다. 지우기 전에 play 192건을 하나씩 분류해, 다른 테스트가 보지 않던 48건만 Vitest(RTL)와 Playwright E2E 로 옮겼다. 옮긴 테스트는 play 의 단언 값과 의도를 그대로 지켰고, 테스트마다 기대값을 일부러 깨서 실패하는 것을 확인했다.

## 분류

play 가 있는 스토리를 셋으로 나눴다. ① 같은 상태와 같은 단언 의도를 보는 E2E·RTL 이 이미 있다. ② 옮긴다. ③ 지워도 잃는 검사가 없다. 기존 테스트가 일부만 겹치면 ② 로 두고 빠진 단언만 더했다.

| 분류 | 건수 |
|---|---|
| ① | 142 |
| ② RTL | 37 |
| ② E2E | 11 |
| ③ | 2 |
| 합계 | 192 |

- 이슈는 play 184건이라고 적었다. `fde92d13` 에서 185건(`DropdownMenu` 의 `비활성_항목` 이 `열림` 의 play 를 물려받는다), #471·#478·#417·#474 병합 뒤 `94c04ddb` 에서 192건이다.
- ① 의 근거 테스트 이름 169개가 `94c04ddb` 의 파일에 글자 그대로 있는지 스크립트로 확인했다(없는 이름 0).
- ③ 두 건: `DropdownMenu.비활성_항목`(`열림` 과 같은 play), `MinutesSkeleton.본문`(testid 와 `aria-busy` 만 보고, 같은 뼈대를 `RouteSkeleton.test.tsx`·`meetingMinutesSelection.test.tsx` 가 그린다).
- 열린 브랜치 `feature/477-select-rollout` 이 바꾸거나 더하는 play 네 건(`ReminderCreateForm.팀원과_태스크_고르기`, `Combobox.찾기`, `Combobox.휴대폰_시트`, `Select.휴대폰_시트`)은 모두 ① 이다. 그 브랜치를 병합할 때 스토리 파일만 지우면 된다.

## 옮긴 곳

### RTL (앱 단위 Vitest, MSW `server.use`)

| 스토리 | 옮긴 테스트 |
|---|---|
| `ApprovalReview.빠진_값` | `approvalsMsw.test.tsx`: 서버가 제목·담당자·마감을 비워 보내면 들어오자마자 승인이 꺼지고 이유가 버튼에 이어진다. 반려는 할 수 있다 |
| `ApprovalReview.처리_결과_승인` | `approvals.test.tsx`: 승인된 채로 들어오면 생성된 태스크 링크와 반영 상태를 보이고 처리 버튼이 없다 |
| `ApprovalReview.처리_결과_반려` | `approvals.test.tsx`: 처리된 승인으로 들어오면 결과만 보이고 처리 버튼이 없다 (단언 추가) |
| `ApprovalReview.로딩` | `approvals.test.tsx`: 확인 요청을 받는 동안 태스크 목록 링크와 기다림 표시가 있고 승인 버튼은 없다 |
| `ApprovalReview.오류` | `approvals.test.tsx`: 확인 요청을 받지 못하면 다시 시도와 함께 알린다 |
| `ApprovalReview.찾을_수_없음` | `approvals.test.tsx`: 없는 승인은 찾을 수 없다고 알린다 (단언 추가) |
| `AuthForms.로그인_제출_중` | `authFlow.test.tsx`: 중복 제출 방지 — 로그인 (단언 추가: 응답 전 버튼 비활성) |
| `Dashboard.로딩` | `dashboard.test.tsx`: 태스크와 승인을 함께 받는 중이면 PM 제목은 `워크스페이스 현황` 이고 요약 넷이 모두 불러오는 중이다 |
| `DiscordConnectionSection.PM_연결됨` | `settingsConnections.test.tsx`: 연결된 Discord 에는 연결 액션 대신 `채널 바꾸기` 와 `연결 끊기` 만 있다 |
| `DiscordConnectionSection.조회_오류` | `settingsConnections.test.tsx`: 연동 조회가 실패하면 미연결로 보이지 않고 인라인 안내와 다시 시도를 보이며, 다시 시도하면 회복한다 |
| `MeetingMinutes.본문_로딩` | `meetingMinutes.test.tsx`: 직접 들어온 회의의 상세가 늦으면 목록은 보이고, 본문 자리는 스켈레톤이며 회의 제목이 없다 |
| `MeetingProcessingPage.단계_0` | `meetingProcessing.test.tsx`: 아직 끝난 단계가 없으면 정리하고 있다는 제목과 0 / 3 단계 완료를 알린다 |
| `MeetingProcessingPage.불러오기_오류` | `meetingProcessing.test.tsx`: 처음 상세 조회가 실패하면 불러오지 못했다고 알리고 다시 시도를 준다 |
| `MeetingUploadForm.드래그_중` | `meetingUpload.test.tsx`: 파일을 끌고 들어오면 놓는 칸이 끌고 있다고 표시한다 |
| `MeetingUploadForm.입력_오류` | `meetingUpload.test.tsx`: 파일 없이 제출하면 … 파일 고르기로 포커스를 옮기며 요청하지 않는다 (단언 추가) |
| `MeetingUploadForm.전송률`, `전송률_불확정` | 새 `features/meeting-upload/ui/UploadStatus.test.tsx` (앱 테스트로는 전송률을 한 값에 붙잡을 수 없다) |
| `MessageInbox.로딩` | `messagesMsw.test.tsx`: 대화 주소에서 목록과 대화를 함께 받는 동안 목록 칸과 상세 칸이 모두 스켈레톤이다 |
| `MessageInbox.발송_시점_저장_중` (요청 부분) | `messagesActionsMsw.test.tsx`: 마감 하루 전을 누르면 응답 전에는 그대로이고 이대로 발송을 눌러도 보내지 않는다. 저장되면 그 카드가 골라진다 |
| `NotionConnectionSection.팀원_미연결` | `notionConnection.test.tsx`: 일반 팀원 — %s 는 %s 상태와 PM 에게 연결을 요청하라는 안내만 본다 (상태 라벨 단언 추가) |
| `NotionConnectionSection.조회_오류` | `notionConnection.test.tsx`: 연동 상태를 불러오지 못하면 미연결로 보이지 않고 다시 시도를 준다 |
| `OnboardingSteps.만들기_제출_중` | `onboardingCreate.test.tsx`: 만드는 요청에 답이 오기 전에는 `만들기` 가 잠겨 다시 보낼 수 없다 |
| `ProcessingToast.진행_중` | `processingToast.test.tsx`: 정리 중 카드에 `닫기` 가 없다 (단언 추가) |
| `ProcessingToast.화자_지정_필요` | `processingToast.test.tsx`: PM: 「화자 지정하기」는 그 회의의 화자 지정 화면으로 간다 |
| `ProcessingToast.화자_지정_필요_접힘` | `processingToast.test.tsx`: 접은 화자 지정 필요 알약을 누르면 화자 지정 카드를 다시 펼친다 |
| `ReminderCreateForm.태스크_담당자에게` | `reminderCreateMsw.test.tsx`: Discord 가 연결된 담당자에게는 미연결 안내 없이 마감 기준 시각을 골라 두고 바로 만들 수 있다 |
| `TaskBoard.탭_키보드` | `tasks.test.tsx`: 화살표·End·Home 으로 탭을 옮기면 그 탭에 포커스가 가고 골라진다 |
| `TaskBoard.로딩`·`오류`·`빈_목록` | `tasks.test.tsx` 「리스트 보기의 대기·실패·빈 목록」 세 테스트 |
| `TaskDetail.로딩` | `tasks.test.tsx`: 상세를 받는 동안 `태스크 목록` 링크와 기다림 표시가 있고 태스크 제목은 없다 |
| `TaskDetail.기한_지남` | `taskDetailEdit.test.tsx`: 제목 아래에 담당·마감을 보이고, 마감이 지났으면 기한 지남 배지를 붙인다 (재촉 카드 `마감이 지났어요.` 단언 추가) |
| `TaskNotionSyncStatus.확인_중` | `notionSyncPolling.test.tsx`: 승인 직후 그 태스크를 받기 전에는 확인하는 중이라고 보이고, 받으면 반영 상태로 바꾼다 |
| `TaskViews.캘린더_빈_달` | `taskViews.test.tsx`: 캘린더 — 회의를 받지 못하면 … (앞 달로 가면 문구가 없다는 단언 추가) |
| `TeamOverview.PM_기본` | `team.test.tsx`: PM 은 `먼저 챙길 것` 카드를 보고, 앞으로 7일은 오늘 칸에 `오늘` 을 적는다 |
| `TeamOverview.팀원` | `team.test.tsx`: 연결되지 않은 계정 영역은 Discord 미연결만 알리고 설정으로 가는 링크가 없다. `팀원 관리` 도 없다 |
| `TeamOverview.로딩`·`오류` | `team.test.tsx`: 팀원을 받는 동안 …, 팀원 조회가 실패하면 본문에 다시 시도를 보이고 … |

### E2E (실제 브라우저)

| 스토리 | 옮긴 테스트 |
|---|---|
| `MessageInbox.긴_문구_미리보기`·`긴_문구_대화`·`긴_대화` | 새 `e2e/messages-layout.e2e.ts` 세 테스트. 스토리가 db 를 고치던 상태를 새 MSW 시나리오 `messages-long-content` 로 만들었다 |
| `MessageInbox.발송_시점_hover`·`발송_시점_고를_수_없음` | `messages-layout.e2e.ts`: 언제 보낼까요? 카드는 고를 수 있는 카드만 hover 면이 #EDEDED 이고, 고른 카드·고를 수 없는 카드는 그대로다 |
| `MessageInbox.발송_시점_저장_중` (화면 부분) | `messages-layout.e2e.ts`: 보낼 시각을 저장하는 동안 … 면과 글자색이 그대로이고, 잠긴 카드는 hover 면이 없다 |
| `TaskViews.보드_PM`·`보드_직접_추가`·`캘린더_PM`·`간트_PM` | 새 `e2e/task-views-design.e2e.ts` 네 테스트(시안 값, 간트 오늘 선 VR-10) |
| `TaskViews.간트_긴_내용` | `e2e/task-views.e2e.ts`: 간트 — 긴 제목·줄바꿈할 곳이 없는 제목·긴 담당자 이름이 있어도 왼쪽 칸은 252px 이다 (1024·1440·1920) |

## 지운 것

- 스토리 43개(`src/**/*.stories.tsx`), `.storybook/`(`main.ts`, `preview.tsx`, `playOutcome.ts`), `e2e/storybook/`(`serve.mjs`, `stories.sb.ts`), `playwright.storybook.config.ts`.
- `package.json` 스크립트 `storybook`·`build-storybook`·`test:storybook`, 의존성 `storybook`·`@storybook/react-vite`. `package-lock.json` 은 develop 의 lock 에서 root 의 두 의존성을 빼고, root 에서 lock 그래프(dependencies·optionalDependencies·필수 peer)로 더 닿지 않는 엔트리 143개만 스크립트로 지웠다(740 → 597). 남은 엔트리는 develop 과 글자 그대로 같고 diff 는 삭제뿐이다. Windows 의 npm 으로 lock 을 다시 만들면 wasm32 전용 `@emnapi/core`·`@emnapi/runtime` 까지 빠져 Linux CI 의 `npm ci` 가 실패했기 때문이다.
- `.gitignore`·`.prettierignore`·`eslint.config.js` ignores 의 `storybook-static`·`playwright-report-storybook`·`test-results-storybook`. eslint 의 `.storybook`·`*.stories.tsx` 대상, `tsconfig.json` include 의 `.storybook`·`playwright.storybook.config.ts`.
- `.github/workflows/frontend-ci.yml` 의 `storybook` job. 이 job 을 `needs` 로 기다리는 job 은 없다. check·build·e2e job 은 그대로다.
- 스토리만 쓰던 `widgets/task-board` barrel 의 `TaskBoardProps`·`DEFAULT_VIEW_QUERY` export. 다른 barrel 에서 스토리만 쓰던 export 는 없었다(스크립트로 확인).
- 주석: `shared/lib/date/clock.ts`, `e2e/task-views.e2e.ts`, `e2e/settings-team.e2e.ts`.

## 문서

- [결정 기록](../../plan/m8/basis-for-decision/2026-11-07-remove-storybook.md)에 근거를 남기고, [결정 문서](../../decision/frontend-decisions.md)에 D-181 을 더했다. D-141 은 폐기, D-143(CI 게이트)·D-146(MSW 공유 대상)은 Storybook 부분만 바꿨다고 각 줄 끝에 적었다.
- [MSW 사용 안내](../../msw-guide.md) 「Storybook·E2E 에서 고르기」를 「E2E 에서 고르기」로 고쳤다.
- [Frontend README](../../../README.md) 의 Storybook 절을 지우고 MSW 를 쓰는 곳에서 Storybook 을 뺐다.
- [API 계약](../../contracts/frontend-api-contract.md) 의 MSW 공유 대상 두 줄에서 Storybook 을 뺐다. 166행은 `당시` 상황을 적은 인용이라 그대로 뒀다. 인터페이스는 바뀌지 않았다.
- verify 스킬(`.cursor/skills/verify-managers-manager/`, `.claude/skills/`)에는 Storybook 줄이 없었다. 원본 checkout 에만 있는 로컬 `verify-frontend` 스킬은 이 저장소 밖이라 고치지 않았다.
- 지난 마일스톤의 plan·result·basis-for-decision, `issues/*/result.md`, `plan/refactor/*` 에 나오는 Storybook 은 그때의 사실이라 고치지 않았다.

### `frontend-plan.md` (보호 문서, 고칠 곳만)

[전체 계획](../../plan/frontend-plan.md)은 고치지 않았다. 사람이 고칠 곳은 아래와 같다.

- 78행: `.gitignore` 보강 목록의 `storybook-static/`.
- 81행: CI 게이트(D-143)의 `build-storybook` job.
- 141행: MSW 를 `로컬 개발 · Vitest · Storybook이 공유`(D-146).
- 174행: M4 종료 시점 Storybook 도입.
- 239행: Storybook 도입 완료와 CI `build-storybook`·`test:storybook`(D-141, D-143).
- 393행: `shared/mock/` 설명의 `dev·test·Storybook 공유`.
- 415행: `npm run build-storybook`.

## 완료조건 확인

| 이슈 #482 의 할 일 | 상태 | 근거 |
|---|---|---|
| 분류: play 를 ①②③ 으로 나눈다 | 충족 | 위 「분류」. 분류표 원본은 로컬 `frontend/.verify/reports/482-classification.md`(git 제외) |
| 옮기기: ② 를 RTL·E2E 로 | 충족(MSW) | 위 「옮긴 곳」 48건. 아래 검증 |
| 지우기: 스토리·설정·스크립트·의존성·ignore·CI job | 충족 | 위 「지운 것」, 아래 흔적 검색 |
| 문서: D-141 폐기, D-143·D-146, msw-guide, verify 스킬 줄, clock.ts, frontend-plan 보고 | 충족 | 위 「문서」 |
| 검증: test·test:e2e·build·CI | 일부 | 바꾼 E2E spec 과 전체 Vitest·build 는 로컬에서 통과. 전체 E2E 와 CI 는 PR 에서 본다 |

## 설계 결정

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| 옮길 범위 | 다른 테스트가 같은 의도를 이미 보면 지우고, 일부만 겹치면 빠진 단언만 더한다 | 모든 play 옮기기: 142건은 같은 검사가 이미 있어 중복만 남는다 |
| 옮길 곳 | 상태는 앱 단위 Vitest, 배치·색·hover·스크롤은 E2E | 모두 E2E: 느리고 무겁다. 모두 RTL: jsdom 은 CSS 계산과 배치가 없다 |
| 목록 탭 End·Home | RTL | E2E: 키 두 개뿐이고 jsdom 에서도 포커스와 선택을 본다 |
| `발송_시점_저장_중` | 승인 요청 0건은 RTL, 버튼 면·글자색은 E2E | 둘 다 E2E: 요청 수는 RTL 로 충분하다 |
| 메시지 긴 문구 상태 | MSW 시나리오 `messages-long-content` | 테스트 안에서 모의 DB 고치기: 시나리오는 개발 서버에서도 같은 화면을 다시 연다 |
| 업로드 전송률 | `UploadStatus` 컴포넌트 테스트 | 앱 단위: 전송률을 한 값에 붙잡을 수 없다 |
| 시안 값 E2E | play 의 픽셀·색 값을 그대로 옮긴다 | ③ 으로 지우기: 간트 오늘 선(VR-10)처럼 실제 회귀를 잡은 값이 있다 |

## 검증

| 범위 | 명령·방법 | 결과 |
|---|---|---|
| 옮긴 RTL | 바꾼 파일마다 `npx vitest run <파일> --maxWorkers=1` | 모두 통과 |
| 깨 보기 | 새 단언마다 기대값을 바꿔(제품 코드는 그대로) 실패를 보고 되돌림 | 모든 새 단언이 실패했다. 빈 단언 없음 |
| 옮긴 E2E | `E2E_PORT=5231 npx playwright test` `messages-layout`·`task-views-design`·`task-views`·`settings-team` `--workers=1` | 30개 통과 |
| 타입·린트·포맷 | `npm run typecheck`, `npm run lint`, `npm run format:check` | 통과(포맷 경고는 git 제외 `.verify/` 두 파일뿐) |
| 빌드 | `npm run build` | 통과 |
| 전체 Vitest | `npm run test -- --maxWorkers=1` | 252개 파일 중 251개, 3121개 중 3119개 통과. 실패 2개는 이번에 고치지 않은 `settingsPage.test.tsx` 의 저장 실패 알림 두 행이다. 그 파일만 다시 돌리면 21개 모두 통과해 부하로 인한 시간 초과로 본다 |
| 설치 | 커밋한 `package.json`·`package-lock.json` 으로 WSL Linux(CI 와 같은 Node 24.22.2·npm 11.19.1)와 Windows 에서 `npm ci`, lock 그래프 대조 스크립트 | Linux 529개·Windows 596개 설치 통과, 풀리지 않는 요구 0건(develop 과 같다). Windows npm 으로 만든 이전 lock 은 Linux 에서 CI 와 같은 `Missing: @emnapi/core@1.11.3` 으로 실패했다 |
| 흔적 | `git grep -i "storybook\|\.stories\|playOutcome\|watchStoryPlay"` (결정·결과·지난 기록 제외) | 코드·설정·CI 에 없음. `playwright.config.ts` 28행 주석의 옛 결정 문서 파일 이름 하나만 남는다 |

## 확인하지 못한 것

- 전체 E2E(`npm run test:e2e`)와 CI 는 PR 에서 확인한다. 로컬에서는 바꾼 spec 만 돌렸다.
- 실서버는 이번 작업과 관계없다(테스트만 바뀌었다).
