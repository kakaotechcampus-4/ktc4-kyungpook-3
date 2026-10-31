# M8-C 구현 결과 — 메시지 (결정 전 부분)

- 기록일: 2026-10-31
- 이슈: #245
- 대상: [M8 계획](plan.md) C 절의 구현 순서 1~6(결정 전)과 최종 게이트
- 상태: **AC-01~AC-07 충족(프론트·MSW 기준, UI/UX만).** 메시지 API가 없어 화면은 MSW 모드에서만 보이고, 실 API 모드와 production은 기존 「메시지는 준비 중이에요」 안내를 그대로 둔다. 구현 순서 7~10(발송 검토 흐름, 권한 분기, 상태 전이와 동기화, 메시지 E2E 고정)은 결정 4 대기라 구현하지 않았다. 전체 Vitest는 기본 설정(`npm run test`)으로는 한 번에 통과하지 못했고 `npm run test -- --maxWorkers=2`로 exit 0을 얻었다(아래 「검증 내역」). 전체 `test:e2e`는 실행하지 않았다. 실제 메시지 API 연동과 Discord 발송은 범위 밖이며 검증하지 않았다.

## 작업 근거와 요약

코디네이터 지시에 따라 계획 C-6의 결정 전 단계 1~6을 구현했다. 브랜치 `feature/245-m8-messages`, 기준 `develop`(`ff9467e`) 위 커밋 8개다. push·PR은 하지 않았다.

계획 파일 [plan.md](plan.md)는 이 브랜치에서 **커밋되지 않은 작업 트리 변경**으로만 있다(커밋된 파일은 0바이트). 구현·검증·이 문서 작업 모두 계획 파일을 수정하지 않았다. 최종 게이트 검증의 시작·종료 SHA256은 `c054a4f6…cd4194`로 같았고, 이 문서 작업의 시작 시점 값도 같다.

| 커밋 | 단계 | 요지 |
|---|---|---|
| `277f09f` | 1 | `MessagesPage` 모드 분기(`import.meta.env.DEV && config.mswEnabled`), `messages/*` 아래 하위 경로(index · `threads/:threadId` · `*`), 경로 함수 `paths.messageReview`·`paths.messageThread`와 `MESSAGE_PARAMS`(임시·계약 아님 주석) |
| `7c97fa1` | 2 | 임시 DTO, `entities/message`(타입·매퍼·Query, key에 `workspaceId`), 픽스처·조회 handler 2개·메모리 DB 칸 3개·시나리오 4개, 모의 DB 저장 버전 2→3, MSW 안내 문장 갱신 |
| `e8f99f6` | 3 | `widgets/message-inbox`: 2단 레이아웃, 목록 두 영역(`보내기 전 확인 N`, `대화`·`답장 기다리는 중 N`, 채널), 검토 항목 읽기 전용 미리보기, URL 선택 |
| `16676c1` | 4 | 대화: 날짜 구분선(오늘 표시), 봇·상대 말풍선, 시각, 답장 대기 배지·안내 |
| `8c5b665` | 5 | 빈 상태(`EmptyMessages`), 목록·대화·검토 스켈레톤, 목록 오류와 대화 오류 분리, 없는 대화·잘못된 경로 안내 |
| `351a70e` | 6 | 목록·대화 각자 스크롤, 대화 칸 키보드 Tab 자리, AC-07 테스트, Storybook 스토리 8개 |
| `765e37a` | 회귀 | `e2e/restore.e2e.ts`의 저장 버전 기대값 2→3 |
| `58237a8` | 리뷰 수정 | 첫 메시지 시각을 읽을 수 없으면 날짜 구분선 없이 묶는다(V2-01) |

## 실제 구현 및 관련 코드

