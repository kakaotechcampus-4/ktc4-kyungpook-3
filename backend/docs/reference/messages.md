# 메시지와 알림

[Backend README](../../README.md)로 돌아가기

메시지 설정, 읽지 않은 수, 답장 판단 재시도를 다룬다.

## 메시지·알림 설정

워크스페이스마다 한 행(`workspace_message_settings`)이고, 행이 없으면 기본값이다(`saved: false`).

| 요청 | 누가 | 하는 일 |
|---|---|---|
| `GET /api/v1/workspaces/{workspace_id}/message-settings` | 소속 팀원 | 설정 6개와 `saved`, `updated_at`, `updated_by`, PM 목록(`pms`, Discord 연결 여부 포함) |
| `PATCH /api/v1/workspaces/{workspace_id}/message-settings` | PM | 보낸 키만 바꾼다. 빈 본문·null·범위 밖·모르는 키는 400 `INVALID_REQUEST` |

- 키는 `due_reminder`, `minutes_summary`, `silence_alert`, `reminder_auto_approve`(bool), `nudge_rule`(`days_before` 0~3, `hour` 0~23, 한국 시간, 객체째), `pm_alert_method`(`web`·`discord_dm`·`both`)다.
- `due_reminder` 가 꺼지면 스케줄러가 재촉을 제안하지 않지만 PM 이 만든 재촉은 나간다. `silence_alert` 가 꺼지면 72시간 무응답 막힘 알림만 건너뛴다.
- `reminder_auto_approve` 가 켜지면 켠 뒤 발송 시각이 오는 재촉 묶음을 그 시각에 승인하고, 켜기 전에 지난 묶음은 보내지 않는다. 자동 승인 묶음은 `approved_by` 가 null 이다.
- 설정을 바꿔도 이미 만든 제안·묶음은 그대로다. `pm_alert_method` 와 `minutes_summary` 는 저장만 한다.
- 계약은 [FE 계약](../../../frontend/docs/contracts/frontend-api-contract.md), 근거는 [결정 기록](../plan/m6/basis-for-decision/2026-11-04-message-settings.md).

## 메시지 탭 읽지 않은 수

사람·대화마다 읽은 위치(`message_thread_read.last_read_at`)를 저장하고 그 뒤 상대편 메시지를 센다(#480).

| 요청 | 누가 | 응답 |
|---|---|---|
| `GET /api/v1/workspaces/{workspace_id}/messages/unread-count` | 소속 팀원 | `{unread_count}`. 쓰기 없음 |
| `POST /api/v1/workspaces/{workspace_id}/messages/threads/{thread_id}/read` | PM 또는 대화 주인 | `{thread_id, unread_count: 0, total_unread_count, last_read_at}` |

- 읽음은 그 대화의 가장 늦은 메시지까지 옮기고 뒤로 가지 않는다. 다시 불러도 200, 메시지 없는 대화는 `last_read_at` null.
- 없음·다른 워크스페이스·(PM 이 보낸) 탈퇴 팀원 대화는 404 `MESSAGE_THREAD_NOT_FOUND`, 팀원이 남의 대화면 403 `FORBIDDEN`.
- 대화 목록(`GET .../messages`)의 `threads[]`, 상세(`GET .../threads/{id}`)의 `thread`, 열기(`POST .../threads`) 응답에도 `unread_count` 가 있다. 이 셋은 읽음을 바꾸지 않는다.
- 도착 시각은 `coalesce(received_at, created_at)` 라 늦게 온 디스코드 답장도 센다. 상대편 메시지에 답했는지는 보낸 시각(`created_at`)으로 가르고, 봇 리마인드의 `awaiting_reply_since` 도 이 기준이다.
- 상대편은 자기 대화면 봇·PM 메시지, 남의 대화(PM)면 주인의 답장이다. 자기 대화에서 내가 뒤에 답한 상대편 메시지는 세지 않는다.
- PM 마다 따로 세고 자기 대화의 봇·다른 PM 메시지도 센다. 탈퇴한 팀원 대화와 보내기 전 묶음은 세지 않는다.
- 읽은 위치가 없으면 그 사람이 들어온 시각이 기준이다. 배포 때 있던 메시지는 마이그레이션이 모두 읽음으로 채웠다.
- 팀원을 PM 으로 올리면 그 순간까지 남의 대화가 읽음이 되고, 자기 대화의 봇·PM 메시지는 그대로 센다.
- 종 알림(`notifications`)과는 별개다. 근거는 [결정 기록](../plan/m6/basis-for-decision/2026-11-07-message-unread-count.md).

## 답장 판단 재시도와 판단 창

리마인드 답장 판단(`POST /bot/replies/claim`, `POST /bot/replies/{message_id}/judgment`) 재시도 규칙이다(#548).

- 리스는 3분(`JUDGE_LEASE`)이고, 그 안에 결과가 없으면 `attempt` 를 올려 다시 맡긴다.
- 판단 창은 답장을 받은 뒤(PM 이 태스크를 고르면 고른 뒤) 10분(`JUDGE_WINDOW`)이다. 한 차례에 같은 답장은 최대 4회 맡기고, 창이 받은 시각 기준이라 같은 대화의 앞 답장이 밀리면 더 적을 수 있다.
- 창이 지나면 claim 이 더 맡기지 않고 `timed_out` 으로 닫아 PM 에게 `reply_unjudged` 알림을 한 번 보내고, 같은 claim 에서 같은 대화의 다음 답장을 준다.
- 스케줄러 틱도 같은 창으로 닫는다. 먼저 본 쪽이 닫고 알림은 한 번이다. 스케줄러가 꺼져 있어도 claim 이 상한을 지킨다.
- 한 대화의 닫기가 실패하면(알림 오류 등) 그 대화만 건너뛰고 다른 대화 답장은 준다. 실패한 답장은 다음 claim·틱에서 다시 닫는다.
- 닫힌 답장에 늦게 온 결과는 200 으로 받아 기록만 한다. PM 이 고른 재판단은 앞 차례 `attempt` 와 상관없이 새 10분 창을 받는다.
- 근거는 [결정 기록](../plan/m6/basis-for-decision/2026-11-08-reply-judgment-attempt-cap.md).
