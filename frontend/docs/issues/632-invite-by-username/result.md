# #632 아이디로 팀원 초대 화면

2026-11-10 [#632](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/632)를 구현했다. 마일스톤 계획 밖 이슈 작업이며 전체 계획은 수정하지 않았다. BE [#631](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/pull/631)이 아직 병합되지 않아 MSW 로만 확인했다. 두 PR 은 같은 배포에 들어가야 한다. 이 브랜치는 #627(가입 아이디) 브랜치 위에 있다.

## 배경

카카오 계정에 이메일이 없는 사람이 있어 이메일로는 초대할 수 없었다. BE #631 은 초대를 이메일 대신 가입한 계정(`user_id`)에 묶고, PM 이 아이디로 가입자를 찾는 `GET /users/search` 를 더했다. 아무나 공간을 만들어 PM 이 될 수 있어 아이디가 정확히 같아야(대소문자만 무시) 찾는다. 이 작업은 그에 맞춘 화면이다.

## 변경

- **데이터 모양.** 초대 응답 스키마가 `email` 대신 `invited_user {user_id, username, name}`(null 아님)을 읽는다. 검색 응답 `userSearchSchema` 와 도메인 `Invitee` 를 더했다. 만들기 본문은 `{member_id, user_id}` 다. 오류 코드 `EMAIL_ALREADY_INVITED` 를 지우고 `USER_ALREADY_INVITED`·`USER_NOT_FOUND` 를 더했다.
- **찾기 상태.** `features/member-invite/model/useInviteeSearch.ts` 는 판별 유니온 하나(`idle`·`searching`·`found`·`none`·`invalid`·`failed`)다. 결과에 정규화 아이디를 붙이고, 입력의 정규화 값이 바뀌면 그 결과를 버린다. 같은 아이디로 되돌려도 다시 찾아야 한다(이슈의 「찾은 뒤 입력을 바꾸면 찾은 결과를 버리고 다시 찾게」). 그사이 탈퇴한 사람을 지난 결과로 초대하지 않는다. #627 의 `useUsernameCheck` 는 되돌리면 지난 결과를 다시 쓰는데, 여기는 그 점만 다르다. 입력이 바뀌면 찾던 요청을 끊고, 늦게 온 응답은 요청마다의 컨트롤러 비교로 버린다. 누를 때 세션 범위를 잡고 요청 signal 은 입력용 컨트롤러와 세션 signal 을 `AbortSignal.any` 로 합친다. 규칙 밖 아이디는 요청 없이 `invalid` 다.
- **초대 창.** 아이디 칸 오른쪽에 `찾기` 가 있다. 찾은 사람의 이름(굵게)과 아이디를 보인 뒤에만 `초대하기` 가 켜지고 그 사람의 `user_id` 로 보낸다. Enter 는 찾은 사람이 없으면 찾고, 있으면 초대한다. 0명은 「가입한 사용자의 아이디를 정확히 입력해 주세요.」, 규칙 밖은 아이디 규칙 문구, 검색 실패(403·네트워크·`INVALID_RESPONSE`)와 만들기 거절은 칸 오류다. 입력·결과는 창이 열려 있는 동안만 있어 닫으면 함께 사라진다.
- **대기 초대 표시.** 팀원 줄과 다시 초대 안내가 이메일 대신 `이름 · 아이디` 다. 수락이면 지금처럼 수락한 계정이다.
- **토스트.** 「알림은 가지 않아요. {찾은 사람 이름}에게 {아이디} 계정으로 로그인해 받은 초대를 수락하라고 알려 주세요.」 알릴 사람은 팀원 줄의 이름이 아니라 찾아 초대한 계정의 주인이다.
- **받은 초대 빈 상태.** 「PM에게 내 아이디({아이디})를 알려 주고 초대를 요청하세요.」 세션을 아직 읽지 못했으면 「PM에게 가입한 아이디를 알려 주고 초대를 요청하세요.」 다.
- **MSW.** `GET /api/v1/users/search` 를 더했다(로그인 → 쿼리 누락 400 → PM 아니면 403 → 규칙 밖 빈 목록 → 같은 아이디 한 명, 그 공간 팀원 제외). 만들기 검사는 BE `create_invitation` 순서(본문 400 → PM 403 → `USER_NOT_FOUND` → 팀원 → 연결 → PM 팀원 → `ALREADY_WORKSPACE_MEMBER` → `USER_ALREADY_INVITED`)이고 `details` 는 `user_id` 다. 내 초대·수락·거절·연결 끊기가 닫는 대기 초대·탈퇴가 지우는 초대가 이메일 대신 `invited_user_id` 를 본다. 모의 저장 버전을 23 으로 올리고 초대 칸 검사를 더했다.
- **픽스처.** 초대받는 가입자 계정 이재환(`jaehwan`)·정하늘(`haneul`)·한도윤(`doyun`, 어느 팀원과도 이어지지 않아 찾아 초대할 수 있다)을 `team-invitations`·`invitation-pending` 에 뒀다. `invitation-pending` 은 가입 대신 이재환으로 로그인해 초대를 받는다. 박민수가 수락한 초대만 있던 `messages-pm-thread` 에도 박민수 계정을 뒀다. 초대받은 계정이 없으면 응답을 만들 수 없고, 계정 없이 두면 가입한 새 계정의 ID 가 `us_02` 와 겹친다.
- **문서.** [계약](../../contracts/frontend-api-contract.md) §5.9 를 BE 브랜치의 변경과 같은 줄로 맞추고, 「FE 미연결」 표기를 이 브랜치 사실로 고친 뒤 「#632 FE 반영」 문단을 더했다. 새 결정 번호는 쓰지 않았다.

## 설계에서 정한 것

- 찾기 상태는 `useMutation` 이 아니라 손으로 짠 훅이다. 조회이고, 가장 가까운 선례 `useUsernameCheck` 가 같은 문제(입력에서 파생하는 결과, 입력이 바뀌면 끊기, 늦은 응답 버리기)를 같은 모양으로 푼다. `useMutation` 은 결과를 입력과 견주는 파생과 입력별 취소를 따로 얹어야 한다.
- 찾은 결과는 정규화 아이디가 바뀌거나 입력이 규칙 밖이 되면 상태에서 지운다. 숨기기만 하면 소문자로 바꿔야 같아지는 규칙 밖 글자(켈빈 기호 등)로 바꿨다 되돌릴 때 찾지 않은 결과가 다시 붙는다.
- 초대 만들기가 404 `USER_NOT_FOUND` 면 찾은 그 사람을 버린다. 안내대로 같은 아이디로 다시 찾을 수 있고 Enter 가 없어진 `user_id` 로 다시 보내지 않는다.
- 찾기가 실패하면(0명·규칙 밖·403·네트워크·`INVALID_RESPONSE`) 포커스를 아이디 칸으로 옮긴다. 실패 문구는 칸의 설명으로 이어져 있어 화면 낭독기가 그 칸에서 읽는다. `찾기` 버튼에 포커스가 남으면 읽히지 않았다.
- 칸에 보이는 오류라면 초대 만들기의 서버 거절도 같은 규칙으로 아이디 칸에 포커스를 옮긴다. 404 `USER_NOT_FOUND` 로 찾은 사람을 버리면 `초대하기` 가 꺼져 포커스가 그 버튼에 남았다. 다시 찾기를 시작하면 지난 서버 오류를 지운다. 입력을 바꾸지 않고 다시 찾아 사람이 나와도 404 문구가 남지 않는다.
- MSW 의 PM 초대 목록은 초대받은 계정이 없는 줄만 빼고 돌려준다. BE 가 초대받은 계정과 inner join 이라 목록 전체가 실패하지 않는 것과 같다.
- 찾기 전에는 `초대하기` 가 꺼져 있어 브라우저가 Enter 로 폼을 보내지 않는다. 칸의 Enter 를 찾기로 잇는다. 한글 조합 중 Enter 는 무시한다.
- 창의 입력·결과를 창 안쪽 컴포넌트에 두었다. 모달 내용은 닫히면 사라지므로 닫을 때 지우는 코드가 없고, 찾던 요청은 언마운트에서 끊긴다.

## 검증

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm run format:check` | 통과(이 워크트리에는 `.verify` 가 없다) |
| `npm run build` | 통과 |
| 바꾼 곳 테스트 | 마지막 코드에서 한 번에 `--maxWorkers=1`. 바꾼 테스트 12 파일과 바꾼 픽스처·handler 를 쓰는 9 파일(`withdrawnRecordNames`·`teamRoles`·`messageScenarios`·`messagesMsw`·`messagesSync`·`types/api/message`·`persistence`·`entities/user/api/username`·`appShell`), 21 파일 397 건 모두 통과. 전체 `npm run test` 는 돌리지 않았다 |
| E2E | `E2E_PORT=5232` 로 `member-invitations`·`account-withdrawal`·`restore`·`member-roles` 9 건, `settings-team` 9 건 모두 통과 |

- 이슈 「테스트」 항목 (`app/teamInvitations.test.tsx`)
  - 결과에서 고른 사용자로 `POST /invitations` 가 `{member_id, user_id}` 로 나간다: 「아이디로 찾은 사람의 이름·아이디를 확인하고 초대하면…」. 보낸 본문을 그대로 비교한다.
  - 결과가 비면 안내가 뜬다: 「찾는 아이디의 가입자가 없거나 이미 이 팀원이면…」(없는 아이디, 이미 팀원인 박민수).
  - 대기 중 초대에 아이디와 이름이 보인다: 첫 테스트(`이재환 · jaehwan`)와 다시 초대 안내 「기다리는 초대(이재환 · jaehwan)…」.
- 더한 화면 테스트: Enter 로 찾고 초대, 규칙 밖은 요청 없음, 찾은 뒤 입력을 바꾸면 결과가 사라지고 초대하기가 꺼지며 같은 아이디로 되돌려도 다시 찾아야 함, 늦게 온 이전 검색 응답이 새 입력에 붙지 않음, 찾는 중 입력을 바꿨다 되돌려도 찾기가 멈추지 않음, 검색 403·네트워크·스키마 불일치 문구, 만들기 409 `USER_ALREADY_INVITED`·404 `USER_NOT_FOUND`(찾은 뒤 탈퇴), 닫았다 열면 비어 있음.
- 늦은 응답·입력 변경 테스트가 실제로 잡는지 훅을 일부러 망가뜨려 확인했다. 컨트롤러 비교와 끊기를 빼면 「늦게 온 이전 검색 응답」 이 실패하고, 파생 비교까지 빼면 입력 변경 두 테스트도 실패한다. 되돌린 뒤 통과.
- MSW: `shared/mock/invitationFlow.test.ts` 에 검색(대소문자·공백, 앞부분·이름 불가, 팀원 제외, 규칙 밖 빈 목록, 403 우선)과 만들기 검사 순서, 이메일 없는 계정의 내 초대를 더했다.
- 리뷰 뒤 더한 테스트: 404 `USER_NOT_FOUND` 뒤 찾은 사람이 사라지고 같은 아이디로 다시 찾으며 목록 재조회가 실패하지 않음, 켈빈 기호로 바꿨다 되돌려도 찾은 사람이 다시 붙지 않음, 찾기 실패 뒤 아이디 칸 포커스와 칸 설명, MSW 목록이 계정 없는 초대만 뺌. 넷 모두 고치기 전 실패를 먼저 확인했다.
- 404·409 거절 뒤 아이디 칸 포커스와 칸 설명, 404 뒤 같은 아이디로 다시 찾아 사람이 나오면 404 문구가 사라짐. 고치기 전 코드에서 세 테스트가 실패하는 것을 확인했다.
- `invitationRespond` 의 로그인 도우미는 시작 화면이 다 그려질 때(「팀원으로 시작」 링크)까지 기다린다. 가입을 거치던 이전 도우미보다 빨리 `/onboarding/start` 에 닿아, CI 에서 시작 화면이 불러오는 중(`aria-busy`)일 때 링크를 찾다 실패했다.
- 고친 기존 테스트: `teamInvitations`, `accountWithdrawal`, `invitationFlow`, `inviteView`, `invitationRespond`(가입 대신 로그인), `onboardingStart`, `useMemberInviteActions`, `latestByMember`, `workspaceInvalidResponse`(모르는 상태만 틀린 응답으로), `types/api/invitation`, `scenarios`, `taskScenarios`(저장 버전).

## 확인하지 않은 것

- BE #631 과의 실서버 왕복. 계약과 MSW 는 BE 브랜치 코드(`users.py`·`invitations.py`·`schemas/invitation.py`)를 읽어 맞췄다.
- 브라우저로 본 초대 창 배치(1280·390). 관리 세션이 따로 본다.
- 전체 `npm run test`. 바꾼 곳과 관련 파일만 돌렸다.