- **모드 분기** — [MessagesPage](../../../src/pages/messages/ui/MessagesPage.tsx)는 개발 서버 + MSW일 때만 새 화면을, 그 밖에는 기존 준비 중 안내를 그린다. `DEV`를 먼저 봐서 번들러가 새 화면 코드를 production 번들에서 지우게 했다. [기록](basis-for-decision/2026-10-31-messages-screen-msw-mode-only.md).
- **URL 선택** — 사람별 대화는 경로 `messages/threads/:threadId`, 보내기 전 확인 항목은 검색 파라미터 `messages?review=<id>`로 고른다([경로 함수](../../../src/shared/config/routes.ts)). URL 값은 페이지 경계에서 `parseRouteId`로 한 번 검증한다(D-132). 목록에 없는 id·모양이 틀린 id는 선택 없음으로 처리한다. [기록](basis-for-decision/2026-10-31-message-review-selection-search-param.md).
- **임시 엔티티** — [entities/message](../../../src/entities/message): 도메인 타입, DTO→도메인 [매퍼](../../../src/entities/message/model/mapper.ts), 조회 [Query](../../../src/entities/message/api/messageQueries.ts)(key에 `workspaceId`, AbortSignal 전달). 조회만 있고 발송·반려 요청은 없다. 답장 대기는 사람별 DM에서 봇이 마지막으로 보냈으면 대기로 본다. 며칠째인지는 세지 않는다. DTO는 [shared/types/api/message.ts](../../../src/shared/types/api/message.ts)에 있고 화면 계층은 DTO를 import하지 않는다.
- **MSW** — [handler](../../../src/shared/mock/handlers/message.ts)는 `GET /api/v1/workspaces/:workspaceId/messages`와 `GET /api/v1/workspaces/:workspaceId/messages/threads/:threadId` 두 개다. 공간 ID로 걸러 다른 공간의 대화는 404다. 없는 대화의 오류 코드 `MESSAGE_THREAD_NOT_FOUND`도 임시이며 화면은 상태 404만 본다. [픽스처](../../../src/shared/mock/fixtures/message.ts), [메모리 DB](../../../src/shared/mock/db.ts)의 `messageReviews`·`messageThreads`·`messageFailures`, 시나리오 `messages-default`·`messages-empty`·`messages-list-error`·`messages-thread-error`([scenarios.ts](../../../src/shared/mock/scenarios.ts)). MockDb 모양이 바뀌어 [persistence.ts](../../../src/shared/mock/persistence.ts)의 `MOCK_DB_VERSION`을 2→3으로 올렸다(파일 규칙 「MockDb 모양을 바꾸면 버전을 올린다」).
- **화면** — [widgets/message-inbox](../../../src/widgets/message-inbox): [MessageInbox](../../../src/widgets/message-inbox/ui/MessageInbox.tsx)(2단·목록·빈 상태·목록 오류), [ThreadDetail](../../../src/widgets/message-inbox/ui/ThreadDetail.tsx)(대화·대화 오류·404), [ReviewPreview](../../../src/widgets/message-inbox/ui/ReviewPreview.tsx)(읽기 전용), [MessageSkeletons](../../../src/widgets/message-inbox/ui/MessageSkeletons.tsx), 날짜·시각 [format.ts](../../../src/widgets/message-inbox/lib/format.ts). 목록 Query와 대화 Query는 서로 기다리지 않는다.
- **스크롤 칸** — 목록과 대화가 각자 세로로 스크롤한다. 구현 중 첫 측정에서 문서 높이가 5955px로 늘어 페이지가 세로로 스크롤되는 것을 발견했다. 말풍선·행의 `sr-only`(absolute) 글자가 스크롤 칸 밖으로 새어 나간 것이라 스크롤 칸을 `relative`로 고쳤다(`351a70e`).
- **스토리** — [MessageInbox.stories.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.stories.tsx): 기본, 검토 항목, 대화, 빈 상태, 로딩, 목록 오류, 대화 오류, 긴 대화.
- **테스트** — MSW 모드 통합 테스트 [messagesMsw.test.tsx](../../../src/app/messagesMsw.test.tsx)(테스트 파일 안에서만 `config.mswEnabled`를 바꾼다), handler [messageScenarios.test.ts](../../../src/shared/mock/messageScenarios.test.ts), [mapper.test.ts](../../../src/entities/message/model/mapper.test.ts), [format.test.ts](../../../src/widgets/message-inbox/lib/format.test.ts). 로딩은 시나리오가 아니라 응답을 붙잡아(deferred) 재현한다.

