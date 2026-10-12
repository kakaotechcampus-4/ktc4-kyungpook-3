# M5 인수인계

- 작성일: 2026-10-06 · 갱신일: 2026-10-07
- 브랜치: `feature/143-m5-meeting-upload-processing-minutes` (기준 커밋 `8beab48`)
- 계획: `m5-meeting-upload-processing-and-minutes.md` · 완료 조건: `m5-done-criteria.md`
- 상태: **U1~U6 PASS, 최종 게이트 F r1 PASS(2026-10-06), 후속 UX1 r4 PASS(2026-10-07, blocker·major 0, minor 2).** F의 minor 3건은 문서 정리로 처리했다. MSW 기준 M5 완료. 실 백엔드 성공 흐름은 미검증이다(§5).

## 1. 지금까지

구현 에이전트(Claude Opus 5.5 high)와 분리된 검증 에이전트(Codex `gpt-6-sol` high → 2026-10-02 U1 r2 도중 용량 부족으로 `gpt-6.1-sol` high)가
단위마다 `m5-done-criteria.md` 로 판정했다(구현 → 검증 → 수정 루프). 둘 다 Orca orchestration 워커로 띄웠다. 검증자는 구현 보고를 근거로 쓰지 않고
명령·되돌림 실험·실제 Chromium 재현을 직접 했다.

| 단위 | 범위 | 회차 | 판정 |
|---|---|---|---|
| U1·U2 | 계약·데이터 기반(엔티티 API·Query 옵션·업로드 진행 콜백·라우트) + MSW 수직 흐름(정리 전이·시나리오) | 3 | r1 FAIL(G8) → r2 FAIL(G8, E2E 간헐) → **r3 PASS** |
| U3 | 업로드·Notion 연결(파일 폼·진입 가드·설정 Notion 영역·OAuth 복귀) | 2 | r1 FAIL(major 2) → **r2 PASS** |
| U4 | 처리 추적(앱 수준 polling·처리 화면·헤더 `정리 중`·전역 토스트) | 5 | r1~r4 FAIL(major 2·1·2·1) → 사용자 결정 → **r5 PASS**(minor 1 이월) |
| U5 | 회의록(목록·상세·권한 분기) | 1 | **r1 PASS** |
| U6 | Storybook·E2E·CI·문서 | 2 | r1 FAIL(major 2·minor 2) → **r2 PASS**(blocker·major·minor 0) |
| F | 최종 게이트(F1~F4, G1~G8·U1~U6 기준 재검증) | 1 | **r1 PASS**(minor 3, 아래 §3) |
| UX1 | 첫 진입 스켈레톤 위치·빠른 회의 선택 깜빡임·긴 제목·참석자 줄·시간 검사 | 4 | r1~r3 수정 후 **r4 PASS**(blocker·major 0, minor 2, 아래 §5) |

U2 는 U1 과 한 지시로 묶어 같은 회차에서 판정했다.

**최종 게이트 F r1 (2026-10-06).** 검증자가 `npm ci` 뒤 G1 8개 명령(typecheck·lint·format:check·test·build·build-storybook·test:e2e·test:storybook)을 하나씩 따로 돌려 모두 통과했다.
Vitest 129파일·1,257건을 2회 연속, E2E 45건(M4 29 + M5 16), Storybook 검사 44건. 실제 Chromium 에서 핵심 흐름 넷(PM 업로드 → 정리 → 완료 토스트 → 회의록, 일반 실패 토스트, 일반 팀원 업로드 차단·승인 비노출, Notion 끊김 → 재연결 → 업로드 복귀)을 따로 확인했고,
계획 §5 항목 ↔ 테스트 대응표(F3)를 만들어 미대응 항목이 없었다. F4 — `dist/` 에 M5 MSW 시나리오·픽스처·앱 등록 코드가 없고 `backend/`·`ai/` 변경 0.
`dist/mockServiceWorker.js` 는 들어 있지만 M4 인수인계 #14 결정(프로덕션 산출물에 포함, 앱 번들 등록 코드 없음)대로라 결함으로 세지 않았다.

