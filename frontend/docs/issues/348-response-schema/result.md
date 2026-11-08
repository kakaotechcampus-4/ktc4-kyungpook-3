# 결과 — API 응답 zod 검증과 모르는 enum 처리 (#348)

- 기록일: 2026-11-08
- 대상: [#348](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/348)
- 상태: **PR 1(초안 5절의 1+2) 반영.** 공용 경계(`shared/api`)와 task 응답만 검증한다. approval → meeting·minutes·extraction → message·notification → integration·invitation·workspace·member·user 는 다음 PR 이 이 파일에 이어 쓴다. 검사는 MSW 기준이고 실제 BE 와는 붙여 보지 않았다.

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
| 답장 줄 종류·결과 모름 | `무엇을 바꿀지 정하지 못했어요`·`반영하지 않음` | `알 수 없는 변경이에요`·`알 수 없는 결과` |
| 기록 칸 `kind` 모름 | 이력 칸으로 잘못 읽음 | 변경 이력 영역이 `INVALID_RESPONSE` |

### 문서

- [D-184](../../decision/frontend-decisions.md): 결정과 D-134 대체. D-134 요약 줄에 대체 표시.
- [계약](../../contracts/frontend-api-contract.md) 맨 위 「응답 검증과 새 값 배포 순서」: 배포 순서 규칙(FE 결정, BE 합의 확인 필요), task 응답이 거절하는 것과 따로 다루는 것, BE 요청 둘. §2.6 의 「모르는 값은 `title`」과 §6 의 D-134 언급을 고쳤다.

## 검증

Node v24.11.0, `frontend/` 에서 실행했다(2026-11-08).

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm run format:check` | 통과 |
| `npm run build` | 통과 |
| `npm run test -- --maxWorkers=1` | 276 파일·3472 건 통과. `src/shared/api/client.test.ts` 는 부하로 워커가 뜨지 못해(`Timeout waiting for worker to respond`) 돌지 않았다. 따로 돌려 21 건 통과 |

- 첫 전체 실행에서는 `notionSyncPolling.test.tsx` 한 건이 실패했다. 갱신 응답을 `auto_blocked` 없는 mock 행 그대로 돌려줬기 때문이다. 테스트가 `toTaskResponse` 로 실제 응답 모양을 돌려주게 고쳤고, `auto_blocked` 보수 폴백도 되살렸다(위). 두 번째 실행에서 통과했다.
- 새·바꾼 테스트:
  - `shared/api/parseResponse.test.ts`: 정상, 필수 필드 누락, 타입 오류, 목록 한 건의 모르는 상태, 응답 전체가 다른 모양 → `INVALID_RESPONSE`, entity·필드 경로, 재시도 안 함. 받은 값은 경고에만 있다.
  - `shared/api/unknownValue.test.ts`: 표시용 보존과 보수 폴백, 경고.
  - `shared/types/api/task.test.ts`: 스키마의 거절·허용. MSW 픽스처와 handler 응답(목록·상세·이력·기록, 기본·`reply-judgment`, 변경·생성)을 스키마로 `parse`.
  - `entities/task/api/taskApi.test.ts`: 모르는 상태가 `할 일` 이 되지 않고 캐시에 들어가지 않으며 다시 요청하지 않음, 필수 필드 누락, 목록 한 건 깨짐이면 전체 실패, `PATCH` 응답, 이력 모르는 값 보존, 기록 `kind` 모름, 다른 태스크 이력 경로.
  - `app/taskInvalidResponse.test.tsx`(RTL, MSW `server.use`): 목록·상세가 `응답을 읽지 못했어요` 와 `다시 시도`, 1.3 초 기다려도 요청 1 번, 다시 시도로 복구. 받아 둔 상세는 갱신 실패 때 본문을 남기고 `최신 상태를 받지 못했어요`. 이력의 모르는 필드·출처는 `알 수 없는 항목`·`알 수 없는 출처`.
  - 기존 version 충돌·정상 태스크 흐름(`tasks.test.tsx`, `approvals*.test.tsx`, `taskDetailEdit.test.tsx` 등)은 전체 실행에서 통과했다.
- 초기 chunk(`index.html` 의 script·modulepreload·CSS 28 개)는 develop `0c9affbd` 와 같은 방식으로 빌드해 비교했다.

  | | develop | 이 변경 | 차이 |
  |---|---|---|---|
  | 원본 | 922,593 B | 927,966 B | +5,373 B (+0.58%) |
  | gzip | 289,614 B | 291,045 B | +1,431 B (+0.49%) |

  늘어난 곳은 `task` chunk(+1.7 KB, 스키마)와 zod 가 든 공용 chunk(+3.7 KB)다. 공용 chunk 에 zod 의 `ZodDiscriminatedUnion`·`ZodLiteral` 이 새로 들어왔다(기록 `kind` 판별). 다른 초기 chunk 는 ±5 B 안이다.
- 브라우저(ego lite, MSW 모드 `single-workspace`): 태스크 목록 13 건이 그려졌다. 앱 안 이동으로 `tk_01`·`tk_03` 상세를 열었다. 콘솔 경고·오류와 `role=alert` 가 없었다. 스크린샷은 ego lite 창 문제로 찍지 못했다.

## 남은 일

- 다음 PR: approval(`status` 검증, Unsupported·`category` 유지) → meeting·minutes·extraction(`source` unknown 특성, `gate` 폴백) → message·notification(`ZodError`·`Error` 를 `INVALID_RESPONSE` 로) → integration·invitation·workspace·member·user. 마지막 PR 이 `enumValue` 를 지우고 이 이슈를 닫는다.
- BE 합의 두 가지(배포 순서, `status: str` 의 enum 타입화)는 계약에 요청으로 남겼다.
- 실제 BE 응답과의 대조는 BE enum 타입화와 `/openapi.json` 접근이 갖춰진 뒤 후속이다(#348 추가 항목 1).
- 정할 것: 변경(`PATCH`·생성·되돌리기) 응답이 스키마에 맞지 않으면 화면은 `상태를 바꾸지 못했어요` 처럼 실패로 알린다. 서버에서는 이미 바뀌었을 수 있다. 문구를 `변경 결과를 확인하지 못했어요` 처럼 바꿀지는 제품 문구 결정이라 이 PR 에서 바꾸지 않았다. 전에도 `version` 이 정수가 아니면 같았다.
