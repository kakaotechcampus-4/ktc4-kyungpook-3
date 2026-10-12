# 회의 업로드의 권한·한도·경로 — 누가, 무엇을, 어느 주소로 올리는가

- 날짜: 2026-10-02
- 상태: 결정

## 고민

M5 를 시작하면서 결정 문서와 코드가 비어 있거나 서로 어긋난 곳이 셋이었다.

- **권한.** D-090 은 「PM 외 팀원의 업로드 권한이 확정된 뒤」 처리 중 진입 동작을 정한다며 보류돼 있다. 실 API 는 소속(`get_current_member`)만 보고 역할은 보지 않아 일반 팀원도 올릴 수 있다(`backend/app/api/workspaces.py` `upload_meeting`).
- **한도.** 결정 문서에 형식·크기·길이 상한이 없다. 서버도 검사하지 않는다 — `AUDIO_TOO_LARGE`·`AUDIO_FORMAT_UNSUPPORTED` 는 코드만 있다(계약 §4.4).
- **경로.** 회의 화면은 `/workspaces/:workspaceId/meetings/:meetingId?` 하나다. 업로드를 `meetings/upload` 에 두면 `upload` 가 회의 ID 로 읽힐 수 있고, 처리 화면 주소는 아예 없다.
- **진행 표시.** 업로드 진행을 보여 주려면 `request()` 가 전송 진행을 넘겨야 한다. axios 의 `AxiosProgressEvent` 를 그대로 넘기면 화면이 axios 에 묶인다.

## 고른 길

**권한 — 업로드는 PM 만, 처리·회의록은 팀원 모두.**

| 경로 | 가드 | 일반 팀원 |
|---|---|---|
| `/workspaces/:workspaceId/meetings/upload` | `RequireTeamMember` → `RequireOnboardingComplete` → `RequirePM` | 업무 API 0회로 태스크 목록 + `접근 권한이 없어요` 토스트 (기존 D-162 동작) |
| `/workspaces/:workspaceId/meetings/:meetingId/processing` | `RequireTeamMember` → `RequireOnboardingComplete` | 볼 수 있다 |
| `/workspaces/:workspaceId/meetings/:meetingId?` | 같음 | 볼 수 있다 (확인 필요 영역만 숨김, D-104) |

- D-090 의 보류 조건이 풀렸다. PM 이 처리 중 `회의 올리기`에 들어오면 현재 처리 화면으로 보낸다(U3·U4 에서 구현).
- 서버 강제는 계약 §4.0-②-17 로 요청했다. 가드는 UX 장치다 — 서버가 막는다고 가정하지도, 가드를 보안 대책으로 보고하지도 않는다(계약 §4.0).
- **MSW 도 PM 을 강제하지 않는다.** 실 API 의 현재 동작을 흉내 낸다(integration DELETE 의 204 와 같은 원칙). 막는 쪽이 아니라 여는 쪽이라 「mock 은 되는데 실 API 에서 깨지는」 방향의 차이가 생기지 않는다.

**한도 — MP3·WAV·M4A·OGG·WebM, 200 MiB, 2시간. 경계값은 허용.**

```ts
// entities/meeting/model/uploadPolicy.ts
export const MEETING_UPLOAD_POLICY = {
  maxBytes: 200 * 1024 * 1024,   // 209,715,200 바이트. 정확히 이 크기는 통과, 1 바이트라도 넘으면 막는다
  maxDurationMs: 2 * 60 * 60 * 1000,
  extensions: ['mp3', 'wav', 'm4a', 'ogg', 'webm'],
} as const
```

- 「MB」가 아니라 **MiB** 다. 파일 크기는 바이트로 비교한다.
- 길이는 브라우저가 읽는다. 읽지 못하면 형식 확인 안내와 함께 제출을 막는다(계획 §3). 서버가 길이를 모르므로 화면이 유일한 검사다.
- 413 `AUDIO_TOO_LARGE` 는 서버가 언젠가 낼 수 있는 응답으로 처리한다(폼에 표시). MSW 는 크기를 검사하지 않는다 — 화면이 먼저 막고, 413 처리는 테스트의 `server.use()` override 로 확인한다.

