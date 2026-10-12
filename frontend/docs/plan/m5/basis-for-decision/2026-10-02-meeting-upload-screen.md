# 회의 올리기 화면과 Notion 연결 복귀 — 무엇을 어디에 두는가

- 날짜: 2026-10-02
- 상태: 결정

## 고민

M5 U3 에서 회의 올리기 화면, 진입 판정, Notion 차단 모달, 설정의 Notion 연결 영역을 만들었다. 정할 것이 넷이었다.

- **추적기 등록 지점.** 업로드 202 응답의 회의를 U4 의 처리 추적기(앱 계층)가 받아 가야 한다. 업로드는 feature 이고 추적기는 app 이다. feature 는 app 을 import 할 수 없다.
- **진입 판정의 캐시.** 회의 목록·연동 상태는 30초 동안 최신으로 본다. 진입 판정이 캐시를 믿으면 그 사이 시작된 정리나 끊긴 연결을 놓친다.
- **복귀 목적지.** 차단 모달 → 설정 → OAuth → 업로드로 돌아오는 길에 목적지를 주소에 싣는다. 주소는 사용자가 바꿀 수 있다.
- **캔버스와 결정의 어긋남.** Upload 캔버스에는 결정이 지운 요소가 남아 있다.

## 고른 길

**추적기 등록 지점 — `entities/meeting` 의 Zustand store (`trackMeeting`).**

```
features/meeting-upload ──trackMeeting()──▶ entities/meeting/model/processingTracker ◀──읽기── app (U4 추적기)
```

- ID 목록(`{ workspaceId, meetingId }[]`)만 둔다. 회의 객체는 넣지 않는다 — 상태·진행은 Query 상세 캐시가 갖는다 (G5).
- persist 하지 않는다. 새로고침하면 추적기가 현재 공간 목록에서 처리 중 회의를 다시 찾는다 (U4-2).
- 등록은 `useMutation` 의 `onSuccess` 에 건다. 응답 전에 화면을 떠났어도 등록된다. 화면 이동은 화면이 남아 있을 때만 한다.
- 409 `MEETING_PROCESSING_IN_PROGRESS` 와 「응답을 잃은 뒤 목록에서 찾은 처리 중 회의」도 같은 함수로 등록한다.

**진입 판정 — 이 화면의 구독만 `staleTime: 0`.**

- 회의 목록을 먼저, 처리 중 회의가 없을 때만 연동 상태를 본다. 둘 다 마운트 뒤 새로 받은 값(`isFetchedAfterMount`)으로만 판정한다.
- `refetchOnMount: 'always'` 로는 부족했다. 연동 조회는 꺼진 채(`enabled: false`) 마운트되는데, 30초 안에 받아 둔 캐시가 있으면 켜져도 다시 받지 않는다. 설정에서 OAuth 복귀 확인 직후 업로드로 오면 판정이 끝나지 않았다(통합 테스트에서 발견).
- `ready` 가 되면 고정한다. 폼을 쓰는 동안의 재조회가 화면을 처리 화면이나 모달로 바꾸지 않는다. 그 사이의 변화는 업로드 응답 409 가 알린다.
- 조회 실패는 미연결로 보지 않는다. 다시 시도 UI 를 보인다.

**복귀 목적지 — `paths.settingsNotion(ws, next)` + 받는 쪽 정확 비교.**

- 설정 주소는 `/workspaces/{ws}/settings?section=notion&next=/workspaces/{ws}/meetings/upload` 다.
- 설정은 `next` 를 `safeReturnPath` 로 정규화한 뒤 **그 공간의 업로드 경로와 정확히 같을 때만** 받는다(`uploadReturnTarget`). 외부·다른 공간·같은 공간의 다른 화면·검색이 붙은 주소는 모두 버린다.
- OAuth `state` 에는 설정 주소(`next` 포함)를 그대로 싣는다. 콜백이 결과를 붙여 설정으로 돌려보내면, 설정이 연동 상태를 다시 조회해 `connected` 일 때만 업로드로 `replace` 한다. 취소·실패는 설정에 머문다. 복귀 표시는 지우고 `section`·`next` 는 남긴다.
- 온보딩의 `useIntegrationStep` 은 feature 끼리 import 할 수 없어 쓰지 않았다. 같은 방식(직접 `fetchIntegrations` → `setQueryData`, `handled` ref)을 `features/notion-connection` 에 다시 썼고, 재사용한 것은 entities 의 `integrationStartUrl`·`readIntegrationReturn` 과 shared 의 `withoutOAuthResult`·`leaveApp` 이다. 직접 요청 → `setQueryData` 부분은 U4 r5 에서 공유 Query 판정(`fetchFresh`)으로 바뀌었다 — 아래 「개정 — 2026-10-06」.
- 끊김 모달(D-100)의 `Notion 다시 연결하기` 도 설정 영역으로 보낸다. 「재연결 절차를 시작한다」를 설정에서 시작하는 것으로 읽었다 — 계획 §3 이 연결 버튼을 설정 이동으로 정했다.

**캔버스와 다른 곳.** 결정·계획을 따랐다.

