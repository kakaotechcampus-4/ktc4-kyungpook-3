# 회의 정리 추적기 — 어디에 두고, 한 번만 알리고, 언제 옮기는가

- 날짜: 2026-10-03
- 상태: 결정

## 고민

M5 U4 에서 업로드 뒤 정리 상태를 앱 전체에서 따라가는 추적기, 처리 화면, 헤더 `정리 중` 링크, 완료·실패 알림을 만들었다. 갈린 곳이 다섯이었다.

- **자리.** polling 은 화면·공간을 옮겨도 이어져야 한다. 워크스페이스 레이아웃은 공간이 바뀌면 다시 그려지고, 앱 바깥(`App`)에는 라우터가 없다.
- **한 번만.** 완료 토스트는 회의마다 한 번이어야 한다. 효과는 재렌더·StrictMode 에서 여러 번 돌고, 끝난 뒤 낡은 목록 캐시가 같은 회의를 다시 「정리 중」으로 보여 줄 수 있다.
- **강제 이동.** 완료·실패 때 처리 화면을 보던 사람만 옮겨야 한다. 실패 쪽은 연동 상태를 다시 묻느라 비동기다 — U3 r1 의 M02(늦게 끝난 확인이 떠난 사용자를 끌고 옴)와 같은 모양이다.
- **일시적 오류.** 네트워크가 끊긴 조회를 정리 실패로 보면 안 된다.
- **기존 테스트.** M4 의 많은 테스트가 「이 화면은 업무 API 0회」를 단언한다. 추적기는 모든 워크스페이스 화면에서 지금 공간 목록을 받고, 정리 중 회의의 상세를 polling 한다.

## 고른 길

**자리 — 두 칸으로 나눈다.**

```
RequireAuth ─ AuthenticatedLayout   useProcessingTracker(): 등록된 회의마다 상세 polling · 완료/실패 처리 · 끊김 모달
                └ … WorkspaceLayout  useProcessingDiscovery(ws): 지금 공간 목록에서 정리 중 회의를 trackMeeting
                                     useProcessingMeetingId(ws) → AppHeader processingHref (props)
```

- polling 은 인증된 앱 영역 전체를 감싸는 경로 없는 layout route(`app/router/layouts/AuthenticatedLayout.tsx`)에 하나 둔다. 화면·공간을 옮겨도 그대로이고, 로그아웃하면 이 칸이 내려가며 멈춘다. 라우터 안이라 위치·관문을 쓸 수 있다.
- 발견은 워크스페이스 레이아웃이 지금 공간 목록 하나만 본다. 다른 공간 목록을 돌지 않는다. 다른 공간에서 시작한 추적은 store 에 남아 끝날 때까지 이어지고, 새로고침하면 그때 보는 공간 목록으로 다시 찾는다.
- 행동은 `features/meeting-processing`, 조립은 app 이다. 끊김 모달은 `features/notion-connection` 의 것이라 두 feature 를 app(`AuthenticatedLayout`)이 잇는다. 헤더 widget 은 추적기를 모르고 `processingHref` 만 받는다 (G4).
- 상태·진행은 상세 Query 캐시에 있고 처리 화면이 같은 key 를 읽는다. store 에는 ID 와 「끝냄」 key 뿐이다 (G5).

**한 번만 — store 의 `finishMeeting` 이 처음 끝냈을 때만 true.**

- `finished` 에 `공간/회의` key 를 남기고, 끝낸 회의는 `trackMeeting` 이 다시 받지 않는다. 알림·무효화·이동은 `finishMeeting` 이 true 일 때만 한다.
- 토스트 key 도 회의별이라(`meeting-done:ws/mt`) 같은 key 가 둘 그려지지 않지만, 그것은 두 번째 방어다.
- 로그아웃·세션 만료·앱 dispose 가 모두 비운다(`clearTrackedMeetings`).

**강제 이동 — 처리 화면을 보고 있을 때만, 관문으로.**