**후속 UX1 r4 (2026-10-07).** 독립 검증에서 8종 명령을 순차 실행해 모두 통과했다. Vitest 135파일·1,313건은 5회 연속 통과했고, E2E 63건·Storybook 54건도 통과했다. G1~G8·U1~U6 및 M4 회귀를 재확인했다. 이 검증에서 `npm ci`를 다시 실행한 것은 아니며, 깨끗한 설치 검증은 위 F r1 기록과 구분한다.

첫 진입의 가드·라우트·데이터 로딩은 공통 2단 스켈레톤을 사용한다. 빠른 회의 선택은 이전 본문을 최대 250ms 유지하며 새 회의 머리를 즉시 표시한다. 스켈레톤을 이미 표시했으면 최소 300ms 유지해 경계 응답의 번쩍임을 줄인다. 이때 251~549ms 응답은 최대 약 300ms 늦게 표시될 수 있다. 긴 제목은 한 줄 말줄임과 키보드 툴팁, 참석자는 한 줄 칩과 `+N` 팝오버로 전체 내용을 확인한다. 결정·검증 대응은 [회의록 스켈레톤과 선택](basis-for-decision/2026-10-06-minutes-skeleton-and-selection.md)에 기록했다.

PR 준비 검토에서 UX1 r4 종료 시점의 제품·문서·설정 636개 파일 해시와 현재 파일이 모두 같음을 확인했다. 타입·린트·포맷·앱 빌드를 직접 다시 실행해 통과했고, 프로덕션 앱 번들에서 MSW 시나리오·등록 코드가 검색되지 않았다. 전체 테스트 수치는 위 독립 검증 기록에 근거한다. 상세 로컬 보고서 `.orca-loop/ux1-r4-verify.md`와 증거는 커밋하지 않는다.

**develop 병합 후 PR 검증 (2026-10-07).** 최신 develop `127e43a`를 충돌 없이 병합하고 `npm ci` 뒤 8종 명령을 순차 실행해 모두 통과했다. Vitest 135파일·1,316건(develop의 팀원 매핑 복구 테스트 3건 추가), E2E 63건, Storybook 54건이다. 병합 직후 팀원 매핑 파일 두 개의 줄바꿈이 포맷 검사에 걸려 Prettier로 맞췄으며 Git 기준 코드 내용 차이는 없다. 프로덕션 산출물에서 M5 MSW 시나리오·앱 등록 코드 검색 0건, develop 대비 `backend/`·`ai/` 변경 0건이다. 로컬 로그는 `.orca-loop/pr-gate-*.log`에 두고 커밋하지 않는다.

## 2. 사용자·코디네이터 결정

| 언제 | 누가 | 결정 | 기록 |
|---|---|---|---|
| U1 r3 (2026-10-02) | 사용자 승인(코디네이터 A안) | E2E·Storybook Playwright trace 를 `retain-on-failure` → `on-first-retry`. 통과할 테스트까지 기록하던 비용이 context 정리 30초 슬롯을 넘겼다 | `impl-decision/2026-09-29-storybook-e2e-setup.md` 2026-10-02 절 |
| U4 r1 (2026-10-03) | 코디네이터 결정 A ① | M4 테스트의 「업무 API 0회」 단언 도우미 `businessRequests` 가 앱 수준 추적기의 두 요청(지금 URL 공간의 회의 목록, 정리 중 회의 상세)만 뺀다. 새 테스트는 `trackerRequests` 로 따로 정확히 단언 | `shared/test/requests.ts` 주석 |
| U4 r1 | 코디네이터 결정 A ② | M4 E2E 헤더 두 곳(`layout`·`select-switch`)의 기대값을 `정리 중` 링크 포함으로 정확히 고침 | 각 E2E 주석 |
| U4 r5 (2026-10-05) | 사용자 결정(판정 규칙 4) | 4회차 미통과 뒤 「연동 상태 캐시 쓰기 경로를 공유 Query 하나로 단일화」하는 5회차 | `impl-decision/2026-10-03-processing-tracker.md` 개정 절 |
| U6 r1 (2026-10-06) | 코디네이터 승인 A | 공통 `Modal` 이 닫히면 연 요소로 포커스를 돌린다(Trigger 없는 모달에서 `body` 로 떨어졌다) | `impl-decision/2026-10-06-modal-focus-return.md` |

## 3. 주요 결함과 해결

등급 표기는 검증 보고서 그대로다. ID 는 단위마다 새로 센다.

