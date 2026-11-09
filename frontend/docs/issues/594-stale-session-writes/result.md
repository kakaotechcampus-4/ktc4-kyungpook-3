# #594 누를 때의 세션에서만 쓰기를 보낸다

2026-11-09 [#594](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/594)를 고쳤다. 마일스톤 계획 밖 이슈 작업이며 전체 계획은 수정하지 않았다.

## 원인

TanStack Query mutation 의 기본 `networkMode: 'online'` 은 오프라인이면 `mutationFn` 을 멈췄다가 다시 연결되면 이어서 부른다. 승인·반려(`useApprovalResolve`)는 누를 때 세션 세대(`captureSession()`)를 변수에 잡아 두고 `onSuccess`·`onError` 에서만 확인했다. `mutationFn` 은 확인하지 않고 요청에 세션 신호도 달지 않아, 멈춘 사이 로그아웃·다른 계정 로그인이 있으면 이전 세션의 `PATCH /approvals/{id}` 가 다음 계정의 쿠키로 나갔다. 막힌 것은 늦은 응답의 뒷처리뿐이었다.

새 회귀 테스트가 이 경로를 재현한다. 고치기 전 코드에서 승인 반려를 오프라인으로 멈추고 세대를 올린 뒤 다시 연결하면 `PATCH /approvals/ap_01` 이 나갔다.

## 변경

지켜야 할 규칙은 이미 있다. 「끝난 세션의 요청은 어떤 부작용도 내지 못한다」([처리 추적 결정 개정 2026-10-05 불변식 1](../../plan/m5/basis-for-decision/2026-10-03-processing-tracker.md)). 메시지 쓰기·재촉 만들기·대화 열기·알림 설정·회의 채팅 채널·별칭·답장 되돌리기·자동 막힘 풀기·담당자·마감 저장·회의 삭제는 이미 그 모양이다. 같은 빈틈이 있던 쓰기를 그 모양으로 맞췄다. 새 결정 번호는 쓰지 않았다.

- 변수에 `captureSessionScope()` 의 세션 범위를 잡는다. `mutationFn` 첫 줄에서 그 세션이 지금 세션이 아니면 요청하지 않고 취소 오류(`REQUEST_CANCELED`)로 끝낸다. 요청에는 그 세션의 `signal` 을 달아, 보내는 중에 세션이 끝나면 요청도 끊긴다. 뒷처리의 세션 검사는 그대로다.
- 고친 쓰기
  - 승인·반려 `useApprovalResolve` → `resolveApproval` 에 `signal`
  - 태스크 상태 `useTaskStatusChange`, 태스크 만들기 `useTaskCreate`, Notion 반영 다시 넣기 `useTaskNotionSync` → `updateTaskStatus`·`createTask`·`retryTaskNotionSync` 에 `signal`
  - 초대 만들기·취소·계정 연결 끊기 `useMemberInviteActions` → `createInvitation`·`cancelInvitation`·`revokeInvitation` 에 `signal`
  - 자동 반영 되돌리기 `useAutoItemRevert` → `revertAutoItem` 에 `signal`
  - PM 권한 주기 `MemberRoleControl` → `updateMember` 에 `signal`
  - 알림 읽음 `NotificationBell` → `readNotification` 에 `signal`
  - 회의 업로드 `useMeetingUpload`: 세션을 `onMutate` 대신 변수로 넘기고 `uploadMeeting` 의 `signal` 에 단다.
  - 연동 끊기 `useDisconnectIntegration`: 전에는 세션을 보지 않았다. 누를 때의 세션을 변수로 받고(`ConnectionActions`), 세션이 바뀌었으면 보내지 않고 카드·캐시도 바꾸지 않는다.
- 고치지 않은 것
  - 로그아웃·비밀번호 재설정 요청·가입 코드 다시 받기: 세션 밖이거나 세션을 끝내는 요청이다.
  - 온보딩 저장(`useOnboardingSave`·`useCreateWorkspace`·팀원 단계): 세션 검사가 없고 여러 요청을 잇는 흐름이라 같은 모양 한 줄로 끝나지 않는다. 후속으로 남긴다.
  - 세대는 탭 하나의 것이다. 다른 탭에서 다른 계정으로 로그인해 쿠키가 바뀐 경우는 이 검사로 알 수 없다.

## 검증

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과(직접 돌려 0 건 확인) |
| `npm run lint` | 통과 |
| `npm run build` | 통과 |
| 바꾼 곳 테스트 | 바꾼 조각·API 와 승인·태스크·초대·팀·알림·업로드·연결 설정 화면 55 파일·651 건. 업로드 변수 모양 단언 1 건이 실패해 고친 뒤 그 파일 43 건 통과 |
| `npm run test -- --maxWorkers=1` | 312 파일·4049 건 모두 통과(2,222 초) |

- 새 테스트
  - `app/staleSessionWrites.test.tsx`: 승인 반려·태스크 상태·태스크 만들기·Notion 다시 넣기·자동 반영 되돌리기마다 오프라인으로 멈춘 쓰기 → 세션 세대 올림 → 다시 연결에서 요청이 나가지 않는다. 같은 세션이면 다시 연결될 때 나간다(대조).
  - `features/member-invite/model/useMemberInviteActions.test.tsx`: 초대 만들기·취소·계정 연결 끊기 같은 검사와 대조.
  - `features/integration-connection/model/useDisconnectIntegration.test.tsx`: 연동 끊기가 나가지 않고 `onDisconnected` 도 부르지 않는다. 대조는 끊는다.
  - 「나가지 않는다」 아홉 경우는 고치기 전 코드로 먼저 실패를 봤고, 대조 일곱은 그때도 통과했다.
- PM 권한 주기·알림 읽음·회의 업로드는 따로 테스트를 더하지 않았다. 같은 두 줄을 넣었고 기존 화면 테스트가 정상 경로를 본다.
- `app/taskViewsRender.test.tsx` 는 상태 변경 mutation 을 직접 만드는 곳의 변수 이름만 바꿨다. `app/meetingUpload.test.tsx` 의 「원본 파일 참조가 남지 않는다」는 변수가 `{ fields, session }` 이 되어 `fields` 를 비교한다. 파일이 캐시에 없는지 보는 검사는 그대로다.