- 끝난 순간(실패는 연동 재조회가 끝난 순간) 지금 경로가 그 회의의 처리 화면일 때만 옮긴다. 완료 → 회의록 `replace`, 실패 → 회의록 목록 `replace`. 다른 화면·공간이면 토스트(또는 모달)만 띄운다.
- 이탈 확인을 고르는 중이면(`hasPendingLeave()`) 끼어들지 않는다. 옮길 때는 `useGuardedNavigate` 다. 관문은 ref 로 최신 값을 읽는다.
- **「보고 있다」는 그려진 경로와 기록의 지금 경로가 둘 다 처리 화면인 것이다.** 기록 경로는 부르는 순간 읽는다(`shared/lib/live-pathname` 의 `useLivePathname`). r1 은 `useLocation` 을 ref 에 담은 그려진 경로만 봤다. 선언형 라우터는 기록을 먼저 옮기고 화면은 transition 으로 그려서, 사용자가 누른 이동이 지연 로드 화면을 기다리는 동안 그 ref 는 처리 화면 경로였다 — 완료·실패가 사용자의 이동을 덮어썼다(U4 r1 M01, Chromium 재현). 반대로 기록 경로만 보면 처리 화면으로 **가는 중**인 사람(409 뒤 처리 화면 이동 등)도 옮기게 된다. 그 사람은 도착해 끝난 처리 화면의 `회의록 보기`를 본다 — r1 과 같다.
- **비동기 결과는 세션 세대에 묶는다**(`entities/user` 의 `captureSession`·`advanceSessionGeneration`). 세션을 끝내는 코드(`clearUserScope`·`expireSession`·앱 dispose)가 요청 취소보다 먼저 동기로 세대를 올리고, 실패 처리는 연동 재조회 뒤 세대가 바뀌었으면 알림·모달·이동을 모두 버린다. r1 은 effect cleanup 의 mounted ref 를 봤는데, 로그인 이동이 transition 이라 추적기가 아직 마운트된 채 취소가 catch 로 떨어져 로그인 화면에 실패 토스트가 생겼다(U4 r1 M02).
- **끊김 판정의 연동 재조회는 「실패를 본 뒤의 서버 상태」로 한다.** r5 부터는 따로 요청하지 않고 연동 상태의 공유 Query 를 `fetchFresh` 로 묻는다(아래 「개정 — 2026-10-05 (2)」). r3~r4 는 공유 캐시를 거치지 않고 직접 받았다(`fetchIntegrations`) — 같은 세션이면 받은 값으로 연동 캐시를 고치고, 세션이 끝났으면 캐시에 쓰지 않았다(r4 는 `fetchLatest` 한 곳에서). r2 는 `fetchQuery({ staleTime: 0 })` 로 묻고, 같은 세션 안의 취소(다른 화면의 구독이 같은 조회를 거둬 감)면 한 번 더 물었다. 그런데 연동 캐시(connected)가 이미 있으면 취소는 던져지지 않는다 — 마지막 구독(설정 화면)이 내려가면 TanStack Query 가 `cancel({ revert: true })` 로 요청을 거두고 **이전 값(connected)을 돌려준다**. 판정이 그 값을 새 답으로 믿어 실제 끊김을 일반 실패로 알렸다(U4 r2 M03, Chromium 재현).
- 끊김(D-100)은 모달이다. 처리 화면이면 목록으로 옮긴 뒤, 다른 화면이면 그 자리에서 띄운다. 모달은 이동하지 않고 입력을 지우지 않는다. `Notion 다시 연결하기` 는 U3 와 같이 설정의 Notion 영역으로 간다.

**일시적 오류 — 실패가 아니라 「아직 모름」.**

- 판정(`trackerOutcome`)은 403·404 만 접근 상실로 보고, 네트워크·5xx 는 마지막 상태(없으면 정리 중)를 쓴다. polling 은 계속하고 `refetchOnWindowFocus`·`refetchOnReconnect` 를 `'always'` 로 둬 30초 최신 시간과 무관하게 돌아오면 바로 묻는다.
- 처리 화면은 받아 둔 상태를 그대로 보이고 「연결이 불안정해요」 한 줄만 더한다.

**기존 테스트 — 추적기 요청 두 모양만 뺀다 (코디네이터 결정 A).**

- `shared/test/requests.ts` 의 `businessRequests` 가 부팅 조회처럼 `GET /workspaces/{지금 공간}/meetings` 와 `GET /meetings/{id}` 를 뺀다. 지금 공간은 기본 `ws_01`(기존 화면 테스트의 공간)이고 다른 공간이면 넘긴다. 다른 공간 목록, 회의록·추출·승인·태스크 요청은 빼지 않는다.
- 뺀 요청은 `trackerRequests` 로 따로 단언한다(`app/meetingProcessing.test.tsx`): 대시보드의 업무 요청은 0회이고 추적기 요청은 지금 공간 목록 1회 + 정리 중 회의 상세 1회, 정리 중 회의가 없으면 상세 0회, 공간을 바꿔도 본 공간 목록만.
- M4 E2E 둘(`layout.e2e.ts` 헤더 한 줄, `select-switch.e2e.ts` 키보드 순서)은 `multiple-workspaces` 시나리오의 정리 중 회의(mt_10) 때문에 `정리 중` 링크가 보인다. 기대값을 고쳤다(코디네이터 결정 A): 탭 5개는 이름으로 정확히, `정리 중` 은 따로 정확히 1개·회의록 바로 다음·같은 줄, Tab 순서는 마크 → 대시보드·회의록·정리 중·태스크·메시지·팀 → 메뉴. 정리 중 회의가 없으면 링크가 없다는 단언은 Vitest(`app/meetingProcessing.test.tsx`)에 있다.
- StrictMode 의 개발용 이중 마운트는 signal 을 쓰는 첫 목록 요청을 취소하고 한 번 더 보낸다(TanStack Query 동작, 부팅 `/auth/me` 도 같다). 그래서 StrictMode 테스트는 「마운트 때 1~2회, 그 뒤 재렌더·탭 이동에 0회」를 단언하고, 정확한 1회는 StrictMode 없는 테스트가 본다.

**캔버스와 다른 곳.**

| Processing 캔버스 | 화면 | 근거 |
|---|---|---|
| 진행 막대 62% · `경과 03:06` · 단계별 소요 시간 | 없음. `n / 3 단계 완료` 와 단계마다 `완료·진행 중·대기` | 서버가 주지 않는 숫자다 (U4-4) |
| 네 단계(전사·화자·결정·담당자) | 세 단계 — `음성 파일 준비하기`·`음성을 텍스트로 옮기기`·`결정사항과 할 일 뽑아내기` | 서버 `progress` 가 세 값이다 (계약 §2.3) |
| 진행 중 단계의 회전 표식 | 먹 테두리 + 먹 점(정지) | 공통 UI 가 스피너를 쓰지 않는다 (Skeleton·Button) |
| `29:12~29:40` 말 겹침 안내 · `해당 구간 들어보기` | 없음 | 원본 재생 제외 (계획 §1) |
| `중단하기` | 없음 | 중단 API 가 없다 |
| `확인이 끝나기 전에는 Notion에 아무것도 쓰지 않아요.` | `회의록과 확실한 태스크는 바로 Notion에 반영하고, 확인이 필요한 항목은 승인한 뒤 반영해요.` | D-101 |
| 제목 아래 `52:14 · 참석 4명` | `제목 · 서울 날짜 · 참석 n명` | 정리 중에는 길이가 없다(목록 `duration_ms` 0/null) |

