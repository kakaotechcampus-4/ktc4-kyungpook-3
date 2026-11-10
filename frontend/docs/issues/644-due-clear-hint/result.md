# #644 마감 해제 카드의 마감 칸 안내

2026-11-10 [#644](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/644)를 구현했다. 마일스톤 계획 밖 이슈 작업이며 전체 계획은 수정하지 않았다. AI [#630](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/630)(마감 해제 payload)과 [#629](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/629)(참석자 안내 새 문구)는 이 작업 중 develop 에 병합됐고, 이 브랜치는 그 위에 있다.

## 배경

#630 부터 회의에서 기존 할 일의 마감을 없애자는 말이 나오면 변경 승인 payload 에 `"due_date": null` 이 키째 실린다([backend-ai-contract](../../../../backend/docs/contracts/backend-ai-contract.md) 「update 마감 해제」). 변경 표는 `없음` 으로 맞게 보였지만, 마감 칸 안내는 키가 없는 카드와 null 인 카드를 구분하지 못해 `원래 제안 유지 · YYYY-MM-DD` 로 나왔다. 원래 제안이 「마감 없음」인데 날짜를 유지한다고 읽혔다.

## 변경

- **데이터 모양.** `useTaskUpdateOverrides` 의 `proposedDue` 가 `string | null | undefined` 다. 문자열은 제안한 날짜, `null` 은 마감 해제, `undefined` 는 마감을 바꾸지 않는 제안이다. 같은 훅의 `edits.dueDate`(키 없음 = 원래 제안 유지, null = 미정)와 같은 규칙이다. 문자열도 null 도 아닌 값은 전처럼 키 없음으로 본다.
- **마감 칸 안내.** `TaskUpdateOverrideFields` 가 `proposedDue` 가 null 이면 `원래 제안 유지 · 미정` 을 보인다. 키 없는 카드는 `원래 제안 유지 · YYYY-MM-DD`, 날짜 제안은 `원래 제안 유지 · <날짜>` 그대로다. 승인 본문은 바뀌지 않았다. 칸을 비워 승인하면 `task_overrides` 없이 보내 제안대로 마감이 지워지고, 날짜를 넣으면 그 날짜를 `task_overrides.due_date` 로 보낸다.
- **승인 스키마(#348).** payload 는 `looseObject` 라 `due_date: null` 을 받는다. 새 시나리오를 `shared/types/api/approval.test.ts` 의 「handler 가 내는 목록·상세」 목록에 넣어 스키마 통과를 확인했다. 스키마는 바꾸지 않았다.
- **MSW.** 시나리오 `approval-due-clear` 를 더했다. ws_01 PM 으로 로그인하고, `tk_04`(배포 스크립트, 마감 2026-09-24)의 마감을 없애자는 변경 승인 `ap_09` 가 대기한다. payload 는 `due_date: null`, `base_values.due_date` 에 원래 마감을 둔다. 기존 handler 가 승인 때 마감을 지운다.
- **디자인 캔버스.** `docs/design/canvas/Upload.dc.html` 의 참석자 안내를 #629 의 새 문구 「녹음에서 실제로 말한 사람만 골라 주세요. 적어도 이 인원수로 목소리를 나눠요.」로 바꿨다.
- **계약.** [대표 계약](../../contracts/frontend-api-contract.md) `task_update` 반영 절에 FE 사용 사실 한 줄을 더했다.

## 검증

- RTL `app/approvalOverrides.test.tsx` 「마감 해제 카드 (#644)」: 안내가 `원래 제안 유지 · 미정` 이고 칸을 비워 승인하면 본문이 `{status: 'approved'}`, 태스크 마감이 null. 날짜를 넣으면 본문 `task_overrides.due_date` 가 그 날짜, 태스크 마감도 그 날짜. 키 없는 카드는 기존 테스트 「a deadline absent from proposal…」가 `원래 제안 유지 · YYYY-MM-DD` 를 그대로 본다. 고치기 전 커밋에서 첫 테스트가 `원래 제안 유지 · YYYY-MM-DD` 로 실패하는 것을 확인했다.
- MSW 시나리오: `shared/mock/taskScenarios.test.ts`(등록·ws_01 로그인), `shared/types/api/approval.test.ts`(목록·상세 스키마 통과).
- 브라우저(MSW 개발 서버): `/workspaces/ws_01/approvals/ap_09?msw-scenario=approval-due-clear` 를 1280·390 폭으로 열어 안내가 고치기 전 `원래 제안 유지 · YYYY-MM-DD`, 고친 뒤 `원래 제안 유지 · 미정` 인 것을 캡처했다. 승인을 누르면 본문 `{status: 'approved'}` 이고 `tk_04` 의 마감이 null, version 2 가 됐다. 증거는 git 에서 제외한 `frontend/.verify/644/` 에 있다.

## 확인하지 않은 것

- 실제 BE·AI 가 만든 마감 해제 카드로 본 화면. payload 모양은 #630 계약 행을 따라 MSW 로 만들었다.
- `docs/design/managers-manager-refined.html` 에 묶인 업로드 화면 스냅샷의 옛 참석자 문구. 캔버스에서 생성한 별도 스냅샷이라 이번 범위(캔버스 원본 111줄)에 넣지 않았다.
