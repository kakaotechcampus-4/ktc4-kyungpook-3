# 결과 — 태스크 상세·승인 확인을 다시 그린 안으로 바꾸기 (#471)

- 기록일: 2026-11-07
- 대상: [#471](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/471)의 E-5·E-6 체크리스트와 2026-11-06 댓글(선택 상자)
- 기준: develop `2eb36ca5` 에서 시작해 #344 첫 PR(#479)이 병합된 develop `5307760d` 를 merge 했다. PR은 아직 만들지 않았다.
- 상태: **체크리스트를 모두 반영했다.** MSW 개발 서버(Chromium)로 검증했다. 실서버는 미검증이다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #471, 감독 결정(2026-11-06 선택 상자, 2026-11-07 저장 충돌), 관리 세션 사전 조사다. 지금 화면은 태스크 상세에서 상태가 두 번 나오고 「막힌 사유 없음」·「Notion 반영됨」이 담당자·마감과 같은 무게였다. 승인 확인은 확정할 값과 회의 원문이 떨어져 있고, 「보완하기」를 눌러야 고칠 수 있었다.

이번 작업으로 두 화면을 시안대로 다시 그렸다. 태스크 상세는 정보 패널에서 담당자·마감을 고쳐 저장 줄로 한 번에 저장한다. 승인 확인은 한 카드 안에서 값을 바로 고치고, 근거와 「확인이 필요한 이유」를 같이 본다. 마감 원문이 확실한 표현이면 「9/21(월)로 채우기」를 제안한다.

## 실제 구현 및 관련 코드

- 공용 부품
  - 선택 상자 `shared/ui/select`. `@radix-ui/react-select` 2.3.7 을 정확한 버전으로 더했다. 트리거 아래로 열고(popper), 폭은 트리거 이상이다. 「미정」은 부품 안 값으로 두고 바깥으로 null 을 낸다. 크기 2종, 앞 아이콘, 보조줄, 비활성 옵션을 받는다. 이번에는 승인 확인 담당자 칸에만 쓴다. [결정](../../plan/m6/basis-for-decision/2026-11-07-shared-select-on-radix.md)
  - 날짜 칸 `shared/ui/date-field`. 「미정」을 받아야 해서 `type="date"` 가 아닌 글자 입력이다. 오른쪽 `calendar` 버튼이 숨은 날짜 입력의 `showPicker()` 로 달력을 연다.
  - `TextField` 에 44px 크기(`size="lg"`)를 더했다. 기존 호출부의 모양은 같다.
- 마감 표현 해석기 `shared/lib/date/dueExpression.ts` 와 「채우기」 판정 `entities/approval/lib/dueFill.ts`. 회의 날짜 기준으로 오늘·내일·모레, 이번·다음 주 요일, N일 뒤·후, M월 D일, D일만 푼다. 회의 날짜를 모르면 버튼이 없다. [결정](../../plan/m6/basis-for-decision/2026-11-07-due-fill-from-raw-expression.md)
- 태스크 상세(E-5)
  - `features/task-fields-edit`: 바뀐 필드만 `PATCH /tasks/{id}` 로 보내는 저장 훅(`captureSessionScope`, 성공 시 `writeServerTask`)과 변경 목록 계산.
  - `widgets/task-detail`: 머리(담당·마감 줄, 「기한 지남」 배지), PM 전용 상태 트랙(`TaskStatusControl` 을 `Segmented` 로), 정보 패널·저장 줄(`TaskInfoPanel.tsx`), 막힘일 때만 막힌 사유, 재촉 카드(`TaskReminder` 동작 그대로), 변경 이력(`TaskHistory.tsx`).
  - #344 가 더한 이력 답장 줄(`ReplyRow`), 되돌리기(`useReplyChangeUndo`), 되돌리기 404 의 볼 수 없는 태스크 화면은 새 배치로 옮기고 동작을 그대로 두었다.
- 승인 확인(E-6)
  - `widgets/approval-review`: 질문형 제목, 「확인 필요」 카드에서 태스크명·담당자·마감을 바로 고친다, 근거 블록, 「확인이 필요한 이유」 패널과 「채우기」.
  - `features/approval-resolve`: 「보완하기」 토글과 두 폼 컴포넌트를 지우고 늘 열린 입력 칸(`TaskCreateOverrideFields`·`TaskUpdateOverrideFields`)으로 바꿨다. 빠진 값 표시는 `model/attention.ts` 한 곳에서 정한다. 승인·반려·충돌 확인 흐름은 그대로다.
  - #344 의 답장 근거(리마인드 답장·보낸 팀원, 팀원 답장 섹션)는 새 근거 블록에 그대로 있다.

## 완료조건 확인

| 이슈 #471 할 일 | 상태 | 근거 |
|---|---|---|
| 공통: 960 컨테이너, `‹ 태스크 목록`, 질문형 제목, 날짜 칸 달력 아이콘, R2 | 충족(MSW) | 브라우저 확인, `taskDetailEdit.test.tsx`, `approvalsMsw.test.tsx` |
| E-5 머리(담당·마감 줄, 기한 지남 배지) | 충족(MSW) | 브라우저 tk_01·tk_02, `taskDetailEdit.test.tsx` |
| E-5 상태 트랙 PM 전용, 팀원은 배지 | 충족(MSW) | 브라우저 PM·팀원, `taskDetailEdit.test.tsx`, `tasks.test.tsx` |
| E-5 정보 패널 세 칸, 연필 버튼 | 충족(MSW) | 브라우저, `taskDetailEdit.test.tsx` |
| E-5 저장 줄, 저장 전 서버 요청 없음, 세션 경계 | 충족(MSW) | 브라우저 PATCH 본문 `{"due_date":"2026-09-27"}`, `useTaskFieldsSave.test.tsx` |
| E-5 409 면 다시 받아 알림 | 결정으로 대신함 | BE `update_task` 에 버전 비교가 없어 409 가 오지 않는다. 감독 결정(2026-11-07)으로 409 처리 코드를 두지 않고 마지막 저장이 이긴다. 서버 오류는 저장 줄에 보이고 입력은 남는다. [결정](../../plan/m6/basis-for-decision/2026-11-07-task-detail-save-row-last-write-wins.md) |
| E-5 막힌 사유는 막힘일 때만 | 충족(MSW) | 브라우저 tk_03, `taskDetailEdit.test.tsx` |
| E-5 재촉 카드 | 충족(MSW) | `reminderCreateMsw.test.tsx`, `messages-reminder.e2e.ts` 기대값 갱신 |
| E-5 변경 이력 구분선 줄 + 출처 회의 링크 | 충족(MSW) | 브라우저, `taskReplyTimeline.test.tsx` |
| E-6 제목·안내 문장 | 충족(MSW) | 브라우저 ap_01, `approvalView.test.ts` |
| E-6 카드에서 바로 고침, 세 칸 44px, 담당자 선택 상자 | 충족(MSW) | 브라우저 높이 측정(세 칸 44), `approvalsMsw.test.tsx` |
| E-6 근거 블록, 빠진 값 원문 `accent` | 충족(MSW) | 브라우저, `ApprovalReview.stories.tsx` |
| E-6 카드 아래 줄, 미정이어도 승인 | 충족(MSW) | 브라우저 승인 요청 본문, `approvals.test.tsx` |
| E-6 「확인이 필요한 이유」와 「채우기」(있음·없음) | 충족(MSW) | 브라우저 ap_01(있음)·ap_07(없음), `approvalsMsw.test.tsx` |

## 설계 결정

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| 선택 상자 바탕 | Radix Select 공용 부품 | 기본 `<select>`: 열린 목록을 꾸밀 수 없다. DropdownMenu: 메뉴 역할이라 값 고르기의 의미가 틀린다 |
| 목록 위치 | popper, 트리거 아래 | item-aligned(기본): 서비스의 다른 메뉴와 여는 방향이 다르다 |
| 날짜 후보 | FE 해석기, 확실한 표현만 | AI·BE 후보 필드: 지금 없고 AI 는 규칙 계산을 일부러 지웠다. 넓게 풀기: 틀린 날짜를 사람이 그대로 누를 수 있다 |
| 지난 「M월 D일」 | 다음 해의 그날이 92일 안일 때만 다음 해 | 늘 다음 해: 9/15 회의의 「9월 1일」이 1년 뒤가 된다 |
| 저장 충돌 | 바뀐 필드만 보내고 마지막 저장이 이김 | 저장 직전 다시 받기: 경합을 없애지 못하고 요청만 는다. BE 버전 비교: 지금 열지 않는다 |
| 상세 편집 상태 | 손댄 필드만 담은 덮개 + 열린 칸 하나 | 서버 값 전체 복사본: 서버 값이 바뀌면 손대지 않은 필드도 바뀐 것처럼 보인다 |
| 승인 입력 칸 | 늘 열린 칸, 보완하기 토글 삭제 | 토글 유지: 시안과 다르고 「보완 중이라 승인 불가」 분기가 남는다 |

## 검증

| 범위 | 명령·방법 | 결과 |
|---|---|---|
| 바꾼 곳 단위 | `npx vitest run <파일> --maxWorkers=1`, 작업 단위마다 | 모두 통과. 해석기·채우기 2개 파일·저장 경로 9(`task-fields-edit`)·선택 상자 10·날짜 칸 12·`TextField`, 앱 테스트 `taskDetailEdit` 13·`tasks` 33·`taskAutoBlock` 9·`reminderCreateMsw` 16·`notionSyncPolling` 15·`taskReplyTimeline` 3·`replyJudgmentRefresh` 3·`approvals`·`approvalsMsw`·`approvalOverrides`·`replyApprovals`·`lateAsyncRaces`(해당 사례) |
| 브라우저 | `.verify/verify-471/`(로컬 전용 Playwright, MSW 개발 서버 5291, Chromium, 시계 2026-09-18 09:00) | 아래 |
| 전체 | `npm run typecheck`·`lint`·`build` | 통과 |
| 전체 | `npm run format:check` | git 에서 제외한 `.verify/` 참고 파일 6개만 걸렸다. 그 밖은 통과 |
| 전체 | `npm run test -- --maxWorkers=1` | 미완료. 다른 워커와 함께 도는 중 시스템 메모리가 모자라 실행이 중단됐고 결과가 나오지 않았다. 다시 돌려야 한다 |

브라우저 확인(PM·팀원, 1280·390):

- E-5: PM 은 상태 트랙·연필 버튼, 팀원은 배지만. 기한 지남 배지는 tk_02 에만, 막힌 사유는 tk_03 에만.
- E-5 저장 줄: 마감을 고치면 「바뀐 내용 1개 · 마감 09/20 → 09/27」, 요청 없음. 취소하면 값이 돌아오고 연필로 포커스. 저장하면 `PATCH /api/v1/tasks/tk_01` 본문 `{"due_date":"2026-09-27"}`, 200, 새로고침 뒤에도 유지.
- E-6: ap_01(「다음 주 월요일」)은 「9/21(월)로 채우기」, 누르면 마감 칸에 2026-09-21. ap_07(「배포 전」)은 버튼 없음.
- 선택 상자: 「미정」이 맨 위, 트리거 아래로 열리고 폭은 트리거와 같다. 고른 줄에 체크. 트리거·태스크명·마감 모두 44px.
- 승인 `{"status":"approved","task_overrides":{"assignee_member_id":"mb_02","due_date":"2026-09-21"}}` 200, 만든 태스크에 값 반영. 반려 `{"status":"rejected"}` 200.
- 팀원이 승인 URL 을 열면 태스크 목록으로 가고 「접근 권한이 없어요」, 승인 API 요청 없음.
- 첫 브라우저 확인에서 선택 상자 트리거가 52px 로 늘고 이니셜이 이름 위로 올라갔다. Radix 2.3.7 의 `Select.Value`·`Select.ItemText` 가 `className` 을 버려서다. 트리거 내용을 직접 그리게 고친 뒤 다시 재서 44px 한 줄을 확인했다.

## 범위 밖과 미검증

- 나머지 선택 상자 다섯 곳(승인 카드 담당자, 상태, 재촉 팀원·태스크, 설정 두 개), 찾기 칸 있는 태스크 고르기(Radix Select 로 안 됨, Popover+목록), 560px 아래 시트는 #477. 태스크 상세 담당자 칸도 아직 기본 `<select>` 다.
- 같은 필드의 동시 수정은 알리지 않는다(위 결정).
- 390px 에서 문서 폭이 646px 로 가로 스크롤이 생긴다. 앱 셸 머리 줄 때문이고 본문(`main`)은 390 이다. 바꾸지 않은 태스크 목록·대시보드도 같다. 휴대폰 셸 #478 범위다.
- 달력 팝업은 headless 스크린샷에 그려지지 않아 눈으로 보지 못했다(버튼 동작은 단위 테스트).
- 실서버 연동, Storybook play·E2E 전체는 CI 에서 돈다.