| 단위·회차 | ID | 내용 | 해결 |
|---|---|---|---|
| U1 r1 | G8 | `MOCK_DB_VERSION` 1→2(회의 흐름 칸 추가)인데 M4 복원 E2E 두 곳이 `version: 1` 기대 | 기대값을 2로, 버전 출처 주석 |
| U1 r2 | G8(minor) | 전체 E2E 에서 `restore.e2e.ts:10` 이 `Tearing down "context" exceeded` 로 간헐 실패 | 원인은 trace 마무리 비용 → `on-first-retry`(위 결정) |
| U3 r1 | M01 major | 202 뒤에도 원본 `File` 이 Mutation 캐시 `variables` 에 남음(U3-9) | 원본 `File` 을 mutation 변수에 넣지 않고 ref 로 넘긴다 — 넣지 않으면 지울 곳이 없다 |
| U3 r1 | M02 major | OAuth 복귀 재조회가 늦게 끝나면 사용자가 떠난 화면을 업로드로 끌고 가 미저장 입력을 잃음 | 복귀 확인이 끝난 뒤 지금 경로·미저장 입력·열린 확인을 보고 이동. M01·M02 회귀 테스트 6건(되돌리면 실패) |
| U4 r1 | M01 major | 완료·실패의 자동 이동이 사용자의 탭 이동(지연 로드 중)을 덮어씀 | 그려진 경로와 기록 경로 둘 다 처리 화면일 때만 이동 |
| U4 r1 | M02 major | 로그아웃 뒤 이전 세션 회의의 실패 토스트가 뜸 | 세션 포착(`captureSession`) 뒤 알림·모달·이동 |
| U4 r2 | M03 major | 설정을 떠나 연동 조회가 취소되면 Notion 끊김 실패를 일반 실패로 오판 | r3: 마지막 구독 이탈로 취소된 공유 조회가 이전 캐시 값을 돌려주는 함정 — 판정을 직접 요청(`fetchLatest`)으로. 이것이 M04·M05 를 낳았다 |
| U4 r3 | M04 major | 이전 세션의 늦은 401 이 재로그인한 새 세션을 만료시킴 | r4: 요청 세대(세션)를 `request` 가 알고 끝난 세션의 401 알림을 거른다 + 세션 신호로 취소 |
| U4 r3 | M05 major | 이전 공유 조회가 최신 `revoked` 캐시를 `connected` 로 덮어 재연결 버튼이 사라짐 | r4: 직접 요청의 출발 순서 조건과 오래된 공유 조회 취소 → M06 |
| U4 r4 | M06 major | 나중에 출발한 공유 조회가 먼저 끝나면 오래된 직접 응답이 최신 `revoked` 를 다시 덮음 | 5회차: 캐시 쓰기를 공유 Query 하나로 단일화(사용자 결정) |
| U4 r5 | N02 minor | `select-switch.e2e.ts` 키보드 Tab 순서가 비동기 `정리 중` 링크를 기다리지 않아 간헐 실패 | U5 에서 링크 visible 대기 |
| U6 r1 | M01 major | `test:storybook` 이 렌더 단계 `finished` 만 보고 깨진 play 를 통과로 판정. Storybook 기본 `throwPlayFunctionExceptions: false` 는 play 예외를 채널·console 로만 알리고 `finished` 까지 간다 | r2: `.storybook/playOutcome.ts` 가 play·렌더 오류 채널 이벤트를 iframe 에 남기고 `stories.sb.ts` 가 오류 0건을 단언. 단언 하나를 깨면 명령이 exit 1 |
| U6 r1 | M02 major | 원본 스토리 5개의 play 가 실제로 실패 중이었다(M01 에 가려짐) — 드래그 중·처리 단계 1/2/3·PM 추출된 일 | r2: 상태 갱신·로딩을 기다리고(`waitFor`·제목 `findBy*`) 영역 제목을 역할·이름으로 좁힘. 단언 삭제·완화 없음 |
| U6 r1 | N01·N02 minor | 이 문서의 회귀 테스트 파일명(`fetchLatest.test.ts`), `msw-guide.md` 의 OAuth 설명이 MSW 모의 OAuth 와 모순 | r2: 문구 수정 |
| F r1 | N01 minor | 이 문서의 상태·U6 이력·남은 것이 「U6 r2 검증 대기」로 남아 있었다 | 문서 정리: U6 r2·F PASS 반영 |
| F r1 | N02 minor | 계획 §5 의 M4 회귀를 「무수정 통과」로 적었지만 사유를 단 기대값 갱신이 넷 있었다(MSW 저장 버전 1→2, 회의 자리표시자→회의록, 지연 로드 13→15, 헤더 `정리 중`) | 문서 정리: 계획 §5 「완료 판정」 표를 정확히 고침 |
| F r1 | N03 minor | `impl-decision/2026-10-02-meeting-upload-screen.md`·`meetingQueries.ts` 주석이 Notion 복귀·응답 유실 복구를 r5 전 방식(직접 요청 → `setQueryData`)으로 설명 | 문서 정리: 그 결정 문서에 2026-10-06 개정 절, 주석을 `fetchFresh` 공유 Query 판정으로. 코드 동작 변경 없음 |

