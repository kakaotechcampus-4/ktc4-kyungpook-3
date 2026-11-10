# 결과 — 채팅 회의 승인의 근거 시각 (#397)

- 기록일: 2026-11-05
- 대상: [#397](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/397)의 세부 작업 4개
- 기준: develop `fb492273`. PR은 아직 만들지 않았다.
- 상태: **세부 작업 4개를 반영했다.** MSW 기준으로 검증했고, 실서버는 미검증이다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #397과 #379의 남은 작업이다. 채팅 회의(`source: "chat"`)의 `evidence_at_ms`는 첫 메시지부터의 오프셋이라 수십 시간이 될 수 있다. 그래서 채팅 회의에서 나온 승인은 근거 시각이 `26:40:00`처럼 읽을 수 없게 보였다. 채팅 회의의 제안은 모두 PM 승인 대기로 가므로(#378) PM이 매일 보는 카드다.

이번 작업으로 세 화면의 승인 근거 시각이 회의 출처를 따른다. 녹음 회의는 그대로 `mm:ss`(`h:mm:ss`)이고, 채팅 회의는 실제 작성 시각(`started_at + at_ms`, 서울 `MM/DD HH:mm`)이다. BE 계약은 바꾸지 않았다. 승인의 `meetingId`로 회의 목록에서 `source`·`startedAt`을 찾는다.

## 실제 구현 및 관련 코드

- [moment.ts](../../../../../src/entities/meeting/lib/moment.ts)로 `formatClock`·`offsetInstant`·`formatMoment`를 회의 엔티티에 옮겼다. 위젯끼리는 서로 가져올 수 없어(eslint boundaries) 승인 화면이 회의록 위젯의 함수를 쓸 수 없었다. [format.ts](../../../../../src/widgets/meeting-minutes/lib/format.ts)와 [MinutesDetail.tsx](../../../../../src/widgets/meeting-minutes/ui/MinutesDetail.tsx)는 엔티티에서 가져온다.
- 같은 파일에 `evidenceMoment(meeting, atMs)`를 더했다. 시간 해석은 `MEETING_SOURCE_TRAITS`의 시간 축으로만 한다. 화면에는 `source === 'chat'` 조건이 없다.
- 세 화면이 이 함수를 쓴다. 회의 목록은 세 화면 모두 이미 같은 query key(`meetingListQueryOptions`)로 받고 있어 요청이 늘지 않는다.
  - [Dashboard.tsx](../../../../../src/widgets/dashboard/ui/Dashboard.tsx)의 확인 필요 목록. 회의 목록을 행에 넘긴다.
  - [ApprovalReview.tsx](../../../../../src/widgets/approval-review/ui/ApprovalReview.tsx)의 `Evidence`. 생성 승인과 범위 변경(`task_update`, `category: scope`)이 함께 쓰는 구성 요소다.
  - [ApprovalCard.tsx](../../../../../src/widgets/task-board/ui/ApprovalCard.tsx)와 [TaskBoard.tsx](../../../../../src/widgets/task-board/ui/TaskBoard.tsx). 회의 제목 Map을 회의 Map으로 바꿔 제목과 시각을 함께 읽는다.
- 세 화면에 따로 있던 같은 모양의 시각 함수(`clock` 2개, `evidenceClock`)를 지웠다.
- MSW 시나리오 `approval-chat`을 더했다. 채팅 회의 `mt_08`에서 나온 생성 승인 `ap_07`(근거 오프셋 34,080,000ms)이다. 실제 작성 시각은 `09/11 18:40`이고, 녹음 규칙으로 읽으면 `9:28:00`이다. 기본 픽스처는 바꾸지 않았다.

## 완료조건 확인

이슈의 체크 항목을 완료조건으로 대응시켰다.

| 이슈 #397의 조건 | 상태 | 근거 |
|---|---|---|
| 승인 근거 시각을 회의 출처에 맞게 보인다(대시보드, 승인 검토, 태스크 보드) | 충족(MSW) | `dashboard.test.tsx`·`approvals.test.tsx`·`tasks.test.tsx`의 `#397` 테스트. MSW 모드 Chromium에서 세 화면 모두 채팅 `09/11 18:40`, 녹음 `02:35`·`02:45` 확인 |
| 출처와 시작 시각을 얻는 방법을 정한다 | 정함 | 사용자 결정(2026-11-05)대로 FE만 바꾼다. 회의 목록에서 찾는다 |
| `MEETING_SOURCE_TRAITS`를 그대로 쓰고 화면마다 `source === 'chat'`을 두지 않는다 | 충족 | `evidenceMoment` → `formatMoment` → 시간 축 표. 화면 코드에 출처 비교가 없다 |
| 채팅·녹음 승인의 근거 시각을 보이는 글자로 테스트한다 | 충족 | `moment.test.ts`와 세 화면 테스트. 범위 변경 승인도 녹음 `12:34`, 채팅 `09/11 18:40`을 확인한다 |

## 회의를 찾지 못할 때

회의 목록을 아직 받지 못했거나, 받지 못했거나, 목록에 그 회의가 없거나, 승인에 회의가 없으면(`meetingId` null, 예: 리마인드 답장) 시각을 모르는 것으로 본다. 각 화면은 이 경우를 근거 시각이 없을 때(`atMs` null)와 같이 그린다. 대시보드와 태스크 보드는 시각을 숨기고, 승인 검토는 `시각 알 수 없음`이다. 녹음 규칙으로 바꿔 읽지 않는다. 채팅 회의에서 `9:28:00`·`26:40:00`처럼 보이기 때문이다.

## 검증 내역

| 시점 | 명령·범위 | 결과 |
|---|---|---|
| 커밋 전 | `npm run typecheck`, `npm run lint`, `npm run build` | 통과 |
| 커밋 전 | `npm run format:check` | git에서 제외한 로컬 파일 `.verify/` 2개만 걸렸다. `.verify`를 뺀 `prettier --check`는 통과 |
| 커밋 전 | `npm run test -- --maxWorkers=1` | 210개 파일, 2,531개 테스트 통과 |
| 범위 변경 테스트 추가 뒤 | `npx vitest run src/app/approvals.test.tsx --maxWorkers=1` | 34개 통과 |
| 커밋 전 | MSW 모드 Vite와 Playwright Chromium, 시나리오 `approval-chat` | 대시보드, 승인 검토(`ap_07`, `ap_01`), 태스크 보드 확인 필요 탭의 채팅·녹음 시각 7개 단언 통과. 콘솔 오류 0건 |

## 계획 대비 변경

계획 문서가 없는 작업이라 이슈 요청과 비교한다.

- 채팅 회의 승인을 기본 픽스처가 아니라 시나리오로 더했다. 기본 픽스처에 넣으면 승인 수를 단언하는 테스트와 E2E 약 30개 파일이 바뀐다.
- 승인 검토 화면은 회의 목록을 받는 동안 잠깐 `시각 알 수 없음`을 보이고, 받으면 시각으로 바뀐다.

## 남은 작업과 제한 사항

- 회의 목록 API가 모든 회의를 한 번에 주지 않게 바뀌면, 목록에 없는 오래된 회의의 승인은 시각을 숨긴다.
- 태스크 보드 승인 카드의 근거 상자는 채팅 회의에서도 `전사문`·`원문 듣기` 문구다. 이번 범위 밖이다.
- PR #378이 병합되어 BE가 실제로 `chat`을 내리는 환경에서의 화면은 미검증이다.

## 관련 기록

- 선행: [#379 결과](../../../m5/work-items/379-chat-meeting/result.md), PR [#386](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/386)
- [MSW 사용 안내](../../../../msw-guide.md)
