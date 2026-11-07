# 결과 — 스켈레톤 지연·최소 표시 규칙과 화면과 맞지 않는 스켈레톤 정리 (#508)

- 기록일: 2026-11-07
- 대상: [#508](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/508)의 1(지연·최소 표시 규칙)
- 기준: develop `4c632f4a`. 뒤에 develop `333a249c`(#516 — #507 Notion 선택)를 merge 했다. 회의 올리기 화면은 #507 의 진입 판정(Notion 차단 없음) 위에 같은 래퍼를 다시 얹었다.
- 상태: **1을 반영했다.** 2(화면과 맞지 않는 스켈레톤)는 아직이다. 회의 처리 화면과 설정 연결 영역은 다른 작업이 끝난 뒤 적용한다(아래 「적용 대기」).

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #508 과 사용자 결정(2026-11-07)이다. 네트워크가 빠르면 스켈레톤이 한두 프레임 번쩍이며 깜빡였다. 화면마다 `isPending` 이면 바로 스켈레톤을 그렸기 때문이다.

화면 안에서 API 데이터를 기다리는 스켈레톤이 모두 같은 규칙을 따르게 했다.

1. 로딩 시작 ~ 200ms: 스켈레톤 없이 같은 높이의 빈 자리. 컨테이너 `aria-busy` 는 바로 켠다.
2. 200ms 안에 데이터가 오면 스켈레톤 없이 내용.
3. 200ms 를 넘기면 스켈레톤을 보이고, 한 번 보이면 400ms 둔다.
4. 내용은 150ms 불투명도 전환으로 나타난다. `prefers-reduced-motion` 이면 전환하지 않는다.

결정은 [D-129 보완](../../decision/frontend-decisions.md)과 [결정 기록](../../plan/m8/basis-for-decision/2026-11-07-skeleton-delay.md)에 남겼다.

## 공통 구현

| 이름 | 위치 | 하는 일 |
|---|---|---|
| `useLoadingIndicator(loading)` | `src/shared/lib/loading-indicator` | `pending`(내용 대신 로딩 자리) · `skeletonVisible` · `reveal` 을 돌려준다. `LOADING_DELAY_MS` 200 · `LOADING_MIN_MS` 400 |
| `DeferredSkeleton` | `src/shared/ui/deferred-skeleton` | 로딩 자리 컨테이너. `aria-busy="true"` 와 `data-skeleton="blank"·"shown"`. `blank` 동안 뼈대를 `visibility: hidden` 으로 숨겨 높이를 지킨다 |
| `Reveal` · `revealClass` | 같은 폴더 | 로딩을 거쳐 나타난 내용에만 150ms 불투명도 전환. `Reveal` 은 늘 같은 `display: contents` 상자(`data-reveal-box`)라 부모의 flex·grid 배치를 바꾸지 않고, 전환이 켜져도 안의 컴포넌트가 다시 마운트되지 않는다. 바깥 Reveal 만 로딩을 거쳤으면 전환이 안쪽 Reveal 상자를 세 겹까지 건너 실제 내용에 걸린다(`REVEAL_TARGETS`, CSS 와 같은 선택자) |

- 기존 `useShownAfter`(저장 표시, 지연만)는 바꾸지 않았다.
- 라우트 뼈대 이어받기: 로딩 중으로 처음 그려질 때 라우트 뼈대(스플래시 잡기)가 아직 그려져 있으면 빈 자리 없이 스켈레톤으로 시작한다. 앱 안에서 처음 가는 화면이 라우트 뼈대 → 빈 자리 → 스켈레톤으로 깜빡이지 않게 했다. 이슈에 없던 선택이라 결정 기록에 이유를 적었다.

## 적용한 자리

| 화면 | 자리 | 비고 |
|---|---|---|
| 대시보드 | 영역 본문(`SectionBody`), 요약 숫자 넷, 회의 안내 줄 | 요약 숫자는 숫자마다 따로 잰다 |
| 태스크 | 리스트 탭 본문, 보드·캘린더·간트의 `태스크를 불러오는 중`, 상세, 변경 이력 | 보기 코드 대기(`보드 화면을 불러오는 중`)는 바로 보인다 — 화면 코드 대기다 |
| 확인 필요 상세 | 본문 | |
| 회의록 | 목록, 본문 첫 진입(목록 → 기본 회의 → 회의록을 한 자리로), 확인이 필요한 일, 추출된 일 | 회의를 바꿀 때의 들고 있기 · 최소 뼈대 값을 공통 값에 맞췄다(250 → 200ms, 300 → 400ms) |
| 회의 올리기 | 진입 확인, 참석자 목록 | 정리 중 회의로 가는 이동은 붙잡지 않는다 |
| 화자 지정 | 진입 확인 | |
| 메시지 | 목록, 대화, 검토 미리보기 | 받은 것이 없을 때의 빈 화면도 최소 표시가 끝난 뒤 바꾼다 |
| 팀 | 팀원 목록, 연결되지 않은 계정, 팀원 연결 창 | |
| 설정 | 알림 | |
| 워크스페이스 선택 | 목록 | |
| 온보딩 | 팀원 잇기 단계 | 연결 안 됨·팀원 잇기·오류로 바뀔 때 단계 머리·카드 제목은 그대로이고 카드 본문과 버튼만 전환한다 |

## 적용하지 않은 자리

- `app/router/RouteSkeleton.tsx`(`PageSkeleton` · `MinutesPageSkeleton` · `OnboardingSkeleton`), 가드 뼈대와 헤더 뼈대: 스플래시가 잡기 신호로 쓴다(이슈 범위 밖).
- 태스크 보기의 화면 코드 대기(`Suspense`): 대기를 내리는 때를 `Suspense` 가 정해 최소 표시를 둘 수 없다.

## 적용 대기

다른 작업이 같은 파일을 고치는 중이라 손대지 않았다. 그 작업이 develop 에 병합되면 develop 을 merge 한 뒤 같은 래퍼를 적용한다.

| 자리 | 파일 | 기다리는 작업 |
|---|---|---|
| 회의 처리 화면 진입 확인 | `src/pages/meeting-processing/ui/MeetingProcessingPage.tsx` | #483 B |
| 설정 Discord 연결 | `src/features/integration-connection/ui/DiscordConnectionSection.tsx` | 버튼 삭제. #507 은 병합됐다 — 2단계 PR 에서 적용(관리 세션 지시) |
| 설정 Notion 연결 | `src/features/integration-connection/ui/NotionConnectionSection.tsx` | 버튼 삭제. #507 은 병합됐다 — 2단계 PR 에서 적용(관리 세션 지시) |

## 검증

- 훅 단위 테스트(`useLoadingIndicator.test.ts`): 150ms 응답은 스켈레톤 0회, 250ms 응답은 200ms 에 보이고 600ms 에 사라짐, 1초 응답은 1초에 사라짐. 붙잡는 동안 다시 로딩, 지연 안에 끝났다 다시 로딩, 라우트 뼈대 이어받기도 본다.
- 컴포넌트 테스트(`DeferredSkeleton.test.tsx`): 빈 자리에도 `aria-busy`, `data-skeleton`, `Reveal` 의 감싸기, 중첩된 Reveal 에서 전환 대상, CSS 선택자와 `REVEAL_TARGETS` 일치.
- 경로 테스트: 메시지에서 목록을 기다린 뒤 캐시된 기본 대화가 나타나면 실제 대화 요소가 전환 대상이다(`messagesMsw.test.tsx`). 온보딩 팀원 잇기·연결 안 됨의 카드 본문과 버튼이 전환 대상이다(`onboardingMembers.test.tsx`).
- 바꾼 화면의 앱 단위 Vitest 와 typecheck·lint 는 아래 「검사 결과」에 적는다. 전체 Vitest 와 E2E 는 CI 가 돈다(감독 지시, 2026-11-07).

## 검사 결과

| 검사 | 결과 |
|---|---|
| `useLoadingIndicator.test.ts` · `DeferredSkeleton.test.tsx` | 첫 커밋 9 · 4 통과(합계 13). 리뷰 반영 뒤 9 · 7 통과 |
| `src/app` 등 바꾼 화면의 Vitest 83파일, `--maxWorkers=1` (Reveal 을 늘 감싸도록 바꾸기 전) | 1259 중 1253 통과, 6 실패 → 아래처럼 고친 뒤 그 4파일 154 통과 |
| 관련 19파일을 기본 병렬로 (Reveal 변경 뒤) | 다른 워커와 함께 돌아 5초 시간 초과가 대부분. 실패한 10파일을 하나씩 다시 돌려 모두 통과(approvals 37, dashboard 66, meetingMinutes 47, messagesMsw 58, onboardingStart 11, taskViewsCodeSplit 3, tasks 38, onboardingMembers 34, meetingUpload 41, team·settings 앞 실행 통과) |
| `npm run typecheck` · `npm run lint` | 통과 |
| `npm run format:check` | 커밋 대상은 통과. 로컬 전용 `.verify/brief.md`(git 제외) 하나만 걸린다 |

고친 테스트:

- 기대가 로딩 자리의 최소 표시만큼 늦어진 것: `dashboard.test.tsx`(안내 두 곳이 따로 끝난다), `team.test.tsx`(팀원 목록), `meetingMinutes.test.tsx`(목록), `tasks.test.tsx`(`openList` 기다림 3초).
- `settingsPage.test.tsx` 저장 실패 알림: `exact: false` 가 Radix 토스트의 잠깐 그리는 스크린리더 알림(`span[aria-live]`)까지 잡았다. 원래 `NotificationSection` 으로 돌려도 같은 실패가 나는 시각 의존이라 그 알림을 빼고 찾는다.
- 회의록 404·다른 공간 두 건은 코드 버그였다. 최소 표시가 끝날 때 `Reveal` 감싸기가 새로 생겨 `MinutesDetail` 이 다시 마운트됐고, 새 관찰자가 실패한 상세를 다시 받으며(`retryOnMount`) 대기 → 실패 → 대기가 끝없이 돌았다. `Reveal` 을 늘 같은 요소로 바꿨다.

브라우저 확인(로컬 전용 E2E `frontend/.verify/e2e/skeleton-delay.e2e.ts`, git 제외): 메시지에서 다른 대화를 고르고 대화 조회를 700ms 늦추면, 고른 뒤 빈 자리(`aria-busy`) → 약 355ms 에 뼈대 → 약 580ms 뒤 대화다. 다섯 번 중 네 번 통과했고, 한 번은 고른 뒤 뼈대 자리가 한 번도 적히지 않았다(원인 미확인). 그래서 저장소 E2E 로 넣지 않았다. 규칙의 정확한 경계는 훅 단위 테스트가 가짜 시계로 본다.

## 리뷰 반영 (Codex 리뷰, 2026-11-07)

| 지적 | 반영 |
|---|---|
| 온보딩 성공·연결 해제 경로에 전환이 없다 | `MembersForm`·`DiscordNotConnected` 의 카드 본문과 버튼을 `Reveal` 로 감쌌다. 단계 머리·카드 제목은 기다리는 동안에도 같아 그대로 둔다 |
| 중첩된 Reveal 에서 바깥 전환이 상자 없는 안쪽 감싸기에 걸린다 | Reveal 감싸기에 `data-reveal-box` 를 달고, 전환 선택자가 안쪽 감싸기를 세 겹까지 건너 실제 내용에 걸리게 했다. 옛 선택자로 되돌리면 새 경로 테스트가 실패하는 것을 확인했다 |
| 시간 옵션을 도중에 바꾸면 바꾼 때부터 다시 잰다 | 코드는 두고 계약을 주석에 적었다 — 옵션은 호출이 살아 있는 동안 상수로 쓴다. 지금 호출자는 모두 기본값이다 |
| 결과 문서의 테스트 수 | 파일별(9 · 4)로 바로잡았다 |

리뷰 반영 뒤 검사: `DeferredSkeleton.test.tsx` 7, `useLoadingIndicator.test.ts` 9, `messagesMsw.test.tsx` 59, `onboardingMembers.test.tsx` 34 통과. typecheck·lint 통과, format:check 는 커밋 대상 통과.
