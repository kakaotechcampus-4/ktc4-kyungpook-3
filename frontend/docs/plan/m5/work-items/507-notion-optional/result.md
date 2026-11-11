# 결과 — 회의 올리기에서 Notion 연결 필수 빼기 (#507)

- 기록일: 2026-11-07
- 대상: [#507](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/507)
- 상태: **이슈의 할 일 6개를 반영했다.** 검사는 MSW 기준이다. 실제 BE·Notion 과는 붙여 보지 않았다.

## 작업 근거와 요약

사용자 결정(2026-11-07): 회의록은 웹 서비스가 제공하므로 회의 올리기에 Notion 연결이 꼭 필요하지 않다. Notion 은 선택 기능이다. 연결하면 승인한 태스크가 Notion 에도 반영되고, 연결하지 않아도 회의 올리기·정리·회의록·태스크를 웹에서 모두 쓴다. 새 결정은 [D-182](../../../../decision/frontend-decisions.md)에 남겼다. 마일스톤 계획의 완료조건이 아니라 이슈로 진행한 작업이다.

BE 는 이미 Notion 없이 동작한다. 코드로 다음을 확인했다(정적 확인).

- 업로드 `POST /workspaces/{id}/meetings/upload`(`backend/app/api/workspaces.py` `upload_meeting`)는 정리 중 회의·참석자·형식·크기만 검사한다. 정리·승인 API 에도 Notion 검사가 없다.
- 미연동 공간의 태스크는 `notion_sync_status = null` 이고(`notion_sync.enqueue_task_sync`), 반영 잡은 「Notion 연동이 없습니다」로 SKIPPED 된다(`notion_sync._process`).
- Notion 반영 대상은 태스크뿐이다. 회의록 본문은 Notion 에 올라가지 않는다.
- 정리 실패의 `failed_stage` 는 AI 의 `PATCH /meetings/{id}/fail`(`stt`·`sources`·`extract`·`handoff`·`diarize`, `ai/capture/recorder.FAILED_STAGE`)과 멈춤 정리 sweeper(`diarize`·`speaker_assignment_expired`·`chat_stalled`, `backend/app/services/upload_sweeper.py`)에서만 온다. **Notion 해제로 정리가 실패하는 경로가 없다.**

## D-099·D-100 을 지운 근거

D-099(정리 중 Notion 해제 시 실패)와 D-100(그때 재연결 모달)은 위 실패 경로 목록 때문에 전제가 성립하지 않는다. Notion 반영 실패는 회의 정리를 실패시키지 않는다 — Notion 쓰기는 정리와 따로 도는 태스크 반영 잡이고, 그 실패는 태스크의 `notion_sync_status` 에만 남는다. 오히려 잘못된 안내를 냈다. FE 추적기(`useProcessingTracker`)는 알 수 없는 `failed_stage` 를 보면 `GET /integrations` 를 다시 물어, Notion 이 `revoked` 면 일반 실패 토스트 대신 「Notion 연결을 마치지 못했어요」 재연결 모달을 띄웠다. 서버의 `revoked` 는 연결 뒤 DB 찾기가 실패·중단된 경우([M6 오류 기록](../../../m6-api/errors/2026-10-12-notion-revoked-meaning.md))와, 반영 중 토큰 갱신이 거절돼 토큰을 비운 경우(연결 끊김, `backend/app/api/integrations._notion_status`·`notion_sync._refresh_token`) 둘 다다. 어느 쪽이든 정리 실패와는 무관한데, 그런 공간에서 STT 등 다른 이유로 정리가 실패해도 재업로드 대신 Notion 재연결을 안내했다. 관리 세션 승인(2026-11-07)을 받고 이 경로를 지웠다. 알 수 없는 실패 단계도 일반 실패 안내(D-092)다.

## 실제 변경

### 회의 올리기·정리

- `features/meeting-upload/model/useUploadEntry.ts`: 진입 판정에서 연동 조회와 `blocked` 를 지웠다. 정리 중 회의만 본다. `NotionBlockReason` 타입을 없앴다.
- `pages/meeting-upload/ui/MeetingUploadPage.tsx`: 진입·업로드 409 의 `NotionRequiredModal` 두 곳을 지웠다.
- `features/meeting-upload/ui/MeetingUploadForm.tsx`·`model/useMeetingUpload.ts`·`model/uploadOutcome.ts`: `onBlocked` 와 409 `INTEGRATION_NOT_CONNECTED`·`INTEGRATION_REVOKED` 의 차단 분류를 지웠다. 이 코드가 오면 다른 오류처럼 폼 위에 알린다(서버는 내지 않는다). 폼 아래 안내를 「Notion을 연결했다면 태스크도 Notion에 올라가요. 확인이 필요한 태스크는 승인한 뒤에 올라가요.」로 바꿨다.
- `features/meeting-processing/model/useProcessingTracker.ts`: 실패 때의 연동 재조회(`isNotionRevoked`)·`revokedWorkspaceId`·`dismissRevoked` 를 지웠다. 실패 처리가 동기라 세션 확인(`captureSession`)도 필요 없어졌다. 반환값이 없다(`void`).
- `app/router/layouts/AuthenticatedLayout.tsx`: 재연결 모달을 지웠다.

### Notion 연결 뒤 업로드 복귀(D-098)

- `features/integration-connection/ui/NotionRequiredModal.tsx`, `lib/uploadReturn.ts`(+테스트)를 지웠다. `index.ts` 는 Notion 줄만 고쳤다.
- `model/useNotionConnection.ts`: `next`·`returnTo` 를 지웠다. OAuth 복귀는 설정의 Notion 영역이고 연결 뒤 설정에 머문다.
- `ui/NotionConnectionSection.tsx`: `회의 올리기로 돌아가기` 링크를 지웠다.
- `shared/config/routes.ts`: `SETTINGS_PARAMS.next` 와 `settingsNotion` 의 `next` 인자를 지웠다.
- Discord 쪽 파일(`DiscordConnectionSection.tsx`·`ConnectionActions.tsx`)과 `useIntegrationConnection.ts` 의 `connectedTo`(Discord 가 씀)는 고치지 않았다.

### 문구

- 설정 Notion 카드(미연결): 「연결하지 않아도 돼요. 연결하면 승인한 태스크가 Notion에도 올라가요.」 팀원 안내: 「Notion 연결은 PM만 할 수 있어요. 태스크를 Notion에도 올리려면 PM에게 연결을 요청해 주세요.」
- 온보딩 Notion 단계: 이미 `건너뛰기` 가 있다. 말풍선 한 줄 「노션은 꼭 연결하지 않아도 돼요. 연결하면 승인한 태스크가 노션에도 올라가요.」를 더했다. 새 버튼은 없다.
- 회의록 `추출된 일` 안내(`widgets/meeting-minutes/ui/MinutesBody.tsx`, 관리 세션이 정한 문구): PM 「Notion을 연결했다면 확실한 태스크는 바로, 확인이 필요한 태스크는 승인한 뒤 Notion에도 올라가요.」, 팀원 「Notion을 연결했다면 확실한 태스크는 바로 Notion에도 올라가요.」
- 태스크 리스트 PM 설명(`widgets/task-board/ui/TaskBoard.tsx`): 「담당자별로 걸러 보고, 준비된 태스크를 확인하세요.」 캘린더 승인 대기 칩 문구는 그대로다.

### MSW

- 업로드 handler 가 Notion 상태로 409 를 내지 않는다(서버와 같다).
- `fail-notion-revoked` 흐름, `failMeeting` 의 `notionRevoked` 옵션, 시나리오 `meeting-fail-notion-revoked`·`meeting-notion-revoked` 를 지웠다. `fail-diarize` 는 이제 Notion 을 건드리지 않는다.
- `meeting-notion-not-connected` 는 미연결 공간에서 올리고 정리가 끝나는 시나리오가 됐다. [MSW 안내](../../../../msw-guide.md)를 고쳤다.

### 테스트

- 지운 동작의 테스트를 지우거나 새 동작으로 바꿨다: `meetingUpload`(미연결·끊김·준비 중에도 폼이 열리고 연동 조회가 없다, 미연결 공간 업로드가 처리 화면으로 간다), `notionConnection`(복귀 뒤 설정에 머문다, 옛 `next` 주소로 돌아와도 업로드로 가지 않는다), `meetingProcessing`(`revoked` 공간의 정리 실패도 재업로드 안내), `lateAsyncRaces`(실패 때 연동 재조회를 둘러싼 경합 묶음 M02~M06 을 지우고 「실패: 다른 화면으로 가는 중이면 끌고 가지 않는다」는 화면 코드 대기 경합으로 바꿨다), `meetingFlow`·`meetingScenarios`·`uploadModel`·`routes`.
- 새 `app/notionOptional.test.tsx`: 미연결 공간에서 정리한 회의의 회의록·태스크 상세·승인 결과에 「반영 중·반영 실패·반영됨」이 없고 `반영 상태 없음` 이며 `다시 반영하기` 가 없다.
- `onboardingIntegrations`: Notion 단계가 선택임을 알리고 건너뛸 수 있다.
- E2E: `meeting-flow` ①을 `meeting-notion-not-connected` 로 돌려 업로드 → 정리 → 회의록 → 그 회의의 태스크(`반영 상태 없음`)까지 본다. `meeting-keyboard` 의 차단 모달 포커스 테스트를 지웠다. ⑥ 제목에서 Notion 끊김을 뺐다.

### 문서

- [결정](../../../../decision/frontend-decisions.md): D-096~D-100 상태를 「대체됨(D-182)」, D-101 을 「일부 변경(D-182)」으로 바꾸고 본문은 그대로 두었다. 진행 상황 목록에 대체 표시를 달았다. D-182 를 새로 적었다(`git log --all -S "D-182"` 로 다른 브랜치가 쓰지 않음을 확인).
- [계약](../../../../contracts/frontend-api-contract.md): 맨 앞에 「Notion 선택 기능 (#507)」 절(합의된 규약·현재 구현·합의 필요 변경)을 더했다. §4.0-②-6·②-9·③-3, §4.3, §4.4 업로드 409, 오류 코드 절, §5.5 진입 가드 줄에 「2026-11-07(#507)」 표시를 달았다. 예전 기록은 지우지 않았다.

## 보호 문서의 대체된 설명

보호 문서는 고치지 않았다. 아래 설명은 D-182 로 대체됐다.

- [전체 계획](../../../frontend-plan.md) 277·281·294·295줄 근처: Notion 미연결 차단 모달·연결 뒤 업로드 복귀(D-096~D-098), 정리 중 끊김 모달(D-099·D-100), 업로드 진입 가드의 `GET /integrations`.
- [M5 계획](../../plan.md)·[M5 완료조건](../../m5-done-criteria.md)·[M5 인수인계](../../m5-handoff.md), [M1 계획](../../../m1/plan.md), [M8 계획](../../../m8/plan.md)의 같은 설명.
- M5 결정 기록(`plan/m5/basis-for-decision/` 의 업로드 정책·업로드 화면·MSW 회의 흐름·처리 추적기)과 [M8-B 결과](../../../m8/result-b.md)의 차단 모달·끊김 판정 서술은 그때의 기록이다.

## 실제 검증

- `npm run typecheck`·`npm run lint`·`npm run format:check`·`npm run build` 통과(Node v24.11.0).
- 바꾼 곳과 관련된 테스트 파일(회의 올리기·Notion 연결·정리 추적·경합·회의록·온보딩 연결·설정·대시보드·MSW 흐름·시나리오·업로드 모델·경로·회의 통합)을 돌렸다. `settingsPage.test.tsx` 의 저장 실패 알림 2건만 실패했고, 이 2건은 origin/develop 에서도 실패한다(이 작업과 무관). 전체 Vitest 는 CI 에 맡겼다.
- E2E `meeting-flow.e2e.ts`·`meeting-keyboard.e2e.ts` 11건 통과(로컬, Chromium).
- MSW 개발 서버(Chromium, `verify-managers-manager` 의 `meetings ①`)로 Notion 미연결 공간에서 회의 올리기 → 정리 → 회의록 → 그 회의가 만든 태스크 상세(Notion `반영 상태 없음`)까지 돌았다. 증거는 `frontend/.verify/reports/507/`(커밋하지 않음)이다.

## 남은 일

- 처리 화면(`pages/meeting-processing/ui/MeetingProcessingPage.tsx` 41줄)의 「회의록과 확실한 태스크는 바로 Notion에 반영하고…」 문구와 `meetingProcessing.test.tsx` 453줄 단언은 고치지 않았다. #483 B 에서 회의 정리 화면을 고치는 중이라 그쪽에 넘겼다(관리 세션 결정).
- 대시보드 `최근 반영` 은 Notion 미연결이면 「Notion이 연결되지 않았어요」 빈 상태를 보인다. 사실과 맞아 고치지 않았다.
- 실제 BE·Notion 과 붙여 보지 않았다.
