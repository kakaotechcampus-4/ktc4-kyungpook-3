# 메시지의 재촉 만들기·태스크 빼기·PM 자기 대화 답장

PM이 재촉을 직접 만들고, 보내기 전 확인에서 묶은 태스크 하나를 빼거나 메모를 고친다(#370). 재촉 만들기는 `POST /workspaces/{id}/messages/reminders`, 빼기는 `POST …/reminders/{id}/cancel`, 메모는 `PATCH …/reminders/{id}`다. 세 경로 모두 응답이 `{reminder, bundle}`이고 PM만 부른다.

## Sub-features

- `compose`는 메시지 화면 **새 재촉**에서 팀원과 태스크를 골라 만들고, 만든 묶음의 보내기 전 확인으로 옮겨 간 뒤 새로고침해도 남는지 확인한다.
- `remove-and-note`는 묶은 태스크가 둘인 묶음에서 하나를 빼고 남은 태스크의 메모를 고친 뒤 새로고침해도 남는지 확인한다.
- `task-detail`은 태스크 상세의 **재촉** 영역에서 담당자에게 보낼 재촉을 만들고 **메시지 화면에서 확인하기** 링크로 그 묶음을 여는지 확인한다.
- `pm-self-reply`는 팀원 행에도 연결된 PM이 자기 대화에서 웹 답장을 보내고 새로고침 뒤에도 남는지, 남의 대화에는 답장 칸 대신 안내 바가 있는지 확인한다(#367). 답장은 `POST …/messages/threads/{id}/replies`이고 대화 주인만 201이다.

## How to get to it (user POV)

- 메시지 화면 목록 머리의 **새 재촉** 링크, 또는 `/workspaces/ws_01/messages?new=reminder`로 간다.
- 보낼 메시지 하나를 고르면(`?review=bd_02`) **묶은 태스크** 행마다 **메모 고치기**·**빼기**가 있다.
- 태스크 상세(`/workspaces/ws_01/tasks/tk_01`)의 **재촉** 영역에서 **재촉 만들기**를 누른다.
- PM 자기 대화는 메시지 화면 대화 목록의 **김서연**, 또는 `/workspaces/ws_01/messages/threads/th_06`이다.

## Driving it with Playwright

Preconditions:

- `messages-default`는 ws_01 PM이다. 브라우저 MSW 시계는 9/18 09:00이다. `bd_01`(이재환, 태스크 1)과 `bd_02`(정하늘, 퍼블리싱·발표 자료)가 있다.

- `messages-pm-self`는 `messages-default`에 PM 자신(`mb_01`, 김서연)의 대화 `th_06`과 그 대화의 보낼 메시지 `bd_05`를 더한다. 워크스페이스 응답의 `member_id`가 `mb_01`이다.

- **실행.** `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run messages`로 `messages-reminder.e2e.ts`의 세 테스트와 `messages-reply.e2e.ts`의 세 테스트, `messages-approve.e2e.ts`의 세 테스트를 실행한다.
- **새 재촉.** `getByLabel('받는 사람').selectOption({ label: '이재환' })`, `getByLabel('태스크').selectOption({ label: 'DB 스키마 정리 · 09/22 마감' })` 뒤 마감 하루 전 라디오가 골라져 있다. **재촉 만들기**를 누르면 주소가 `?review=bd_03`이고 목록의 보낼 메시지가 셋이다.
- **빼기·메모.** `'발표 자료' 빼기` → 확인 그룹(이름이 `빼면 남은 태스크로 문구를 다시 만들어요`로 시작)의 **빼기** → `묶은 태스크 1`. 남은 행의 **메모 고치기** → 메모 칸에 `시안 3차까지` → **저장** → `메모: 시안 3차까지`.
- **태스크 상세.** **재촉** 영역의 **재촉 만들기** → 폼 그룹 **재촉 만들기** 안의 **재촉 만들기** → 상태 영역의 **메시지 화면에서 확인하기** → `?review=bd_…`.
- **PM 자기 대화 답장.** 폼 `getByRole('form', { name: '답장' })`의 **답장** 칸에 글을 쓰고 **답장 보내기** → 영역 **대화 내용**에 그 글이 보이고 칸이 빈다. `th_01`에서는 폼이 없고 `메시지는 항상`으로 시작하는 안내 바가 있다.
- **승인과 바뀐 문구(#371).** `?review=bd_01`에서 **이대로 발송** → 토스트 `09/23 09:00에 이재환님에게 보낼게요`, 대화에 `09/23 09:00 발송 예정 · 승인함`. 409 `BUNDLE_CHANGED`는 페이지에서 `import('/src/shared/mock/db.ts')`로 `bd_01`의 `body`·`draft_version`을 바꾸고 같은 작업 안에서 누른다. 초안 대기(`bd_02`)는 같은 방법으로 `draft_status: 'done'`으로 바꾸면 10초 polling 뒤 미리보기가 바뀐다.
- **팀원 답장.** `messages-member`(mb_01)는 `/workspaces/ws_01/messages`에서 자기 대화 `th_06`이 골라져 있다. 답장을 보내면 `09:00 · 웹에서 답장`이 붙는다.
- **후속 상태.** `page.reload()` 뒤에도 같은 묶음 수, 태스크 수, 메모가 남는다. MSW 모드는 모의 DB를 같은 탭의 sessionStorage에 둔다.

## Gotchas

- 브라우저의 라디오 접근 이름은 `마감 하루 전 09/21 09:00`처럼 사이에 공백이 있다. jsdom은 공백 없이 계산하므로 단언은 정규식으로 쓴다.
- 성공 알림은 화면의 알림과 스크린리더용 `role=status`(`알림 …`) 두 곳에 나온다. `getByText`는 `exact: true`로 하나만 고른다.
- 목은 문구를 다시 만들 때 태스크 표의 지금 제목을 읽는다. 메시지 픽스처의 태스크 ID가 태스크 픽스처와 제목이 달라, 빼기·메모 뒤 남은 행의 제목이 바뀔 수 있다(예: `bd_02`의 퍼블리싱 → 배포 스크립트). 다시 만든 뒤의 행은 제목으로 고르지 않는다.
- 목의 시각은 늘 고정 시각이라 연달아 뺀 리마인드의 `cancelled_at`이 같다. 마지막 태스크를 빼 닫힌 묶음의 응답에 앞서 뺀 것까지 들어갈 수 있다. 백엔드 규칙은 `message-state.test.ts`가 서로 다른 시각으로 본다.
- 마지막 태스크 빼기(묶음 닫힘), 실패(500)·`REMINDER_NOT_FOUND`, 일반 팀원의 진입점 없음, 담당자 없음·완료 태스크는 E2E에 넣지 않았다. `src/app/messagesReviewTasksMsw.test.tsx`와 `src/app/reminderCreateMsw.test.tsx`가 본다.
- 워크스페이스 응답에 `member_id`가 없거나 `null`이면 PM 자기 대화에도 답장 칸이 없다. E2E에는 넣지 않았고 `src/app/messagesMsw.test.tsx`가 본다.
- 모의 저장은 실제 DB 행이나 Discord DM의 증거가 아니다.