임시 도메인 타입, DTO, MSW 경로, 오류 코드, 화면 하위 경로와 `review` 파라미터는 **계약이 아니다.** 코드의 각 파일 머리말에 임시라고 적었고 [대표 계약](../../contracts/frontend-api-contract.md) §5.7(「1차에서 화면을 만들지 않는다(D-171)」)은 고치지 않았다.

## 완료조건 확인

| 계획의 ID | 상태 | 근거 |
|---|---|---|
| AC-01 | 충족 | 기존 [라우트](../../../src/app/router/routes.test.tsx)·[가드](../../../src/app/router/guards.test.tsx)(`messages/threads/1`에서 준비 중 문구와 업무 요청 0건)·[앱 셸](../../../src/app/appShell.test.tsx) 테스트는 수정 없이 V3 전체 Vitest에서 통과했다. 새 build의 `dist/assets/*.js` 57개에서 메시지 표식 17종(`rv_01`, `th_01`, `mg_01`, `messageReviews`, `messageThreads`, `messageFailures`, `이재환`, `API 명세서 진행 상황`, `messages-default`, `MESSAGE_THREAD_NOT_FOUND`, `보낼 메시지가 없어요`, `이 메시지, 보낼까요`, `답장 기다리는 중`, `여기서부터 답장을 기다리고 있어요`, `대화를 찾을 수 없어요`, `mockServiceWorker`, `setupWorker`)을 `rg`로 검색해 모두 0건이고, `메시지는 준비 중이에요`는 1개 청크에 남았다. 계획의 「`msw` 0건」은 글자 그대로는 맞지 않는다 — `msw` 부분 문자열 8곳(4개 청크)이 있으나 모두 기존 승인 전송 리터럴 `'msw'`와 설정 필드 `mswEnabled`이고 대응 소스의 develop 대비 변경은 0이다. MSW 런타임 표식은 0건이다. `/messages/threads` 1건은 공용 경로 함수 `paths.messageThread` 문자열이다. production 브라우저 확인은 하지 않았다 |
| AC-02 | 충족 (MSW) | 통합 테스트 AC-02 묶음: 목록 두 영역 순서, 검토 고르기 → `?review=rv_01`·`aria-current`·미리보기, 주소로 바로 진입, 없는 id `rv_99`·틀린 id `a/b`는 선택 없음(alert 없음), 대화 고르면 검토 현재 표시 해제. 스토리 기본·검토 항목·대화. 뒤로가기(POP) 자체를 실행하는 전용 테스트는 없다 — 선택은 URL에서 바로 파생하고 따로 저장하는 상태가 없다(V2) |
| AC-03 | 충족 (MSW) | 통합 테스트 AC-03 묶음(봇이 마지막인 DM의 답장 대기, 답한 DM·채널은 대기 없음, 오늘 구분선), [format.test.ts](../../../src/widgets/message-inbox/lib/format.test.ts)(서울 시간 날짜 묶기, 첫 메시지 시각 불명 — `58237a8`), [mapper.test.ts](../../../src/entities/message/model/mapper.test.ts)(대기 규칙). 스토리 대화·긴 대화 |
| AC-04 | 충족 (MSW) | 통합 테스트 AC-04 묶음: 빈 상태·한 영역만 빔, 목록·검토·대화 로딩(응답 붙잡기), 목록 오류 중 대화 표시와 다시 시도 성공, 대화 오류 중 목록 선택, 없는 대화·다른 공간 대화·틀린 ID·없는 하위 경로. [messageScenarios.test.ts](../../../src/shared/mock/messageScenarios.test.ts). 스토리 빈 상태·로딩·목록 오류·대화 오류 |
| AC-05 | 충족 (MSW) | 통합 테스트 AC-05 묶음: `ws_02` 응답을 붙잡은 전환 구간에 이전 공간 행이 없고 새 공간 1건만 보임, 이전 공간 대화 ID는 새 공간에서 404 |
| AC-06 | 충족 (MSW 개발 서버, 임시 스크립트) | 아래 「AC-06 세 너비 측정」. 1024/1440/1920px의 12개 상태 모두 가로 넘침 0px, 목록·대화가 각자 스크롤하고 페이지는 움직이지 않음 |
| AC-07 | 충족 (MSW) | 통합 테스트 AC-07 묶음(영역 이름·제목, Tab→Enter로 검토·대화 선택 후 `aria-current`, 대화 칸 Tab 도달, 답장 대기 글자 표현). 세 너비 실제 키보드 확인은 아래 「AC-07 키보드 확인」 |

