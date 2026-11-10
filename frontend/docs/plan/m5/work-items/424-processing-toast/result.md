# 결과 — 회의 정리 진행 신호를 오른쪽 아래 토스트로 (#424)

- 기록일: 2026-11-06
- 대상: [#424](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/424)
- 기준: develop `0b662272`(#423 레드 토큰·#395 문서 병합 뒤). PR은 아직 만들지 않았다.
- 상태: **이슈의 할 일을 반영했다.** MSW 기준으로 검증했다. 실서버는 확인하지 않았다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #424 본문의 사용자 결정(2026-11-06)이다.

1. 헤더 「정리 중」 링크를 지우고, 오른쪽 아래 진행 토스트 하나가 정리 중(펼침·접힘)·화자 지정 필요·완료·실패를 이어서 보인다.
2. 처리 추적기의 완료·화자 지정·실패 토스트를 이 토스트의 상태 전환으로 옮겼다. 같은 회의의 신호는 하나다.
3. 팀원은 정리 중과 완료만 본다. 화자 지정 대기는 정리 중 모양으로 「화자 지정을 기다리고 있어요」이고, 실패하면 카드가 조용히 사라진다.

선택의 이유와 D-095·헤더 링크·`#FF2E2E` 처리는 [결정 기록](../../basis-for-decision/2026-11-06-processing-toast.md)에 있다.

## 실제 구현 및 관련 코드

### 상태 모델

- [processingTracker.ts](../../../../../src/entities/meeting/model/processingTracker.ts): 추적 저장소에 끝난 결과 `settled`(회의 ID, 제목, 완료 또는 실패와 `failedStage`)를 더했다. 공간마다 가장 최근 결과 하나만 남긴다. 한 공간의 카드는 많아야 결과 하나와 정리 중 하나다. 닫기·「회의록 보기」가 지우고, 로그아웃·세션 만료의 `clearTrackedMeetings` 가 함께 비운다.
- [processingSignal.ts](../../../../../src/features/meeting-processing/model/processingSignal.ts): 역할 × 단계 표가 카드 종류를 정한다. 단계 문장은 「음성 파일을 준비하고 있어요」·「음성을 텍스트로 옮기고 있어요」·「결정사항과 할 일을 뽑고 있어요」다. 화면 읽기 알림 문장도 여기서 정한다.
- [useProcessingTracker.ts](../../../../../src/features/meeting-processing/model/useProcessingTracker.ts): 토스트를 띄우지 않는다. 완료와 끊김이 아닌 실패는 결과를 적는다. 화자 지정 대기는 목록 캐시 갱신과 처리 화면에서의 한 번 이동만 한다.
- [useProcessingDiscovery.ts](../../../../../src/features/meeting-processing/model/useProcessingDiscovery.ts): 공간 목록에서 화자 지정 대기 회의도 찾는다. 새로고침 뒤에도 화자 지정 카드가 남는다.

### 화면

- [GlobalToaster.tsx](../../../../../src/shared/ui/toast/GlobalToaster.tsx)·[PinnedToast.tsx](../../../../../src/shared/ui/toast/PinnedToast.tsx): 오른쪽 아래 24px 독에 짧은 토스트 목록과 그 아래 고정 칸을 둔다. 짧은 토스트는 진행 토스트 위로 쌓인다. 고정 칸은 화면 높이의 절반을 넘으면 안에서 스크롤한다. `ToastViewport` 는 더 이상 스스로 고정되지 않는다. 독과 고정 칸은 누름을 통과시키고 토스트 면·카드·알약만 누름을 받는다 — 빈 자리가 아래 버튼을 막지 않는다.
- [pinnedSlot.ts](../../../../../src/shared/ui/toast/pinnedSlot.ts): 고정 칸 높이를 재서 「칸 높이 + 24」를 내보낸다(`usePinnedToastReserve`). [WorkspaceLayout.tsx](../../../../../src/app/router/layouts/WorkspaceLayout.tsx)가 고정 토스트가 있는 동안 그만큼 본문 아래를 비운다(알약 58px, 펼친 카드 약 145px, 없으면 0). 펼친 카드가 덮은 본문 끝의 버튼을 스크롤로 꺼낼 수 있다(사용자 결정).
- 회의 이름이 들어가는 자리(정리 중 제목, 화자 지정·완료·실패 본문)는 띄어 쓰지 않은 긴 이름도 줄을 바꿔 카드 안에 둔다(`wrap-anywhere`).
- [ProcessingToast.tsx](../../../../../src/features/meeting-processing/ui/ProcessingToast.tsx): 지금 공간의 회의만 그린다. 상세는 추적기가 polling 하는 캐시를 읽기만 한다(`enabled: false`). 그 회의의 처리 화면·화자 지정 화면에서는 숨긴다. 카드마다 처음 보인 세션을 잡아 두고, 세션이 바뀐 뒤 누른 「자세히 보기」·「화자 지정하기」·「회의록 보기」는 옮기지 않는다.
- [ProcessingToastCard.tsx](../../../../../src/features/meeting-processing/ui/ProcessingToastCard.tsx): 다섯 모양.
  - 정리 중(펼침): 회의 이름, 단계 문장, 3칸 진행 표시, 「n / 3 단계 완료」, 「자세히 보기」, 접기(꺾쇠).
  - 정리 중(접힘): 먹 알약 「● 정리 중 n/3」. 점은 `accent-signal`(`#ff2e2e`).
  - 화자 지정 필요(PM): 면 `accent-badge`, 테두리 `accent-chip`, 제목 `accent`, 「화자 지정하기」 `accent-solid` + 흰 글자, 「7일 안에 정해 주세요」, 접기(꺾쇠). 닫기는 없다.
  - 화자 지정 필요(접힘): 먹 알약 「● 화자 지정이 필요해요」. 점은 `accent-signal`.
  - 완료: 「회의 정리가 끝났어요」, 회의 이름, 「회의록 보기」, 닫기(X). 저절로 닫히지 않는다(사용자 확정).
  - 실패(PM): 「회의를 정리하지 못했어요」, 「<회의 이름> · <안내>」, 닫기(X). 저절로 닫히지 않는다(사용자 확정). 안내는 제목 문장을 되풀이하지 않는다. 알 수 없는 실패는 「파일을 다시 올려 주세요.」이고, 사유별 실패는 사유 문장을 그대로 둔다. `meetingFailure` 문구는 바꾸지 않고 토스트 쪽에서만 뺀다.
- 화면 읽기 알림은 카드 바깥의 `role="status"` 하나다. 접고 펼쳐도 남고, 단계가 바뀔 때만 문장이 바뀐다. 진행 수는 넣지 않는다.
- 정리 중은 화면 폭과 상관없이 접힌 알약으로 시작한다(사용자 결정). 펼침은 사용자가 누르거나 화자 지정 필요·완료·실패로 상태가 바뀔 때만이다.
- 접힘은 카드마다 「지금 상태 + 접힘」이다. 상태(정리 중·화자 지정 필요·완료·실패)가 바뀌면 다시 펼친다. 정리 중의 단계 진행은 상태 변화가 아니라 접힌 채다. 고른 접힘은 카드가 보이는 동안 유지하고(같은 공간에서 화면을 옮겨도), 카드가 새로 그려지면 알약으로 시작한다.
- 이 기기의 접힘 기록(localStorage)은 없앴다. 「펼침」 기록을 따르면 한 번 펼쳐 본 사람에게 평소 본문을 덮는 카드가 돌아오고, 「접힘」 기록은 기본값과 같다. 이슈 본문의 「접은 상태는 이 기기에 기억한다」를 대신한다. 이유는 [결정 기록](../../basis-for-decision/2026-11-06-processing-toast.md) 11에 있다.
- [AppHeader.tsx](../../../../../src/widgets/app-shell/ui/AppHeader.tsx): `processingHref` 와 「정리 중」 링크를 지웠다. [WorkspaceLayout.tsx](../../../../../src/app/router/layouts/WorkspaceLayout.tsx)가 진행 토스트를 올린다.
- [tokens.css](../../../../../src/app/styles/tokens.css): `--color-accent-signal: #ff2e2e`. 먹 면 위 4.85:1.
- [Icon.tsx](../../../../../src/shared/ui/icon/Icon.tsx): `chevron-up` 을 더했다.

### 지운 것

`processingToastKey`, `useProcessingMeetingId`, `ProcessingNotices.stories.tsx`, 헤더 정리 중 스토리. 스토리는 [ProcessingToast.stories.tsx](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/4770f1af589ee24e962efb5160ad483f3c0263bc/frontend/src/features/meeting-processing/ui/ProcessingToast.stories.tsx)의 여섯 상태(다섯 상태와 팀원 대기)로 바꿨다.

### 테스트

- [processingToast.test.tsx](../../../../../src/app/processingToast.test.tsx) 18건: PM 정리 중 → 화자 지정 → 정리 중 → 완료, 실패는 닫을 때까지 남음, 팀원 대기·실패·완료, 새로 연 앱의 화자 지정 대기 발견(PM 은 펼친 화자 지정 카드, 팀원은 정리 중 알약), 처리·화자 지정 화면에서 숨김, 공간 전환, 세션이 바뀐 뒤 세 버튼, 폭과 상관없이 알약 시작·펼친 채 같은 공간의 다른 화면으로 이동·새로 열면 다시 알약·localStorage 를 쓰지 않음, 알림 문장이 단계가 바뀔 때만 바뀜, 화자 지정 필요 접기와 상태가 바뀌면 다시 펼침·단계 진행은 접힌 채, 알약으로 시작한 정리 중이 화자 지정 필요를 거쳐 돌아오면 펼침. 마지막 것은 되돌림 줄을 빼면 실패하는 것을 확인했다. 같은 공간에서 완료를 닫지 않고 다음 회의를 정리하면 결과 하나와 정리 중 하나이고 다음 결과가 이전 결과를 바꾼다. 이것은 공간마다 하나로 줄이기 전 코드에서 실패하는 것을 확인했다.
- 발견 테스트 2건은 발견을 고치기 전 코드에서 실패하는 것을 확인했다.
- 단위: `processingSignal.test.ts`(역할 × 단계 전부, 실패 설명에서 제목 문장 빼기), `processingTracker.test.ts`(공간마다 결과 하나), `GlobalToaster.test.tsx`(독 자리, 고정 칸이 목록 아래이고 높이 상한·스크롤, 독이 없으면 그리지 않음, 독은 누름 통과·토스트 면은 누름 받음, 본문 아래 여백이 칸 높이 + 24 이고 칸이 비면 0).
- 기존 처리 추적 테스트(`meetingProcessing`·`lateAsyncRaces`·`meetingSpeakers`·`meetingSpeakersTracking`·`meetingProcessingProgress`)는 같은 의도를 새 토스트로 단언한다.
- E2E(`layout`·`meeting-flow`·`select-switch`)와 Storybook 목록의 기대값을 고쳤다. `meeting-flow` ② 는 알약을 눌러 펼친다. 진행 토스트 스토리의 play 는 카드 영역 안에서 찾는다(화면 읽기 알림과 같은 문장이 둘 잡히던 것).
- PR #453 CI 에서 E2E 6건(`dashboard:159`, `messages-approve:40`, `tasks-approval:78·203·419·454`)이 진행 토스트에 막혔다. 기본 모의 데이터의 `mt_10` 이 정리 중이라 ws_01 시나리오 전부에 카드가 뜬다. 테스트를 우회하지 않고 제품을 고쳤다(독 누름 통과, 알약 시작, 본문 아래 여백). 시나리오는 그대로 두었다.

## 검증

- 로컬 E2E(`--workers=1`): 실패했던 3파일과 바꾼 3파일(`dashboard`·`messages-approve`·`tasks-approval`·`meeting-flow`·`layout`·`select-switch`) 55건 통과. Storybook play 172건 중 진행 토스트 스토리 2건이 캔버스의 다른 region 과 겹쳐 실패했고, 이름으로 좁힌 뒤 진행 토스트 스토리 7건이 통과했다(나머지 170건은 같은 실행에서 통과).
- 실제 브라우저(MSW, Chromium, 데스크톱 1280×900과 휴대폰 390×844)에서 17개 여정이 통과했다.
  - 덮임: 승인 상세 「승인」, 메시지 「이대로 발송」, 대시보드 「외 n건 · 회의록에서 보기」가 알약일 때 그 자리를 누르면 버튼이 잡힌다(두 폭). 카드를 펼친 뒤에도 스크롤해 누를 수 있다(본문 아래 여백 58~145px).
  - PM `meeting-demo`: 올리기 → 처리 화면(토스트 없음, 헤더 링크 없음) → 태스크로 이동 → 알약(점 `rgb(255, 46, 46)`) → 펼친 카드 → 접기 → 완료 카드 → 「회의록 보기」로 그 회의록, 카드 사라짐. 두 폭 모두 알약으로 시작했다.
  - PM `meeting-speakers`: 새로 연 태스크 화면에 화자 지정 카드. 면 `rgb(251, 233, 231)`, 테두리 `rgb(244, 217, 215)`, 버튼 `rgb(211, 47, 47)`. 접으면 「화자 지정이 필요해요」 알약, 누르면 다시 펼침. 「화자 지정하기」로 화자 지정 화면에 가고 카드가 숨는다.
  - PM `meeting-fail`: 실패 카드 「short-meeting.wav · 파일을 다시 올려 주세요.」(제목 문장 반복 없음), 닫기로 사라짐.
  - 팀원 `meeting-speakers-member`: 「화자 지정을 기다리고 있어요」, 「화자 지정하기」 없음. 팀원 `meeting-member`: 완료 카드.
  - 390px, 공백 없는 100자 이름: 정리 중·완료·화자 지정·실패 카드와 그 안 요소의 경계가 모두 화면 안이다. 같은 공간에서 두 번째 회의를 올리면 결과 하나 + 정리 중 하나이고, 두 번째가 끝나면 그 결과 하나만 남는다.
- 스크린샷은 커밋하지 않는 로컬 증거다(`frontend/.verify/screens/`).
- 전체 검사 결과는 PR 본문에 적는다.

## 남은 작업과 제한 사항

- 완료 요약 숫자(할 일·확인 필요)와 남은 날짜는 넣지 않았다. 이유는 결정 기록에 있다.
- 앱 화면 자체는 휴대폰 폭에 맞춰져 있지 않다(헤더가 넘친다). 이번 범위 밖이다.
- 실서버 연동은 확인하지 않았다.

## 관련 기록

- [결정 기록](../../basis-for-decision/2026-11-06-processing-toast.md)
- [제품·기술 결정](../../../../decision/frontend-decisions.md) D-088·D-095
- [#423 결과](../../../m2/work-items/423-accent-red/result.md): 레드 토큰
