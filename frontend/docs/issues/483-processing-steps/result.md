# 결과 — 회의 정리 중 단계를 실제 처리 순서에 맞추기 (#483 B안)

- 기록일: 2026-11-07
- 대상: [#483](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/483)
- 기준: develop `4c632f4a`(#500 병합 뒤). PR은 아직 만들지 않았다. PR 본문은 `Part of #483`이다 — 이슈를 닫지 않는다.
- 상태: **B안의 할 일을 반영했다.** MSW 기준으로 검증했다. 실서버는 확인하지 않았다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 #483 의 사용자 결정 댓글(2026-11-07)이다. AI·BE 는 바꾸지 않고 FE 만 바꾼다. 전사 트랙 진행·단계 시작 시각 표시(A안)는 #483 에 남는다.

1. 녹음·업로드 회의의 첫 단계 이름을 「음성 파일 준비하기」에서 「차례 기다리는 중」으로 바꿨다.
2. 마지막 단계는 회의 `status` 가 `done` 이 될 때까지 진행 중이다. BE 는 AI 가 넘기기(`handoff`)를 알릴 때 `extracted` 를 참으로 만들어, 넘기는 동안 화면이 「3 / 3 단계 완료」인 채 정리 중이었다.
3. 채팅 회의(`source: chat`)는 「대화 모으기 → 결정사항과 할 일 뽑아내기」 두 단계다. 채팅 수집([chat_poll.py](../../../../ai/capture/chat_poll.py))은 단계를 알리지 않고 `/end` → `sources` → 판단 → `/extractions` 순서라, 발화 저장 여부(`transcribed`)로 나눈다.
4. 진행 토스트의 단계 문장·칸 수·「n/3」 표시도 같은 단계 목록을 따른다. 채팅은 「n/2」다.
5. 모의 서버의 `staged` 흐름을 서버 순서로 바꿨다.
6. 추가 범위(관리 세션 전달, 2026-11-07 사용자 결정): 처리 화면의 Notion 반영 안내를 역할별 문구로 바꿨다.
7. 추가 범위(t15 결정): 회의록 목록의 정리 중 채팅 행도 처리 화면으로 잇는다(#379 결정을 바꿨다).
8. Codex 리뷰 반영: 출처를 모르는 동안 단계 수를 짐작하지 않는다. 받아 둔 목록에 회의가 없으면 목록을 한 번 새로 받는다.

## 실제 구현 및 관련 코드

### 단계 목록

- [processingSteps.ts](../../../src/entities/meeting/lib/processingSteps.ts): `processingSteps(progress, status, source)` 가 단계 목록을 만든다. 단계마다 끝났다고 보는 `progress` 값이 있다.
  - 녹음·업로드: `queue` 「차례 기다리는 중」(`audioMerged` 로 끝), `transcribe` 「음성을 텍스트로 옮기기」(`transcribed` 로 끝), `extract` 「결정사항과 할 일 뽑아내기」.
  - 채팅: `collect` 「대화 모으기」(`transcribed` 로 끝), `extract`.
  - 마지막 단계 `extract` 는 `progress` 로 끝내지 않는다. `done` 일 때만 끝이다. 실패한 회의에서도 끝나지 않은 단계다(처리 화면은 실패 회의에 단계를 그리지 않는다).
  - 출처를 모르면 부르지 않는다(인자가 `MeetingSource` 다).
  - 단계 키를 `progress` 키에서 단계 이름(`ProcessingStepKey`)으로 바꿨다. 채팅의 첫 단계와 녹음의 둘째 단계가 같은 `transcribed` 를 보기 때문이다. 고정 개수 `PROCESSING_STEP_COUNT` 는 지웠다 — 화면은 `steps.length` 를 쓴다.
- `source` 는 상세 응답에 없다. [meetingSources.ts](../../../src/entities/meeting/api/meetingSources.ts)의 `useMeetingSources` 가 회의 목록 요약의 `source` 를 읽는다. 처리 화면(참석 인원)과 진행 토스트의 발견이 이미 읽는 캐시라 보통 새 요청이 없다.
  - 받아 둔 목록에 그 회의가 없으면(목록을 받은 뒤 생긴 회의, 오래된 목록) 회의마다 한 번 목록을 새로 받는다. 목록 Query 는 30초 동안 새로 묻지 않아 기다리기만 하면 끝까지 모를 수 있다.
  - 출처를 모르는 동안(목록 대기, 새로 받는 중, 조회 실패, 새로 받아도 없음)은 처리 화면·토스트 모두 단계 수를 정하지 않는다. 처리 화면은 단계 목록 없이 「정리하고 있어요」, 토스트는 칸·「n/m」 없이 「회의를 정리하고 있어요」다.
  - 목록 조회가 실패해도 녹음 단계로 되돌리지 않는다. 짐작이 틀리면 채팅 회의에 음성 단계가 보이고 나중에 「0/3 → 0/2」로 바뀌는 것이 Codex 리뷰가 짚은 결함이다. 상세 polling 과 완료·실패 처리는 출처와 상관없이 이어진다.
  - 처음에는 목록을 처음 받는 동안만 기다리고 그 밖에는 녹음 단계로 그렸다. 목록 캐시가 있는데 그 회의가 빠진 경우(처리 화면 직접 진입)와 목록 응답 전에 처리 화면을 떠난 경우를 놓쳐 바꿨다.

### 화면

- [MeetingProcessingPage.tsx](../../../src/pages/meeting-processing/ui/MeetingProcessingPage.tsx): `useMeetingSources` 의 출처로 단계를 만든다. 출처를 모르는 동안은 제목·안내만 보이고 단계 목록·「n / m 단계 완료」를 그리지 않는다.
- 같은 파일의 Notion 안내를 역할별로 바꿨다. BE 는 회의록 본문을 Notion 에 올리지 않는다. 역할은 이 화면이 이미 아는 PM 여부로 고른다.
  - PM: 「Notion을 연결했다면 확실한 태스크는 바로, 확인이 필요한 태스크는 승인한 뒤 Notion에도 올라가요.」
  - 팀원: 「Notion을 연결했다면 확실한 태스크는 바로 Notion에도 올라가요.」
- [processingSignal.ts](../../../src/features/meeting-processing/model/processingSignal.ts): 토스트 대상에 `source` 를 더했다. 단계 문장은 단계마다 하나다 — 「차례를 기다리고 있어요」·「음성을 텍스트로 옮기고 있어요」·「대화를 모으고 있어요」·「결정사항과 할 일을 뽑고 있어요」. 출처를 모르면 단계(`steps`·`doneCount`)가 null 이고 문장은 「회의를 정리하고 있어요」다.
- [ProcessingToast.tsx](../../../src/features/meeting-processing/ui/ProcessingToast.tsx): 정리 중·화자 지정 대기 회의의 출처를 `useMeetingSources` 로 찾아 넘긴다. [useProcessingTracker.ts](../../../src/features/meeting-processing/model/useProcessingTracker.ts)는 바꾸지 않았다.
- [ProcessingToastCard.tsx](../../../src/features/meeting-processing/ui/ProcessingToastCard.tsx): 칸 수와 「n / m 단계 완료」·알약의 「n/m」을 단계 목록 길이로 그린다. 칸 격자는 고정 3열에서 단계 수만큼의 같은 폭 열로 바꿨다. 단계가 null 이면 칸·수를 그리지 않는다.
- 회의록 목록의 정리 중 채팅 행도 처리 화면으로 잇는다(2026-11-07 t15 결정). [MeetingMinutes.tsx](../../../src/widgets/meeting-minutes/ui/MeetingMinutes.tsx)의 `inProgressStatus` 가 출처와 상관없이 처리 화면 주소를 준다.
  - #379 는 「처리 화면의 단계가 녹음 기준이라」 채팅 회의를 잇지 않았다. 이 작업으로 처리 화면에 채팅 두 단계가 생겨 그 이유가 없어졌다. 진행 토스트의 「자세히 보기」는 전부터 채팅 회의도 처리 화면으로 이었다 — 이제 두 진입점이 같다.
  - 모든 출처가 잇게 되어 [sourceTraits.ts](../../../src/entities/meeting/model/sourceTraits.ts)의 `hasProcessingScreen` 칸을 지웠다. 표에는 시간 축(`timeAxis`)만 남는다.

### 모의 서버

- [meetingFlow.ts](../../../src/shared/mock/meetingFlow.ts)
  - `readMeeting`: 상세 조회 한 번. `staged` 는 지금 모습을 답하고 다음 조회 몫으로 한 단계 진행한다. 첫 조회가 대기(셋 다 거짓)다. 다른 방식은 전처럼 진행한 뒤 답한다. [meeting handler](../../../src/shared/mock/handlers/meeting.ts)가 이것을 부른다.
  - `advanceMeeting`: 채팅 회의는 첫 진행에 `audio_merged`·`transcribed` 를 함께 켠다(BE `_compute_progress` 의 발화 판정).
  - 그래서 `staged` 는 녹음 `000 → 100 → 110 → 111(processing) → done`, 채팅 `000 → 110 → 111(processing) → done` 이다.
- [scenarios.ts](../../../src/shared/mock/scenarios.ts): 시나리오 `meeting-chat-demo` 를 더했다. 정리 중 채팅 회의 `mt_11` 이 `staged` 로 진행한다. [MSW 안내](../../msw-guide.md)의 시나리오 표에 적었다.

### 계약

[대표 계약](../../contracts/frontend-api-contract.md) §2.3 의 `progress` 설명에서 옛 표시(「음성 파일 준비하기」, 인계 중 `3 / 3`)에 취소선을 긋고 현재 구현을 적었다. 응답 키·시점은 바꾸지 않았다.

## 검증

### 고치기 전 실패 확인

새 기대를 먼저 테스트에 적고 구현 전 코드에서 돌렸다. 6개 파일 19건이 실패했다(단계 이름, 넘기는 중 마지막 단계 진행 중, 채팅 두 단계, 토스트 `0/2`·`2/3`, `staged` 순서). 구현 뒤 모두 통과했다.

### 테스트

- [processingSteps.test.ts](../../../src/entities/meeting/lib/processingSteps.test.ts): 녹음·채팅 단계 이름, 서버 순서별 상태, 넘기는 중 마지막 단계 진행 중, 출처를 모르면 녹음 단계, 실패·화자 지정 대기.
- [processingSignal.test.ts](../../../src/features/meeting-processing/model/processingSignal.test.ts): 녹음·채팅 단계 문장과 칸, 넘기는 중 `doneCount`.
- [meetingProcessingProgress.test.tsx](../../../src/app/meetingProcessingProgress.test.tsx): 인계 중 녹음 회의는 `2 / 3` 이고 셋째가 `aria-current`, 채팅 회의 대기·발화 저장 뒤·넘기는 중. Codex 리뷰 회귀: 받아 둔 최신 목록에 없는 채팅 회의로 들어오면 목록을 한 번(요청 1건) 새로 받고 단계 안내에 `/ 3` 이 한 번도 없이 `0 / 2` 가 된다. 목록 조회가 실패하면 단계 목록 없이 「정리하고 있어요」다.
- [meetingProcessing.test.tsx](../../../src/app/meetingProcessing.test.tsx): 바뀐 첫 단계 이름, PM·팀원 Notion 안내.
- [processingToast.test.tsx](../../../src/app/processingToast.test.tsx): 녹음 넘기는 중 `정리 중2/3`·`2 / 3 단계 완료`, 채팅 `0/2 → 1/2`, 넘기는 중에도 `1/2`. Codex 리뷰 회귀: 처리 화면이 목록 응답을 기다리는 사이 떠나면 알약·카드가 단계 수 없이 「정리 중」·「회의를 정리하고 있어요」이고, 목록이 오면 `0 / 2` 다. 「이어진 정리」 테스트는 둘째 회의를 서버 목록에도 넣었다(실서버 목록은 정리 중 회의를 준다).
- [meetingMinutes.test.tsx](../../../src/app/meetingMinutes.test.tsx): 정리 중 채팅 행이 처리 화면으로 잇는다. 고치기 전 코드에서 링크가 없어 실패하는 것을 확인했다.
- [meetingFlow.test.ts](../../../src/shared/mock/meetingFlow.test.ts)·[meetingScenarios.test.ts](../../../src/shared/mock/meetingScenarios.test.ts): `staged` 녹음·채팅 순서, `meeting-chat-demo`, 복원 뒤 이어 가기.
- E2E [meeting-flow.e2e.ts](../../../e2e/meeting-flow.e2e.ts) ⑩ 녹음·⑪ 채팅: 처리 화면의 단계 안내(`role=status`)가 지나간 문장이 순서대로 「0 / 3 · 차례 기다리는 중 → 1 / 3 · 음성을 텍스트로 옮기기 → 2 / 3 · 결정사항과 할 일 뽑아내기」, 채팅은 「0 / 2 · 대화 모으기 → 1 / 2 · 결정사항과 할 일 뽑아내기」이고 `3 / 3`·`2 / 2` 가 없다. 서버가 넘기기(`extracted` 참, processing)를 답한 때 마지막 단계가 진행 중이다. ② 의 완료 대기 한도는 조회가 하나 늘어 20초에서 25초로 늘렸다.

### 검사 명령

로컬 전체 vitest 는 돌리지 않았다(2026-11-07 감독 지시: 여러 워커가 동시에 돌아 병목이라 전체 테스트·E2E 는 CI 가 맡는다).

- `npm run typecheck`: 통과.
- `npx eslint . --ignore-pattern ".verify/**"`: 통과. `npm run lint` 그대로는 git 에서 뺀 로컬 증거 스크립트(`.verify/483/*.ts`) 두 파일을 tsconfig 밖이라 오류로 센다.
- `npm run format:check`: 추적 파일 통과. git 에서 뺀 `.verify/brief.md` 한 파일만 경고다.
- `npm run build`: 통과.
- 관련 테스트 12개 파일 `--maxWorkers=1`: 176건 중 170건 통과, 6건(`meetingProcessing` 5·`processingToast` 1)이 4~10초 시간 초과. 두 파일을 따로 돌리면 42/42·22/22 로 모두 통과해 부하로 본다. 같은 부하에서 기본 병렬 실행은 시간 초과가 더 많아 멈췄다.
- `scenarios.test.ts` 의 「시나리오끼리 독립적이다」(시나리오 수의 제곱만큼 도는 테스트)는 30초 한도를 넘었다. 이 브랜치 이전 `scenarios.ts` 로 바꿔 돌려도 30.3초로 같이 넘어, 시나리오 하나를 더한 탓이 아니라 부하다.
- 리뷰 반영·채팅 행 잇기 뒤(기본 병렬, 바꾼 곳 관련 파일만): `processingToast`·`meetingProcessingProgress`·`meeting-processing`·`entities/meeting` 32건 중 1건, `meetingProcessing`·`lateAsyncRaces`·`meetingMinutes`·`meetingSpeakersTracking`·`meetingUpload` 160/160, `meetingSpeakers`·`meetingMinutesRaces`·`meetingMinutesSelection`·`meetingFlow`·`meetingScenarios`·`widgets/meeting-minutes` 117건 중 2건이 시간 초과였다. 그 파일들을 따로 돌리면 `processingToast` 23/23, `meetingMinutesSelection` 13/13, `meetingSpeakers` 25/25 로 통과해 부하로 본다. typecheck·lint(`.verify/` 제외)·format:check(추적 파일) 통과. 이 변경 뒤 E2E·build 는 다시 돌리지 않았다(CI 몫).
- E2E(포트 5231): `meeting-flow` 11건 통과(⑩·⑪ 포함, ② 23.2초). 그 뒤 ② 의 완료 대기 한도만 20초에서 25초로 늘렸고 다시 돌리지 않았다. `meeting-speakers`·`meeting-layout`·`layout`·`select-switch`·`messages-toast` 133건 통과.

### 화면 검증

MSW 개발 서버(5233)에서 1280·390 폭으로 녹음 회의·채팅 회의의 처리 화면과 진행 토스트를 단계마다 찍었다(38장, 로컬 `frontend/.verify/483/`, 커밋하지 않음). 녹음 토스트의 대기 단계는 업로드 뒤 처리 화면을 떠나는 동안 지나가 찍지 못했다 — 그 상태는 `processingToast.test.tsx` 의 「PM: 정리 중 → 화자 지정 필요 …」가 단언한다.

## 남은 작업과 제한 사항

- A안(전사 트랙 진행, 단계 시작 시각)은 #483 에 남는다.
- 업로드 화면([MeetingUploadForm.tsx](../../../src/features/meeting-upload/ui/MeetingUploadForm.tsx))의 옛 Notion 안내와 회의록 화면 문구는 #507 이 바꾼다(t15 결정).
- 실서버(BE·AI)와는 확인하지 않았다.

## 관련 기록

- 이슈 [#483](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/483) 사용자 결정 댓글
- [#384 progress 시점](../../contracts/frontend-api-contract.md), [#424 진행 토스트](../424-processing-toast/result.md), [#379 채팅 회의](../379-chat-meeting/result.md)