U4 의 M01~M06 은 모두 「늦게 도착한 응답이 그 사이 바뀐 상태(경로·세션·캐시)를 덮는다」는 한 갈래다. 재현 절차와 되돌림 실험은 루프 보고서에 있고,
회귀 테스트는 `app/lateAsyncRaces.test.tsx`·`shared/api/fetchFresh.test.ts`(r5 에서 `fetchLatest` 를 공유 Query 판정 `fetchFresh` 로 바꿨다)·`app/meetingMinutesRaces.test.tsx` 에 모였다.

## 4. U6 에서 한 것

| 기준 | 위치 |
|---|---|
| U6-1 Storybook | `M5 회의/` — 올리기(`features/meeting-upload/ui/MeetingUploadForm.stories.tsx`), 처리(`pages/meeting-processing/ui/MeetingProcessingPage.stories.tsx`), 회의록(`widgets/meeting-minutes/ui/MeetingMinutes.stories.tsx`), Notion 차단 모달·설정 Notion 영역(`features/notion-connection/ui/*.stories.tsx`), 정리 알림(`features/meeting-processing/ui/ProcessingNotices.stories.tsx`). 헤더 `정리 중` 은 `M4 메뉴/앱 셸/헤더 정리 중`. `e2e/storybook/stories.sb.ts` 가 M5 스토리마다 play 가 오류 없이 끝나는지 본다 — 렌더 단계가 아니라 `.storybook/playOutcome.ts` 가 모은 play·렌더 오류로 판정한다(U6 r2, 단언을 깨면 exit 1 확인) |
| U6-2 E2E | `e2e/meeting-flow.e2e.ts` ①~④, 픽스처 `e2e/fixtures/short-meeting.wav`(1초 · 8 kHz · 8비트 모노 PCM, 8,044바이트) |
| U6-3 레이아웃·키보드 | `e2e/meeting-layout.e2e.ts`(1024·1440·1920 × 올리기·처리·회의록), `e2e/meeting-keyboard.e2e.ts`(파일·참석자·이탈 확인 모달·Notion 차단 모달) |
| U6-4 CI | 워크플로 변경 없음. 업로드 조건 점검 기록 — `impl-decision/2026-09-29-storybook-e2e-setup.md` 2026-10-06 절 |
| U6-5 문서 | 계획 §5 「완료 판정」, 이 문서, `msw-guide.md` 「회의 정리 흐름 (M5)」 |

제품 코드 변경은 `shared/ui/modal/Modal.tsx`(포커스 복귀) 하나다.

## 5. 남은 것

