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

선택의 이유와 D-095·헤더 링크·`#FF2E2E` 처리는 [결정 기록](../../plan/m5/basis-for-decision/2026-11-06-processing-toast.md)에 있다.

## 실제 구현 및 관련 코드

### 상태 모델

- [processingTracker.ts](../../../src/entities/meeting/model/processingTracker.ts): 추적 저장소에 끝난 결과 `settled`(회의 ID, 제목, 완료 또는 실패와 `failedStage`)를 더했다. 닫기·「회의록 보기」가 지우고, 로그아웃·세션 만료의 `clearTrackedMeetings` 가 함께 비운다.
- [processingSignal.ts](../../../src/features/meeting-processing/model/processingSignal.ts): 역할 × 단계 표가 카드 종류를 정한다. 단계 문장은 「음성 파일을 준비하고 있어요」·「음성을 텍스트로 옮기고 있어요」·「결정사항과 할 일을 뽑고 있어요」다. 화면 읽기 알림 문장도 여기서 정한다.
- [useProcessingTracker.ts](../../../src/features/meeting-processing/model/useProcessingTracker.ts): 토스트를 띄우지 않는다. 완료와 끊김이 아닌 실패는 결과를 적는다. 화자 지정 대기는 목록 캐시 갱신과 처리 화면에서의 한 번 이동만 한다.
- [useProcessingDiscovery.ts](../../../src/features/meeting-processing/model/useProcessingDiscovery.ts): 공간 목록에서 화자 지정 대기 회의도 찾는다. 새로고침 뒤에도 화자 지정 카드가 남는다.

### 화면

- [GlobalToaster.tsx](../../../src/shared/ui/toast/GlobalToaster.tsx)·[PinnedToast.tsx](../../../src/shared/ui/toast/PinnedToast.tsx): 오른쪽 아래 24px 독에 짧은 토스트 목록과 그 아래 고정 칸을 둔다. 짧은 토스트는 진행 토스트 위로 쌓인다. `ToastViewport` 는 더 이상 스스로 고정되지 않는다.
- [ProcessingToast.tsx](../../../src/features/meeting-processing/ui/ProcessingToast.tsx): 지금 공간의 회의만 그린다. 상세는 추적기가 polling 하는 캐시를 읽기만 한다(`enabled: false`). 그 회의의 처리 화면·화자 지정 화면에서는 숨긴다. 카드마다 처음 보인 세션을 잡아 두고, 세션이 바뀐 뒤 누른 「자세히 보기」·「화자 지정하기」·「회의록 보기」는 옮기지 않는다.
- [ProcessingToastCard.tsx](../../../src/features/meeting-processing/ui/ProcessingToastCard.tsx): 다섯 모양.
  - 정리 중(펼침): 회의 이름, 단계 문장, 3칸 진행 표시, 「n / 3 단계 완료」, 「자세히 보기」, 접기(꺾쇠).
  - 정리 중(접힘): 먹 알약 「● 정리 중 n/3」. 점은 `accent-signal`(`#ff2e2e`).
  - 화자 지정 필요(PM): 면 `accent-badge`, 테두리 `accent-chip`, 제목 `accent`, 「화자 지정하기」 `accent-solid` + 흰 글자, 「7일 안에 정해 주세요」. 닫기·접기가 없다.
  - 완료: 「회의 정리가 끝났어요」, 회의 이름, 「회의록 보기」, 닫기(X). 저절로 닫히지 않는다.
  - 실패(PM): 「회의를 정리하지 못했어요」, 회의 이름과 지금 실패 안내 문구, 닫기(X).
- 화면 읽기 알림은 카드 바깥의 `role="status"` 하나다. 접고 펼쳐도 남고, 단계가 바뀔 때만 문장이 바뀐다. 진행 수는 넣지 않는다.
- [collapsePreference.ts](../../../src/features/meeting-processing/lib/collapsePreference.ts): 접은 상태를 이 기기의 localStorage 에 기억한다. 읽기·쓰기 모두 try/catch 다. 기록이 없으면 휴대폰 폭(639px 이하)은 알약으로 시작한다.
- [AppHeader.tsx](../../../src/widgets/app-shell/ui/AppHeader.tsx): `processingHref` 와 「정리 중」 링크를 지웠다. [WorkspaceLayout.tsx](../../../src/app/router/layouts/WorkspaceLayout.tsx)가 진행 토스트를 올린다.
- [tokens.css](../../../src/app/styles/tokens.css): `--color-accent-signal: #ff2e2e`. 먹 면 위 4.85:1.
- [Icon.tsx](../../../src/shared/ui/icon/Icon.tsx): `chevron-up` 을 더했다.