- 크기 값은 캔버스 실측이다: 본문 폭 560px(`max-w-[560px]`), 제목 30px, 마스코트 64px. 나머지는 토큰이다.
- 실패 토스트는 공통 Toast 의 「오류는 토스트로 보내지 않는다」 원칙과 어긋나지만 D-092 가 토스트로 정했다. 오류 색 없이 같은 중립 토스트를 쓴다.

## 왜

- 추적기를 `App`(라우터 밖)에 두면 위치를 읽을 수 없어 「처리 화면을 보고 있을 때만 옮김」을 할 수 없다. 워크스페이스 레이아웃에 두면 공간을 바꿀 때마다 다시 마운트돼 polling 이 끊기거나 중복된다.
- 「한 번만」을 컴포넌트의 ref 로 지키면 다시 마운트될 때(로그인 재진입, StrictMode) 잊는다. 토스트 key 합치기만으로는 5초 뒤 사라진 토스트가 재발견에 다시 뜬다. 전역 store 의 key 한 줄이 가장 짧다.
- 실패의 끊김 판정을 `failed_stage` 문자열로 하지 않는다 — 계약상 자유 문자열이다. 연동 상태를 다시 묻는 것이 D-100 의 사실(연결이 끊겼다)을 직접 본다. 재조회가 실패하면 끊김으로 단정하지 않고 일반 안내로 간다.
- 끝난 회의 자신의 상세는 무효화하지 않는다. 방금 받은 끝 상태이고, 무효화하면 아직 붙어 있는 추적 구독이 같은 상세를 한 번 더 묻는다(polling 횟수 테스트에서 발견).
- 「가는 중인 이동」의 근거로 기록 객체의 `location` 을 고른 까닭: 이 앱은 data router 를 쓰지 않아 `useNavigation` 이 없다. 기록 객체는 구독자를 하나만 받아(`A history only accepts one active listener`, 라우터 자신이 쓴다) `listen` 도 못 한다. 관문 store 에 「요청한 이동」을 적는 방법은 관문을 지나지 않는 이동(뒤로가기, 가드의 `<Navigate>`, 로그아웃 이동)을 놓친다. BrowserRouter·MemoryRouter 의 navigator 는 기록 객체 그 자체이고 `location` getter 가 지금 값을 준다 — 앱과 테스트가 같은 근거를 쓴다. navigator 에 `location` 이 없으면 커밋된 경로로 물러난다.
- **`useLivePathname` 이 라우터 내부에 기대는 범위.** `UNSAFE_NavigationContext` 의 `navigator` 를 읽고, 공개 `Navigator` 타입(`createHref`·`go`·`push`·`replace`)에 **없는** `location` 을 `Reflect.get` 으로 꺼낸다. 「BrowserRouter·MemoryRouter 가 기록 객체를 그대로 navigator 로 넘기고 그 `location` getter 가 지금 위치를 준다」는 설치된 react-router 7.18.4 의 구현 사실이다(`package.json` 은 `^7.18.4`, lock 이 7.18.4 로 고정 — 버전 정책은 바꾸지 않았다). 렌더 값으로 쓰지 않고 늦은 부작용 직전에만 읽는다 — 공개 타입 주석이 경고하는 렌더 중 기록 읽기의 tearing 과는 다르다. 물러나기는 crash 만 막고 M01 보호는 아니다. data router·custom Router·basename 을 들이면 경합이 조용히 돌아올 수 있다(U4 r2 검증, 위험 중간).
  - **react-router 를 올리거나 lock 을 갱신하거나 라우터 구성을 바꿀 때 확인할 테스트:** `shared/lib/live-pathname/useLivePathname.test.tsx` 전부 — `지연 로드 화면을 기다리는 이동 중에는 그려진 경로가 아니라 가는 경로를 준다`(MemoryRouter), `BrowserRouter 에서도 지연 로드 화면을 기다리는 이동 중에는 가는 경로를 준다`(앱의 라우터), `지금 위치를 갖지 않는 navigator 면 그려진 경로로 물러난다`. 그리고 `app/lateAsyncRaces.test.tsx` 의 `진행 중인 사용자 이동을 정리 결과가 덮어쓰지 않는다 (U4 r1 M01)` 두 개, `Notion 복귀 확인 중 팀 화면으로 가는 중(화면 코드 대기)이면 끝나도 업로드로 데려오지 않는다`, `보내는 중 이탈 확인에서 나가기를 고른 이동이 화면 코드를 기다리는 사이 202 가 와도 처리 화면으로 끌고 가지 않는다`. 하나라도 깨지면 `location` 가정이 바뀐 것이다 — 위 대안(data router 의 `useNavigation`, 앱 소유 history 어댑터)을 다시 본다.