**경로 — 정적 조각을 별도 라우트로.**

```tsx
<Route path="meetings/upload" element={<RequirePM />}>…</Route>
<Route path="meetings/:meetingId/processing" element={…} />
<Route path="meetings/:meetingId?" element={…} />
```

React Router 는 정적 조각을 동적 조각보다 높게 친다. 그래도 순서와 무관하게 `upload` 가 `:meetingId` 로 읽히지 않는지 `matchRoutes` 로 확인한다(`app/router/meetingRoutes.test.tsx`).
주소는 `paths.meetingUpload(ws)`·`paths.meetingProcessing(ws, id)` 로만 만든다. 회의 ID 가 `upload` 인 회의는 없다 — 서버 ID 는 `mt_` 로 시작한다.

**진행 콜백 — `UploadProgress { loaded, total: number | null }`.**

- `RequestOptions.onUploadProgress` 가 axios 이벤트를 `toUploadProgress()` 로 바꿔 넘긴다. 화면·feature 는 axios 타입을 보지 않는다.
- 전체 크기를 모르면(`lengthComputable` 거짓, `total` 없음·0) `total: null` — 화면은 불확정 진행으로 그린다.
- 전송률 100% 는 「다 보냈다」일 뿐이다. 202 응답을 받아야 처리 화면으로 간다(U3).

**캐시 key 와 최신 시간.** 모두 `workspaceKey(workspaceId, …)` 로 만든다.

| 데이터 | key | staleTime |
|---|---|---|
| 회의 목록 | `['workspace', ws, 'meetings', 'list']` | 30초 |
| 회의 상세 | `['workspace', ws, 'meetings', 'detail', id]` | 기본(30초). 처리 중 polling 은 U4 가 `refetchInterval` 로 |
| 회의록 본문 | `['workspace', ws, 'minutes', id]` | 5분 — `done` 회의만 부른다 |
| 추출 결과 | `['workspace', ws, 'extractions', id]` | 30초 |
| 대기 승인 목록 | `['workspace', ws, 'approvals', { status: 'pending' }]` | 30초 |

목록과 상세는 `meetingKeys(ws)` 접두어 아래에 있어 정리가 끝나면 한 번에 무효화할 수 있다.
회의 상세·추출은 경로에 워크스페이스가 없다(봇 경로). 그래도 key 에 넣는다 — 응답의 `workspaceId` 가 URL 과 같은지는 화면이 확인한다(U5).

## 왜

- 업로드를 PM 으로 좁히면 D-090 이 닫히고, 처리 중 진입·Notion 차단 모달·업로드 CTA 노출을 한 기준으로 판단할 수 있다. 회의록은 D-105 로 이미 팀원 모두에게 열려 있다.
- 한도는 서버 STT 처리 시간과 메모리(결정 문서의 서버 자원 제약, D-088)에 맞춘 값이다. 경계를 허용으로 두면 「200 MiB 이하」라는 안내 문구와 판정이 일치한다.
- 업로드를 `meetings/:meetingId?` 의 특수값으로 처리하면 회의 화면이 `meetingId === 'upload'` 를 매번 걸러야 하고 PM 가드를 그 화면 안에 넣어야 한다. 별도 라우트면 기존 가드를 그대로 쓴다.
- 진행 값을 우리 타입으로 바꾸면 axios 를 다른 전송으로 바꿔도 화면이 그대로다. `null` 로 「모름」을 표현하면 0% 와 불확정이 섞이지 않는다.

## 다시 고민할 때

- 백엔드가 §4.0-②-17 을 반영해 업로드에 PM 을 강제하면: MSW upload handler 에도 403 `FORBIDDEN` 을 넣는다. 화면은 그대로다.
- 서버가 크기·형식·길이를 검사하기 시작하면: 그 상한이 `MEETING_UPLOAD_POLICY` 와 같은지 확인한다. 서버가 더 좁으면 정책을 맞춘다.
- 일반 팀원의 업로드를 허용하기로 바뀌면: `meetings/upload` 의 `RequirePM` 을 빼고 업로드 CTA 노출 규칙(U5)을 함께 바꾼다.
