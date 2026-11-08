# 결과 — 강조색 레드 다섯 값과 설정 알림 문구 (#423)

- 기록일: 2026-11-06
- 대상: [#423](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/423)
- 기준: develop `e94f7a26`(#365·#371 병합 뒤). PR은 아직 만들지 않았다.
- 상태: **이슈의 할 일을 반영했다.** 디자인 문서의 색 표는 #395에서 맞춘다. MSW 기준으로 검증했다.

## 작업 근거와 요약

마일스톤 계획에 없는 작업이다. 근거는 이슈 #423과 사용자 결정(2026-11-06, R2 에디토리얼 레드 포인트)이다.

1. 벽돌색 `#c43636` 하나가 맡던 강조색을 레드 다섯 토큰으로 나눴다. 자리마다 필요한 대비 기준(작은 글자 4.5:1, 흰 글자 면 4.5:1, 점·선 3:1, 연한 면 위 글자 4.5:1)에 맞는 토큰을 쓴다.
2. 설정 알림 절의 문구를 #411 띠와 같은 기준으로 고쳤다. 데스크톱 브라우저는 완전히 닫히면 푸시를 받지 못할 수 있어 「닫아도 받아요」는 사실과 다를 수 있다.

## 실제 구현 및 관련 코드

### 토큰

[tokens.css](../../../src/app/styles/tokens.css)의 강조 절이 다섯 값이다. `--color-accent-soft`는 지웠다.

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `accent` | `#c62828` | 작은 글자, 오류·승인을 막는 입력의 라벨과 경계, 배지 글자 |
| `accent-point` | `#e62e2d` | 안 읽음 점, 연결 끊김 점, 오류 입력의 포커스 선 |
| `accent-solid` | `#d32f2f` | 흰 글자를 얹는 면, 흰 입력의 플레이스홀더 |
| `accent-badge` | `#fbe9e7` | 글자 있는 배지의 면 |
| `accent-chip` | `#f4d9d7` | 캘린더 칩, 안내 띠의 면 |

이름과 자리별 기준의 이유는 [결정 기록](../../plan/m2/basis-for-decision/2026-11-06-accent-red-r2.md)에 있다.

### 자리별로 옮긴 곳

- 글자 있는 배지는 `bg-accent-badge text-accent`다. 태스크 보드 `위험`([BoardView.tsx](../../../src/widgets/task-board/ui/BoardView.tsx)), 간트 막대 안 `위험`([GanttView.tsx](../../../src/widgets/task-board/ui/GanttView.tsx)), 팀원 목록 `위험`([MemberList.tsx](../../../src/widgets/team/ui/MemberList.tsx)), 초대 거절 칩([chipStyles.ts](../../../src/features/member-invite/ui/chipStyles.ts)), 메시지 `답장 n일째 없음`([ThreadDetail.tsx](../../../src/widgets/message-inbox/ui/ThreadDetail.tsx))과 `DM 못 보냄`([MessageInbox.tsx](../../../src/widgets/message-inbox/ui/MessageInbox.tsx))이다.
- 흰 글자를 얹는 면은 `bg-accent-solid`다. 간트 위험 막대, 알림 개수 배지([NotificationBell.tsx](../../../src/features/notifications/ui/NotificationBell.tsx)), 막힘 알약의 hover·열림이다. 막힘 알약의 평상시 테두리·글자는 `accent`다.
- 캘린더의 위험·주의 칩과 범례 견본은 `bg-accent-chip`에 먹 제목, `sub` 보조 줄이다([CalendarView.tsx](../../../src/widgets/task-board/ui/CalendarView.tsx)). 칩의 상태 아이콘은 제목 색(먹)을 따른다.
- 점은 `bg-accent-point`다. 알림 안 읽음 점과 연결 끊김 점([connectionStyles.ts](../../../src/features/integration-connection/ui/connectionStyles.ts))이다.
- 오류·막는 입력의 포커스 선은 `outline-accent-point`, 플레이스홀더는 `accent-solid`다([TextField.tsx](../../../src/shared/ui/text-field/TextField.tsx), [Checkbox.tsx](../../../src/shared/ui/checkbox/Checkbox.tsx), [ApprovalCard.tsx](../../../src/widgets/task-board/ui/ApprovalCard.tsx)). 승인 카드의 막힌 담당자 select와 보완 폼([TaskCreateOverridesForm.tsx](../../../src/features/approval-resolve/ui/TaskCreateOverridesForm.tsx))의 오류 담당자 select도 포커스 선이 포인트다. 전에는 전역 먹 선이었다.
- 나머지 `text-accent`·`border-accent`(라벨, 오류 문구, 대시보드 `기한 지남`, 최근 반영 실패 등)는 클래스가 그대로이고 값만 `#c62828`로 바뀌었다.
- 마스코트의 `#FF6969`와 바탕 면·선은 바꾸지 않았다.

### 문구

[BrowserPushControl.tsx](../../../src/features/browser-push/ui/BrowserPushControl.tsx)의 대기 상태 문구가 「켜면 새 알림이 올 때 이 기기로 바로 알려 드려요.」다. 설정은 리마인드만이 아니라 모든 알림이라 띠의 「새 리마인드가 오면」을 「새 알림이 올 때」로 썼다.

### 테스트

- [color-contrast.e2e.ts](../../../e2e/color-contrast.e2e.ts)가 `accent`·`accent-point`·`accent-solid`·`faint` 글자와, 레드 다섯 값 중 `accent` 외 네 면 위의 글자를 화면에서 찾아 4.5:1 이상인지 잰다. `accent-point`는 점·포커스 선용 3:1 값이라 글자나 글자 바탕에 쓰이면 미달로 잡힌다. 점 자체는 글자가 없어 세지 않는다.
- 캘린더 Storybook play(`TaskViews.stories.tsx`)가 마감 임박 칩의 면 `accent-chip`, 먹 제목, `sub` 보조 줄을 단언한다. 전에는 벽돌색 면을 기대했다.
- 클래스를 단언하는 `TextField`·`Checkbox` 테스트를 새 토큰으로 맞췄다. 막힌·오류 담당자 select의 포인트 포커스 선을 `tasks.test.tsx`·`approvalsMsw.test.tsx`가 단언한다.
- [browserPush.test.tsx](../../../src/app/browserPush.test.tsx)가 설정의 대기 상태 문구를 단언한다. 이전에는 이 문구를 단언하는 테스트가 없었다.

## 검증

- 대비 E2E 5건이 통과했다. 레드 면 세 값을 일부러 낮춘 값(`#e05050`·`#707070`·`#f08080`)으로 바꾸면 보드·캘린더·간트 3건이 모두 그 글자를 짚고 실패하는 것도 확인했다.
- 화면 전후 비교(MSW, 같은 시나리오·고정 시각 2026-09-18 09:00): 대시보드, 알림 종(개수 배지·안 읽음 점), 태스크 보드(막힘 hover 포함)·캘린더·간트, 메시지 목록·대화, 팀, 승인 확인, 보드의 승인 카드, 오류 입력, 설정 알림 절, Notion 끊김 설정. 스크린샷은 커밋하지 않는 로컬 증거다.
- 같은 화면에서 계산된 색(`getComputedStyle`)을 단언했다. 개수 배지 `#d32f2f`+흰 글자, 안 읽음 점 `#e62e2d`, 대시보드 `기한 지남` 글자·테두리 `#c62828`, 간트 위험 막대 `#d32f2f`+흰 글자와 안의 배지 `#fbe9e7`+`#c62828`, 캘린더 칩 `#f4d9d7`, 보드 `위험` `#fbe9e7`+`#c62828`, 막힘 hover `#d32f2f`+흰 글자, 오류 입력의 포커스 선 `#e62e2d`·경계 `#c62828`이다.
- 전체 검사 결과는 PR 본문에 적는다.

## 남은 작업과 제한 사항

- 디자인 문서([design-system.md](../../design/design-system.md))의 색 표는 #395에서 맞춘다.
- `accent-chip`의 안내 띠 쓰임은 토큰만 있다. 지금 강조색을 쓰는 띠가 없어 이번에 칠한 띠는 없다. #411 기기 알림 띠는 흰 바탕 그대로다.
- `accent-chip` 위 `dim`(`#666666`) 글자는 4.31:1이라 미달이다. 칩에 `dim` 글자를 쓰지 않는다.
- 플레이스홀더 색은 브라우저가 `::placeholder` 계산값을 돌려주지 않아 클래스와 토큰 값으로 확인했다.
- 실서버 연동은 색과 무관해 따로 확인하지 않았다.

## 관련 기록

- [결정 기록](../../plan/m2/basis-for-decision/2026-11-06-accent-red-r2.md), 이전 [2026-11-04 기록](../../plan/m2/basis-for-decision/2026-11-04-accent-faint-contrast.md)
- [#411 결과](../411-login-return-push-prompt/result.md): 띠 문구의 기준
- #336·PR #372: 벽돌색으로 바꾼 작업. #395: 디자인 문서 색 표. #424: 정리 진행 토스트(`#FF2E2E` 점)