- **「방금 서버가 준 값」이 필요한 판정은 공유 캐시 조회의 결과를 믿지 않는다.** `fetchQuery`·`ensureQueryData`·`refetchQueries` 의 결과는 두 경우 새 답이 아니다. ① 구독하던 마지막 화면이 내려가 취소되면, 이전 데이터가 있을 때 그 이전 값을 돌려준다(취소를 던지는 것은 데이터가 없을 때뿐이다). ② 이미 진행 중인 조회가 있으면 그 요청에 합쳐진다 — 판정할 일이 생기기 전에 보낸 요청의 답이다. 그래서 이런 판정은 요청 함수(`fetchIntegrations`·`fetchMeetingList`)를 직접 부르고, 같은 세션일 때만 결과를 캐시에 쓴다. 온보딩 연결 단계(M4)와 설정의 Notion 복귀 확인(U3)이 이미 이렇게 했다. U3·U4 에서 고친 곳은 정리 실패의 끊김 판정(`useProcessingTracker`)과 업로드 응답 유실 복구의 목록 재조회(`useMeetingUpload` — 다른 공간으로 가 목록 구독이 모두 내려가면 들어올 때 받은 「정리 중 없음」 목록을 돌려받아, 서버가 받은 회의를 추적에 넣지 못했다). 업로드 진입 판정(`useUploadEntry`)은 그대로 둔다 — 결과 promise 가 아니라 그 화면 구독의 `isFetchedAfterMount` 로 판정하고, 취소로 되돌린 상태는 받은 횟수를 올리지 않으며, 그 화면이 구독자라 판정 중에는 마지막 구독이 내려가지 않는다. 들어오는 순간 이미 진행 중이던 목록 요청(공간의 발견)에 합쳐질 수는 있지만, 그 답은 들어온 뒤 도착하는 서버 상태라 30초 캐시를 믿지 않는다는 U3-1 의 뜻은 지킨다. 회귀 테스트는 `app/lateAsyncRaces.test.tsx` 의 `설정 화면을 떠나도 정리 실패의 끊김 판정은 새 답을 기다린다 (U4 r2 M03)`(대조군 포함)와 `응답을 잃고 목록을 다시 보는 사이 다른 공간으로 가도 서버가 받은 회의를 추적에 넣는다` 다. **r5 개정:** 직접 요청은 공유 조회와 같은 캐시에 쓰는 두 번째 길이 돼 도착 순서의 구멍(M05·M06)을 낳았다. 지금은 다시 공유 Query 의 결과를 쓰되, ① 은 「시작 뒤 이 key 에 조회의 답이 쓰였나」로 가려 다시 묻고 ② 는 시작 때 진행 중인 조회를 거두고 새로 물어 피한다(`fetchFresh`, 아래 개정 절).
- 라우터의 `useTransitions={false}` 로 이동을 동기로 그리는 길은 고르지 않았다. 앱 전체 이동이 Skeleton 을 먼저 보이게 바뀌고(지금은 이전 화면이 남는다) M4 화면 전환 동작이 달라진다.
- 같은 종류의 경합을 U3 에서도 같은 두 장치로 막았다. `useNotionConnection` 의 복귀 확인(그려진 경로 ref → 기록 경로, 확인 중 세션이 끝나면 캐시 쓰기·이동 없음)과 `useMeetingUpload`(이탈 확인에서 나가기를 고른 이동이 대기 중이면 202 뒤 처리 화면으로 옮기지 않음, 보내는 중 세션이 끝나면 추적 등록·이동·안내 없음). 회귀 테스트는 `app/lateAsyncRaces.test.tsx` 다 — 경로 표의 지연 로드만 바꿔 끼워 화면 코드 도착을 붙잡는다.

## 개정 — 2026-10-05: 끝난 세션의 요청과 오래된 응답을 한 곳에서 막는다 (U4 r3 M04·M05)

> r5 에서 불변식 2 의 `fetchLatest` 를 지우고 캐시에 쓰는 길을 공유 Query 하나로 바꿨다(아래 「개정 — 2026-10-05 (2)」). 불변식 1 의 `sessionScope`·`request` 의 401 거르기는 그대로다.

r3 에서 판정 요청을 직접 요청으로 바꾸자 두 경합이 새로 생겼다. 1~3회차는 늦은 결과를 호출 지점마다 따로 막았고(M01 → M03 → M04·M05), 막을 때마다 다른 곳이 샜다. 이번에는 지점마다 고치지 않고 **불변식 둘**을 두고, 그것을 지키는 곳을 하나씩 정했다.

- **M04 — 이전 세션의 늦은 401 이 새 세션을 끝냈다.** 직접 요청에는 세션 정리의 `cancelQueries` 가 닿지 않는다. 로그아웃 → 재로그인 뒤 그 요청이 401 을 받으면 `request` 가 곧바로 전역 401 알림을 부르고(`createApp` → `expireSession`) 새 세션을 null 로 바꿨다. 호출자의 `isCurrentSession()` 검사는 `request` 가 던진 **뒤**라 늦었다.
- **M05 — 먼저 출발한 공유 조회의 늦은 답이 새 결과를 되돌렸다.** 설정의 연동 조회(포커스·무효화 재조회)가 먼저 출발해 connected 를 받아 둔 사이, 끊김 판정의 직접 요청이 revoked 를 캐시에 썼다. 그 뒤 도착한 공유 조회의 답이 connected 로 덮어 PM 재연결 버튼이 사라졌다. `setQueryData` 는 쓰는 순서만 알고 두 요청의 출발 순서는 모른다.

