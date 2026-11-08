# 결과 — 정리 중 채팅 회의가 업로드를 막던 문제 (#450)

- 기록일: 2026-11-07
- 대상: [#450](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/450)의 요청 1개와 '확인할 것' 2개
- 상태: **반영했다.** MSW 기준으로 검증했고 실서버는 미검증이다. '확인할 것' 두 가지는 [감독 기본값 댓글](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/450#issuecomment-6690118831)대로 정했고 사용자 확인 전이다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #450이다. 채팅 회의(`source: "chat"`)는 정리 중이어도 업로드를 막지 않는 것이 BE 계약이고 서버도 409를 주지 않는다. 그런데 FE는 출처를 보지 않고 정리 중 회의를 찾아, 채팅 회의 하나만 정리 중이어도 업로드 화면이 그 처리 화면으로 넘어갔다. 응답을 잃은 업로드의 복구도 채팅 회의를 방금 올린 회의로 골랐다.

이번 작업으로 PM은 채팅 회의가 정리 중이어도 업로드 화면에 머물러 파일을 올린다. 폴러가 멈춰 BE가 `failed_stage=chat_stalled`로 끝낸 채팅 회의는 파일을 다시 올리라고 하지 않는다.

## 실제 구현 및 관련 코드

- [uploadBlockingMeeting.ts](../../../src/entities/meeting/lib/uploadBlockingMeeting.ts): 업로드 쪽만 쓰던 `findProcessingMeeting`을 `findUploadBlockingMeeting`으로 바꾸고 `source === 'chat'` 회의를 세지 않는다. 호출하는 곳은 [진입 판정](../../../src/features/meeting-upload/model/useUploadEntry.ts)과 [업로드 복구](../../../src/features/meeting-upload/model/useMeetingUpload.ts) 둘뿐이다. 정리 중 토스트의 발견(`useProcessingDiscovery`)은 이 함수를 쓰지 않아 채팅 회의를 그대로 따라간다.
- [meetingFailure.ts](../../../src/entities/meeting/lib/meetingFailure.ts): `chat_stalled`를 알려진 사유로 더했다. 제목 「채팅 대화를 정리하지 못했어요」, 안내 「채팅 대화를 정리하다 멈췄어요. 다음 수집 때 다시 정리해요.」. 사유마다 `reupload`를 두어 [회의록 상세](../../../src/widgets/meeting-minutes/ui/MinutesDetail.tsx)와 [화자 지정 화면](../../../src/pages/meeting-speakers/ui/MeetingSpeakersPage.tsx)의 `다시 업로드` 링크와 「PM에게 파일 재업로드를 요청해 주세요.」를 이 사유에서 감춘다. 처리 화면과 토스트는 같은 안내 문구를 읽는다.
- 알려진 사유가 됐으므로 추적기는 `chat_stalled` 실패에 Notion 끊김 재조회를 하지 않는다. 추적기 코드는 바꾸지 않았다.
- 「다음 수집 때 다시 정리해요」의 근거: BE `chat-cursor`는 `done`인 채팅 회의만 수집 위치로 친다(`backend/app/api/bot_lookups.py`). 실패한 회의의 메시지는 다음 수집이 다시 모은다. 다음 수집 시각은 계약에 없어 문구에 넣지 않았다.
- MSW: 업로드 handler가 BE처럼 정리 중 채팅 회의를 409로 세지 않는다. `startChatMeeting`, 흐름 방식 `fail-chat-stalled`, 시나리오 `meeting-chat-processing`·`meeting-chat-stalled`를 더했다([MSW 안내](../../msw-guide.md)).
- 계약: [API 계약](../../contracts/frontend-api-contract.md) §4.4 업로드 절에 FE 구현을, §4.4.1 알려진 `failed_stage` 표에 `chat_stalled`를 더했다.

## 완료조건 확인

| 이슈 #450의 조건 | 상태 | 근거 |
|---|---|---|
| 업로드 진입과 응답 잃은 업로드의 복구에서 `chat` 회의 빼기 | 충족(MSW) | `meetingUpload.test.tsx`의 #450 테스트 2개, E2E ⑧ |
| 확인할 것: 채팅 회의를 헤더 「정리 중」 표시에 둘지 | 정함 | 그대로 둔다. 정리 중 토스트의 발견 코드는 바꾸지 않았고 E2E ⑧ 화면에 `정리 중` 토스트가 보인다 |
| 확인할 것: `chat_stalled` 문구 | 정함(MSW) | `meetingProcessing.test.tsx`(토스트·처리 화면), `meetingMinutes.test.tsx`(회의록 상세), E2E ⑨ |

## 검증 내역

| 명령·범위 | 결과 |
|---|---|
| 고치기 전 #450 테스트 (`vitest -t 450`) | 앱 테스트 5개 실패, 시나리오 테스트 2개 통과 (커밋 `62702401`) |
| 고친 뒤 영향 파일 22개 (`--maxWorkers=1`) | 344개 통과 |
| `verify-managers-manager run meetings` (Playwright Chromium, MSW, 포트 7420) | 9개 통과, 정리 후 포트 닫힘 |
| 전체 검사 | PR 본문 초안에 적는다 |