### 지운 것

`processingToastKey`, `useProcessingMeetingId`, `ProcessingNotices.stories.tsx`, 헤더 정리 중 스토리. 스토리는 [ProcessingToast.stories.tsx](../../../src/features/meeting-processing/ui/ProcessingToast.stories.tsx)의 여섯 상태(다섯 상태와 팀원 대기)로 바꿨다.

### 테스트

- [processingToast.test.tsx](../../../src/app/processingToast.test.tsx) 17건: PM 정리 중 → 화자 지정 → 정리 중 → 완료, 실패는 닫을 때까지 남음, 팀원 대기·실패·완료, 새로 연 앱의 화자 지정 대기 발견(PM·팀원), 처리·화자 지정 화면에서 숨김, 공간 전환, 세션이 바뀐 뒤 세 버튼, 접기 기억과 막힌 저장소, 휴대폰 폭 시작, 알림 문장이 단계가 바뀔 때만 바뀜.
- 발견 테스트 2건은 발견을 고치기 전 코드에서 실패하는 것을 확인했다.
- 단위: `processingSignal.test.ts`(역할 × 단계 전부), `processingTracker.test.ts`, `GlobalToaster.test.tsx`(독 자리, 고정 칸이 목록 아래, 독이 없으면 그리지 않음).
- 기존 처리 추적 테스트(`meetingProcessing`·`lateAsyncRaces`·`meetingSpeakers`·`meetingSpeakersTracking`·`meetingProcessingProgress`)는 같은 의도를 새 토스트로 단언한다.
- E2E(`layout`·`meeting-flow`·`select-switch`)와 Storybook 목록의 기대값을 고쳤다. 로컬에서는 돌리지 않았다(CI가 돈다).

## 검증

- 실제 브라우저(MSW, Chromium, 데스크톱 1280×900과 휴대폰 390×844)에서 8개 여정이 통과했다.
  - PM `meeting-demo`: 올리기 → 처리 화면(토스트 없음, 헤더 링크 없음) → 태스크로 이동 → 펼친 카드 → 접기 → 알약 점 `rgb(255, 46, 46)` → 완료 카드 → 「회의록 보기」로 그 회의록, 카드 사라짐. 휴대폰은 알약으로 시작했다.
  - PM `meeting-speakers`: 새로 연 태스크 화면에 화자 지정 카드. 면 `rgb(251, 233, 231)`, 테두리 `rgb(244, 217, 215)`, 버튼 `rgb(211, 47, 47)`. 누르면 화자 지정 화면으로 가고 카드가 숨는다.
  - PM `meeting-fail`: 실패 카드, 닫기로 사라짐.
  - 팀원 `meeting-speakers-member`: 「화자 지정을 기다리고 있어요」, 「화자 지정하기」 없음. 팀원 `meeting-member`: 완료 카드.
- 스크린샷은 커밋하지 않는 로컬 증거다(`frontend/.verify/screens/`).
- 전체 검사 결과는 PR 본문에 적는다.

## 남은 작업과 제한 사항

- 실패 카드는 알 수 없는 실패에서 「회의를 정리하지 못했어요」가 제목과 본문에 두 번 나온다. 이슈 본문 문구 그대로다. 본문을 「파일을 다시 올려 주세요.」만 둘지는 문구 결정으로 남긴다.
- 화자 지정 카드는 접을 수 없다. 비교 화면에는 접기 아이콘이 있다.
- 완료 요약 숫자(할 일·확인 필요)와 남은 날짜는 넣지 않았다. 이유는 결정 기록에 있다.
- 앱 화면 자체는 휴대폰 폭에 맞춰져 있지 않다(헤더가 넘친다). 이번 범위 밖이다.
- 실서버 연동은 확인하지 않았다.

## 관련 기록

- [결정 기록](../../plan/m5/basis-for-decision/2026-11-06-processing-toast.md)
- [제품·기술 결정](../../decision/frontend-decisions.md) D-088·D-095
- [#423 결과](../423-accent-red/result.md): 레드 토큰