**불변식 1 — 끝난 세션의 요청은 어떤 부작용도 내지 못한다.** 세션 범위 `shared/api/sessionScope.ts` 한 곳이 지킨다.

- 세대와 그 세대의 `AbortController` 를 함께 둔다. 세션을 끝내는 코드(`clearUserScope`·`expireSession`·앱 dispose)는 지금처럼 `advanceSessionGeneration()` 을 부르고, 그것이 `endSessionScope()` 로 세대를 올린 **뒤** 이전 세대의 신호를 abort 한다. 취소로 떨어진 작업은 이미 바뀐 세대를 본다.
- `request` 는 출발할 때 범위를 잡고, 401 을 받으면 **출발 세대가 지금 세대일 때만** 알린다. 지금 세션의 401 은 그대로 만료다. 이 거르기는 모든 요청에 걸린다 — 직접 요청뿐 아니라 세션 정리가 취소하지 않는 업로드 POST(mutation)의 늦은 401 도 새 세션을 끝내지 않는다.
- 직접 요청은 세대의 신호로 보낸다(아래 `fetchLatest`). 세션이 끝나면 요청 자체가 취소된다. 401 거르기와 겹치는 두 겹이다 — 거르기는 「알림」을, 취소는 「요청과 그 뒤의 캐시 쓰기」를 막는다.
- 세대 값은 사용자 계층의 개념이지만 요청이 「어느 세션에서 출발했나」는 도메인을 모르는 전송 사실이라 shared 에 둔다. `entities/user` 의 `captureSession`·`advanceSessionGeneration` 은 이름을 그대로 두고 이 범위를 감싼다 — 기존 호출자는 바뀌지 않는다. `request` 에 인터셉터나 재요청을 들이지 않는다(D-120, D-135). 401 을 알릴지 말지 정하는 조건 하나를 더했을 뿐이다.
- 대안: `onUnauthorized` 구독자(createApp)가 세대를 보게 하는 방법은 구독자가 「그 요청이 출발한 세대」를 모른다. 알림에 세대를 실어 보내면 같은 조건이 구독자로 옮겨갈 뿐이라 요청 곁에 둔다. 모든 요청에 세션 신호를 자동으로 거는 방법은 고르지 않았다 — 로그아웃 POST·업로드 POST 처럼 세션 경계에 걸친 요청까지 끊는다.

**불변식 2 — 오래된 응답이 더 새 결과를 덮지 못한다.** 직접 요청 도우미 `shared/api/fetchLatest.ts` 한 곳이 지킨다.

- 직접 요청과 그 결과의 캐시 쓰기를 이 함수 하나로 한다. 받은 값을 쓰기 **전에**, 이 요청보다 **먼저 출발해 아직 진행 중인** 같은 key 의 공유 조회만 `cancelQueries` 로 거둔다. 그 조회는 이 답보다 이전 서버 상태다. 「먼저 출발했나」는 진행 중 조회의 promise 가 이 요청이 출발할 때와 같은지로 본다(`Query.promise` — 공개 getter, 재시도는 같은 promise 다).
- 이 요청 **뒤에** 출발한 공유 조회는 더 새 상태라 거두지 않는다. 그 답이 나중에 오면 이 값을 덮는 것이 맞다. 같은 key 의 직접 요청끼리는 출발 순서표로 비교해, 먼저 출발한 답이 늦게 와도 나중 출발의 답을 덮지 않는다(같은 공간의 정리 둘이 함께 실패하는 경우).
- 근거: `cancelQueries` 를 고른 까닭은 쓰기 순서를 시각으로 비교하는 방법이 Query 캐시에서 성립하지 않아서다. `dataUpdatedAt` 은 **도착** 시각이라, M05 처럼 먼저 출발해 늦게 도착한 답이 오히려 더 새것으로 보인다. 출발 시각은 Query 상태에 없다. 진행 중 promise 의 정체만이 「이 조회가 내 요청보다 먼저 출발했다」를 알려 준다. 취소는 `revert` 로 이전 상태로 돌린 뒤 바로 받은 값을 써서, 화면에는 이전 값 → 새 값 한 번만 보인다. 거둔 요청은 signal 을 쓰므로 실제 연결도 끊긴다.
- 적용한 요청은 M5 가 새로 만든 직접 요청 셋이다 — 정리 실패의 끊김 판정(`useProcessingTracker` 의 `isNotionRevoked`, 연동 key), 업로드 응답 유실 복구의 목록 재조회(`useMeetingUpload` 의 `recover`, 회의 목록 key), 설정의 Notion 복귀 확인(`useNotionConnection`, 연동 key). 호출자는 받은 값으로 각자 판정하고, 캐시 쓰기·세션 검사는 더 하지 않는다. 세션이 끝났으면 `fetchLatest` 가 취소 오류로 끝내 호출자의 기존 catch → 세대 검사로 간다.
- 고치지 않은 곳: M4 온보딩 연결 단계의 직접 요청(`features/onboarding/model/useIntegrationStep.ts`)은 M4 코드라 그대로 둔다. 그 요청의 늦은 401 은 이제 `request` 의 거르기가 막는다. M4 의 `fetchQuery` 판정 네 곳(r3 검증 「남겨 둔 M4 fetchQuery 판정 지점」)도 그대로다.

**회귀 테스트.** 고친 동작을 하나씩 되돌려 실패하는지 확인했다(`.orca-loop/u4-r4-impl.md` 에 결과).

