# 결과 — 나머지 선택 상자 다섯 곳을 공용 선택 상자로 바꾸기 (#477)

- 기록일: 2026-11-07
- 대상: [#477](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/477)의 바꿀 곳 표와 할 일
- 기준: develop `83e31c8a`(#471 병합 뒤). PR은 아직 만들지 않았다.
- 상태: **코드·단위·앱 테스트는 마쳤다.** 브라우저 검증은 다음 단계다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #477, 시안 `select-design.html`(1~5절), 관리 세션 브리프(2026-11-07)다. #471 이 공용 선택 상자를 만들고 승인 확인(E-6) 담당자 칸에만 썼다. 서비스에는 기본 `<select>` 가 다섯 자리 남아 열린 목록 모양이 필터 메뉴와 달랐고, 휴대폰에서 고르는 방식도 없었다.

이번 작업으로 다섯 자리 모두 같은 선택 상자를 쓴다. 폭 560px 아래에서는 아래에서 올라오는 시트로 고른다. 재촉 만들기의 태스크는 8개를 넘으면 찾기 칸으로 거른다. 각 자리의 동작(잠금, 저장, 승인 차단, 시간 재설정)은 그대로다.

## 실제 구현 및 관련 코드

- 공용 부품
  - `shared/lib/narrow-viewport`: 폭 판정 한 곳(`NARROW_QUERY`, `useNarrowViewport`).
  - `shared/ui/sheet`: Radix Dialog 위의 아래 시트. 손잡이·칸 이름 제목, 80px 넘게 끌면 닫힌다.
  - `shared/ui/select`: 폭이 좁으면 같은 모양의 트리거로 시트를 연다(`Select`). 시트 제목 때문에 칸 이름 `label` 이 필수 prop 이 됐다. 목록 부품 `OptionList` 를 시트 Select 와 찾기 칸 선택 상자 `Combobox` 가 함께 쓴다. 모양 클래스는 `selectStyles.ts` 한 곳이다. 열면 고른 줄이 가운데에 온다.
  - 테스트 도우미 `shared/test/viewport.ts`(휴대폰 폭 흉내, 560 경계 넘기기). `setup.ts` 에 `setPointerCapture` 빈 구현을 더했다.
- 조립(entities)
  - `entities/member`: `assigneeOptions`·`ASSIGNEE_NONE_OPTION`. 이니셜 원, 맨 위 「미정」 점선 원, 지금 담당자가 목록에 없으면 「알 수 없는 담당자」 줄. E-6·승인 카드·상세(E-5)가 쓴다.
  - `entities/task`: `TASK_STATUSES`·`TASK_STATUS_LABEL` 을 `features/task-status` 에서 옮겼다. 상태 표식 `TaskStatusMark`(할 일 빈 네모·진행 중 먹색·막힘 포인트 레드 점·완료 옅은 회색)와 `TASK_STATUS_OPTIONS`. 보드 칸 머리도 이 표식을 쓴다.
- 다섯 자리
  - 승인 카드(`widgets/task-board/ui/ApprovalCard.tsx`) 담당자: 빠진 값이면 `tone="blocking"`, 플레이스홀더 「담당자 고르기」. 라벨 문구는 그대로다.
  - 태스크 상세(`widgets/task-detail/ui/TaskInfoPanel.tsx`) 담당자: 칸을 열면 트리거 버튼에 포커스가 간다. 저장 줄 동작은 그대로다. 「담당자 없음」 줄은 「미정」이 됐다(요약 줄과 같은 말).
  - 수정 제안 상태(`features/approval-resolve/ui/TaskUpdateOverrideFields.tsx`): 상태 표식, 「원래 제안 유지」 줄, 저장 중 잠김.
  - 재촉 만들기(`features/reminder-create/ui/ReminderCreateForm.tsx`): 받는 사람 둘째 줄은 「진행 중 N개」, Discord 미연결이면 빨간 글씨 「Discord 미연결 · DM 이 나가지 않아요」(고를 수는 있다). 태스크 둘째 줄은 「09/20 마감 · 기한 지남」(빨간 글씨)·「09/24 마감 · 진행 중」·「마감 없음 · 할 일」. 그 팀원의 완료 태스크는 끝에 비활성으로 두고 「완료한 태스크는 재촉할 수 없어요」. 목록 줄이 8개를 넘으면 `Combobox`.
  - 설정(`pages/settings/ui/NotificationSection.tsx`): 「마감 [1일 전] [09:00]에 보내요」 문장 안에 36px 선택 상자 두 개. 시트 제목은 「재촉 며칠 전」「재촉 보낼 시각」. PM 이 아니면 잠긴다.
- 바꾸지 않은 곳: `features/task-status/ui/TaskStatusControl.tsx` 는 #471 이 이미 4칸 트랙(`Segmented`)으로 바꿨고 이슈가 「겹치면 그쪽을 따른다」고 해서 import 줄만 옮겼다. `TaskBoard.tsx` 는 #478 이 고치는 중이라 손대지 않았다. 그래서 `features/task-status` 가 `TASK_STATUS_LABEL` 을 다시 내보내는 줄 하나가 남는다. #478 뒤 지운다.

## 완료조건 확인

| 이슈 #477 할 일 | 상태 | 근거 |
|---|---|---|
| 공용 부품을 그대로 쓰고 담당자·상태 조립을 한 곳에 | 충족 | `entities/member`·`entities/task` 조립, `grep -rn "<select" src` 가 `shared/ui/select` 주석 한 줄뿐 |
| 찾기 칸 태스크 고르기(콤보박스 역할·키보드) | 충족(단위·앱) | `Combobox.test.tsx`, `reminderCreateMsw.test.tsx` 「8개를 넘으면」 |
| 560px 아래 시트 | 충족(단위) | `Sheet.test.tsx`, `Select.test.tsx` 휴대폰 폭 절, `Combobox.test.tsx` 휴대폰 폭 |
| 다섯 곳의 테스트·스토리·E2E 를 새 부품 기준으로 | 충족(단위·앱). 스토리 play·E2E 는 기대값만 고치고 실행하지 않았다 | 아래 검증 |
| 각 자리 1280·390 스크린샷, 키보드만으로 고르기 | 미완료 | 브라우저 검증은 다음 단계 |

## 설계 결정

| 결정 | 고른 길 | 대안과 버린 이유 |
|---|---|---|
| 시트·찾기 칸의 목록 | 목록 부품 하나를 시트 Select·Combobox 가 함께 쓴다. 넓은 화면 Select 는 Radix 그대로 | 자리마다 목록: 키보드 규칙이 두 벌. 넓은 화면도 직접 구현: #471 의 Radix 동작을 다시 만든다 |
| 시트 바탕 | Radix Dialog | 직접 구현: 포커스 가둠·스크롤 잠금을 다시 만든다 |
| 시트 제목 | Select 에 필수 `label` | 선택 prop: 제목 없는 시트가 생길 수 있다 |
| 찾기 칸 기준 | 목록 줄(완료 태스크 포함) 8개 초과 | 끝나지 않은 태스크만 세기: 스크롤해야 하는 길이는 보이는 줄 수가 정한다 |
| 재촉 팀원 아래 경고 문단 | 남긴다 | 지우기: 닫힌 트리거에는 둘째 줄이 안 보이고, 팀 화면 연결 링크는 그 문단에만 있다. 태스크 상세 재촉에는 받는 사람 칸이 없어 문단이 유일한 안내다 |
| 상세의 빈 담당자 줄 | 「미정」 | 「담당자 없음」 유지: 같은 화면 요약 줄은 null 을 「미정」으로 보여 두 말이 섞인다 |

상세: [시트·찾기 칸 결정](../../plan/m6/basis-for-decision/2026-11-07-select-sheet-and-combobox.md), [#471 선택 상자 결정의 이후 변경](../../plan/m6/basis-for-decision/2026-11-07-shared-select-on-radix.md#이후-변경-다섯-자리와-휴대폰-시트-477)

## 검증

| 범위 | 명령·방법 | 결과 |
|---|---|---|
| 새 부품 단위 | `npx vitest run src/shared/ui/select src/shared/ui/sheet --maxWorkers=1` | 49개 통과(Select 22, Combobox 10, Sheet 5 등) |
| 앱 테스트 | `npx vitest run <파일> --maxWorkers=1` | `approvalOverrides` 13, `taskDetailEdit`+`approvals` 47, `approvalsMsw`+`tasks` 55, `settingsPage` 21, `reminderCreateMsw` 19 통과 |
| 바꾼 모듈 주변 | 옮긴 상태 이름·표식, 담당자 조립을 쓰는 widgets·features·entities 의 테스트와 앱 테스트 `dashboard`·`taskViews`·`taskViewsCreate`·`taskViewsCodeSplit`·`taskBoardRecompute`·`approvals`, `--maxWorkers=1` 한 번 | 31개 파일 470개 통과 |
| 전체 | `npm run typecheck`·`lint`·`build` | 통과. 빌드의 CSS 경고 1건(`[color:var(...)]`)은 Tailwind 가 기존 문서 마크다운을 읽어 생기는 것으로 이번 변경과 상관없다 |
| 전체 | `npm run format:check` | git 에서 제외한 `.verify/` 참고 파일 2개만 걸렸다. 그 밖은 통과 |
| 전체 | `npm run test` | 돌리지 않았다(메모리). CI 에 맡긴다 |
| 스토리 play·E2E | 기대값만 고쳤다 | 실행하지 않았다. `messages-reminder`·`settings-notifications` E2E, `ReminderCreateForm`·`Select`·`Combobox` 스토리 |
| 브라우저 | 스크린샷·키보드만 고르기 | 브라우저 검증은 다음 단계 |