### AC-06 세 너비 측정

최종 게이트 검증(V3)이 Chromium headless(locale `ko-KR`, timezone `Asia/Seoul`, 높이 900px)로 `VITE_ENABLE_MSW=true` Vite 개발 서버에서 측정했다. 저장소에 남기지 않은 임시 Playwright 스크립트(`frontend/test-results/v3-visual.mjs`, 실행 뒤 삭제)다. 상태는 ① `messages-default` 목록 ② `?review=rv_01` ③ `/messages/threads/th_01` ④ 긴 대화(`th_02`)다. ④는 그 브라우저 컨텍스트의 `sessionStorage`에만 메시지 30개를 더하고 검토·대화를 각각 30개 복제해(검토 32, 대화 35) 목록도 넘치게 했다. 저장소의 픽스처·handler는 바꾸지 않았다.

| 너비 | 네 상태의 문서 `scrollWidth / clientWidth` | 네 상태의 문서 `scrollHeight / clientHeight` |
|---:|---|---|
| 1024 | 모두 1024 / 1024 | 모두 900 / 900 |
| 1440 | 모두 1440 / 1440 | 모두 900 / 900 |
| 1920 | 모두 1920 / 1920 | 모두 900 / 900 |

독립 스크롤(세 너비 같은 값):

| 대상 | scrollHeight | clientHeight | 조작과 결과 |
|---|---:|---:|---|
| 목록 aside | 5043 | 824 | scrollTop `0 → 120`, 대화는 `2974` 유지 |
| 대화 section | 3722 | 748 | scrollTop `2974 → 0`, 목록은 `120` 유지 |
| 페이지 | 900 | 900 | 위 조작 전후 `window.scrollY` `0` 유지 |

긴 대화를 열면 대화는 최신 메시지 위치(scrollTop 2974)로 간다. 검증자는 세 너비 × 네 상태 스크린샷 12장을 직접 열어 겹침·가로 잘림이 없고 목록의 긴 미리보기가 의도한 말줄임으로 보임을 확인했다. 구현 중에도 같은 방식의 임시 스크립트로 세 너비를 측정해 통과했다(목록 22행·대화 42건).

### AC-07 키보드 확인

같은 V3 실행에서 세 너비 모두 실제 `Tab`·`Enter`로 검토 링크 선택(`?review=rv_01`) → 대화 링크 선택(`/messages/threads/th_01`) → `aria-label="대화 내용"` section 포커스를 확인했다.

