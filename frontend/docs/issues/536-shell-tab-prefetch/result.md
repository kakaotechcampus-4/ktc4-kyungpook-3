# 결과 — 셸 탭 다섯 개의 화면 코드와 첫 데이터 미리 받기 (#536, #539 B)

- 기록일: 2026-11-08
- 대상: [#536](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/536) 전체, [#539](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/539)의 B 중 「로그인 중 도착할 화면 코드 받기」(사용자 결정, 2026-11-08 범위 추가)
- 기준: develop `1b0d3f7a`. 리뷰 반영 뒤 develop `84a4d9b5`(#537 — #510 화면별 라우트 뼈대)를 merge 했다
- 상태: 구현·단위 테스트·새 E2E 로컬 통과. 전체 Vitest·전체 E2E 는 CI 가 돈다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #536 과 사용자 결정(셸 탭 다섯 개 전부, 2026-11-08), #536 마지막 댓글의 범위 추가(#539 B)다.

탭을 처음 옮기면 화면 코드 → 빈 자리 → 스켈레톤 → 내용의 단계를 거쳤다. 화면 데이터 요청이 화면이 마운트된 뒤에야 시작했기 때문이다. 이제 셸이 화면 코드와 첫 화면 데이터를 미리 받는다.

1. 탭에 다가간 순간(마우스 올리기 `pointerenter`·포커스·`touchstart`) 그 탭 하나를 받는다. 헤더 탭과 휴대폰 아래 탭 막대 모두.
2. 셸이 뜬 뒤 한가할 때(`requestIdleCallback`, 2초 상한) 다섯 탭을 모두 한 번 받는다. `requestIdleCallback` 이 없는 브라우저(Safari)는 300ms 타이머로 대신한다. `navigator.connection.saveData` 면 이 갈래만 건너뛴다.
3. 로그인·가입 중(공간 목록을 받는 동안) 도착할 화면의 코드를 받기 시작한다. 돌아갈 경로(`?next=`)가 있으면 그 화면, 없으면 대시보드다. 데이터는 받지 않는다. 실패해도 로그인을 막지 않는다 (#539 B).

#527 의 시간 규칙(지연 200ms·최소 400ms)은 바꾸지 않았다.

## 구현

| 이름 | 위치 | 하는 일 |
|---|---|---|
| `lazyPage` | `src/app/router/lazyPage.tsx` | 화면 코드 부르기(`load`)를 한 번으로 묶어 지연 로드와 미리 부르기가 같은 요청을 쓴다. 실패하면 묶음을 풀어 다음 부름이 다시 받는다. 만든 화면과 그 `load` 를 `screenCode` 에 짝지어 둔다 |
| `screenCodePreloader(routes)` | `src/app/router/screenCode.ts` | 경로를 경로 표(`appRoutes`)에 맞춰 그 경로의 지연 로드 화면을 찾고 짝지은 `load` 를 부른다. 지연 로드 화면이 아닌 경로·없는 경로는 아무것도 하지 않는다. 실패는 삼킨다 |
| `preloadScreenCode(path)` · `provideScreenCode` | `src/shared/lib/screen-code` | 아래 층(로그인 기능, 셸)이 「이 경로의 화면 코드를 받아 두라」고 알리는 신호. 스플래시 신호와 같은 모양이다. `createApp` 이 경로 표로 받는다 |
| `useShellPrefetch` · `prefetchShellTab` | `src/app/router/shellPrefetch.ts` | 탭 하나의 코드(탭이 여는 경로)와 첫 화면 데이터를 받는다. 한가할 때 다섯 탭을 한 번 받는다. `WorkspaceLayout` 이 헤더·아래 탭 막대의 `onTabIntent` 에 건다 |
| `tabIntentHandlers` · `ShellTabKey` · `SHELL_TABS.key` | `src/widgets/app-shell/model/shellTabs.ts` | 탭에 `onPointerEnter`·`onFocus`·`onTouchStart` 를 붙인다. 받을 쪽이 없으면 붙이지 않는다 |
| 화면별 데이터 미리 받기 | `src/widgets/dashboard/prefetch.ts`, `src/pages/meetings/prefetch.ts`, `src/widgets/task-board/prefetch.ts`, `src/widgets/message-inbox/prefetch.ts`, `src/widgets/team/prefetch.ts` | 각 화면의 조회 옆에 둔 별도 입구. 셸이 정적으로 가져와도 화면 코드가 첫 번들에 끼지 않는다(빌드한 메인 번들에 다섯 화면의 문구가 없음을 확인) |
| 회의록 기본 회의 바로 그리기 | `src/pages/meetings/ui/MeetingsPage.tsx`, `model/useDefaultMinutesSelection.ts` | 아래 「설계 결정」 참고 |

### 화면별로 받는 것

화면과 같은 query options(기존 쿼리 팩토리)를 쓴다. 신선한 값은 다시 받지 않는다(`prefetchQuery`). 다음 조회를 정하는 목록·상세는 `fetchQuery` 로 받는다 — 신선하면 재사용하고 오래됐으면 새 값을 기다려 화면이 고를 상세를 고른다. 시작할 때 잡은 세션 범위(`captureSessionScope`)를 각 `await` 뒤에 확인해, 그 사이 세션이 끝났으면 다음 조회를 시작하지 않는다(중첩 `prefetchMinutes` 에도 넘긴다). 실패는 조용히 넘긴다 — 화면이 뜨면 같은 Query 가 다시 묻고 그 오류를 그린다.

| 탭 | 받는 조회 | 역할에 따른 차이 |
|---|---|---|
| 대시보드 | 태스크·팀원·연동·회의 목록, 최신 완료 회의 상세 → 그 추출 | 대기 승인은 PM 만 |
| 회의록 | 회의 목록, 기본 선택(가장 최근 회의록)의 상세·회의록 본문·추출 (`prefetchMinutes` 재사용) | 승인 목록은 PM 이고 서버가 확인 권한(`canReview`)을 줬을 때만 |
| 태스크 | 태스크·팀원 | 대기 승인·회의 목록은 PM 만(탭이 여는 기본 보기는 리스트라 캘린더 조건은 해당 없음) |
| 메시지 | 받은 목록, 넓은 화면이 처음 열 대화(`selectDetail` 재사용) | 팀원은 첫 대화를 받는다. PM 은 보낼 메시지 묶음을 여는데 목록에 이미 있어 더 받지 않는다. 휴대폰은 목록만 보여 대화를 받지 않는다 |
| 팀 | 팀원·태스크·연동, Discord 사용자 | Discord 사용자는 연동 상태를 아직 모르거나 연결됐을 때만(화면과 같은 조건) |

## 설계 결정

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| 화면 코드 미리 부르기 | `lazyPage` 가 자기 `load` 를 화면과 짝지어 두고, 경로를 경로 표에 맞춰 찾는다 | 다섯 탭 화면을 따로 표(`shellScreens`)로 빼기 — `routes.tsx` 를 고쳐야 하고(#510 과 겹침), `?next=` 가 가리키는 상세·설정 화면은 다룰 수 없다. 경로 모양을 따로 적기 — 경로 표와 두 벌이 된다 |
| 아래 층에서 부르는 길 | `shared/lib/screen-code` 신호(스플래시 신호와 같은 모양) | 로그인 기능이 app 층을 직접 부르기 — FSD 의존 방향 위반 |
| 데이터 미리 받기 위치 | 각 화면 조회 옆의 별도 입구 파일(`prefetch.ts`) | 위젯·페이지의 `index.ts` 에서 내보내기 — 셸이 정적으로 가져오면 화면 코드가 메인 번들에 끼어 지연 로드가 깨진다 |
| 상세까지 받는 범위 | 화면이 목록에서 처음 여는 상세만 받는다 — 회의록의 기본 회의, 팀원 메시지의 첫 대화, 대시보드의 최근 반영 회의 | 상세를 받지 않기 — 이 세 화면은 첫 화면 자체가 그 상세를 그려, 받지 않으면 본문 자리에 뼈대가 남는다(E2E 대조군에서 확인). 다른 상세(회의 하나·대화 하나를 사용자가 고르는 것)는 받지 않는다 |
| 회의록 기본 진입 | 목록을 이미 받아 둔 채 들어오면 주소를 바꾸기 전 첫 렌더부터 **마운트 당시의** 기본 회의를 그린다. 지금 기본 회의가 그것과 다르면 그리지 않는다 | 그대로 두기 — 데이터가 다 있어도 `/meetings` 첫 렌더는 고른 회의가 없어 본문이 빈 자리로 20ms 안팎(1~2 프레임) 남았다(E2E 에서 측정). 목록이 늦게 온 경우는 전처럼 주소를 바꾼 뒤 그린다 — 떠나는 중이면 기본 회의를 부르지 않는 기존 경합 규칙(useLivePathname)을 지킨다. 「목록이 있었나」 불리언으로 두면 회의록 없는 목록을 가진 채 들어와 떠나는 중에 새 목록이 올 때 떠나는 화면이 새 회의를 불렀다(리뷰 3) |
| 한가할 때 받기의 테스트 환경 | Vitest setup 에서 `requestIdleCallback` 이 부르지 않는 브라우저로 둔다(창에 직접 둔다) | 그대로 두기 — jsdom 은 `requestIdleCallback` 이 없어 300ms 타이머로 다섯 탭을 받아, 요청 기록을 단언하는 테스트 54개 파일의 기대가 흔들린다. `vi.stubGlobal` 로 두기 — 테스트가 `vi.unstubAllGlobals()` 로 걷은 뒤 언마운트에서 취소가 없어 실패했다(lateAsyncRaces) |
| 로그인 중 대시보드의 경로 | `paths.dashboard(':workspaceId')` — 공간을 아직 몰라 경로 모양만 맞춘다 | 공간 목록을 받은 뒤 정확한 경로로 부르기 — 목록을 받는 동안 함께 받는다는 결정과 어긋난다 |

D-130 은 「브라우저 유휴 시간 사전 로드는 1차에서 적용하지 않는다」고 적었다. 이번 작업은 사용자 결정(#536)으로 셸 탭 다섯 개에 한해 이를 바꾼다. 결정 문서 갱신은 이 작업 범위(결과 문서만)에 넣지 않았다 — 아래 「남긴 것」.

## 검증

- 단위(Vitest, 관련 파일만 `--maxWorkers=1`):
  - `src/app/shellPrefetch.test.tsx` 10개 — 헤더 탭에 올리기·포커스하면 그 화면 조회가 캐시에 들어간다(회의록은 기본 회의의 회의록까지, 팀은 Discord 사용자까지), 탭이 여는 화면 코드를 부탁한다, 팀원은 대기 승인을 받지 않고 첫 대화를 받는다, 휴대폰 아래 탭 막대는 터치로 받는다, 실패는 알림 없이 넘기고 탭을 열면 화면이 다시 묻는다, 한가할 때 다섯 탭의 데이터·코드를 받는다, 받은 탭으로 처음 옮기면 업무 요청이 0회다, `requestIdleCallback` 이 없으면 타이머로 받는다, `saveData` 면 한가할 때 받지 않고 탭 받기는 그대로다.
  - `src/app/shellPrefetchData.test.ts` 6개(리뷰 반영) — 목록을 받은 뒤 세션이 끝나면 회의록·대시보드·메시지가 상세를 시작하지 않는다, 목록 캐시가 오래됐으면 새 목록의 기본 회의·최신 완료 회의·첫 대화를 받는다. 고치기 전 코드에서 6개 모두 실패했다.
  - `src/app/meetingMinutesRaces.test.tsx` 1개 추가(리뷰 반영) — 회의록 없는 목록을 가진 채 들어와 떠나는 중에 새 목록이 와도 떠나는 화면이 새 기본 회의를 부르지 않는다. 고치기 전 코드에서 실패했다.
  - `src/app/router/screenCode.test.tsx` 4개 — 감싼 화면 칸·하위 경로(`*`)에서 화면을 찾는다, 검색 문자열 무시, 한 번만 부른다, 지연 로드 화면이 아니면 부르지 않는다, 실패는 조용하고 다음 부름이 다시 받는다.
  - `src/app/entryScreenCode.test.tsx` 3개 — 로그인 중 기본은 대시보드, `?next=` 면 그 화면 코드를 부탁한다, 미리 받기가 실패(던짐)해도 로그인이 끝나 그 화면에 도착한다.
- E2E(`e2e/shell-prefetch.e2e.ts`, 로컬 Chromium, 5개 통과): API(XHR)를 모두 350ms 늦추고 설정 화면에서 셸이 뜬 뒤, 앱이 맡긴 한가할 때 일을 테스트가 붙잡았다가 직접 부른다. 그다음 탭마다 이어 받는 사슬의 마지막 조회(추출·회의록 본문·받은 목록·Discord 사용자·태스크 목록)가 답을 받고, 늦추기 대기를 포함한 API 요청과 화면 코드 요청이 진행 중이 아니기를 기다린 뒤 각 탭으로 처음 옮긴다. 누른 순간부터 내용이 뜨고 10프레임 뒤까지 프레임마다·DOM 이 바뀔 때마다 화면 본문을 적어, 라우트 뼈대·화면 안 뼈대(`aria-busy`)·빈 지연 자리(`data-skeleton`)가 한 프레임도 없음을 단언한다. 다섯 탭 모두.
  - 처음 판(네트워크가 잠잠한 시간으로 끝을 판정)은 유휴 실행이 4초 늦는 브라우저를 흉내 내면 정상 구현에서도 다섯 탭 모두 실패했다(리뷰 4 재현, 임시 사본). 지금 판은 한가할 때를 테스트가 정한다.
  - 대조군: 같은 검사를 한가할 때 받기를 끈 채(`requestIdleCallback` 이 부르지 않음, 누를 때의 받기만) 돌리면 다섯 탭 모두 실패했다 — 검사가 뼈대·빈 자리를 잡아낸다(임시 사본, 커밋하지 않음).
- 기존 앱 테스트(관련 파일): appShell·authFlow·dashboard·lateAsyncRaces·meetingMinutesRaces·messagesCompact·splash·taskBoardCompact·router/*·splash/*·meetingProcessing·meetingMinutesSelection·messagesMsw(22개 파일 410개), meetingMinutes·meetingMinutesRaces·meetingMinutesSelection·router/meetingRoutes(73개), loginReturn(9개) 통과.
- typecheck·lint·format:check 통과. build 통과(메인 번들에 다섯 화면 문구 없음).

## 남긴 것

- D-130(라우트 분할·유휴 사전 로드 미적용) 결정 문서 갱신. #539 의 기록 항목과 함께 정하는 것이 맞아 여기서 하지 않았다.
- #539 의 A(화면별 라우트 뼈대)와 C(로그인 직후 스플래시 `revealAt`)는 범위 밖이다.
- `?next=` 가 없을 때 실제 도착지(공간 개수 분기 `postLoginPath` — 공간 선택·온보딩일 수 있다)는 목록을 받은 뒤에야 안다. 그 경우도 대시보드 코드를 받는다(사용자 결정). 도착지가 다르면 그 화면은 전처럼 코드를 기다린다.
- 실제 백엔드에서의 체감 시간은 재지 않았다(MSW·지연 350ms 기준).
