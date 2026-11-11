# 결과 — '원문 듣기'가 회의록 녹음을 근거 시각부터 튼다 (#676)

- 기록일: 2026-11-11
- 대상: [#676](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/676) (BE 이슈 #659, BE PR [#670](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/670))
- 기준: develop `a9dabe26`
- 상태: **MSW 기준으로 반영했다.** BE PR #670 은 머지 전이다. 단위(Vitest·RTL)와 MSW 개발 서버(Chromium) E2E 로 확인했다. 실서버·실제 S3·Safari 는 확인하지 않았다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #676 이다. BE 는 업로드·디스코드 회의 녹음을 S3 에 7일 보관하고 `GET /meetings/{id}/audio` 를 S3 임시 주소로 302 하게 바꿨다(PR #670). 회의록 응답에 `audio` 가, 오류 코드에 `AUDIO_NOT_AVAILABLE` 이 더해졌다. 이슈가 BE 머지 전에 MSW 로 먼저 만들어 달라고 해서 명세대로 MSW 를 만들고 그 위에서 구현했다.

지금까지 '원문 듣기'는 회의록 페이지로 옮기기만 했다. 이제 근거 시각을 주소의 `t` 로 넘기고, 회의록이 녹음을 그 시각으로 옮겨 튼다.

## 실제 구현 및 관련 코드

- 근거 시각 넘기기: [routes.ts](../../../../../src/shared/config/routes.ts) 에 `MEETING_PARAMS = { at: 't' }` 를 두고 `paths.meetings(ws, id, atMs)` 가 0 이상의 유한한 시각이면 `?t=<ms>` 를 붙인다. 승인 상세의 대표 근거·합쳐진 근거([ApprovalReview.tsx](../../../../../src/widgets/approval-review/ui/ApprovalReview.tsx))와 태스크 목록의 확인 필요 카드([ApprovalCard.tsx](../../../../../src/widgets/task-board/ui/ApprovalCard.tsx))가 쓴다. 시각이 null 이면 붙이지 않는다.
- 회의록 `audio`: [minutes 스키마](../../../../../src/shared/types/api/minutes.ts)가 `{content_type, expires_at} | null` 을 읽는다. 키가 없는 이전 서버와 모양이 틀린 값은 null 이고 회의록은 그대로 보인다. 도메인 값은 `{contentType, expiresAt} | null` 이다([types.ts](../../../../../src/entities/minutes/model/types.ts)). 들을 수 있는지는 null 인지로만 판단하고 `expires_at` 으로 만료를 판정하지 않는다.
- 플레이어: [features/meeting-audio](../../../../../src/features/meeting-audio) 의 `MeetingRecording` 을 [MinutesDetail.tsx](../../../../../src/widgets/meeting-minutes/ui/MinutesDetail.tsx) 의 정리 끝난 회의록 탭 줄 아래, 패널 위에 둔다([MinutesTabs.tsx](../../../../../src/widgets/meeting-minutes/ui/MinutesTabs.tsx) `beforePanel`). 어느 탭을 골라도 같은 자리다. `<audio controls preload="metadata" src="/api/v1/meetings/{id}/audio">` 이고 `crossOrigin`·Web Audio 는 쓰지 않는다. `t` 가 있으면 메타데이터가 온 뒤 그 초로 옮기고 재생을 시도한다. 자동 재생이 막히면 그 자리에 멈춰 둔다. `audio` 가 null 이면 플레이어가 없고, `t` 로 왔을 때만 「녹음이 없거나 보관 기간(7일)이 지났어요.」를 보인다. 회의나 `t` 가 바뀌면 플레이어를 새로 만든다.
- 재생 상태: [playback.ts](../../../../../src/features/meeting-audio/model/playback.ts) 의 판별 유니온(`loading`·`ready`·`checking`·`unavailable`·`failed`)과 순수 reducer 다. [useMeetingAudio.ts](../../../../../src/features/meeting-audio/model/useMeetingAudio.ts) 는 `<audio>` 이벤트와 확인 요청만 잇는다.
- 재생 오류: `error` 뒤 [probeMeetingAudio](../../../../../src/entities/meeting/api/meetingAudio.ts) 가 같은 경로를 `fetch(…, {credentials: 'include', redirect: 'manual'})` 로 한 번 묻는다. 404 `AUDIO_NOT_AVAILABLE` 이면 `details.reason` 으로 `expired`(「보관 기간(7일)이 지나 녹음을 들을 수 없어요.」)·`no_recording`(「이 회의는 녹음이 없어요.」)을 가르고, 모르는 이유는 일반 문구다. 302(`opaqueredirect`)·2xx 면 임시 주소가 끝난 것으로 보고 `<audio>` 를 새로 만들어 같은 경로를 다시 부르고 듣던 위치로 옮기며, 재생 중이었으면 이어 튼다. 자동 다시 부르기는 받기에 성공(`loadeddata`·`playing`)할 때마다 한 번이다. 그 밖(권한·삭제·네트워크·5xx)이거나 다시 부른 주소도 받기 전에 실패하면 「녹음을 불러오지 못했어요.」와 `다시 시도` 다. local 저장소의 200 응답은 본문을 받지 않고 끊는다.
- 오류 코드: [errors.ts](../../../../../src/shared/api/errors.ts) 에 `AUDIO_NOT_AVAILABLE` 을, [errorMessages.ts](../../../../../src/shared/api/errorMessages.ts) 에 문구를 더했다.
- 화자 지정 화면: [SpeakerAssignmentForm.tsx](../../../../../src/features/speaker-assignment/ui/SpeakerAssignmentForm.tsx) 는 `audio` 가 null 인지로 샘플 버튼만 정하고, 지정 화면은 `awaiting_speakers` 에서만 폼을 그린다. 「done 이면 null」을 가정하는 화면 코드는 없어 고치지 않았다. MSW 의 화자 조회([speakerFlow.ts](../../../../../src/shared/mock/speakerFlow.ts) `speakerViewOf`)만 `done`·`failed` 면 null 로 냈다. 이제 `failed` 만 null 이고 `done` 은 보관 기간 동안 값이 있다.
- MSW: [handlers/meetingAudio.ts](../../../../../src/shared/mock/handlers/meetingAudio.ts) 가 `/meetings/{id}/audio` 를 맡는다(화자 handler 에서 옮김). done 회의는 팀원 모두, 그 밖에는 PM 만 듣고, 들을 수 있으면 302 로 같은 출처의 모의 S3 주소를 준다. 모의 S3 는 600초 무음 WAV 를 Range 206 으로 준다. 들을 수 없는 이유는 [meetingAudio.ts](../../../../../src/shared/mock/meetingAudio.ts) 가 BE `_row_and_reason` 순서로 정한다. 픽스처 `mt_09` 는 들을 수 있고, `mt_07` 은 기간이 지났고, `mt_08`(채팅)은 녹음이 없다. 새 시나리오 `meeting-audio-expired`. [MSW 안내](../../../../msw-guide.md) 「회의 녹음 재생」.
- 방침 문구: [publishedPolicies.ts](../../../../../src/shared/config/publishedPolicies.ts) 의 약관 6절·방침 4절 「성공 인계한 회의의 원본·파생 음성은 삭제」를 「웹에서 다시 들을 수 있도록 최대 7일 보관한 뒤 삭제」로 바꾸고, 업로드 회의가 처리 중이면 그 기간을 넘겨 남을 수 있다고 적었다. 방침 4절에는 기간을 세는 기준(업로드는 받은 시각, Discord 는 끝난 시각)도 적었다. 방침의 안전 조치 문장 「화자 지정용 음성 조회는 PM 권한을 검사」도 이제 틀려서 「정리가 끝난 회의만 팀원에게 들려주고 그 밖에는 PM 권한을 검사」로 고쳤다. `POLICY_VERSION` 은 올리지 않았다. `npm run policy:docs` 로 [docs/policy](../../../../../../docs/policy) 를 다시 만들었다.
- 계약: [대표 계약](../../../../contracts/frontend-api-contract.md) §2.3.1 에 「회의 녹음 재생과 회의록 `audio` (#676)」를 더하고, 화자 지정의 `audio`·`/audio` 설명에 PR #670 뒤 바뀌는 점을, §1 오류 코드·§4.4 회의록 응답·§5.5 화면 표에 `audio`·`AUDIO_NOT_AVAILABLE` 을 적었다. 상태는 「BE 구현(PR #670, 머지 전), FE 구현(MSW 기준, 실서버 미검증)」이다.
- 검증 스킬: `meetings` 기능에 새 E2E 를 등록하고 [기능 지도](../../../../../../.cursor/skills/verify-managers-manager/features/meetings.md)에 절차를 더했다.

## 설계에서 정한 것

- 다시 부르기는 `src` 를 다시 넣고 `load()` 하는 대신 `<audio>` 의 `key` 를 바꿔 새 요소를 만든다. 결과(같은 경로를 다시 불러 새 302 를 받음)는 같고, reducer 의 상태와 DOM 을 따로 맞추는 명령형 코드가 없다. 새 요소라 음량·재생 속도 설정은 처음 값으로 돌아간다.
- 플레이어는 탭 줄 아래에 둔다. 처음에는 머리와 탭 줄 사이에 두었는데, 녹음 유무는 회의록 응답이 와야 알아서 뼈대에서 본문으로 바뀔 때 탭 줄이 플레이어 높이(54px)만큼 밀렸다. 기존 E2E [meeting-skeleton.e2e.ts](../../../../../e2e/meeting-skeleton.e2e.ts)(UX1-M01·M03·M04, 탭 줄이 움직이지 않는다)가 8건 실패해 옮겼다. 지금은 패널 내용만 그만큼 아래에서 시작한다.
- 모의 녹음은 600초다. `mt_09` 의 근거·전사 시각(8분까지)이 모두 안에 든다. 실제 회의 길이(45분)로 만들면 약 43 MB 라 줄였다. 더 뒤 시각은 브라우저가 녹음 끝으로 자른다.

## 완료조건 확인

| 이슈 #676 요청 | 상태 | 근거 |
|---|---|---|
| '원문 듣기'에서 `?t=<at_ms>` 넘기기 | 충족 | 단위(경로·승인 상세·합쳐진 근거·목록 카드), E2E |
| `minutes.audio` 가 있으면 `<audio>` 를 그리고 `at_ms / 1000` 초로 옮기기, null 이면 안내 | 충족 | 단위(RTL), E2E(Chromium) |
| `AUDIO_NOT_AVAILABLE` 의 `details.reason` 으로 안내, 임시 주소 만료면 `src` 를 다시 넣고 그 위치로 | 충족(MSW) | 단위(reducer·probe·RTL), E2E 의 다시 부르기 |
| 화자 지정 화면의 「done 이면 null」 가정 확인 | 확인함 | 화면 코드에는 없다. MSW 만 고쳤다(단위) |
| MSW: `minutes.audio`, `AUDIO_NOT_AVAILABLE`, `/audio` 302 | 충족 | 단위(MSW handler) |
| FE 대표 계약 | 충족 | 위 계약 항목 |
| 방침 문구, `POLICY_VERSION` 유지 | 충족 | `npm run policy:check` |

## #676 「확인할 것」의 답

- **`crossOrigin`·fetch·Web Audio**: `<audio>` 에 `crossOrigin` 을 두지 않고 Web Audio 도 쓰지 않는다. 재생 오류 뒤에만 `fetch` 를 쓰지만 같은 출처의 `/api/v1/meetings/{id}/audio` 에 `redirect: 'manual'` 이라 302 를 따라가지 않는다. S3 에 가는 요청은 `<audio>` 의 미디어 요청뿐이라 버킷 CORS 는 필요 없다. 운영 CSP 를 쓰면 `media-src` 가 S3 출처를 허용해야 한다는 점은 BE 결정 기록 그대로다.
- **302 를 따라간 S3 주소의 구간 이동(Safari 포함)**: 실제 버킷과 Safari 로는 확인하지 못했다. 이 환경에 Playwright WebKit 이 설치돼 있지 않아 WebKit 으로도 돌리지 않았다. MSW 의 302 → 같은 출처 모의 S3(WAV, Range 206) 에서 Chromium 이 165초·300초로 구간 이동하는 것만 E2E 로 확인했다.

## 검증

- 단위(Vitest·RTL), 전체: `npm test` 346 파일 4491 테스트 통과(2026-11-11).
  - [routes.test.ts](../../../../../src/shared/config/routes.test.ts): `t` 를 붙이는 값과 붙이지 않는 값(null·음수·NaN·무한·목록 주소).
  - [playback.test.ts](../../../../../src/features/meeting-audio/model/playback.test.ts): 근거 시각 시작, 들을 수 없음, 임시 주소 만료 뒤 같은 위치로 다시 부르기, 받기 전 두 번째 실패는 `failed`, 받기에 성공하면 다시 한 번, 다시 시도.
  - [meetingAudio.test.ts](../../../../../src/entities/meeting/api/meetingAudio.test.ts)(probe): `opaqueredirect`·302·2xx·`AUDIO_NOT_AVAILABLE`(모르는 이유 포함)·그 밖의 오류. MSW 로 302 를 따라가지 않아 모의 S3 요청이 없다.
  - [meetingAudio.test.tsx](../../../../../src/app/meetingAudio.test.tsx)(앱 전체): 근거 시각으로 옮겨 틀기, 시각 없이 열기, 녹음 없는 회의의 안내·무표시, 재생 중 기간이 지나 `expired` 안내, 임시 주소 만료 뒤 새 요소가 같은 위치로 이어 틀기, 두 번째 실패와 `다시 시도`.
  - [mapper.test.ts](../../../../../src/entities/minutes/model/mapper.test.ts)·[minutesQuery.test.ts](../../../../../src/entities/minutes/api/minutesQuery.test.ts): `audio` 매핑, 키 없음·모양 틀림이 null.
  - [MSW meetingAudio.test.ts](../../../../../src/shared/mock/meetingAudio.test.ts)·[speakerFlow.test.ts](../../../../../src/shared/mock/speakerFlow.test.ts): 302·Range 206, 팀원 권한, `expired`·`no_recording`, 처리 중 PM 전용, 끝난 업로드 회의의 화자 조회 `audio`.
- `npm run typecheck`, `npm run lint`, `npm run policy:check` 통과.
- E2E(MSW, Chromium) [meeting-audio.e2e.ts](../../../../../e2e/meeting-audio.e2e.ts) 2 통과: 승인 `ap_02` 의 '원문 듣기' → `mt_09?t=165000` → `readyState >= 1`, `currentTime` 165~170. 페이지에서 같은 경로를 `redirect: 'manual'` 로 부르면 `{type: 'opaqueredirect', status: 0}`. 300초로 옮긴 뒤 `error` 를 보내면 새 `<audio>` 가 생기고 `currentTime` 300~305. `meeting-audio-expired` 는 안내만 있고 `<audio>` 가 없다. 1280·390 폭 화면을 찍어 390 폭에 가로 넘침이 없는 것을 확인했다(저장소 밖).
- E2E 전체(Chromium, `npm run test:e2e`): 첫 실행에서 [meeting-skeleton.e2e.ts](../../../../../e2e/meeting-skeleton.e2e.ts) 8건이 플레이어 때문에 실패했고 위 「설계에서 정한 것」처럼 고쳤다. 고친 뒤 다시 돌린 전체는 334건 중 331 통과다. 실패한 3건(`auth-limits.e2e.ts` 2, `task-views.e2e.ts` 간트 1)은 첫 실행에서는 통과했고 그 두 파일만 다시 돌리면 16건 모두 통과했다. 첫 실행에서 실패한 `messages-approve.e2e.ts` 2건과 `tasks-approval.e2e.ts` 1건도 따로 돌리면 통과한다. 회의 화면과 관계없는 병렬 부하의 흔들림으로 보지만(추정) 원인은 확인하지 않았다. WebKit 은 설치돼 있지 않아 돌리지 않았다.

## 확인하지 않은 것

- 실서버(BE PR #670 머지 전)와 실제 S3 의 302·Range·1시간 만료. 만료 재생 오류는 E2E 에서 `error` 이벤트를 보내 흉내 냈다.
- Safari·WebKit 의 구간 이동과 자동 재생.
- 실제 m4a(디스코드 섞은 녹음)의 디코드·구간 이동. 모의 녹음은 WAV 다.
