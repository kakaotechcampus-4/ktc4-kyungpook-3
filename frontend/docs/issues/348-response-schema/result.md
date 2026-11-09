# 결과 — API 응답 zod 검증과 모르는 enum 처리 (#348)

- 기록일: 2026-11-08
- 대상: [#348](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/348)
- 상태: **PR 1(초안 5절의 1+2, #588 병합), PR 2(approval, #592 병합), PR 3(meeting·minutes·extraction) 반영.** 공용 경계(`shared/api`)와 task·approval·meeting·minutes·extraction 응답을 검증한다. message·notification → integration·invitation·workspace·member·user 는 다음 PR 이 이 파일에 이어 쓴다. 검사는 MSW 기준이고 실제 BE 와는 붙여 보지 않았다.

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

## 남은 일

- 다음 PR: message·notification(`ZodError`·`Error` 를 `INVALID_RESPONSE` 로) → integration·invitation·workspace·member·user. 마지막 PR 이 `enumValue` 를 지우고 이 이슈를 닫는다.
- BE 합의 두 가지(배포 순서, `status: str` 의 enum 타입화)는 계약에 요청으로 남겼다.
- 실제 BE 응답과의 대조는 BE enum 타입화와 `/openapi.json` 접근이 갖춰진 뒤 후속이다(#348 추가 항목 1).
- ~~정할 것: 변경 응답이 스키마에 맞지 않을 때의 문구.~~ 2026-11-09 사용자 결정으로 반영했다(위 「리뷰 반영」).