- 두 선택 모두 현재 항목의 `aria-current="page"`가 있고 목록 안의 현재 항목은 매번 1개였다.
- 검토 링크·대화 링크·대화 section 모두 `:focus-visible`이 true이고 outline은 `solid 2px rgb(23, 23, 23)`이었다. 스크린샷에서 포커스 선이 보임을 직접 확인했다.
- 긴 대화에서 PageDown 뒤 대화 scrollTop의 첫 양수 관측값은 1024px 22, 1440px 49, 1920px 20이고 목록은 120을 유지했다(최종 이동량이 아닌 첫 관측값).
- 이름 있는 목록·상세 영역, 날짜, 봇·상대 구분 글자, `답장 기다리는 중`과 대화 안 답장 대기 문장을 확인했다. pageerror 0건.

## 검증 내역

### 최종 게이트 (V3, 2026-10-31, Node v24.11.0)

HEAD `58237a8`, `frontend/`에서 순차 실행했다. 무거운 명령은 다른 워크트리와 겹치지 않게 직렬화 래퍼(Git Bash) 안에서 돌렸다. 기존 `node_modules`가 있어 `npm ci`는 생략했다.

| 명령 | exit | 결과 |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm run format:check` | 0 | |
| `npm run test -- --maxWorkers=2` | 0 | 163 files / 1849 tests 통과, 831.28s |
| `npm run build` | 0 | 새 JS 57개, 번들 검색은 AC-01 |
| `npm run test:storybook` (`STORYBOOK_E2E_PORT=6213`) | 0 | Storybook build 후 104 통과 |
| `node test-results/v3-visual.mjs` (`E2E_PORT=5213`, 임시) | 0 | AC-06·AC-07 측정·단언 통과 |
| `git diff --check develop...HEAD` | 0 | 출력 없음 |

### 전체 Vitest를 기본 설정으로는 한 번에 통과하지 못한 사실

이 기계에서 기본 설정(`npm run test`, 테스트 한도 5초, 기본 워커 수)의 전체 Vitest는 병렬 부하로 메시지와 무관한 테스트가 타임아웃해 한 번에 통과하지 못했다. 시간 한도·단언·설정은 바꾸지 않았고, 워커 수만 줄인 `npm run test -- --maxWorkers=2`로 위 exit 0을 얻었다. **기본 설정의 전체 실행이 통과한 기록은 없다.** 실패한 파일을 단독으로 다시 돌려 통과한 것을 전체 통과로 보지 않는다.

| 실행 | 설정 | 결과 |
|---|---|---|
| 구현 1차 전체 | `npm run test` | exit 1, 127 실패 / 1848(90건 5초 타임아웃, Button·Popover 등 무관한 스위트 포함) |
| 구현 2차 전체 | `npm run test` | exit 1, 58 실패 / 1848, 26개 파일 |
| 구현 3차 전체 | `npm run test`, 직렬화 래퍼 | exit 1, 17 실패 / 1848, 10개 파일 → 그 10개 파일만 `--maxWorkers=2`로 재실행 204건 통과 |
| V1 전체 (HEAD `765e37a`) | `npm run test`, 직렬화 래퍼 | exit 1, 24 실패 / 1848, 12개 파일(시간 초과 20, 요소 대기 3, 경로 기록 단언 1) → 12개 파일을 각각 `--maxWorkers=1`로 단독 실행해 244건 모두 통과 |
| V3 전체 (HEAD `58237a8`) | `npm run test -- --maxWorkers=2`, 직렬화 래퍼 | **exit 0**, 1849 통과 |

- 구현 중 `meetingUpload.test.tsx`는 기준 커밋 `ff9467e`에서도 단독 실행 2회 중 1회 3건 실패했다. 기준 커밋에서도 부하 때 흔들리는 테스트다.
- 실패 원인을 메모리 부족 등으로 계측해 확정하지는 않았다. V1은 「병렬 실행 조건에 민감한 실패」로 분류했고 단독 재실행에서 재현된 코드 결함은 없었다.
- 당시 기계 상황(구현 보고): 다른 워크트리 동시 실행, node 프로세스 약 86개, 여유 메모리 6~8GB.
- V1과 V3의 테스트 수 차이(1848 → 1849)는 `58237a8`이 더한 날짜 묶기 사례 1건이다.

### E2E

- 새 E2E 파일은 없다(D-117, 결정 4 이후 고정).
- 구현 중 관련 파일만 돌렸다: `restore.e2e.ts`(저장 버전), `layout.e2e.ts`·`select-switch.e2e.ts`(헤더 `메시지` 탭·공간 전환). 1차 병렬에서 `restore` 2건이 실제 회귀(기대값이 버전 2로 하드코딩)라 `765e37a`로 고쳤다. 2차 병렬에서는 `restore` 2건이 30초 테스트 타임아웃, `layout` 1024px 대시보드 제목 5초 대기가 실패했다. 3차 `restore`+`layout`을 `--workers=1`로 돌려 25 통과 exit 0이었다. `select-switch`는 2차까지 실패 없이 통과했다.
- **전체 `npm run test:e2e`는 실행하지 않았다.** 계획 최종 게이트의 「기존 E2E 회귀」는 위 관련 파일 실행으로만 확인했다.

### Storybook

- `test:storybook` 104건이 통과했고 메시지 스토리 8개가 `storybook-static/index.json`에 등록됐다.
- V3 확인 결과 104건의 play 수집 범위는 기존 M5~M7이다. **메시지 스토리 8개의 play 함수는 이 명령에서 실행되지 않았다.** 구현 보고의 「104 passed, 새 스토리 8개 포함」은 등록을 뜻하며 play 실행 근거가 아니다. 메시지 화면은 전체 Vitest와 위 브라우저 측정으로 확인했다.
- build 중 생성 CSS의 `color: var(...)` 경고 1건은 [M2 기록](../m2/basis-for-decision/2026-09-16-docs-prose-makes-the-build-warn.md)과 같은 기존 경고다.

### 리뷰

- V1(정적·단위 게이트, HEAD `765e37a`): typecheck·lint·format:check·build·AC-01 번들 검사 통과, 기존 테스트 변경의 적절성 확인. 전체 `npm run test` exit 0을 얻지 못해 major 1건으로 FAIL — 위 V3 실행으로 해소.
- V2(읽기 전용 코드 리뷰, HEAD `765e37a`): blocking·major 0건, minor 1건(V2-01)으로 PASS. 범위 위반(7~10단계, polling, 발송, 계약 문서) 없음.
- V3(최종 게이트, HEAD `58237a8`): blocking·major·minor 0건으로 PASS. V2-01 수정 확인.

### 수행하지 않은 검증

- 실제 메시지 API 호출 — API가 없다.
- 실제 Discord 발송과 그 상태 — 범위 밖.
- production 빌드를 브라우저로 띄운 확인 — 번들 문자열 검색으로만 확인했다.
- 메시지 스토리 play 함수 실행, 전체 `test:e2e`.

## 계획 대비 변경

- **검토 항목 선택 표현:** 계획 1단계는 검토 항목의 경로를 결정 4 이후로 미뤘다. 3단계의 「선택은 URL로」를 지키려고 검색 파라미터 `messages?review=<id>`로 임시 표현했다. 구현 워커가 코디네이터에게 물어 승인받은 선택이며 사용자 결정이 아니다. [기록](basis-for-decision/2026-10-31-message-review-selection-search-param.md).
- **모의 DB 저장 버전과 기존 테스트:** 계획에 없던 변경이다. MockDb에 메시지 칸 3개를 더해 `MOCK_DB_VERSION`을 2→3으로 올렸고, 같은 숫자를 기대하던 [taskScenarios.test.ts](../../../src/shared/mock/taskScenarios.test.ts)와 E2E [restore.e2e.ts](../../../e2e/restore.e2e.ts)의 기대값을 3으로 맞췄다. 저장·복원·손상값 폐기 단언은 그대로다(V1 확인).
- **시나리오 독립성 테스트 한도 30초:** [scenarios.test.ts](../../../src/shared/mock/scenarios.test.ts)의 시나리오 간 독립성 검사는 시나리오 수의 제곱만큼 적용·비교한다. 기준 커밋에서도 당시 부하로 5.2초(한도 5초)가 걸려 실패했고, 시나리오 4개와 메시지 데이터가 비교에 더해지면 약 7.5초다. 이 테스트 하나에만 30초 한도를 주었다. 반복·기대값·단언은 그대로이며 다른 테스트의 타임아웃을 가리지 않는다. 실행 시간 한도를 5초에서 30초로 완화한 것은 사실이다(V1 확인).
- **첫 메시지 시각 불명 방어(`58237a8`):** V2 리뷰가 V2-01(minor)로 「첫 메시지의 시각을 읽을 수 없으면 `date: ''` 묶음이 생기고 `dayLabel('')`이 `RangeError: Invalid time value`를 던진다」를 찾았다. 정상 MSW 픽스처에서는 생기지 않는 방어 코드 결함이다. 날짜 없는 묶음을 `null`로 두고 그 묶음은 날짜 구분선을 그리지 않게 고쳤으며 회귀 사례를 더했다. V3가 직전 커밋 함수와 현재 함수를 같은 입력으로 돌려 이전은 `''`·`RangeError`, 현재는 `null`로 새 사례가 실제로 변별함을 확인했다. 미상 날짜에 별도 문구를 쓰지 않은 선택은 [기록](basis-for-decision/2026-10-31-message-unknown-date-no-divider.md).
- **스토리 수:** 계획의 6개(기본, 빈 상태, 로딩, 목록 오류, 대화 오류, 긴 대화)에 검토 항목·대화를 더해 8개다.
- **결정 4 전 임시 표현(최종 아님):**
  - 답장 대기는 시안의 강조색 `답장 3일째 없음` 대신 회색 배지 `답장 기다리는 중`과 대화 안 문장 `여기서부터 답장을 기다리고 있어요`다. 「3일」 계산 방식이 정해지지 않았다(계획 C-3).
  - 목록은 사람별 대화 최근순, 채널은 뒤(시안 순서, handler가 정렬).
  - 검토 행 날짜는 항목이 만들어진 날이다(시안의 `09/17 마감` 대신). 미리보기의 봇 이름은 공간 이름이다.
  - 없는 대화(404)·잘못된 하위 경로는 「대화를 찾을 수 없어요」(다시 시도 없음), 5xx는 다시 시도.
- **만들지 않은 것(계획대로):** 7~10단계, 메시지 E2E, polling, 대표 계약 메시지 절, 헤더 개수 배지, `알림 규칙 보기`·`Discord에서 열기`, 발송 시점·`고쳐 쓰기`·`이대로 발송`·`보내지 않음`·승인·반려 버튼, 대화 하단 「봇이 보냅니다 · 확인하기」 안내.
- **MSW 안내:** 계획 2단계 대상대로 구현 커밋 `7c97fa1`이 [MSW 안내](../../msw-guide.md)의 「메시지 API는 M1 mock 범위 밖」 문장을 임시 조회 경로 안내로 바꿨다. 이 문서 작업에서 메시지 시나리오 4개와 여는 방법을 같은 안내에 더했다.

## 남은 작업과 제한 사항

- **결정 4**(검토 단위, 발송 권한, 스레드 구성, 발송 시점·문구 수정·반려·재발송, 자동 발송 유무) — 구현 순서 7~10이 이 결정을 기다린다.
  - 7 발송 검토 흐름(C-5의 D-137 원칙), 8 권한 분기, 9 상태 전이와 동기화(D-136, polling 여부), 10 메시지 E2E 고정(D-117).
  - 결정 후 완료조건은 AC-08부터 이어서 더한다(계획 C-9).
- **실제 API 연동** — 메시지 API가 생기면 별도 연동 과제다. 계획 C-8대로 `entities/message`의 경로·DTO·매퍼, MSW handler·픽스처, `MessagesPage` 모드 분기와 준비 중 문구에 기대는 테스트 6개, 대표 계약 §5.7을 함께 바꾼다. 실제 서버 응답·Discord 발송은 MSW 결과로 대체할 수 없어 미검증으로 남는다.
- **화면 노출** — production은 계속 준비 중을 보인다. 2026-11-20까지의 시연에서 메시지 화면을 보여야 하는지는 확인이 필요하다(계획 C-10).
- **D-171 개정** — 이번 구현은 2026-10-30 사용자 답변에 따라 엔티티·MSW 픽스처를 만들었다. [D-171](../../decision/frontend-decisions.md)의 「엔티티도 MSW 픽스처도 만들지 않는다」를 결정 기록에서 개정할지는 확인이 필요하다.
- **전체 Vitest 환경** — 이 기계의 기본 설정 전체 실행은 병렬 부하로 무관한 테스트가 타임아웃한다. 게이트 통과는 `--maxWorkers=2` 실행 기준이다. 기본 설정에서 한 번에 통과하게 하는 일(실행 환경·동시성 조정, 부하에 민감한 테스트 정리)은 남아 있다.
- 메시지 스토리 play 함수는 Storybook 회귀에서 수집되지 않는다. 전체 `test:e2e`는 이번에 실행하지 않았다.
- 확인 필요(계획 C-3·C-6): 답장 대기 「3일」 계산 방식, `알림 규칙 보기`·`Discord에서 열기` 목적지.
- 계획 C-11의 「AC-01~AC-07을 이슈에 옮기는 일」은 이 기록 범위 밖이다.

## 관련 기록

- [검토 항목 선택을 검색 파라미터로 임시 표현한 선택](basis-for-decision/2026-10-31-message-review-selection-search-param.md)
- [새 메시지 화면을 MSW 모드에서만 보이는 선택](basis-for-decision/2026-10-31-messages-screen-msw-mode-only.md)
- [시각을 읽을 수 없는 첫 묶음은 날짜 구분선만 생략한 선택](basis-for-decision/2026-10-31-message-unknown-date-no-divider.md)
- [MSW 안내](../../msw-guide.md)의 메시지 절

검증 보고서(구현 보고, V1·V2·V3)와 스크린샷은 저장소 밖 작업 폴더에 있어 링크하지 않는다.

## 마일스톤 안내에 넣을 문장 제안

[마일스톤 안내](../README.md)와 [Frontend README](../../../README.md)는 A(#243)·B(#244)·C(#245) 세 브랜치가 병합된 뒤 한 번에 갱신한다. C 부분의 제안 문장은 다음과 같다. 링크는 넣을 문서 기준 경로를 괄호에 적었다.

- 마일스톤 안내 M8 행의 상태 칸: 「C 메시지(#245): 결정 전 부분(구현 순서 1~6)을 MSW 모드에서만 구현, AC-01~AC-07 프론트·MSW 기준 충족(결과 `m8/result-c.md`). 7~10은 결정 4 대기. 완료 판정 없음」
- Frontend README 상태 문단: 「M8-C 메시지는 계획(`docs/plan/m8/plan.md`) C 절의 결정 전 부분(구현 순서 1~6)을 진행했고 결과(`docs/plan/m8/result-c.md`)에 AC-01~AC-07의 프론트·MSW 기준 충족을 기록했다. 메시지 API가 없어 화면은 MSW 모드에서만 보이고 실 API·production은 준비 중 안내를 유지한다. 전체 Vitest는 Node v24.11.0에서 `--maxWorkers=2`로 통과했으며 기본 설정 전체 실행은 병렬 부하로 통과하지 못했다. 발송 검토·권한·상태 동기화·메시지 E2E는 결정 4 대기, 실제 API 연동은 미검증 과제다.」
