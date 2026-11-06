# 재촉 직접 만들기에서 서버가 막지 않는 경우를 화면이 다루는 방식과 보낼 시각 고르기의 자리

- 기록일: 2026-11-05
- 관련 마일스톤: M8-C 메시지(#370)

## 문제와 제약

- #370 은 PM 이 태스크 상세와 메시지 화면(`새 재촉`)에서 재촉을 직접 만들게 한다. 진입점 두 곳과 보낼 시각 규칙(`SendTimingPicker` 재사용)은 2026-11-05 사용자가 정했다. 서버가 거절하는 경우는 BE 코드를 읽고 화면에서 막거나 설명하라는 지시였다.
- `POST /messages/reminders`(`backend/app/services/messages.py` `create_reminder`)는 태스크·팀원이 그 공간에 있는지(404 `TASK_NOT_FOUND`·`MEMBER_NOT_FOUND`)와 지난 시각(409 `REMINDER_SCHEDULED_AT_PASSED`)만 본다. 받는 사람이 그 태스크의 담당자인지, 팀원의 Discord 연결, 태스크 상태는 보지 않는다. Discord 가 연결되지 않은 팀원의 묶음은 보낼 때 `dm_status: failed`·`discord_not_linked` 로 남는다(`dispatch_due`).
- 보낼 시각 고르기는 `widgets/message-inbox` 안에서 묶음에 묶여 있었다. 재촉 만들기는 `features` 층에 두어 태스크 상세 위젯과 메시지 위젯이 함께 쓴다. ESLint boundaries 규칙은 `features` 가 `entities`·`shared` 만 가져오게 한다(`eslint.config.js`). 위젯은 다른 위젯을 가져오지 못한다.

## 실제 검토한 선택지

- Discord 미연결 팀원: 만들기를 막는 것과 막지 않고 알리는 것을 비교했다(#370 작업 명세).
- 완료한 태스크: 서버처럼 허용하는 것과 태스크 상세에서 막는 것. 대안을 견준 기록은 따로 없고 작업 명세에서 제품 기본값으로 정했다.
- 보낼 시각 고르기의 자리: 명세는 `features/send-timing` 이었다. 구현 중 `features/reminder-create` 가 다른 feature 를 가져올 수 없어 `entities/message-settings/ui` 로 옮겼다.

## 선택과 이유

| 경우 | 화면 | 이유 |
|---|---|---|
| 태스크에 담당자가 없다 | 태스크 상세에 `담당자가 없어 재촉을 만들 수 없어요` 만 보이고 버튼이 없다 | 받을 사람(`member_id`)을 정할 수 없다. 메시지 화면의 고르기는 팀원이 맡은 태스크만 보인다 |
| 완료한 태스크 | `완료한 태스크라 재촉을 만들지 않아요` 만 보인다. 고르기 목록에서도 뺀다 | 끝난 일의 진행을 묻는 DM 은 쓸모가 없다. 서버는 막지 않으므로 FE 기본값이다 |
| Discord 미연결 팀원 | 막지 않고 `지금은 DM이 나가지 않아요. 보낼 시각 전에 팀 화면에서 연결해 주세요` 와 팀 연결 링크를 보인다 | 보낼 시각 전에 연결하면 그대로 나간다. 막으면 PM 이 연결 뒤에 다시 만들어야 한다 |
| 지난 시각·지워진 태스크·없는 팀원 | 서버 거절을 다시 시도 없이 이유로 보인다 | 같은 요청은 같은 거절이다 |

- 보낼 시각 고르기는 `entities/message-settings/ui/SendTimingPicker.tsx` 에 둔다. 마감 기준 시각은 재촉 규칙(`nudge_rule`)만 쓰고 그 규칙은 이 entity 가 가진다. 묶음 대신 `dueDate`·`scheduledAt`·`onPick` 을 받아 묶음과 새 재촉이 같이 쓴다. 함께 쓰는 `LockedButton` 은 `shared/ui/locked-button`, `useShownAfter` 는 `shared/lib/shown-after`, 날짜 입력 변환은 `shared/lib/date` 로 옮겼다.

## 장단점과 감수한 제약

- 완료 태스크 차단은 서버 규칙이 아니다. 다른 클라이언트나 직접 호출은 만들 수 있다.
- Discord 미연결 팀원의 재촉은 승인해도 DM 이 실패로 남을 수 있다. 화면은 만들 때 한 번만 알리고, 보내기 전 확인에서는 다시 알리지 않는다.
- entity 의 UI 가 설정 조회 훅(`useDeadlineSend`)을 쓴다. 다른 entity 를 가져오지 않아 경계 규칙은 지킨다.

## 영향 범위와 재검토 조건

- 영향 코드: `src/features/reminder-create`, `src/widgets/task-detail/ui/TaskReminder.tsx`, `src/widgets/message-inbox/ui/ComposeDetail.tsx`, `src/entities/message-settings/ui/SendTimingPicker.tsx`.
- 서버가 담당자·태스크 상태·Discord 연결을 검사하게 되면 화면의 막기와 문구를 서버 오류 코드에 맞춘다.
- 완료한 태스크에도 재촉이 필요하다는 요구가 생기면 이 기본값을 다시 본다.

## 근거와 관련 문서

- 이슈 #370 과 2026-11-05 사용자 결정(진입점 두 곳, 보낼 시각 규칙)
- [계약 §5.7](../../../contracts/frontend-api-contract.md)
- [2026-11-04 실제 API 연결 때 뺀 화면 요소](2026-11-04-messages-real-api-drop-unbacked-ui.md). 재검토 조건은 바뀌지 않았다
- [M8-C 결과](../result-c.md)
