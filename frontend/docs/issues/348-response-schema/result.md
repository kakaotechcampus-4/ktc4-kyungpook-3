# 결과 — API 응답 zod 검증과 모르는 enum 처리 (#348)

- 기록일: 2026-11-08
- 대상: [#348](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/348)
- 상태: **PR 1(초안 5절의 1+2, #588 병합), PR 2(approval, #592 병합), PR 3(meeting·minutes·extraction, #597 병합), PR 4(message·notification, #604 병합), PR 5(integration·invitation·workspace·member·user·메시지 설정, 마지막) 반영.** 공용 경계(`shared/api`)와 모든 entity 응답을 검증한다. 옛 `enumValue` 는 지웠다. 검사는 MSW 기준이고 실제 BE 와는 붙여 보지 않았다.

## 작업 근거와 요약

정책은 #348 의 정책 결정(2026-11-05)과 추가 항목(2026-11-07)을 따랐다. 결정은 [D-184](../../decision/frontend-decisions.md)로 옮겼고 D-134 를 대체한다. 마일스톤 계획의 완료조건이 아니라 이슈로 진행한 작업이다.

전에는 `request<TaskDto>` 가 응답을 단언했다. 모르는 태스크 상태는 `할 일` 로, 모르는 이력 필드는 `제목` 으로, 모르는 출처는 `직접 변경` 으로 보였다. 필수 필드가 빠지면 `TypeError` 가 나서 화면은 `INVALID_RESPONSE` 문구 대신 공통 문구를 보였다.

## 실제 변경

### 공용 경계 (`shared/api`)

- `parseResponse(schema, data, entity)`: 성공 데이터를 스키마로 읽는다. 틀리면 첫 문제 필드로 `INVALID_RESPONSE`(`kind: invalid_response`, 재시도 안 함)를 던진다. `details` 는 `{entity, path}` 이고 경로는 `items[3].status` 처럼 쓴다. 받은 값은 넣지 않는다(D-140). 개발 모드는 모든 문제 필드의 경로·받은 값을 `console.warn` 으로 남긴다.
- `createInvalidResponseError(entity, path)`: 스키마 밖의 일관성 검사(예: 이력의 `task_id`)가 같은 오류를 만든다. 알림의 `ZodError`·메시지 mapper 의 일반 `Error` 를 바꿀 때도 이것을 쓴다(해당 entity PR).
- `unknownValue.ts`: `enumValue` 를 대신할 두 규칙. `displayValue` 는 표시용 분류의 모르는 값을 `{ unknown: '<받은 값>' }`(`UnknownValue`)로 남긴다. `fallbackValue` 는 보수 폴백이다. 둘 다 개발 모드에서 경고한다. `enumValue` 는 아직 남은 entity 가 써서 지우지 않았다.

### task

- `shared/types/api/task.ts`: 손으로 쓴 `TaskDto`·`TaskHistoryDto` 를 zod 스키마(`taskSchema`·`taskListSchema`·`taskHistorySchema`·`taskHistoryListSchema`)와 `z.infer` 타입으로 바꿨다. `status` 는 네 값 enum, `version` 은 정수다. `start_date`·`notion_sync_status` 는 빠진 옛 응답을 받는다(`nullish`). `auto_blocked` 는 #365 의 보수 폴백을 스키마로 옮겼다. 불리언이 아니거나 없으면 false(풀기 버튼 없음)이고 개발 모드에서 경고한다.
- `shared/types/api/reply.ts`: 기록(`/timeline`) DTO 를 스키마로 바꿨다. `kind` 는 판별 유니온이라 모르는 칸은 응답 전체가 실패한다. 줄의 `field`·`result`, `channel`·`evidence_status` 는 표시용이라 문자열로 받는다. 답장 판단(attribution) 타입은 message PR 몫이라 그대로 뒀다.
- `entities/task/api/taskApi.ts`: 태스크 하나를 돌려주는 일곱 경로(조회·`PATCH` 둘·생성·Notion 재시도·자동 막힘 풀기·답장 변경 되돌리기)가 `requestTask` 하나로 스키마와 공간 확인을 거친다. 목록·이력·기록도 `parseResponse` 로 읽는다. 다른 태스크의 이력은 `items[n].task_id` 경로로 실패한다.
- `entities/task/model/mapper.ts`: 경계가 보장하는 방어를 뺐다(`version` 정수 검사, `auto_blocked === true`, `undoable === true`, 상태 폴백). 이력 `changed_field`·`change_source` 와 답장 줄 `field`·`result` 는 `displayValue`, `notion_sync_status`·답장 `channel`·`evidence_status` 는 모르면 null 이다.
- `widgets/task-detail/lib/history.ts`: 모르는 값 문구 `알 수 없는 항목`(필드), `알 수 없는 출처`(출처), `알 수 없는 변경이에요`(답장 줄), `알 수 없는 결과`(답장 결과).
- MSW: `MockTask.status` 와 자동 막힘 이전 상태를 스키마 enum 으로 좁혔다(`fixtures/task.ts`, `db.ts`, `task-state.ts`). 동작은 그대로다.

### 바뀐 동작

| 응답 | 전 | 후 |
|---|---|---|
| 태스크 `status` 모름 | `할 일` 로 보이고 그 칸에 놓임 | 목록·상세가 `응답을 읽지 못했어요` 와 `다시 시도` |
| 목록 한 건 깨짐 | 상태는 그 건만 `할 일`, 필드 누락은 `TypeError` | 목록 전체가 `INVALID_RESPONSE` |
| 이력 필드·출처 모름 | `제목`·`직접 변경` | `알 수 없는 항목`·`알 수 없는 출처` |
| 답장 줄 종류·결과 모름 | `무엇을 바꿀지 정하지 못했어요`·`반영하지 않음`, 서버가 허락하면 되돌리기 | `알 수 없는 변경이에요`·`알 수 없는 결과`, 되돌리기 없음 |
| 쓰기 응답을 읽지 못함 | `상태를 바꾸지 못했어요`·`되돌리지 못했어요` 등 실패 문구 | `변경 결과를 확인하지 못했어요` 토스트와 `새로고침` |
| 기록 칸 `kind` 모름 | 이력 칸으로 잘못 읽음 | 변경 이력 영역이 `INVALID_RESPONSE` |

### 문서

- [D-184](../../decision/frontend-decisions.md): 결정과 D-134 대체. D-134 요약 줄에 대체 표시.
- [계약](../../contracts/frontend-api-contract.md) 맨 위 「응답 검증과 새 값 배포 순서」: 배포 순서 규칙(FE 결정, BE 합의 확인 필요), task 응답이 거절하는 것과 따로 다루는 것, BE 요청 둘. §2.6 의 「모르는 값은 `title`」과 §6 의 D-134 언급을 고쳤다.

## 리뷰 반영 (2026-11-09)

독립 리뷰 두 건(Codex·Grok)과 관리 세션 지시를 반영했다.

- **모르는 답장 줄에는 되돌리기가 없다(중간, 두 리뷰 모두).** 줄 종류(`field`)나 결과(`result`)를 모르면 서버 `undoable` 이 true 여도 mapper 가 false 로 읽는다. 아는 줄은 서버 값을 따른다. 표시용 분류는 읽기 전용이라는 정책에 맞췄다. 계약·D-184·스키마 주석의 「되돌리기는 `undoable` 만 따른다」를 고쳤다.
- **계약 대조 표의 버전 거절 위치(낮음, Grok).** 「M6 태스크·승인 처리 경계」의 Task 매핑 줄이 mapper 가 거절한다고 적었다. 응답 스키마가 거절한다고 고쳤다.
- **쓰기 응답을 읽지 못했을 때(사용자 결정).** 상태 변경·필드 저장·직접 추가·Notion 재시도·자동 막힘 풀기·답장 변경 되돌리기의 응답이 `INVALID_RESPONSE` 면 토스트 `변경 결과를 확인하지 못했어요` 와 `새로고침` 을 보인다. `새로고침` 은 그 공간의 태스크 목록·상세·이력을 다시 받는다(`taskKeys` 무효화). 입력 칸·버튼 옆에 실패를 보이던 세 쓰기도 이 경우만 토스트로 옮겼다. 다른 실패 문구는 그대로다. 공용 조각은 `isInvalidResponse`(`shared/api/errors.ts`), `WRITE_UNCONFIRMED_MESSAGES`(`errorMessages.ts`), `showWriteUnconfirmed`(`shared/ui/toast`), `showTaskWriteUnconfirmed`(`entities/task/lib`)다. 다음 entity PR 은 `showWriteUnconfirmed` 에 자기 데이터를 다시 받는 함수를 넘긴다.
- 테스트는 고치기 전에 먼저 실패를 확인했다. 모르는 답장 줄 RTL 셋(종류·결과·둘 다: 버튼 없음, GET 밖의 요청 없음), mapper 셋, history 하나. 쓰기 응답 RTL 여섯(`tasks`·`taskDetailEdit`·`taskViewsCreate`·`notionSyncPolling`·`taskAutoBlock`·`taskReplyTimeline`): 새 토스트, 옛 실패 문구 없음, `새로고침` 을 누르면 GET 이 나간다.

## develop 병합 (2026-11-09)

`origin/develop`(`33b071ac`, #582 회의 삭제·#458·#583 등)을 merge 로 들였다. 충돌은 셋이었다.

- `shared/types/api/task.ts`: develop 이 손으로 쓴 `TaskDto` 에 `meeting_deleted?: boolean` 을 더했다. 스키마에 `meeting_deleted: z.boolean().optional()` 로 옮겼다. BE `TaskResponse.meeting_deleted: bool = False` 와 같고, 빠진 옛 응답은 지우지 않은 회의(false)다. 불리언이 아니면 `INVALID_RESPONSE` 다(develop 의 mapper 검사와 같은 동작).
- `entities/task/model/mapper.ts`: develop 의 `version`·`meeting_deleted` 수동 검사는 스키마가 맡아 뺐다. `meetingDeleted: dto.meeting_deleted ?? false` 는 남겼다. 비불리언 거절 테스트는 mapper.test 에서 `shared/types/api/task.test.ts` 로 옮겼고, 빠진 옛 응답 허용도 더했다.
- 계약: develop 의 「회의 삭제와 보존 태스크 (#576)」 절과 이 PR 의 맨 위 절을 모두 남겼다. 이 PR 의 task 표에 `meeting_deleted` 를 더했다.
- BE `backend/app/schemas/task.py`·`reply.py` 최신과 다시 대조했다. 그 사이 바뀐 것은 `meeting_deleted` 하나이고, 스키마는 BE 가 정상으로 내는 응답을 거절하지 않는다. task 응답을 직접 읽는 곳이 `entities/task` 밖에 새로 생기지 않았다.

## 검증

Node v24.11.0, `frontend/` 에서 실행했다. 아래 숫자는 리뷰 반영 뒤 마지막 실행(2026-11-09)이다.

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm run format:check` | 통과 |
| `npm run build` | 통과 |
| `npm run test -- --maxWorkers=1` | 리뷰 반영 뒤 277 파일·3505 건 통과. develop 병합 뒤 287 파일·3654 건 통과 |

- 첫 전체 실행에서는 `notionSyncPolling.test.tsx` 한 건이 실패했다. 갱신 응답을 `auto_blocked` 없는 mock 행 그대로 돌려줬기 때문이다. 테스트가 `toTaskResponse` 로 실제 응답 모양을 돌려주게 고쳤고, `auto_blocked` 보수 폴백도 되살렸다(위). 두 번째 실행에서 통과했다. 두 번째 실행은 부하로 `client.test.ts` 의 워커가 뜨지 못해 그 파일만 따로 돌렸다(21 건 통과). 리뷰 반영 뒤 실행은 다른 워커와 겹치지 않게 차례를 받아 한 번에 돌렸다.
- 새·바꾼 테스트:
  - `shared/api/parseResponse.test.ts`: 정상, 필수 필드 누락, 타입 오류, 목록 한 건의 모르는 상태, 응답 전체가 다른 모양 → `INVALID_RESPONSE`, entity·필드 경로, 재시도 안 함. 받은 값은 경고에만 있다.
  - `shared/api/unknownValue.test.ts`: 표시용 보존과 보수 폴백, 경고.
  - `shared/types/api/task.test.ts`: 스키마의 거절·허용. MSW 픽스처와 handler 응답(목록·상세·이력·기록, 기본·`reply-judgment`, 변경·생성)을 스키마로 `parse`.
  - `entities/task/api/taskApi.test.ts`: 모르는 상태가 `할 일` 이 되지 않고 캐시에 들어가지 않으며 다시 요청하지 않음, 필수 필드 누락, 목록 한 건 깨짐이면 전체 실패, `PATCH` 응답, 이력 모르는 값 보존, 기록 `kind` 모름, 다른 태스크 이력 경로.
  - `app/taskInvalidResponse.test.tsx`(RTL, MSW `server.use`): 목록·상세가 `응답을 읽지 못했어요` 와 `다시 시도`, 1.3 초 기다려도 요청 1 번, 다시 시도로 복구. 받아 둔 상세는 갱신 실패 때 본문을 남기고 `최신 상태를 받지 못했어요`. 이력의 모르는 필드·출처는 `알 수 없는 항목`·`알 수 없는 출처`.
  - 기존 version 충돌·정상 태스크 흐름(`tasks.test.tsx`, `approvals*.test.tsx`, `taskDetailEdit.test.tsx` 등)은 전체 실행에서 통과했다.
- 초기 chunk(`index.html` 의 script·modulepreload·CSS 28 개)는 develop `0c9affbd` 와 같은 방식으로 빌드해 비교했다.

  병합 전 기준(develop `0c9affbd`):

  | | develop | 이 변경 | 차이 |
  |---|---|---|---|
  | 원본 | 922,593 B | 928,418 B | +5,825 B (+0.63%) |
  | gzip | 289,614 B | 291,085 B | +1,471 B (+0.51%) |

  늘어난 곳은 `task` chunk(+1.7 KB, 스키마)와 zod 가 든 공용 chunk(+3.7 KB)다. 공용 chunk 에 zod 의 `ZodDiscriminatedUnion`·`ZodLiteral` 이 새로 들어왔다(기록 `kind` 판별). 다른 초기 chunk 는 ±5 B 안이다. 리뷰 반영(쓰기 응답 토스트·답장 줄 되돌리기 판정)으로 원본 +452 B, gzip +40 B 가 더해졌다.

  병합 뒤 기준(develop `33b071ac` 를 같은 방식으로 빌드, 초기 파일 31 개): 원본 933,610 → 939,330 B(+5,720 B, +0.61%), gzip 293,326 → 294,828 B(+1,502 B, +0.51%).
- 브라우저(ego lite, MSW 모드 `single-workspace`): 태스크 목록 13 건이 그려졌다. 앱 안 이동으로 `tk_01`·`tk_03` 상세를 열었다. 콘솔 경고·오류와 `role=alert` 가 없었다. 스크린샷은 ego lite 창 문제로 찍지 못했다.

## PR 2: approval (2026-11-09)

develop `a6e9ea68`(PR 1 #588, #512 합친 카드 #586 병합 뒤)에서 `feature/348-approval-schema` 로 땄다.

### 실제 변경

- `shared/types/api/approval.ts`: 손으로 쓴 `ApprovalDto` 를 `approvalSchema`·`approvalListSchema` 와 `z.infer` 로 바꿨다. `status` 는 세 값 enum 이다. `type` 은 문자열로 받아 지원하지 않는 종류는 지금처럼 `unsupported` 다. `payload` 는 자유 dict(`looseObject`)로 두고, 모양이 화면 동작을 정하는 세 키만 본다. `task_overrides`(저장된 보완 값, mapper 의 `safeParse` 를 옮김), `merged_items`(#586, 배열이고 항목이 객체), `assignee_item_id`(#586, 문자열). 제안 값·근거와 합쳐진 항목의 키는 mapper 가 글자일 때만 읽는다(정책의 「payload `text()` 읽기 유지」). `payload_version`(#547)·`alias_candidate`·`alias_text`(#523)는 빠진 옛 응답을 받는다.
- 409 `details` 스키마 셋(`APPROVAL_CONFLICT`·`APPROVAL_CHANGED`·`APPROVAL_ALREADY_RESOLVED`). 손으로 쓴 details 타입은 아무 데서도 쓰지 않았다. `toApprovalResolveFailure` 가 충돌·이미 처리됨을 이 스키마의 `safeParse` 로 읽는다. 모양이 틀리면 지금처럼 일반 실패이고 `INVALID_RESPONSE` 로 바꾸지 않는다(요청은 이미 실패했다, D-184 에 더함). `APPROVAL_CHANGED` 의 details 는 화면이 읽지 않고, 스키마는 MSW 409 를 검사하는 데 쓴다.
- `entities/approval/api`: 상세·대기 목록·`PATCH` 승인·반려가 `request<unknown>` → `parseResponse(…, 'approval')` 다.
- `entities/approval/model/mapper.ts`: `enumValue`(모르는 상태 → `pending`), 보완 값 `safeParse`, `merged_items` 배열·객체 걸러내기, 409 수동 검사를 뺐다. `category`·`gate` 의 모르는 값 → null 은 그대로다.
- `features/approval-resolve`: 승인·반려 응답이 `INVALID_RESPONSE` 면 카드의 실패 문구 대신 `변경 결과를 확인하지 못했어요` 토스트와 `새로고침` 을 보인다. `새로고침` 은 성공 뒤 맞추는 것과 같은 승인·태스크·추출·별칭을 다시 받는다(`syncAfterResolve`).
- 저장된 보완 값은 생성·수정 카드의 키를 한 모양으로 본다. 생성 카드에 `status` 가 들어 있으면 전에는 버렸고 이제는 값이 틀리면 거절한다. 서버는 종류에 맞지 않는 키를 400 으로 막아 저장하지 않으므로(계약 「제안 값을 고쳐 승인」) BE 보다 엄격하지 않다.

### 바뀐 동작

| 응답 | 전 | 후 |
|---|---|---|
| 승인 `status` 모름 | `승인 대기` 로 보이고 승인·반려 버튼, 확인 필요 목록에 들어감 | 상세는 `확인 요청을 불러오지 못했어요` 와 `응답을 읽지 못했어요`, `다시 시도`. 승인·반려 버튼 없음 |
| 대기 목록 한 건 깨짐 | 그 건만 `승인 대기` | 목록 전체가 `INVALID_RESPONSE`. PM 의 태스크 목록은 `태스크 목록을 불러오지 못했어요` |
| `merged_items` 가 배열이 아니거나 항목이 객체가 아님 | 조용히 빈 목록·그 항목 버림 | `INVALID_RESPONSE` |
| 승인·반려 응답을 읽지 못함 | 카드에 `응답을 읽지 못했어요` 실패 | `변경 결과를 확인하지 못했어요` 토스트와 `새로고침` |

- 받아 둔 승인 상세는 갱신이 실패해도 카드가 남는다. 태스크 상세와 달리 승인 화면에는 「최신 상태를 받지 못했어요」 안내가 원래 없고, 이 PR 에서 더하지 않았다. 바뀐 카드 처리는 서버의 `payload_version` 409 가 막는다.

### 검증

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm run format:check` | 추적 파일 통과(git 제외 `.verify/reports` 두 파일만 경고) |
| `npm run build` | 통과 |
| 바꾼 곳 테스트 | 50 파일·866 건 통과(approval·reply·dashboard·extraction·mock·schema), 마지막 수정 뒤 14 파일·196 건 다시 통과 |
| `npm run test -- --maxWorkers=1` | 294 파일 중 293·3802 건 중 3801 통과(2,561 초). 실패 1 건은 `app/splash.test.tsx` 의 포커스 단언(#510, 이 PR 이 건드리지 않은 랜딩 스플래시)이다. 그 파일만 두 번 다시 돌려 모두 5 건 통과해 부하 타이밍으로 본다 |

- 새·바꾼 테스트:
  - `shared/types/api/approval.test.ts`: 거절(모르는·null 상태, 비불리언 `alias_candidate`, 숫자 지문, 배열 payload, 필수 필드 누락, 보완 값 일곱 경우는 경로 `payload.task_overrides` 까지, `merged_items`·`assignee_item_id` 모양), 허용(옛 응답, 모르는 종류, payload 의 모르는 키 보존, `merged_items` null). MSW 픽스처와 아홉 상태(기본·`approval-*` 일곱·`reply-judgment`)의 목록·상세, 승인·반려 응답, handler 의 409 셋 details 를 스키마로 `parse`.
  - `entities/approval/api/*.test.ts`: 상세의 모르는 상태가 `pending` 이 되지 않고 캐시에 들어가지 않으며 다시 요청하지 않음, 경고에 경로·값. 보완 값 경로 `payload.task_overrides.status`. `PATCH` 응답. 목록 `items[1].status` 면 전체 실패.
  - `entities/approval/model/mapper.test.ts`: 「모르는 상태 → `pending`」 기대를 지우고 스키마 테스트로 옮겼다. 저장된 보완 값 거절 여덟 경우도 스키마 테스트로 옮겼다.
  - `app/approvalInvalidResponse.test.tsx`(RTL, MSW `server.use`): 상세·PM 태스크 목록의 안내와 `다시 시도`, 1.3 초 기다려도 요청 1 번, 다시 시도로 복구. 갱신 실패 때 카드가 남음. 반려 응답을 읽지 못하면 토스트와 `새로고침`(누르면 `GET /approvals/ap_01`). 마지막 경우는 고치기 전에 실패를 먼저 확인했다.
- 초기 chunk(`index.html` 의 script·modulepreload·CSS)를 develop `a6e9ea68` 과 같은 방식으로 빌드해 비교했다.

  | | develop | 이 변경 | 차이 |
  |---|---|---|---|
  | 원본 | 943,158 B (31 개) | 943,362 B (32 개) | +204 B (+0.02%) |
  | gzip | 296,014 B | 296,330 B | +316 B (+0.11%) |

  처음에는 `merged_items` 항목을 `z.record` 로 써서 zod 의 `ZodRecord` 가 공용 chunk 에 새로 들어왔다(원본 +4.8 KB). 같은 뜻인 `z.looseObject({})` 로 바꿔 새 zod 클래스가 없다. 파일이 하나 는 것은 task 스키마 모듈을 approval 도 쓰게 되어(`taskStatusSchema`) 1,184 B 짜리 chunk 로 갈라졌기 때문이다. 합친 크기는 +183 B 다. gzip 이 원본보다 더 는 것은 파일이 나뉜 몫이다.
- 브라우저 확인은 하지 않았다. 사용자 경로가 바뀌지 않고, 잘못된 응답 화면은 RTL 이 MSW 로 본다.

## PR 3: meeting·minutes·extraction (2026-11-09)

develop `5462ebff`(PR 2 #592, #591·#569·#589 병합 뒤)에서 `feature/348-meeting-schema` 로 땄다.

### 실제 변경

- `shared/types/api/meeting.ts`·`minutes.ts`·`extraction.ts`: 손으로 쓴 DTO 를 zod 스키마와 `z.infer` 로 바꿨다.
  - 회의 `status` 는 여섯 값 enum 이다(목록·상세·업로드 202·화자 지정). 처리 추적·회의록 목록·업로드 차단을 정하는 상태 판단 필드다.
  - 회의·회의록 `source` 는 문자열로 받아 mapper 가 `displayValue` 로 읽는다. 모르는 값은 `{unknown}` 으로 남는다.
  - 회의 상세의 `deletion_available`(#576)·`progress` 는 빠진 옛 응답을 받는다.
  - 화자 지정의 `mapping` 은 `z.record` 대신 같은 검사를 `z.custom` 으로 쓴다(`ZodRecord` 가 초기 chunk 에 들어오지 않게, PR 2 와 같은 이유).
  - 회의록 `summary` 는 모양이 틀리면 null 이다. BE 도 저장된 요약 JSON 이 깨졌거나 객체가 아니면 null 로 내린다(`get_meeting_minutes`). 전사문까지 잃지 않게 응답 전체를 거절하지 않는다. `permissions` 는 권한이라 틀리면 거절한다.
  - 추출 항목은 화면이 읽는 필드만 본다. 확신도 넷·`needs_check`·`alias_candidate`·`alias_text`·`extraction_path` 는 보지 않는다. BE 의 `confidence` 는 `float | None` 인데 FE 타입은 `number` 였고 화면은 읽지 않았다. 도메인 `ExtractionItem.confidence` 도 지웠다.
  - 되돌리기 응답 스키마와 409 `AUTO_TASK_NOT_REVERTIBLE` `details` 스키마. `toAutoItemRevertRejection` 이 손으로 쓴 `isRecord` 검사 대신 `safeParse` 로 읽는다. 틀리면 지금처럼 `unknown` 사유다.
- `entities/meeting`·`minutes`·`extraction` 의 api 가 `request<unknown>` → `parseResponse(…, 'meeting' | 'minutes' | 'extraction')` 다. 화자 지정 `PUT` 은 응답을 읽지 않아 검증하지 않는다.
- mapper 에서 `enumValue` 를 뺐다. 모르는 회의 상태 → `created`·`processing`, 모르는 출처 → `discord` 가 없어졌다. 추출 `gate` → `hold`, `approval_status` → null 은 `fallbackValue` 로 그대로다.
- 모르는 출처의 특성(`entities/meeting/model/sourceTraits.ts`): `MEETING_SOURCE_TRAITS` 표를 직접 읽던 곳을 `meetingSourceTraits(source)` 로 바꿨다. 모르는 출처는 시각 축 `unknown` 이다.
  - 회의 안 시각(`formatMoment`)은 빈 글자, 근거 시각(`evidenceMoment`)은 null 이라 `시각 알 수 없음` 이다.
  - 목록 메타·대시보드 최근 회의는 길이를 빼고, 회의록 머리 메타는 시작 시각만 보인다.
  - 출처 칩은 `알 수 없는 출처`(`sourceLabel`), 목록 배지는 없음(`sourceBadge`).
  - `useMeetingSources` 는 모르는 출처를 「모름」(null)으로 돌려줘 처리 화면·토스트가 단계를 그리지 않는다.
  - 업로드 차단(`findUploadBlockingMeeting`)은 채팅이 아닌 정리 중 회의로 본다. 업로드를 덜 허락하는 쪽이다.
- 쓰기 응답(D-184)
  - 되돌리기(`features/auto-item-revert`): 응답이 `INVALID_RESPONSE` 면 항목에 실패를 남기지 않고 `변경 결과를 확인하지 못했어요` 토스트와 `새로고침`(태스크·승인·추출 다시 받기)을 보인다.
  - 업로드(`features/meeting-upload`): `INVALID_RESPONSE` 를 응답을 잃은 것(`lost`)으로 분류한다. 이미 있는 복구가 목록을 다시 받아 정리 중 회의가 있으면 처리 화면으로 가고, 없으면 `올린 결과를 확인하지 못했어요` 를 보인다. 서버가 받았을 수 있는 업로드를 실패라고 하지 않는 같은 뜻이고, 토스트보다 다음 행동이 분명하다. 복구가 이 업로드를 상태와 상관없이 찾게 한 것은 아래 「리뷰 반영」이다.
- 모의 서버: 추출 항목의 BE 전용 필드(확신도·`needs_check`·별칭 후보)는 `MockExtractionItem` 타입으로 옮겨 handler 가 BE 와 같은 모양을 계속 낸다.

### 바뀐 동작

| 응답 | 전 | 후 |
|---|---|---|
| 회의 `status` 모름 | 상세는 `created`, 업로드 응답은 `processing` 으로 보임 | 회의 목록 `회의 목록을 불러오지 못했어요`·상세·처리 화면이 `응답을 읽지 못했어요` 와 `다시 시도` |
| 회의 목록 한 건 깨짐 | 그 건만 `created` | 목록 전체가 `INVALID_RESPONSE` |
| 회의·회의록 `source` 모름 | `Discord 자동 수집` 으로 보이고 녹음 시간으로 읽음 | `알 수 없는 출처`, 길이·회의 안 시각·배지·처리 단계 없음 |
| 회의록 `summary` 모양이 틀림 | 그리다 `TypeError` | 요약 없음, 전사문은 보임 |
| 추출 항목 한 건 깨짐 | 그 필드만 `undefined` 로 그려짐 | `추출된 일을 불러오지 못했어요`. 회의록 본문은 남음 |
| 되돌리기 응답을 읽지 못함(예: `approval_id` 가 null) | `approval_id` 없이 성공으로 그림 | 토스트와 `새로고침`, 되돌리기 버튼이 남고 포커스가 그 버튼으로 |
| 업로드 응답을 읽지 못함 | 모르는 상태를 `processing` 으로 보고 처리 화면으로 | 목록에서 이 업로드(정리 중·화자 지정 대기·완료)나 정리 중인 다른 회의를 찾아 처리 화면으로. 목록에 없으면 다시 올리라고, 목록을 받지 못하면 회의록 목록에서 확인하라고 안내 |
| 처리 중 회의의 상세를 읽지 못함 | (전에는 모르는 상태가 `created` 라 추적이 끝남) | 처리 화면에 안내와 `다시 시도`만. 추적은 남고 polling·포커스 재조회는 멈춤 |

- `app/dashboard.test.tsx` 의 「성공 응답에 승인 ID 가 없어 링크가 없으면 포커스가 그 행으로 간다」는 `approval_id: null` 성공 응답을 전제했다. BE `ExtractionItemRevertResponse.approval_id` 는 `str` 이고 FE 타입도 `string` 이었다. 이 응답은 이제 읽지 못한 응답이라 기대를 「되돌리기 버튼이 남고 포커스가 그 버튼으로」로 바꿨다. 링크가 없을 때 행으로 옮기는 `RecentSection` 의 분기는 남았지만 이 테스트로는 더 닿지 않는다.

### 검증

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm run format:check` | 추적 파일 통과(git 제외 `.verify/reports/issue.md` 만 경고) |
| `npm run build` | 통과 |
| 바꾼 곳 테스트 | 81 파일·1301 건 중 2 건 실패 뒤 고침(dashboard E-04 기대, 이름을 바꾸던 중 돈 스키마 테스트). 고친 뒤 22 파일·329 건 통과 |
| `npm run test -- --maxWorkers=1` | 302 파일·3913 건 모두 통과(2,147 초) |

- 새·바꾼 테스트:
  - `shared/types/api/meeting.test.ts`·`minutes.test.ts`·`extraction.test.ts`: 거절(모르는·null 상태, 타입 오류, 필수 필드 누락, 화자 지정의 숫자 팀원 ID, 문자열 권한, 깨진 추출 항목은 경로 `items[0]` 까지)과 허용(모르는 출처·판단·승인 상태, 옛 응답, null 확신도). 회의록 요약 세 경우는 null 과 경고. MSW 픽스처와 스물네 상태(기본·`meeting-*` 열여섯·`minutes-edit-pending`·`dashboard-*` 셋·`approval-merged`·`approval-chat`·`reply-judgment`)에서 handler 가 내는 회의 목록·상세·회의록·추출·화자 지정, 되돌리기 응답과 409 details 를 스키마로 `parse`.
  - `entities/*/api/*.test.ts`: 상세의 모르는 상태가 캐시에 들어가지 않고 다시 요청하지 않음과 경고. 목록 `items[1].status`, 업로드 `status`, 화자 지정 `mapping`, 회의록 `permissions.can_review`, 추출 `items[2].task_id` 경로. 모르는 출처의 `{unknown}`, 모르는 판단·승인 상태의 폴백과 경고.
  - `entities/meeting/model/mapper.test.ts`: 「모르는 상태·출처 → `created`·`discord`」 기대를 「출처는 받은 글자를 남기고 상태는 스키마가 거절」로 바꿨다. `widgets/meeting-minutes/lib/format.test.ts`: 모르는 출처의 메타·칩·배지. `features/meeting-upload/model/uploadModel.test.ts`: `INVALID_RESPONSE` → `lost`.
  - `app/meetingInvalidResponse.test.tsx`(RTL, MSW `server.use`): 회의 목록 안내와 `다시 시도`, 안내 뒤 1.3 초 동안 재요청 없음, 다시 시도로 복구. 모르는 출처의 목록 줄·칩·머리 메타·전사문 시각. 출처를 모르는 정리 중 회의의 처리 화면에 단계 없음. 깨진 추출 항목의 안내와 남은 본문. 되돌리기 응답을 읽지 못하면 토스트와 `새로고침`(누르면 `GET /extractions/ex_01`). 다섯 경우 모두 develop 코드로 먼저 실패를 확인했다.
  - 회의 목록은 회의록 본문이 같은 목록 Query 를 늦게 구독해 처음에 한 번 더 받을 수 있다. TanStack 의 mount 때 다시 받기이고 오류 종류와 상관없다. 그래서 「재시도 없음」은 안내가 뜬 뒤 요청 수가 그대로인지로 본다.
- 초기 chunk(`index.html` 의 script·modulepreload·CSS)를 develop `5462ebff` 와 같은 방식으로 빌드해 비교했다.

  | | develop | 이 변경 | 차이 |
  |---|---|---|---|
  | 원본 | 960,071 B (33 개) | 962,690 B (35 개) | +2,619 B (+0.27%) |
  | gzip | 301,792 B | 302,902 B | +1,110 B (+0.37%) |

  늘어난 것은 세 entity 의 스키마와 출처 특성 코드다(회의 chunk +1,037 B, index chunk +1,275 B). zod 클래스는 새로 들어오지 않았다(`z.custom` 의 `ZodCustom` 은 develop 초기 chunk 에 이미 있다). 파일이 둘 는 것은 `parseResponse` 가 592 B chunk 로 갈라지고, `enumValue` 를 덜 쓰게 되어 이름이 `enum` 이던 8 KB chunk 가 `useQuery` chunk 와 60 B `enum` chunk 로 나뉘었기 때문이다.
- 브라우저 확인은 하지 않았다. 정상 응답의 사용자 경로는 그대로이고, 잘못된 응답과 모르는 출처 화면은 RTL 이 MSW 로 본다.

### 리뷰 반영 (2026-11-09)

Codex·Grok 독립 리뷰의 중간 2 건, 낮음 1 건을 고쳤다.

- **처리 추적기가 읽지 못한 상세를 계속 물었다(중간, 두 리뷰, Codex 재현).** `trackerOutcome` 은 모르는 오류를 정리 중으로 보고 3초(화자 지정 대기 30초) polling 과 포커스 재조회(`always`)를 이어 갔다. 받아 둔 상세가 있으면 마지막 단계가 안내 없이 남았다.
  - 판정에 `invalid` 를 더했다. `INVALID_RESPONSE` 면 polling 간격이 없고(`pollInterval` false), 추적기의 포커스·연결 복귀 재조회도 끈다(`refetchOnReturn`). 정리 실패·완료로 끝내지 않아 추적은 남는다.
  - `meetingDetailQueryOptions` 도 같은 오류에서 포커스·복귀 재조회를 끈다. 처리 화면이 같은 상세를 구독해, 추적기만 끄면 화면의 기본 포커스 재조회가 남았다.
  - 처리 화면은 받아 둔 상세가 있어도 `INVALID_RESPONSE` 면 단계 대신 `정리 상태를 불러오지 못했어요`·`응답을 읽지 못했어요` 와 `다시 시도`만 보인다. 다시 시도가 성공하면 다시 polling 한다.
- **업로드 응답을 읽지 못하면 이미 받아진 업로드를 놓쳤다(중간, Codex 재현).** 복구가 업로드 차단 검색(정리 중만)을 그대로 써서, 확인 전에 화자 지정 대기·완료로 넘어간 같은 업로드를 찾지 못하고 다시 올리라고 했다. BE 중복 차단도 정리 중만 막아 두 번째 회의가 생길 수 있었다.
  - 받아진 업로드 확인(`findAcceptedUpload`)을 차단 검색과 나눴다. 올리기 전 목록 캐시에 없던, 제목과 회의 시각(`Date.parse` 로 비교)이 같은 직접 올린 회의 하나를 상태와 상관없이 이 업로드로 보고 그 처리 화면으로 간다.
  - 없으면 전처럼 정리 중인 다른 회의의 처리 화면으로, 그것도 없으면 다시 올리라고 한다(서버가 받지 않았다).
  - 목록을 받지 못했거나 같아 보이는 새 회의가 여럿이면 `다시 올리기 전에 회의록 목록에서 이 회의가 올라갔는지 확인해 주세요` 와 `회의록 목록 보기` 링크를 보인다. 네트워크로 응답을 잃은 경우도 같은 길이다.
- **스키마 순회 테스트가 모든 HTTP 오류를 건너뛰었다(낮음).** `readMeetings` 는 상세의 403·404 만 건너뛰고 나머지는 다시 던진다. 목록 길이 대신 실제로 읽은 상세·회의록·추출·화자 지정 수를 돌려주고, 상태마다 상세가 하나 이상, 모든 상태를 합쳐 회의록·추출·화자 지정이 각각 하나 이상인지 본다. 상세 500 이면 실패하는 테스트를 더했다.
- 리뷰 범위 밖에서 찾은 것: 첫 커밋(`59257608`)의 테스트 두 줄 `onTestFinished(() => vi.restoreAllMocks())`·`onTestFinished(() => vi.useRealTimers())` 가 `VitestUtils` 를 돌려줘 `npm run typecheck` 가 실패했다. 마지막 typecheck 를 그 두 줄을 넣기 전에 돌려 놓쳤고, 보고의 「typecheck 통과」는 그 커밋에 맞지 않았다. 중괄호 본문으로 고쳤다.
- 새 테스트
  - `app/meetingInvalidResponse.test.tsx`: 처리 추적 중인 회의의 상세가 처음부터·받아 둔 뒤에 읽지 못한 응답이면 안내와 `다시 시도`만 보이고, 3.5 초와 창 포커스·연결 복귀 뒤에도 상세 요청이 늘지 않으며 추적이 남는다. 다시 시도가 성공하면 다시 polling 한다.
  - `app/meetingUpload.test.tsx`: 202 본문을 읽지 못하고 서버에는 정리 중·화자 지정 대기·완료로 저장된 업로드를 찾아 그 처리 화면으로 가고 업로드는 한 번이다. 복구 목록도 실패하면 확인 안내와 회의록 목록 링크, 업로드 한 번.
  - `trackerOutcome.test.ts`(`invalid` 판정·멈춤), `uploadBlockingMeeting.test.ts`(이전 회의·다른 제목·다른 시각·채팅 제외, 여럿이면 `ambiguous`).
  - 추적기 두 경우와 업로드의 화자 지정 대기·완료·목록 실패 세 경우는 고치기 전 코드로 먼저 실패를 봤다. 업로드 정리 중 경우는 고치기 전에도 통과한다(차단 검색이 찾는다).
- 검사: typecheck·lint·build 통과, 바꾼 곳 30 파일·537 건 통과, `npm run test -- --maxWorkers=1` 302 파일·3926 건 모두 통과(2,236 초). 초기 chunk 는 다시 재지 않았다.

## PR 4: message·notification (2026-11-09)

develop `92f511bb`(PR 3 #597 병합 뒤)에서 `feature/348-message-schema` 로 땄다. #335 `reminder_dm` 의 FE 정리는 넣지 않았다(BE 2차 배포 뒤 후속, 사용자 결정 2026-11-09).

### 실제 변경

- `shared/types/api/message.ts`: 손으로 쓴 응답 DTO 를 zod 스키마와 `z.infer` 로 바꿨다. 요청 DTO 는 그대로다. BE `backend/app/schemas/message.py` 와 대조했다.
  - 상태 판단: 보낸 쪽 `sender`(`bot`·`pm`·`member`), `dm_status`, 묶음 `status` 는 enum 이다. 화면이 무엇을 그릴지(DM 전달 표시·답장 경로·작성자)와 승인 대상을 정한다.
  - 칸 맞춤: 팀원 메시지는 `reply_channel`, 봇·PM 메시지는 `dm_status` 가 있어야 하고, 승인한 예정 묶음은 `approved_at` 이 있어야 한다(`superRefine`). 막 만든 재촉의 묶음은 예정이어야 한다(`createdReminderSchema`). 전에는 mapper 가 일반 `Error` 를 던졌다.
  - 표시용·보수 폴백: `body_source` 는 받은 글자를 남겨 `출처를 알 수 없는 문구` 로, `dm_failure_reason` 은 서버의 `unknown` 과 같은 `이유를 알 수 없어요` 로, `draft_status` 는 작성 중으로, `reply_channel` 은 웹 답장 표시 없이, 근거 `kind` 는 근거 없음으로 읽는다. 모두 개발 모드에서 경고한다.
  - #583: PM 글(`sender: pm`)의 `author_member_id`·`author_name`(#519)과 대화 요약의 `web_reply_available`(#525)은 빠진 옛 응답을 받는다. 작성자가 없으면 `PM`, 웹 답장은 모름이다.
  - #587(#558): 대화 신호 웹소켓의 `thread_updated` 프레임을 `threadUpdatedSignalSchema` 로 읽는다. 모르는 프레임은 버린다(응답이 아니다).
  - 화면이 읽지 않는 메시지 `thread_id`·`scheduled_at`, 리마인드 `bundle_id`·`status`·`kind`·`origin`·`created_at` 은 보지 않는다. 모의 서버는 `MockMessageResponse`·`MockReminderResponse` 로 그 칸을 계속 낸다.
- `shared/types/api/reply.ts`: 답장 고르기를 `status` 판별 유니온 스키마로 바꿨다. 모르는 상태는 거절한다.
- `shared/types/api/notification.ts`: 알림 목록·푸시 내용·푸시 공개키 스키마를 entity 의 mapper·api 에서 옮겼다. `kind`(`message_received` 포함)·`link.type` 은 열린 문자열이다. 목록·공개키는 `parseResponse(…, 'notification')` 로 읽어 전에 그대로 나가던 `ZodError` 대신 `INVALID_RESPONSE` 다. 서비스 워커의 푸시 내용은 지금처럼 `safeParse` 로 모양이 틀리면 버린다.
- `entities/message/api`: 목록·대화·답장 고르기 조회와, 응답을 읽는 쓰기(보낼 시각 옮기기·태스크 빼기·재촉 만들기·대화 열기)가 `parseResponse(…, 'message')` 다. `reads` 가 그 경로의 스키마를 받는다. 응답을 읽지 않는 쓰기(승인·보내지 않음·문구·답장·메모·답장 고르기)는 그대로다.
- 쓰기 응답(D-184): `useMessageAction`·`useCreateReminder`·`useOpenThread` 는 `INVALID_RESPONSE` 면 실패로 남기지 않고 `변경 결과를 확인하지 못했어요` 토스트와 `새로고침`(그 공간의 메시지 목록·대화 다시 받기)을 보인다. 재촉 만들기는 다시 만들면 둘이 될 수 있어 특히 실패라고 하지 않는다.

### 바뀐 동작

| 응답 | 전 | 후 |
|---|---|---|
| 메시지 보낸 쪽·DM 상태 모름 | 보낸 쪽은 mapper 가 메시지를 만들지 못해 그리다 깨지고, DM 상태는 그대로 지나가 실패가 아닌 것처럼 보임 | 대화·목록이 `응답을 읽지 못했어요` 와 `다시 시도` |
| 보낸 쪽과 칸이 맞지 않음, 승인 시각 없는 승인 묶음 | 일반 `Error` 라 `문제가 생겼어요` | `INVALID_RESPONSE`, 그 칸 경로가 남는다 |
| 묶음 `status` 모름 | 예정이 아닌 것으로 보고 조용히 뺌 | 목록 전체가 `INVALID_RESPONSE` |
| 문구 출처 모름 | 화면이 표에 없는 키로 빈 글자 | `출처를 알 수 없는 문구` |
| 알림 목록 한 건 깨짐 | `ZodError` 라 공통 문구 | 종 안에 `응답을 읽지 못했어요` |
| 시각 옮기기·태스크 빼기·재촉 만들기·대화 열기 응답을 읽지 못함 | 단언한 응답으로 성공 처리하거나, mapper 의 `Error` 로 실패 문구 | 토스트와 `새로고침` |

### 검증

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과(직접 돌려 0 건 확인) |
| `npm run lint` | 통과 |
| `npm run build` | 통과 |
| 바꾼 곳 테스트 | 62 파일·1013 건 통과 |
| `npm run test -- --maxWorkers=1` | 309 파일·4027 건 통과(3,756초) |

- 새·바꾼 테스트
  - `shared/types/api/message.test.ts`: 거절(모르는 보낸 쪽·DM 상태·묶음 상태, 칸 맞춤 다섯, 정수가 아닌 문구 판, 문구 누락, 만든 재촉의 예정이 아닌 묶음, 답장 고르기의 모르는 상태)과 경로, 허용(모르는 문구 출처·초안 상태·근거 종류·DM 실패 이유·답장 경로, #519·#525·#418 의 옛 응답), 웹소켓 프레임. 열두 MSW 상태의 목록·대화·답장 고르기와 쓰기 응답 다섯을 스키마로 `parse` 하고, 대화와 답장 고르기를 실제로 읽었는지 수로 본다.
  - `shared/types/api/notification.test.ts`: 모르는 종류·링크 허용, 날짜·링크·본문 오류 거절, 목록 한 건의 경로, 음수 안 읽은 수, 픽스처·handler 목록·푸시 공개키.
  - `entities/message/model/mapper.test.ts`: mapper 의 칸 맞춤 검사가 `INVALID_RESPONSE`(경로 포함)인지로 바꿨다. 모르는 값 여섯(문구 출처·초안 상태·DM 실패 이유·답장 경로·근거 종류·작성자 없는 옛 PM 글).
  - `entities/message/api/messageQueries.test.ts`·`entities/notification/api/notificationApi.test.ts`: 목록의 모르는 보낸 쪽이 캐시에 들어가지 않고 한 번만 요청, 답장 고르기·시각 옮기기·재촉 만들기·알림 목록·푸시 공개키의 경로.
  - `features/message-action/model/useMessageAction.test.tsx`: 태스크 빼기 응답을 읽지 못하면 실패 없이 토스트, `새로고침` 이 메시지 key 를 무효화.
  - `app/messageInvalidResponse.test.tsx`(RTL): 대화·목록의 안내와 다시 시도, 안내 뒤 재요청 없음, 다시 시도로 복구. 모르는 문구 출처 표시. 알림 종의 안내.
  - 처음에는 대화 신호 소켓이 열릴 때(`opened`)의 받기를 허용하고 그 뒤 요청 수만 봤다. 리뷰 반영에서 그 받기도 막고 요청 한 번인지 본다(아래).
  - 새 동작을 보는 일곱 경우(RTL 넷, 훅 하나, 알림 api 둘)는 develop 코드로 먼저 실패를 봤다.
  - 알림 mapper 의 「잘못된 날짜」 테스트는 스키마 테스트로 옮겼다.
- 초기 chunk(develop `92f511bb` 와 같은 방식): 원본 975,603 → 978,206 B(+2,603 B, +0.27%), gzip 306,320 → 307,311 B(+991 B, +0.32%). 메시지·알림 스키마 코드다(index chunk +2,266 B, task chunk +232 B). zod 핵심 chunk 크기는 같아 새 zod 클래스는 없다(판별 유니온은 PR 1 의 기록 칸이 이미 쓴다). 파일 35 → 36 개는 `unknownValue` 가 162 B chunk 로 갈라진 것이다.
- 브라우저 확인은 하지 않았다. 정상 응답의 사용자 경로는 그대로이고, 잘못된 응답 화면은 RTL 이 MSW 로 본다.

### 리뷰 반영 (2026-11-09)

Codex·Grok 독립 리뷰의 중간 2 건, 낮음 1 건을 고쳤다.

- **읽지 못한 메시지·알림 조회를 스스로 다시 물었다(중간 둘, 두 리뷰, Codex 재현).** 알림 30초 polling, 받아 둔 목록·대화의 초안 10초 polling(마지막 성공 데이터만 봤다), 목록·대화·답장 고르기의 창 포커스·연결 복귀 재조회, 대화 신호 소켓의 `opened`·`thread_updated` 무효화가 `INVALID_RESPONSE` 뒤에도 같은 요청을 보냈다. PR 3 의 회의 상세에 이은 같은 실수라 조회마다 막지 않고 공용으로 막았다(D-184 「읽지 못한 조회는 스스로 다시 묻지 않는다」).
  - `createQueryClient` 가 모든 조회의 기본 옵션을 만들 때(`defaultQueryOptions`) 간격·창 포커스·연결 복귀 값을 감싼다. 마지막 조회가 `INVALID_RESPONSE` 면 `false`, 아니면 조회가 정한 값(숫자·함수·`always`) 그대로다. TanStack 기본값 자리(`defaultOptions`)는 조회가 자기 값을 정하면 덮여, 조회가 정한 간격까지 막으려고 이 자리를 골랐다.
  - 자동 무효화는 `hasReadableResponse` 로 읽지 못한 조회를 거른다. 대화 신호 소켓(`useMessageSignals`, 받는 중인 다시 시도도 끊지 않는다), 새 알림의 다시 받기(`useRefreshOnNotification`), 회의 정리 완료 뒤 다시 받기(`useProcessingTracker`). 다시 시도·쓰기 토스트의 `새로고침`은 거르지 않는다.
  - PR 3 의 개별 처리를 공용으로 옮겼다. `meetingDetailQueryOptions` 의 포커스·복귀 함수와 추적기의 `refetchOnReturn` 을 지웠고 추적기는 `always` 만 정한다. 추적 판정의 `invalid`(polling 간격 없음·화면 안내)는 화면 상태라 그대로다.
- **표시용 DM 실패 이유의 모르는 원문을 잃었다(낮음, Codex).** `dm_failure_reason` 을 `displayValue` 로 읽어 모르는 값은 `UnknownValue` 로 남는다. 화면만 서버의 `unknown` 과 같은 `이유를 알 수 없어요` 로 읽는다(`dmFailureText`). 이유가 null 인 실패는 서버의 `unknown` 이다.
- 새·바꾼 테스트
  - `app/messageInvalidResponse.test.tsx`: 대화(처음부터)·목록(처음부터, 받아 둔 초안 목록 뒤)·답장 고르기·알림 종에서 31초 넘게 가짜 간격 시계를 돌리고 창 포커스·연결 복귀와 그 공간 모든 대화의 `thread_updated` 신호를 지나도 그 조회의 요청 수가 그대로다(소켓 `opened` 뒤 받기도 없다). 목록과 알림은 다시 시도가 성공하면 10초·30초 간격이 다시 돈다. 답장 고르기 경우는 같은 신호로 읽을 수 있는 대화는 다시 받는지도 본다.
  - `shared/api/queryClient.test.ts`: 조회가 정한 숫자 간격·`always` 포커스·연결 복귀를 받아 둔 데이터가 있어도 멈추고 다시 시도 성공 뒤 간격이 다시 돈다, 처음부터 읽지 못하면 함수 간격도 돌지 않는다, 다른 오류(404)는 그대로 다시 묻는다, `hasReadableResponse` 가 읽지 못한 조회를 거른다.
  - `entities/message/model/mapper.test.ts`: 모르는 이유는 `{ unknown: 'rate_limited' }` 와 개발 경고, 서버의 `unknown`·null 은 `unknown`. `widgets/message-inbox/model/conversation.test.ts`: 모르는 이유의 말풍선 문구.
  - `trackerOutcome.test.ts`: 지운 `refetchOnReturn` 단언을 뺐다. 회의 상세·추적기의 요청 수 테스트(`app/meetingInvalidResponse.test.tsx`·`app/meetingProcessing.test.tsx`)는 그대로 통과한다.
  - RTL 다섯과 mapper·conversation 둘, 모두 일곱 경우는 고치기 전 코드로 먼저 실패를 봤다.
- 검사: typecheck(직접 돌려 0 건)·lint·build 통과, 바꾼 곳 62 파일·811 건 통과, `npm run test -- --maxWorkers=1` 309 파일 중 305·4033 건 중 4021 통과(3,874 초). 실패 12 건은 `app/onboardingMembers`·`settingsConnections`·`approvalsMsw`·`meetingDelete` 의 5초 시간 초과와 찾기 시간 초과다. 이 PR 이 건드리지 않은 화면이고, 그 네 파일만 다시 돌려 106 건 모두 통과해 부하 타이밍으로 본다.

## PR 5: integration·invitation·workspace·member·user (2026-11-10)

마지막 묶음이다. #594(PR #623, 초대·연동 쓰기의 세션 검사)와 같은 파일을 고쳐 `fix/594-approval-session-check`(`47959625`) 위에서 `feature/348-workspace-schema` 로 땄고, #623 리뷰 반영(`b6d72a8c`)을 merge 했다. #623 이 develop 에 병합되면 origin/develop 을 merge 한다.

### 실제 변경

- `shared/types/api`: `integration.ts`·`invitation.ts`·`workspace.ts`·`member.ts`·`auth.ts`·`messageSettings.ts` 의 손으로 쓴 응답 DTO 를 zod 스키마와 `z.infer` 로 바꿨다. 요청 DTO 는 그대로다. BE `backend/app/schemas/` 와 `app/api/workspaces.py`(온보딩은 항상 채운다)를 대조했다.
  - 상태 판단: 연동 `status`, 초대 `status`, 온보딩 `steps[].step`·`steps[].status`·`current_step`(완료한 공간의 빈 문자열 포함), 메시지 설정 `pm_alert_method` 는 enum 이다. 연결 카드·`준비 중` 재조회, 팀원 줄의 초대·취소·연결 끊기 버튼, 가드가 이어 갈 온보딩 단계, PM 이 바꿔 저장하는 알림 방법을 정한다.
  - 보수 폴백: 워크스페이스·팀원 `role` 은 모르면 `member`(`fallbackValue`), 워크스페이스의 null 은 경고 없이 `member` 다.
  - 표시용: 별칭 `source` 는 받은 값을 남기고(`UnknownValue`) 팀 화면 칩이 `알 수 없는 출처` 로 읽는다(`aliasSourceLabel`).
  - 화면이 읽지 않는 별칭 `alias_type`, 초대의 `member_display_name`·`invited_by_name`·`responded_at`, 받을 초대 `created_at`, 설정 `updated_*`, 가입 코드 `expires_in` 은 보지 않는다. 모의 서버는 `MockMemberAlias`·`MockMessageSettings`·초대 handler 의 응답 타입으로 그 칸을 계속 낸다.
- 지운 것: `shared/lib/enum.ts`(`enumValue`). 쓰는 곳이 없던 별칭 `type`(모르면 `nickname` 으로 바꿨다)과 미해결 별칭 매핑(`toUnresolvedAlias`·`UnresolvedAlias`). 미해결 별칭 모의 응답 타입은 `shared/mock/fixtures/member.ts` 로 옮겼다.
- entity `api/`: 연동(상태·Discord 채널·채팅 채널 정하기·끄기), 초대(PM 목록·받을 초대), 워크스페이스(목록·상세·만들기), 팀원(목록·기록 목록·만들기·`PATCH`·별칭 목록·더하기·Discord 사용자), 사용자(세션·로그인·가입·가입 코드·카카오 대기·재설정 확인·탈퇴 계획·탈퇴·영수증), 메시지 설정(조회·`PATCH`)이 `parseResponse` 다. 탈퇴는 전에 `schema.parse` 의 `ZodError` 가 그대로 나갔다. entity 이름은 `user` 로 모았다.
- 쓰기 응답(D-184): 회의 채팅 채널 정하기·끄기, 별칭 더하기, PM 권한 주기, 메시지·알림 설정 바꾸기, 워크스페이스 만들기가 `INVALID_RESPONSE` 면 실패로 남기지 않고 `변경 결과를 확인하지 못했어요` 토스트와 `새로고침`(연동 상태·별칭·팀원·설정·공간 목록)을 보인다. 워크스페이스 만들기는 다시 만들면 이름이 겹친다.
- 복구 경로가 있는 쓰기는 그 경로다(D-184 에 더함). 온보딩 팀원 저장은 응답을 잃었을 때처럼 팀원 목록을 다시 읽는다(전부터 `invalid_response` 를 그렇게 봤다). 계정 탈퇴는 결과를 모르는 요청으로 같은 요청을 다시 확인한다. 로그인·가입은 폼에 `응답을 읽지 못했어요` 다.

### 바뀐 동작

| 응답 | 전 | 후 |
|---|---|---|
| 연동 상태 모름 | 미연결로 그려 `연결하기` 를 보임 | 설정·온보딩 카드가 안내와 `다시 시도` |
| 초대 상태 모름 | 닫힌 초대(취소)로 그려 다시 초대하게 함 | 팀원 줄이 `초대 상태를 불러오지 못했어요.` 와 `다시 시도` |
| 온보딩 단계·단계 상태 모름 | 현재 단계는 첫 pending 으로, 모르는 단계는 생성 단계로, 모르는 상태는 pending 으로 바꿔 그 단계로 보냄 | 공간 목록 전체가 `INVALID_RESPONSE`, 가드가 이동하지 않고 안내와 `다시 시도` |
| PM 알림 방법 모름 | `둘 다` 로 보여 다른 칸을 저장할 때 서버 값과 다르게 보임 | 설정 절이 안내와 `다시 시도` |
| 별칭 출처 모름 | `직접 추가` 로 보임 | `알 수 없는 출처` |
| 팀원·공간·세션·초대 응답의 필수 필드 누락 | 타입 단언으로 들어가 `TypeError` 면 공통 문구 | `INVALID_RESPONSE`, 그 칸 경로가 남는다 |
| 채팅 채널·별칭·PM 권한·설정·공간 만들기 응답을 읽지 못함 | 응답을 단언해 성공으로 보거나 실패 문구 | 토스트와 `새로고침` |

### 검증

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과(직접 돌려 0 건 확인) |
| `npm run lint` | 통과 |
| `npm run build` | 통과 |
| 바꾼 곳 테스트 | `src/shared`·`src/entities`, 바꾼 기능 조각, 설정·팀·온보딩·가드·인증·탈퇴·초대·동의 화면 211 파일·2,649 건. 가드의 모르는 단계 테스트 1 건이 요청 수 단언에서 실패해 고친 뒤 그 파일 32 건 통과 |
| `npm run test -- --maxWorkers=1` | 320 파일 중 312·4,095 건 중 4,086 통과(4,734 초). 실패 9 건은 `app/appShell`·`boot`·`consentFlow`·`messagesActionsMsw`·`messagesSignals`·`settingsConnections`·`settingsPage`·`taskBoardCompact` 의 5초 시간 초과와 찾기 시간 초과다. 그 여덟 파일만 다시 돌려 134 건 모두 통과해 부하 타이밍으로 본다 |

- 새·바꾼 테스트
  - `shared/types/api/{integration,invitation,workspace,member,auth,messageSettings}.test.ts`: 모르는 상태 판단 값 거절과 경로, 목록 한 건의 경로, 필수 필드 누락, 허용(모르는 역할·별칭 출처, 빈 현재 단계, `member_id` 없는 옛 응답, 프로필 사진 없음). 픽스처와 MSW handler 응답(연동·Discord 채널, PM 초대·받을 초대, 공간 목록·상세, 팀원·별칭·Discord 사용자, 세션·가입 코드·카카오 대기·재설정 확인, 설정 조회·바꾸기)을 같은 스키마로 `parse` 한다.
  - `app/workspaceInvalidResponse.test.tsx`(RTL): 모르는 연동 상태(연결하기 없음, 재시도 없음), 모르는 PM 알림 방법(선택 칸 없음), 모르는 초대 상태(다시 초대 없음, 재시도 없음), 모르는 별칭 출처의 칩, 별칭 더하기 응답을 읽지 못한 토스트. 다섯 모두 고치기 전 코드(`b6d72a8c`)로 먼저 실패를 봤다.
  - `app/router/guards.test.tsx`: 모르는 현재 단계는 첫 pending 단계로 보내지 않고 안내와 `다시 시도`, 그 뒤 다시 묻지 않는다(부팅 조회 위에 가드 조회가 붙을 때 한 번은 받는다). `pending 도 없으면 생성 단계` 는 현재 단계가 없는 정상 응답으로 바꿨다.
  - mapper 테스트: 연동·워크스페이스는 모르는 값 폴백 단언을 스키마 테스트로 옮겼다. 팀원 별칭은 `{ unknown: 'new' }` 와 개발 경고. 미해결 별칭 handler 테스트는 모의 응답 타입으로 본다.
- 초기 chunk(`index.html` 의 script·modulepreload·CSS, `b6d72a8c` 와 같은 방식): 원본 978,974 → 980,048 B(+1,074 B, +0.11%), gzip 306,459 → 306,420 B(−39 B). 늘어난 곳은 workspace chunk +278 B, user chunk +427 B, 가장 큰 공용 chunk(`url`) +574 B, `index` +692 B 다. 파일 37 → 34 개는 `enum`·`parseResponse`·`unknownValue` 의 작은 chunk(합 660 B)가 다른 chunk 로 합쳐진 것이고, 그래서 approval·meeting·notification·task chunk 는 40~79 B 줄었다.
- 브라우저 확인은 하지 않았다. 정상 응답의 사용자 경로는 그대로이고, 잘못된 응답 화면은 RTL 이 MSW 로 본다.

### 리뷰 반영 (2026-11-10)

Codex·Grok 독립 리뷰(PR #634)의 중간 2 건, 낮음 1 건과 CI `format:check` 실패를 고쳤다. origin/develop(#623·#617 병합 뒤)은 리뷰 전에 merge 했다.

- **워크스페이스 만들기의 확인 불가 경로가 세션을 보지 않았다(중간, 둘 다, Codex 재현).** 세션이 끝난 뒤 늦은 생성 응답이 비운 토스트를 다시 띄웠다. 이제 누를 때 세션 범위를 잡고 `createWorkspace` 에 `signal` 을 달며, 알림·목록 캐시·이동은 그 세션일 때만 한다(#594 규칙). 진행 저장 실패는 전처럼 폼의 실패와 `다시 시도` 다.
- **확인 불가 뒤 새로고침으로 공간이 보여도 폼은 생성 전 상태였다(중간, Codex 재현).** 다시 만들기는 이름 겹침에 막혔다. 이제 만들기 응답을 읽지 못하면 공간 목록을 다시 받아(`fetchFreshWorkspaces`), 보내기 전에 없던 같은 이름의 내가 PM 인 공간이 하나면 그 공간으로 생성 단계를 저장하고 다음 단계로 잇는다(`findCreatedWorkspace`, 업로드 복구 `findAcceptedUpload` 와 같은 꼴). 하나로 정하지 못하면 토스트와 함께 공간 선택으로 보낸다. 만들기 POST 는 다시 보내지 않는다. D-184 「복구 경로가 있는 쓰기」로 옮겼다.
- **저장한 채팅 채널 이름이 null 이면 연동 응답 전체를 거절했다(낮음, Grok).** BE `chat_channel_name` 은 nullable 이다. `name` 을 null 로 받고 화면은 `이름 없는 채널(ID)` 로 보인다(`chatChannelLabel`).
- **CI `format:check`.** prettier 를 적용하지 않은 파일 열을 고쳤다(`appShell`·`meetingMinutesRaces`·`meetingProcessing`·`processingToast` 테스트, `signupCode.ts`, 워크스페이스 mapper, 모의 워크스페이스 픽스처·연동 handler, `invitation.ts`). 로컬 `.verify/`(git 제외)를 뺀 `prettier --check` 가 통과한다.
- 새 테스트: `app/workspaceInvalidResponse.test.tsx` 에 이름 없는 채팅 채널, 만들기 응답을 읽지 못했을 때 그 공간으로 잇기(서버에 그 이름의 공간이 하나), 찾지 못하면 토스트·공간 선택, 만드는 사이 세션이 끝나면 알림 없음. `shared/types/api/integration.test.ts` 에 null 이름 허용. `features/onboarding/model/createdWorkspace.test.ts`(모호한 다섯 경우). 화면 넷과 스키마 하나는 고치기 전 코드(`e9e31e3d`)로 먼저 실패를 봤다.
- 검사: typecheck(직접 0 건)·lint·build 통과, `.verify/` 를 뺀 `prettier --check` 통과, 바꾼 곳 80 파일·1,265 건 통과. 전체 테스트는 CI 로 대신한다(t15 지시).

## 남은 일

- 이 이슈의 entity 묶음은 PR 5 로 끝난다. PR 5 가 `Closes #348` 이다.
- #335 `reminder_dm` 의 FE 정리(테스트의 모르는 종류 예시 값, 계약의 `reminder_dm` 줄, MSW approval 주석)는 BE 2차 배포 뒤 #348 후속이다.
- BE 합의 두 가지(배포 순서, `status: str` 의 enum 타입화)는 계약에 요청으로 남겼다.
- 실제 BE 응답과의 대조는 BE enum 타입화와 `/openapi.json` 접근이 갖춰진 뒤 후속이다(#348 추가 항목 1).
- ~~정할 것: 변경 응답이 스키마에 맞지 않을 때의 문구.~~ 2026-11-09 사용자 결정으로 반영했다(위 「리뷰 반영」).
