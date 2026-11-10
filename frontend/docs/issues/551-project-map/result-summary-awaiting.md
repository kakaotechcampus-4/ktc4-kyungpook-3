# #551 회의록 요약 칸의 승인 대기 상태 결과 (묶음 A)

## 작업 근거와 요약

- 근거: [이슈 #551](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/551)의 2026-11-09·2026-11-10 댓글 요청 1번(승인 대기 문구와 남은 건수). 명세는 BE #645(브랜치 `feature/605-approved-summary`)의 `backend/app/schemas/meeting.py`, `backend/app/api/meetings.py`, `backend/app/services/item_fate.py`와 그 브랜치 계약 §4.4.2 다.
- 같은 이슈의 다른 묶음(주제·결정 고치기, 전사 제목·본문 고치기)과 충돌하지 않게 결과를 이 파일에 따로 둔다. [기존 결과](result.md)는 고치지 않았다. 그 문서의 「모르는 `summary_status`」 줄에 적힌 「#605 의 승인 대기 값이 먼저 오더라도 중립 문구」 는 이 작업으로 지난 설명이 됐다.
- develop 서버는 아직 이 값을 보내지 않는다. 화면과 MSW 만 만들었고, 병합은 #645 뒤다.

## 실제 구현 및 관련 코드

- **응답 읽기.** [회의록 스키마](../../../src/shared/types/api/minutes.ts)의 `SUMMARY_STATUSES` 에 `awaiting_approval` 을 더했다. `summary_waiting_count` 는 표시용이라(D-184) 0 이상의 정수가 아니면 건수만 버리고 응답은 받는다. 키가 없는 이전 서버는 `null` 이다. [타입](../../../src/entities/minutes/model/types.ts)은 `summaryWaitingCount: number | null` 이다.
- **요약 칸.** [MinutesBody](../../../src/widgets/meeting-minutes/ui/MinutesBody.tsx)의 빈 요약 문구를 상태별 표(`EMPTY_SUMMARY`)로 바꿨다. `awaiting_approval` 은 모든 팀원에게 `승인이 끝나면 요약이 만들어져요` / `발언은 전사문에서 볼 수 있어요.` 이고, 건수가 1 이상이면 설명 앞에 `승인 대기 N건이 남았어요.` 가 붙는다. 건수는 서버가 PM 에게만 주므로 화면은 역할을 다시 보지 않는다(D-104). `pending`·`none`·`ready`·모르는 값은 그대로다. 요약이 있으면 상태와 무관하게 요약을 보인다.
- **승인 뒤 다시 받기.** [승인 쓰기](../../../src/features/approval-resolve/model/useApprovalResolve.ts)의 `syncAfterResolve` 가 공간의 회의록 쿼리(`workspaceKey(ws,'minutes')`)도 무효화한다. 끝난 회의록은 5분 동안 최신으로 보므로(D-136), 이것이 없으면 PM 이 카드를 승인하거나 반려하고 돌아와도 남은 건수가 그대로였다. 합친 카드는 다른 회의도 함께 기다려 공간 전체를 본다.
- **MSW.** [회의록 핸들러](../../../src/shared/mock/handlers/minutes.ts)가 저장된 `awaiting_approval` 을 지금의 대기 카드로 다시 판정한다. 그 회의 추출 항목의 `approval_id` 가운데 `pending` 인 카드 수를 센다. BE `item_fate` 와 같은 조인이라 합친 카드도 한 장이다. 0장이면 BE 처럼 `pending` 을 준다. 건수는 PM 에게만 준다. 시나리오 `minutes-awaiting-approval`(PM, mt_09 대기 카드 3장)과 `minutes-awaiting-approval-member` 를 더했다. 모의 db 판은 23 그대로다. 핸들러가 응답마다 `summary_waiting_count` 를 덮어써서 저장된 옛 상태도 같은 응답을 준다.

## 판단

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| 건수에서 승인 화면으로 가는 링크 | 두지 않는다 | 승인 목록 화면이 없어 링크는 카드 하나로만 갈 수 있다. 같은 회의록의 `추출된 일` 탭이 남은 카드마다 `확인하기` 링크를 이미 준다. 서버 건수는 카드 단위이고 그 탭은 항목 단위라, 합친 카드가 있으면 수가 달라 보일 수 있다 |
| 건수가 0 이거나 `null` | 건수 없이 제목과 전사문 안내만 | `승인 대기 0건` 은 기다린다는 제목과 어긋난다. 정상 서버는 0장이면 `pending` 을 준다 |
| 건수 모양이 틀림 | 건수만 버린다 | 응답 거절(`INVALID_RESPONSE`)은 전사문까지 못 보게 한다. 건수는 상태 판단에 쓰지 않는 표시값이다(D-184) |
| 승인 뒤 회의록 | 공간의 회의록 쿼리를 무효화 | 한 회의만 무효화하려면 승인에서 회의 ID 를 찾아야 하고, 합친 카드는 여러 회의에 걸친다. 관찰 중인 회의록만 다시 받으므로 비용이 작다 |

결정 기록(D-193)은 쓰지 않았다. 위 선택은 이 화면 안의 표시 판단이고 다른 화면의 규칙을 바꾸지 않는다.

## 채팅 회의 「일일 요약」

바꿀 것이 없다. 요약 칸은 `summary` 의 `overview`·`key_points`·`decisions` 만 그리고 `discussion` 은 읽지 않는다. 회의록 머리의 제목은 회의 제목이다. 요약본 파일 이름은 서버의 `Content-Disposition` 을 그대로 쓴다([요약본 내려받기](../../../src/features/summary-download/ui/SummaryDownloadButton.tsx)).

## 계약

[대표 계약](../../contracts/frontend-api-contract.md) §4.4.2 「FE 사용 (#551)」 표의 `summary_status` 줄에 `awaiting_approval` 문구를, 새 줄에 `summary_waiting_count` 처리를 적었다. #645 가 고치는 줄(회의록 조회 요약 표의 `summary_waiting_count(FE 미사용)`, §4.4.2 값 표)은 충돌을 피하려고 건드리지 않았다. #645 병합 뒤 develop 을 이 브랜치에 병합할 때 요약 표의 「FE 미사용」 과 「`awaiting_approval` 은 아직 따로 그리지 않음」 을 지워야 한다.

## 검증 내역

2026-11-10, Node v24.11.0.

- RTL: [요약 상태 테스트](../../../src/app/meetingSummaryDownload.test.tsx)가 PM 건수, 팀원(건수 없음), 받은 건수 0·`null`, 대기 카드를 모두 처리하면 `요약을 만드는 중이에요`, 요약이 있으면 상태와 무관하게 요약과 내려받기, 기존 `pending`·`none`·모르는 값을 본다. PM 이 카드를 승인하고 돌아오면 `승인 대기 2건` 이 되는 테스트는 무효화를 넣기 전 코드에서 실패하는 것을 확인했다. 스키마·매퍼·시나리오 테스트도 더했다.
- 바꾼 곳 테스트 14개 파일 295개 통과(`--maxWorkers=1`). 승인 화면 테스트 7개 파일 152개도 통과했다.
- `npm run typecheck`, `npm run lint`, `.verify` 를 뺀 `prettier --check`, `npm run build` 통과.
- 브라우저(검증 스킬 `meetings --grep '#551'`, Vite + MSW, Chromium): [회의 흐름 E2E](../../../e2e/meeting-flow.e2e.ts) ⑫ PM 이 3건을 보고 카드 하나를 반려한 뒤 뒤로 가기로 돌아오면 2건, ⑬ 390px 팀원은 건수 없이 같은 문구이고 가로 넘침이 없다. 2개 통과, 포트 정리 확인.
- 전체 테스트(`npm run test`)는 돌리지 않았다. CI 가 돌린다.
- 실제 BE #645 서버로는 확인하지 않았다. MSW 는 BE 의 `pending` 1시간 제한을 흉내 내지 않는다.