| 테스트 | 지키는 것 | 되돌리면 |
|---|---|---|
| `app/lateAsyncRaces.test.tsx` `이전 세션 요청의 늦은 401 이 다시 로그인한 새 세션을 끝내지 않는다 (U4 r3 M04)` — 판정 조회 + 대조군 | 불변식 1, 실제 로그아웃 → 로그인 → 늦은 401. 대조군은 지금 세션의 401 이 만료로 가는지 | 취소·거르기를 함께 빼면(r3) 로그인 화면으로 떨어진다 |
| 같은 파일 `보내는 중 로그아웃·재로그인하면 그 업로드의 늦은 401 이 새 세션을 끝내지 않는다 (U4 r3 M04)` | 401 거르기만 — 업로드 POST 는 취소되지 않아 늦은 401 이 실제로 도착한다 | 거르기를 빼면 실패 |
| `shared/api/client.test.ts` `끝난 세션에서 출발한 요청의 401 은 알리지 않는다 …` | 401 거르기(대조군 포함) | 거르기를 빼면 실패 |
| `shared/api/sessionScope.test.ts`, `shared/api/fetchLatest.test.ts` 의 M04 묶음 | 세션 종료가 직접 요청을 취소한다 | abort 를 빼거나 세션 신호를 넘기지 않으면 실패 |
| `app/lateAsyncRaces.test.tsx` `먼저 출발한 공유 연동 조회의 늦은 답이 끊김을 되돌리지 못한다 (U4 r3 M05)` — 캐시 무효화 / 30초 뒤 창 포커스 | 불변식 2, 설정의 연결 끊김·PM 재연결 버튼, 모달의 재연결을 따라간 뒤에도 버튼 | 먼저 출발한 조회를 거두지 않으면 실패 |
| 같은 파일 `응답을 잃은 뒤 복구 목록이 쓴 정리 중 회의를 먼저 출발한 공유 목록 조회의 늦은 답이 지우지 못한다 (U4 r3 M05)` | 불변식 2, 업로드 복구 목록 | 같다 |
| `shared/api/fetchLatest.test.ts` 의 M05 묶음 | 먼저 출발한 조회만 거둔다 · 뒤에 출발한 조회는 둔다 · 직접 요청끼리 출발 순서 | 각각 거두지 않기 / 늘 거두기 / 순서표 빼기에 실패 |

## 개정 — 2026-10-05 (2): 캐시에 쓰는 길을 공유 Query 하나로 (U4 r4 M06)

r4 검증에서 major M06 이 나왔다. 끊김 판정이 먼저 출발해 기다리는 사이 서버의 연결이 끊기고, 뒤에 출발한 공유 조회(설정의 무효화·포커스 재조회)가 revoked 를 먼저 받았다. 그 뒤 판정의 직접 요청이 받은 이전 답(connected)을 `fetchLatest` 가 캐시에 써 revoked 를 덮었다 — 서버는 끊겼는데 설정이 연결됨으로 돌아가 PM 재연결 버튼이 사라졌다(U3-3 회귀). M05 는 그 반대 순서였다. 같은 캐시에 쓰는 길이 둘(공유 Query, 직접 요청)이라 도착 순서 조합마다 구멍이 났고, 한 순서를 막으면 반대 순서가 열렸다. 4회차 미통과 뒤 사용자가 이 방향을 골랐다(2026-10-05, 완료 조건 판정 규칙 4).

**고른 길 — 판정은 공유 Query 를 묻고, 캐시에 따로 쓰지 않는다.** `shared/api/fetchFresh.ts` 하나다. 끊김 판정(`useProcessingTracker` 의 `isNotionRevoked`), 업로드 응답 유실 복구(`useMeetingUpload` 의 `recover`), Notion 복귀 확인(`useNotionConnection`)이 그 key 의 기존 query options 를 넘겨 `queryClient.fetchQuery` 로 묻는다. `fetchLatest` 와 그 테스트는 지웠다. 같은 key 의 조회는 한 번에 하나만 날아가고, 무효화·`refetch` 는 진행 중 조회를 조용히 거두고(`cancelRefetch`) 새로 물으며 거둔 조회를 기다리던 쪽도 그 새 조회의 답을 받는다(TanStack Query 5.104 `Query.fetch`). 그래서 이전 상태의 답이 더 새 답을 덮는 순서가 생기지 않는다. 공유 조회에 기대며 생기는 두 함정(위 「왜」 의 ①·②)은 이렇게 가린다.

