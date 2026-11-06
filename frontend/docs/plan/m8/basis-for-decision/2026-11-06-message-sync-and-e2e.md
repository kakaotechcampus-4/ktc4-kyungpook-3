# 메시지 화면을 언제 다시 받는가(D-136)와 메시지 E2E 범위(D-117)

- 기록일: 2026-11-06
- 관련 마일스톤: M8-C 메시지(#371)

## 문제와 제약

- D-136 과 D-117 의 메시지 부분은 「실제 API 가 생길 때 정한다」로 보류돼 있었다. 실제 API 는 #315 에서 연결됐다.
- 메시지 화면은 화면 재진입·탭 복귀·행동 성공 때만 다시 받는다. 그 사이에 서버에서 일어나는 일은 화면이 모른다. AI 초안 도착(`draft_status` 가 `done` 이 되고 문구와 `draft_version` 이 바뀐다), 스케줄러의 자동 취소·만료, 봇 DM 전달 결과(`dm_status`), 팀원의 Discord 답장이다. 승인 직전에 문구가 바뀌었으면 PM 은 409 `BUNDLE_CHANGED` 를 받은 뒤에야 안다.
- 기본 방향은 이슈 #371 댓글과 코디네이터 결정(엔지니어링 판단)이다. 지금의 다시 받기는 두고 두 가지를 더한다. 상시 polling 은 하지 않는다. E2E 는 CI 가 도는 MSW 기준이다.
- BE 에는 SSE·WebSocket 이 없다. 알림은 웹 안 알림 목록과 기기 푸시 두 길로 온다(`backend/app/services/notifications.py`).
- 같은 날 정한 #417 은 PM 자기 대화를 메시지 화면 맨 위 별도 구역으로 뗀다. 이번 갱신은 쿼리 단위로 두고 대화 목록 구조에 묶지 않는다(코디네이터 지시).

## 실제 검토한 선택지

- 초안 기다림: 메시지 화면 상시 polling, 초안을 기다리는 묶음이 있을 때만 polling.
- 초안 polling 간격: AI 워커 주기(30초)와 같은 값, 그보다 짧은 값.
- 알림 도착을 아는 곳: 알림 목록 조회(30초 polling, `entities/notification/api/notificationApi.ts`), 서비스 워커 `push` 이벤트를 열린 화면에 전달하기.
- 메시지 알림 거르기: 알림 `kind`, 알림 링크 종류(`thread`·`bundle`).
- E2E 의 409 재현: MSW handler·시나리오 추가, 페이지 안에서 모의 DB 모듈을 가져와 바꾸기.

## 선택과 이유

| 결정 | 고른 길 | 버린 대안과 이유 |
|---|---|---|
| 언제 주기적으로 받나 | 받은 목록·대화 응답에 `draft_status` 가 `needed`·`claimed` 인 묶음이 있을 때만 그 쿼리를 다시 받는다. TanStack Query `refetchInterval` 을 함수로 주어 그 쿼리의 데이터로 켜고 끈다 | 상시 polling 은 초안이 없는 대부분의 시간에도 요청한다. 팀원 화면은 묶음을 받지 않으므로 다시 받지 않는다 |
| 간격 | 10초 | AI 워커는 30초마다 초안을 가져가 LLM 호출 직후 쓴다(`ai/capture/dm.py` `DRAFT_POLL_S = 30.0`). 30초로 맞추면 화면에 보이기까지 최대 60초 남짓이 된다. 10초면 많아야 3분의 1을 더하고, 초안 하나에 조회가 3번쯤이다. 실제 부하는 재지 않았다(D-136 의 시간값 조정 조건 그대로) |
| 백그라운드 탭 | 다시 받지 않는다(`refetchIntervalInBackground` 기본값 false). 돌아오면 지금처럼 탭 복귀에서 다시 받는다 | 보이지 않는 화면을 위한 요청은 쓸모가 없다 |
| 알림 도착을 아는 곳 | 알림 목록 조회의 새 항목. 종(`NotificationBell`)이 받은 목록에서 처음 본 메시지 알림 ID 가 있으면 그 공간의 메시지 쿼리(`messageKeys`)를 무효화한다. 첫 목록은 기준점이라 무효화하지 않는다 | 서비스 워커는 지금 열린 화면에 아무것도 보내지 않는다. 전달 길을 더해도 푸시를 켠 기기에만 동작하고, 목록은 모든 기기에서 30초마다 이미 받는다 |
| 메시지 알림 | `kind` 가 `reminder_sent`·`nudge_suggested`·`nudge_reapprove`·`reminder_auto_cancelled`. 제목 표와 한 표(`entities/notification/model/display.ts`)에 둔다 | 링크 종류는 알림이 누르면 갈 곳이지 바뀐 데이터가 아니다. 앞으로 메시지가 아닌 일에 `thread` 링크가 붙으면 틀린다. `silence_blocked` 는 태스크 알림이라 뺐다 |
| 세션 경계 | 알림 기준점에 그때의 세션 세대(`captureSession`)를 붙인다. 세션이 바뀌었으면 기준점을 새로 잡고 무효화하지 않는다. 주기 조회는 그 쿼리 데이터에서만 정해지고, 사용자가 바뀌면 `clearUserScope` 가 메시지 캐시를 지운다 | 쿼리 밖에 따로 타이머를 두지 않는다. 회의 처리 추적처럼 별도 저장소를 두면 세션마다 지워야 할 것이 하나 는다 |
| E2E 범위 | MSW 기준 Playwright 세 시나리오(승인 → 예정, 409 `BUNDLE_CHANGED`, 팀원 답장)와 초안 도착 주기 갱신 하나 | 실제 BE 기준은 CI 에서 돌 수 없다. 실서버 확인은 #366·#357 이 맡는다 |
| E2E 의 409 재현 | 페이지가 Vite 개발 서버의 모의 DB 모듈(`/src/shared/mock/db.ts`)을 가져와 묶음의 문구와 판을 바꾼다. Vitest 의 같은 테스트가 DB 를 직접 바꾸는 것과 같다 | MSW handler 나 응답 모양을 바꾸지 않는다(이번 범위 밖). 두 탭은 모의 DB(sessionStorage)를 함께 쓰지 않는다 |

## 장단점과 감수한 제약

- AI 워커가 멈춰 초안이 끝나지 않으면 그 화면이 열려 있고 보이는 동안 10초마다 계속 받는다. BE 는 가져간 지 10분 지난 초안을 다시 내주므로(`DRAFT_CLAIM_TIMEOUT`) 언젠가 끝나는 것을 전제로 했다.
- 알림 목록이 30초 polling 이라 알림이 오고 메시지가 바뀌기까지 최대 30초 늦다.
- 팀원 Discord 답장과 DM 전달 결과는 알림이 없어 이번에도 화면 재진입·탭 복귀·행동 성공 때 보인다. 답장 알림은 BE 에 없다.
- 로그아웃 전환 중 이전 화면이 잠깐 마운트된 채 남는 사이에 주기 조회가 한 번 나갈 수 있는 것은 기존 알림 목록 polling 과 같은 성질이다. 그 조회는 새 세션의 쿠키로 나가고 이전 사용자의 데이터를 다시 보이지 않는다.
- E2E 의 모의 DB 가져오기는 Vite 개발 서버에서만 된다. E2E 는 늘 개발 서버로 돈다(`playwright.config.ts`).

## 영향 범위와 재검토 조건

- 영향 코드: `src/entities/message/api/messageQueries.ts`, `src/entities/notification/model/display.ts`, `src/features/notifications/`, `e2e/messages-approve.e2e.ts`, `e2e/messages-reply.e2e.ts`.
- BE 가 답장·DM 결과 알림이나 실시간 전송(SSE 등)을 더하면 그 신호로 무효화하고 초안 polling 을 다시 본다.
- AI 워커 주기(`DRAFT_POLL_S`)가 바뀌거나 실제 요청 부하를 재면 간격을 다시 정한다.

## 근거와 관련 문서

- 이슈 #371 본문과 댓글(기본 방향)
- [제품·기술 결정 D-117·D-136](../../../decision/frontend-decisions.md)
- [계약 §5.7](../../../contracts/frontend-api-contract.md)
- [M8-C 결과](../result-c.md)