- **UX1-N01 minor(알려진 유지).** 인증·온보딩·비회원 여부를 기다리는 동안 회의록 셸 스켈레톤이 잠깐 보일 수 있다. 최종 화면에서는 사라진다. 후속 공통 로딩 외형 개선 후보다.
- **UX1-N04 minor.** `shared/ui/tooltip/Tooltip.tsx`의 주석은 아래쪽을 설명하지만 실제 기본 방향은 위쪽이다. 전체 제목 접근 동작은 통과했고 주석 정리는 후속으로 남긴다.
- **실 백엔드.** M5 기준 커밋에서는 파일 저장·큐·업로드 PM 권한 강제·STT·Notion 반영(OAuth `start`·`callback` 포함)·참석자 저장이 미완료였다. 2026-10-07 PR 준비 중 최신 develop(`127e43a`)을 병합한 뒤 업로드의 `get_current_pm`과 Notion OAuth `start`·`callback` 구현이 추가된 것을 코드로 확인했다. 업로드의 파일 저장·큐 전송 TODO는 남아 있고, 실 API 성공 흐름은 검증하지 않았다. 계획 §5와 계약의 과거 현황은 M5 기준 커밋 당시 기록이며 현재 develop의 모든 백엔드 상태를 나타내지 않는다.
- **알려진 동작(U4 r5).** 창 포커스 재조회는 진행 중인 판정 조회 하나로 합쳐진다. 그 사이 서버가 바뀌었으면 다음 조회(무효화·다음 포커스)에서야 반영된다. `impl-decision/2026-10-03-processing-tracker.md` 에 기록.
- **후속 후보(M4 범위라 미변경).** M4 온보딩·인증의 `fetchQuery`·직접 요청·`setQueryData` 판정 지점은 U4 r5 의 「공유 Query 하나로 쓰기」 원칙 밖이다. 같은 갈래의 늦은 응답 경합이 있는지 리팩토링 때 본다.
- **trace.** 로컬 실패에는 trace 가 없다(retries 0) — `npx playwright test <파일> --trace on` 으로 다시 돌린다. CI 는 두 번 다 실패한 테스트의 재시도 trace 만 올리고, 재시도로 통과한 flaky 는 아티팩트가 없다. 리눅스 러너의 기록 비용은 재지 않았다.
- **회의록 목록의 확인 필요 개수 배지**(캔버스)는 회의마다 추출을 불러야 해 뺐다 — `impl-decision/2026-10-06-minutes-screen.md` 「다시 고민할 때」.

## 6. 환경 메모

- **Codex 워커.** `gpt-6-sol` 은 Codex CLI 0.159 이상이 필요하다. 0.153.2 는 ChatGPT 계정에서 400 으로 거부하고 워커가 `worker_done` 없이 멈췄다(0.160.0 으로 해결).
- **Orca 안 `CODEX_HOME`.** Orca 터미널에서는 `CODEX_HOME` 이 `%APPDATA%\orca\codex-runtime-home\home` 이다. 설치 스크립트를 그대로 돌리면 Orca 사본만 올라간다 — 본체는 `CODEX_HOME=%USERPROFILE%\.codex`, `CODEX_NON_INTERACTIVE=1` 로 올린다.
- **Codex 모델 교체.** 2026-10-02 U1 r2 도중 `gpt-6-sol` 이 용량 부족으로 막혀 검증 워커를 `gpt-6.1-sol` high 로 바꿨다(§1).
- **멈춘 워커.** 네트워크가 끊겼다 다시 붙은 뒤 워커가 출력 없이 멈춘 적이 있다. 결과물은 디스크에 남으므로 새 워커가 이어받는다 — 처음부터 다시 만들지 않는다.
- **백신(AhnLab V3).** U6 에서 V3 실시간 검사가 Claude 워커의 자식 프로세스(`git.exe`, Orca statusLine 의 `bash.exe`)를 `Suspended` 상태로 붙잡아 두 워커가 멈췄다. 그 프로세스는 종료도 거부했다. V3 실시간 검사를 끈 뒤 새 워커를 띄워 이어 갔다. 워커가 출력 없이 멈추면 작업 관리자에서 자식 프로세스 상태부터 본다.
- **동시 실행.** Vitest 전체(약 1,250건)는 E2E·Storybook 빌드·다른 워커와 함께 돌면 RTL 대기 한도를 넘겨 간헐 실패한다. 게이트 명령은 하나씩 따로 돌린다. 띄운 개발 서버·Storybook 서버는 끝나기 전에 끈다(남은 vite 가 E2E 포트·`npm ci` 를 막은 적이 있다).
- **Windows 줄 끝.** `core.autocrlf=true` 체크아웃이라 `git status` 에 내용 변경 없는 ` M` 이 많다(M4 와 같다). 커밋 전 `git diff --cached --stat` 으로 확인한다.
- 루프 운영 파일(단위별 지시·구현/검증 보고·이월 목록)은 로컬 `.orca-loop/` 에만 있고 커밋하지 않는다. 필요한 내용은 이 문서에 옮겼다.
