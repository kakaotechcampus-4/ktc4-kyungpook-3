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

---

# 결과 — 정리 중 화면의 전사 진행과 단계 경과 (#483 A안 FE)

- 기록일: 2026-11-10
- 대상: [#483](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/483) A안의 FE 몫. BE 몫은 PR #542, AI 몫(전사 진행 보고)은 PR #653 이고 둘 다 병합됐다. PR 본문은 `Part of #483` 이다.
- 기준: develop `cb0e9004` 에서 시작해 AI #653 병합 뒤 develop 을 merge 했다. MSW 로만 확인했다. 실서버는 확인하지 않았다.
- 상태: **FE 몫을 반영했다.** `processing.stt` 가 없는 응답(옛 BE, 진행을 보내지 않는 AI)에서는 화면이 전과 같다.

## 작업 근거

마일스톤 계획 밖 이슈 작업이다. 근거는 #483 의 BE 설계 확정 댓글, BE PR #542, 2026-11-10 사용자 결정(관리 세션 전달)이다. 전체 계획은 고치지 않았다.

사용자 결정(2026-11-10):

- 표시는 숫자와 경과 시간이다. 막대·회전 표시·남은 시간 추정은 없다. 서버 값이 아닌 숫자를 만들지 않는다(U4-4).
- 진행 단위는 처음에 정하지 않아 문구를 한 곳에 모았다. 같은 날 AI #653 이 단위를 전사를 끝낸 입력 음성 트랙 수로 정했고(관리 세션 전달), 문구를 `음성 트랙 3/5`·`음성 트랙 5개 중 3개 완료` 로 바꿨다.
- 경과는 지금 단계가 `stage_at` 부터 몇 분째인지다. 1분 미만은 `방금 시작`, 음수는 0 이다. 갱신은 polling 주기를 따른다.

## 실제 구현

### 경계

- [meeting 스키마](../../../src/shared/types/api/meeting.ts)가 `processing: {stage, stage_at, stt: {done, total} | null} | null` 을 읽는다. `stt` 는 정수이고 `0 ≤ done ≤ total`, `total ≥ 1` 이다(BE `MeetingSttProgress` 와 같다).
- 모양이 틀리면 응답을 거절하지 않고 `processing` 만 null 로 본다(D-184 보수 폴백, 개발 모드 경고). 키가 없는 옛 BE 도 null 이다.
- [mapper](../../../src/entities/meeting/model/mapper.ts)는 모르는 `stage` 를 null 로 내린다. 도메인은 `Meeting.processing: {stage, stageAt, stt} | null` 이다([types.ts](../../../src/entities/meeting/model/types.ts)).

### 표시 판정과 문구

- [stageDetail.ts](../../../src/entities/meeting/lib/stageDetail.ts) `stageDetail(processing, 지금 단계, now)` 가 지금 단계 옆에 붙일 진행 수와 경과(분)를 정한다.
  - 서버 단계가 화면의 지금 단계에 속할 때만 붙인다. 표 `STEP_STAGES` 가 대응을 갖는다: 「음성을 텍스트로 옮기기」 ← `stt`, 「결정사항과 할 일 뽑아내기」 ← `sources`·`extract`·`handoff`. 첫 단계·채팅의 「대화 모으기」에는 붙지 않는다. 발화 데이터로 `progress` 가 서버 단계보다 앞서 간 회의에 다른 단계의 경과를 붙이지 않기 위해서다.
  - 진행 수는 `stage` 가 `stt` 일 때만이다.
  - `now` 는 상세 응답을 마지막으로 받은 시각(쿼리의 `dataUpdatedAt`)이다. 3초 polling 마다 다시 그려지고 따로 타이머가 없다. polling 이 멈추면(읽지 못한 응답·연결 끊김) 경과도 멈춘다.
- 문구는 같은 파일 한 곳에 있다.

| 경우 | 보이는 글 | 화면 읽기 프로그램 |
|---|---|---|
| 진행 수 | `음성 트랙 3/5` | `음성 트랙 5개 중 3개 완료` |
| 경과 1분 미만, 음수 | `방금 시작` | 같음 |
| 경과 1~59분 | `4분째` | 같음 |
| 경과 60분 이상 | `1시간 15분째`, 나머지가 0 이면 `2시간째` | 같음 |
| 둘 다 | `음성 트랙 3/5 · 4분째` | `음성 트랙 5개 중 3개 완료, 4분째` |

- [StageDetailText.tsx](../../../src/entities/meeting/ui/StageDetailText.tsx)가 처리 화면과 토스트에 같은 모양으로 그린다.

### 화면

- [처리 화면](../../../src/pages/meeting-processing/ui/MeetingProcessingPage.tsx): 지금 단계 줄의 라벨 아래 작은 글씨로 보인다. 보조 표시가 없으면 줄의 DOM 이 전과 같다. 단계 판정과 `role=status` 안내(단계가 바뀔 때만 읽는다)는 바꾸지 않았다.
- [진행 토스트](../../../src/features/meeting-processing/ui/ProcessingToastCard.tsx): 펼친 카드의 단계 문장 아래 줄에 보인다. 접힌 알약(`정리 중 1/3`)과 알림 문장은 바꾸지 않았다. 숫자 두 개를 알약에 나란히 두면 단계 수와 헷갈리고, 알림에 진행 수를 넣으면 3초마다 읽힌다.

### 모의 서버

- [meetingFlow.ts](../../../src/shared/mock/meetingFlow.ts)
  - 상세 응답의 `processing` 은 BE `_processing` 처럼 정리 중일 때만 객체(보고 전이면 세 값이 null)이고 그 밖은 null 이다(`meetingResponse`).
  - `staged`(시나리오 `meeting-demo`)의 녹음 회의는 조회마다 AI 보고 하나를 받는다: 대기 → 전사 시작(수치 없음) → 0/5 → 3/5 → 5/5 → 저장(sources) → 추출 → 넘기기 → 완료. AI #653 의 순서(단계 시작 보고 뒤 `0/N`, 2초 간격 중간값, 최종 `N/N`)와 [BE-AI 계약](../../../../backend/docs/contracts/backend-ai-contract.md)을 읽어 맞췄다. 중간값 하나(1/5·2/5·4/5)를 건너뛰는 것은 AI 의 2초 간격과 같은 모습이다. `progress` 는 서버처럼 단계 순위에서 얻는다. 같은 `stt` 재보고는 `stage_at` 을 바꾸지 않는다. 조회는 5번에서 9번으로 늘었다.
  - 단계 시작 시각은 결정적 값이다(MOCK_NOW 2026-09-18 09:00 서울 직전, 08:55·08:58·08:58:30·08:59:30). 실제 날짜로 열면 경과가 큰 수다. 브라우저 시계를 MOCK_NOW 로 두면 `5분째`·`2분째`·`1분째`·`방금 시작` 이 보인다.
  - 새 방식 `staged-legacy`(시나리오 `meeting-demo-legacy`)는 전의 `staged` 그대로이고 `processing` 키가 없다(#542 전 BE).
  - 채팅 회의의 `staged` 는 전과 같다(채팅 수집은 단계를 알리지 않는다). `advanceMeeting` 의 뜻도 바꾸지 않았다. 픽스처 `mt_10` 에는 `processing` 을 넣지 않아 기존 화면 테스트가 그대로다.
- [MSW 안내](../../msw-guide.md)의 흐름 방식·시나리오 표를 고쳤다.
- E2E [meeting-flow.e2e.ts](../../../e2e/meeting-flow.e2e.ts): 조회가 9번으로 늘어 ② 완료 토스트 대기 25초 → 40초, ⑩ 넘기기 응답 대기 30초 → 40초, 이 파일의 테스트 한도 60초 → 90초로 늘렸다. ⑩ 은 넘기기 단계 줄에 경과가 붙어 기대값이 맞지 않았다(실제 날짜면 수천 시간). 시계를 MOCK_NOW 로 두고 `방금 시작` 까지 보게 고쳤다.

### 문서

- [대표 계약](../../contracts/frontend-api-contract.md): `MeetingDetailResponse` 검증 줄, §2.3 응답 예와 `processing` 절(BE 구현·AI 미전송·FE 구현), 코드 대조 표.
- [D-184](../../decision/frontend-decisions.md) 표의 보수 폴백 줄에 회의 상세 `processing` 을 더했다. 새 결정 번호는 쓰지 않았다.

## 설계에서 정한 것

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| 틀린 `processing` | 그 필드만 null(D-184 보수 폴백) | 응답 전체 `INVALID_RESPONSE`: 진행 표시 하나 때문에 처리 화면이 「응답을 읽지 못했어요」가 되고 추적 polling 이 멈춘다. 숫자가 빠질 뿐 화면이 사실과 다르게 말하지 않는다 |
| 틀린 범위 | `processing` 전체를 버림 | `stt` 만 버리고 경과는 남기기: 한 응답 안의 모양이 틀리면 나머지도 믿기 어렵고, 검사를 둘로 나눌 만큼의 이득이 없다 |
| 경과의 기준 시각 | 상세 응답을 받은 시각(`dataUpdatedAt`) | 분 단위 타이머: 화면이 쿼리와 따로 다시 그려지고 테스트가 타이머를 다뤄야 한다. 브리프의 「polling 주기에 맞춘다」와 같다 |
| 어느 단계에 붙이나 | 서버 단계가 화면의 지금 단계에 속할 때만(`STEP_STAGES` 표) | 늘 지금 단계에 붙이기: 데이터로 `progress` 가 앞서 간 회의(발화가 이미 저장됐는데 서버 단계는 `stt`)에 전사 경과가 「뽑아내기」 옆에 붙는다 |
| 알림·알약 | 바꾸지 않음 | 진행 수를 넣으면 3초마다 화면 읽기 프로그램이 읽는다(#424 이 이미 막은 일) |
| 모의 서버 | 보고 표 `STAGED_REPORTS` + 옛 서버 모드 | `advanceMeeting` 을 보고 단위로 바꾸기: 한 번에 `progress` 한 칸을 기대하는 기존 테스트를 모두 바꿔야 한다 |

## 검증

### 검사 명령

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npx prettier --check . '!.verify/**'` | 통과 |
| `npm run build` | 통과 |
| 바꾼 곳 테스트 `--maxWorkers=1` | 25 파일 399 건 + `features/meeting-processing` 2 파일 36 건 통과. 전체 `npm run test` 는 CI 가 돈다 |

- 새 화면 테스트 [meetingProcessingStageDetail.test.tsx](../../../src/app/meetingProcessingStageDetail.test.tsx) 15건: 진행 있음(`음성 트랙 3/5`, 낭독 `음성 트랙 5개 중 3개 완료`), 긴 트랙 하나(수치 `0/1` 이 그대로인데 조회마다 `4분째` → `5분째` → `1시간 1분째`, 처리 화면·토스트), 진행 없음·키 없음(단계 줄이 전과 같음), 모양 틀림(표시만 없고 화면 정상), 1분 미만·음수·60분 이상, 단계가 바뀌면 새 `stage_at` 기준, 모르는 `stage`, 토스트 카드(알림 문장에는 숫자 없음).
- 단위: [stageDetail.test.ts](../../../src/entities/meeting/lib/stageDetail.test.ts), mapper·스키마·`processingSignal`·모의 흐름·시나리오 테스트.
- `stageDetail` 이 늘 null 을 돌려주게 망가뜨리면 표시를 보는 7건이 실패했다(「없을 때 지금과 같음」을 보는 테스트는 통과). 되돌린 뒤 통과.
- 처리 화면이 응답 받은 시각 대신 그릴 때의 `Date.now()` 를 쓰게 망가뜨리면 긴 트랙 테스트가 실패했다. 응답 내용이 같으면 화면이 다시 그려지지 않아 경과가 멈추기 때문이다. 되돌린 뒤 통과.

### 화면 검증

MSW 개발 서버에서 브라우저 시계를 MOCK_NOW 로 두고 찍었다(로컬 `frontend/.verify/483a/shots/`, 커밋하지 않음).

- 처리 화면 1280·390: 올린 뒤 지금 단계 줄이 `5분째`(전사 시작, 수치 없음) → `음성 트랙 0/5 · 5분째` → `3/5` → `5/5` → 「결정사항과 할 일 뽑아내기」의 `2분째` → `1분째` → `방금 시작` 순서로 바뀌었다. `3/5` 에서 낭독되는 글이 `음성 트랙 5개 중 3개 완료, 5분째` 다.
- 진행 토스트 1280·390: 태스크 화면에서 펼친 카드의 문장 아래에 `음성 트랙 3/5 · 5분째`. 알림 문장에는 숫자가 없다.
- `meeting-demo-legacy`(옛 서버) 1280·390: 단계 줄에 보조 표시가 없다.

## 남은 작업과 제한 사항

- 진행 수는 끝낸 트랙 수라 긴 트랙 하나는 낮은 값으로 오래 머문다. 그동안 경과가 오르는 것으로 멈추지 않았음을 보인다. 성공률이 아니다(무음·실패 트랙도 끝난 것으로 센다).
- 마지막 단계 「결정사항과 할 일 뽑아내기」 안에서 서버 단계가 `sources` → `extract` → `handoff` 로 바뀌면 경과가 새로 센다. 화면의 단계 이름은 그대로라 `3분째` 뒤에 `방금 시작` 이 보일 수 있다. 사용자 결정(「지금 단계가 `stage_at` 부터」)대로 두었다. 마지막 단계 전체의 경과를 보이려면 BE 가 단계별 시작 시각을 따로 줘야 한다.
- 실서버(BE·AI)와는 확인하지 않았다. `stage_at` 은 BE 코드(`DateTime(timezone=True)`)를 읽어 시간대가 붙은 ISO 로 보았다.