- **시작 전에 출발한 조회의 답은 쓰지 않는다(M05).** 시작할 때 그 key 가 진행 중이면 그 조회는 판정할 일이 생기기 전의 서버 상태를 묻고 있다. 합치지 않고 `cancelQueries` 로 거둔 뒤 새로 묻는다. 시작 **뒤에** 출발한 조회는 거두지 않고 합친다 — 판정을 다시 물을 때도 거두지 않는다. 다시 물을 때마다 거두면 같은 key 의 판정 둘이 서로의 조회를 번갈아 거둔다.
- **취소돼 돌아온 이전 값은 답이 아니다(M03).** 마지막 구독이 내려가 취소되면 `fetchQuery` 가 이전 값을 돌려주거나(값이 있으면) 취소를 던진다(없으면 — StrictMode 의 시험 재마운트). 시작 뒤에 이 key 에 **조회의 답이 쓰였는지**를 캐시 사건(`updated` 의 `success`, `manual` 아님)으로 보고, 쓰이지 않았으면 같은 세션 안에서 다시 묻는다. 돌려주는 값은 그 key 의 지금 캐시 값이라 판정과 화면이 같다.
  - `dataUpdatedAt` 으로 보지 않은 까닭: 도착 시각이라 밀리초 안에 겹치면 「시작 뒤에 쓰였나」를 가리지 못하고(시계를 고정하는 테스트에서는 늘 겹친다), 손으로 쓴 값(`setQueryData` — 추적기의 실패 회의 빼기 같은)과 조회의 답을 구별하지 않는다. `dataUpdateCount` 도 같은 까닭으로 고르지 않았다. 캐시 사건은 공개 `QueryCache.subscribe` 이고, 취소의 되돌림은 `setState` 라 답으로 세지 않는다.
  - 한도 `FRESH_ATTEMPTS = 3`: 다시 묻는 것은 묻는 사이 마지막 구독이 내려갔을 때뿐이다. 다시 물은 조회에는 대개 구독이 없어 또 취소되지 않는다. StrictMode 재마운트 한 번과 사용자가 그 화면을 떠나는 것 한 번이면 둘이고, 셋째도 취소되면 「확인하지 못함」으로 끝낸다 — 호출자의 기존 catch(끊김 판정은 일반 실패 안내, 복구는 다시 올리기 안내, 복귀 확인은 연결 실패 안내)로 간다. 같은 판정이 서버를 끝없이 두드리지 않는다.
- **끝난 세션의 조회는 부작용이 없다(M04 유지).** 판정 조회가 이제 공유 Query 라 세션 정리의 취소가 닿는다. 세션을 끝내는 세 곳이 모두 세대를 올린 뒤 진행 중 조회를 거둔다 — `features/auth/lib/userScope.ts` 의 `clearUserScope`(`cancelQueries`), `app/expireSession.ts`(`cancelQueries`), `app/createApp.ts` 의 dispose(`clear` → 각 Query `destroy` 의 취소). Query 의 취소는 그 조회의 `signal` 을 abort 하고(`onCancel` → `abortController.abort()`), 연동·목록 query options 의 `queryFn` 이 그 `signal` 을 `request` 에 넘긴다. 그래서 queryFn 에 세션 신호를 `AbortSignal.any` 로 더 묶지 않았다 — 묶으려면 `fetchQuery` 에 다른 queryFn 을 넘겨야 하고, 그 queryFn 이 그 Query 의 옵션으로 남아 뒤의 무효화 재조회까지 그 세션 신호를 쥔다. `fetchFresh` 는 묻기 전과 답을 받은 뒤 세대를 확인해, 끝났으면 다시 묻지 않고 취소 오류로 끝낸다. 401 의 만료 알림은 그대로 `request` 가 출발 세대로 거른다(`sessionScope`). `sessionScope` 의 세대별 AbortController 는 유지한다 — 캐시 밖에서 세션 경계를 넘는 요청이 생기면 그 신호를 쓴다.
- M01·M02 의 현재 경로·세션 세대 검사(알림·모달·이동·추적 등록)는 바꾸지 않았다.

**알려진 동작 (코디네이터 확인, 2026-10-05).**

- **창 포커스 재조회는 진행 중 판정 조회에 합쳐진다.** TanStack 의 포커스 재조회는 `refetch({ cancelRefetch: false })` 라, 판정 조회가 진행 중이면 두 번째 요청이 출발하지 않는다. 판정 조회를 보낸 **뒤** 서버가 바뀌었다면(일반 실패 뒤 연결이 끊김) 판정·캐시·설정 화면은 그 한 답(요청 시점 connected)으로 같고, 그 뒤의 변경은 다음 조회(무효화·다음 포커스·재마운트)가 가져온다. 받은 적 없는 revoked 라 덮어쓰기가 아니다 — 불변식은 「받은 것 중 더 새 답을 오래된 답이 덮지 않는다」다. 무효화는 `cancelRefetch` 라 앞 판정 조회를 거두고 새로 묻는다. 판정도 그 새 답(revoked)을 받아 재연결 모달을 띄운다.
- 시작 때 진행 중이던 조회를 거두면 그 조회를 구독하던 화면은 새 답이 올 때까지 이전 값을 그린다(`revert`). 화면 값이 바뀌는 것은 새 답이 올 때 한 번이다.
- 같은 세션 안에서 판정 조회가 취소되면(StrictMode 의 시험 재마운트, 마지막 구독의 이탈, 다른 곳의 `cancelQueries`) 판정은 한 번 더 묻는다. 3·4회차의 직접 요청은 1회였다. 운영 빌드에는 시험 재마운트가 없다.

**쓰기 경로가 하나라는 근거.** `frontend/src` 의 production 코드에서 연동 key·회의 목록 key 에 `setQueryData` 하는 곳은 둘뿐이다 — 추적기 `onFailed` 의 실패 회의 빼기(`useProcessingTracker.ts`, D-093. 판정 결과가 아니라 서버 목록을 기다리지 않는 손 쓰기이고 곧 그 목록을 무효화한다. `fetchFresh` 는 손 쓰기를 답으로 세지 않는다)와 M4 온보딩 연결 단계(`useIntegrationStep.ts`, M4 코드라 그대로). M5 판정 세 곳은 직접 요청(`fetchIntegrations`·`fetchMeetingList` 호출)도 `setQueryData` 도 하지 않는다. 검색 결과는 `.orca-loop/u4-r5-impl.md` 에 있다.

**고치지 않은 곳.** M4 의 `fetchQuery` 판정 네 곳, M4 온보딩 연결 단계의 직접 요청과 `setQueryData`, 업로드 진입 판정(`useUploadEntry`, 화면 구독의 `isFetchedAfterMount`).