| 캔버스 | 화면 | 근거 |
|---|---|---|
| `텍스트 회의록` 탭 | 없음 | D-084 |
| `올리는 동안 창을 닫아도 됩니다.` | `정리하는 동안 다른 화면을 써도 괜찮아요.` | D-094 |
| `m4a · mp3 · wav · mp4 — [용량 · 길이 제한]` | `mp3 · wav · m4a · ogg · webm — 최대 200 MiB · 2시간` | 계획 §1, 2026-10-02-meeting-upload-policy |
| `확인이 끝나기 전에는 Notion에 아무것도 쓰지 않아요.` | `회의록과 확실한 태스크는 바로 Notion에 반영하고, 확인이 필요한 항목은 승인한 뒤 반영해요.` | D-101, 완료 조건 U5-8 |
| 파일 카드 `48.2 MB · 업로드 완료` | `52:14 · 48.2 MiB`. 전송 상태는 폼 아래 상태 영역 | 한도 단위 MiB, U3-7 |
| 날짜 칸의 달력 아이콘 | 네이티브 `type="date"` (브라우저 달력) | 아이콘이 두 겹이 된다 |

- 크기 값 셋은 캔버스 실측을 그대로 썼다: 본문 폭 700px(`max-w-[700px]`), 제목 30px, 날짜 칸 200px. 설정 절 제목 17px·배지 11px 도 Settings 캔버스 실측이다.
- 아이콘 넷(`upload`·`mic`·`close`·`calendar`)을 캔버스 경로 그대로 `shared/ui/icon` 에 더했다.

**길이 읽기.** `<audio preload="metadata">` + object URL. 성공·오류·시간 초과(15초) 어느 쪽이든 끝나는 순간 URL 을 해제하고 `src` 를 비운다. MediaRecorder WebM 처럼 길이가 `Infinity` 면 끝으로 한 번 감아 `durationchange` 로 받는다. jsdom 은 미디어를 읽지 못해 통합 테스트는 이 함수만 바꿔 끼우고, 함수 자체는 가짜 오디오 요소로 단위 테스트한다. 실제 Chromium 에서는 1초 WAV 가 `00:01`, 깨진 mp3 가 「길이를 읽지 못했어요」로 나오는 것을 확인했다.

## 왜

- entities 는 features 와 app 이 함께 import 할 수 있는 가장 낮은 층이다. 콜백 props 로 넘기려면 라우터가 lazy 화면에 props 를 꽂아야 하고, U4 의 처리 화면·헤더 링크도 같은 목록을 읽어야 해 결국 공용 자리가 필요하다.
- 진입은 「들어온 순간의 서버 상태」가 기준이다. 캐시를 믿고 폼을 열면 파일을 고른 뒤에야 409 로 막혀 입력을 버리게 된다.
- 복귀 목적지를 허용 목록 하나(그 공간의 업로드)로 좁히면 열린 리다이렉트와 공간 넘나들기를 한 비교로 막는다.

## 개정 — 2026-10-06: 복귀 확인·응답 유실 복구는 공유 Query 판정으로 (U4 r5)

위 「복귀 목적지」의 직접 `fetchIntegrations` → `setQueryData` 는 U3 때의 방식이다. 지금 코드는 이렇게 하지 않는다.

- **Notion 복귀 확인**(`features/notion-connection/model/useNotionConnection.ts`)은 연동 상태의 공유 Query 를 `fetchFresh(queryClient, integrationsQueryOptions(workspaceId))` 로 묻고, 그 Query 가 캐시에 쓴 값으로 `connected` 를 판정한다.
- **업로드 응답 유실 복구**(`features/meeting-upload/model/useMeetingUpload.ts` 의 `recover`)도 `fetchMeetingList` 를 직접 부르지 않고 `fetchFresh(queryClient, meetingListQueryOptions(workspaceId))` 로 묻는다.
- 바꾼 까닭: U4 r3~r4 에서 직접 요청이 공유 조회와 같은 캐시에 쓰는 두 번째 길이 돼, 도착 순서에 따라 오래된 답이 새 답을 덮었다(U4 r3 M05, r4 M06). 판정은 `shared/api/fetchFresh.ts` 하나로 모였다 — 시작 전에 출발한 조회는 거두고, 취소돼 돌아온 이전 값은 답으로 치지 않으며, 끝난 세션의 조회는 부작용이 없다.
- 근거·회귀 테스트: [`2026-10-03-processing-tracker.md`](2026-10-03-processing-tracker.md) 「개정 — 2026-10-05 (2)」, `shared/api/fetchFresh.test.ts`, `app/lateAsyncRaces.test.tsx`.

`handled` ref, 정확 비교(`uploadReturnTarget`), `state` 에 설정 주소를 싣는 것, 확인 뒤 지금 경로·미저장 입력을 보고 옮기는 것(U3 r1 M02)은 그대로다. M4 온보딩의 `useIntegrationStep` 은 아직 직접 요청이다 — 옮길지는 처리 추적 결정의 「다시 고민할 때」에 있다.

## 다시 고민할 때

- U4 가 추적기를 만들면서 store 에 상태(완료 알림 여부 등)를 더하고 싶어지면: 서버 데이터가 아닌 UI 상태인지 먼저 본다. 회의 객체는 Query 에 둔다.
- 실 API 가 OAuth `start`·`callback` 을 구현하면: `state` 길이 제한과 인코딩을 확인한다. 지금은 설정 경로 + `next` 라 200자 안쪽이다.
- 업로드 PM 강제(계약 §4.0-②-17)가 들어오면 403 을 `classifyUploadError` 에 더한다.