**바뀐 테스트.** `fetchLatest` 를 지우며 사라진 검사는 새 구조에서 같은 동작을 보는 검사로 바꿨다. 되돌림 실험 결과는 `.orca-loop/u4-r5-impl.md` 에 있다.

| 지운 검사 (`shared/api/fetchLatest.test.ts`) | 대신하는 검사 |
|---|---|
| `끝난 세션의 요청은 부작용이 없다 (U4 r3 M04)` — 세션 신호 취소·캐시 쓰기 없음 | `shared/api/fetchFresh.test.ts` `끝난 세션의 조회는 부작용이 없다 (U4 r3 M04)` 세 개 — 세션 정리의 취소로 요청 signal abort·다시 묻지 않음·늦은 답 캐시 없음(이전 값 있음/없음), 세대만 바뀐 채 온 답을 넘기지 않음. 앱 수준은 `app/lateAsyncRaces.test.tsx` 의 M04 두 검사·M02 로그아웃 캐시 검사가 그대로 지킨다 |
| `오래된 응답은 새 결과를 덮지 못한다 (U4 r3 M05)` › 먼저 출발한 공유 조회만 거둔다 | `fetchFresh.test.ts` `시작 전에 출발한 조회의 답은 쓰지 않는다 (U4 r3 M05)` |
| 같은 묶음 › 뒤에 출발한 공유 조회는 둔다 | `fetchFresh.test.ts` `캐시에 쓰는 길은 공유 Query 하나다 (U4 r4 M06)` › 무효화로 뒤에 출발한 조회의 답을 판정도 받고 판정 조회의 이전 답은 캐시에 닿지 않는다 · 창 포커스는 합쳐진다 |
| 같은 묶음 › 같은 key 의 직접 요청끼리 출발 순서 | 같은 묶음 › 같은 key 의 판정 둘이 한 조회의 답을 함께 받는다(서로 거두며 되풀이하지 않는다) |

- `app/lateAsyncRaces.test.tsx` `같은 세션 안에서 공유 연동 조회가 취소돼도 끊김 판정은 …` 의 연동 요청 기대값을 1 → 2 로 바꿨다. 취소돼 돌아온 값으로 판정하지 않고 다시 묻는 것이 이번 지시(M03 재발 방지)다. 제목도 「끝까지 기다려」 → 「다시 물어」.
- 같은 파일 M03 검사는 다시 묻는 조회까지 붙잡고(`holdIntegrations(…, { every: true })`) 떠났을 때만 한 번 더 묻는 것을 단언한다. Notion 복귀 확인을 붙잡는 도구(`notionConnection.test.tsx` 의 `holdVerification`, `lateAsyncRaces.test.tsx` 의 `openVerifying`)도 StrictMode 의 두 번째 조회까지 붙잡는다 — 기대값은 그대로다.
- 새 검사: `app/lateAsyncRaces.test.tsx` `먼저 출발한 판정 조회의 이전 답이 뒤에 받은 끊김을 덮지 못한다 (U4 r4 M06)` 두 개(무효화 / 30초 뒤 창 포커스), `fetchFresh.test.ts` 의 M03 묶음(되돌린 이전 값·다시 물을 때 시작 뒤 출발한 조회에 합치기·처음 받는 조회의 취소·손 쓰기·한도·실패).

## 다시 고민할 때

- 실 백엔드가 push(웹소켓·SSE)로 상태를 알리면 polling 을 걷고 같은 `finishMeeting` 지점에 붙인다.
- 공간마다 정리를 여럿 동시에 허용하면(D-088·D-089 변경) 헤더 링크가 하나만 고르는 규칙(`useProcessingMeetingId`)을 다시 본다.
- 끊김·미연결 모달 설명은 돌아오는 곳을 이름으로 적는다 — `연결하면 회의 올리기로 돌아와요.` r1 의 「이 화면으로 돌아와요」는 업로드 화면 기준이라, 실패 뒤 회의록 목록에서 띄운 끊김 모달에서는 실제 목적지(업로드, D-098·D-100)와 달랐다(U4 r1 N01). 연결 뒤 목적지가 업로드 말고도 생기면 그때 호출 맥락별로 문구를 나눈다.
- 「판정을 시작한 뒤의 서버 상태」가 필요한 판정을 새로 만들면 그 key 의 공유 Query 를 `fetchFresh` 로 묻는다. 요청 함수를 직접 부르고 `setQueryData` 하면 같은 캐시에 쓰는 길이 둘이 돼 도착 순서의 구멍(U4 r3 M05, r4 M06)이 다시 열린다. M4 온보딩 연결 단계의 직접 요청(`useIntegrationStep`)도 그때 옮길지 본다.
- TanStack Query 를 올리면 `fetchFresh` 가 기대는 동작을 `shared/api/fetchFresh.test.ts` 로 확인한다 — 무효화·`refetch` 의 `cancelRefetch` 가 진행 중 조회를 조용히 거두고 그 promise 가 새 조회에 이어지는 것, 창 포커스 재조회가 진행 중 조회에 합쳐지는 것, 마지막 구독이 내려갈 때의 `cancel({ revert: true })`, 캐시 사건 `updated`/`success` 의 `manual`.
- data router(`createBrowserRouter`)로 옮기면 `useNavigation` 으로 `useLivePathname` 을 바꿀 수 있는지 본다.
