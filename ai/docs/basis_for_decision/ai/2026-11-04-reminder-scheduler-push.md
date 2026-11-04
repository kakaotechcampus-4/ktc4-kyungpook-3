# 리마인드 스케줄러와 웹 안 알림·브라우저 푸시

- 날짜: 2026-11-04
- 이슈: #318
- PR:
- 브랜치: `feature/318-reminder-scheduler-push`

## 한 일

서버 안 워커(`services/scheduler.py`, `run_tick`)를 더했다. 마감 하루 전 09:00(한국 시간) 재촉을 그 3일 전에 제안하고, 발송 직전 응답을 다시 확인하며, DM 전달 뒤 72시간 무응답이면 태스크를 막고 PM 에게 알린다. 답장이 오면 푼다. 틱은 지금 상태만 보고 할 일을 정하므로 서버가 꺼졌다 켜지면 밀린 일을 처리한다.

표 넷을 더했다(마이그레이션 `8b3090f39aec`). `reminder_watch`(72시간 시계), `scheduler_suggestion`(제안 기록), `notification`(알림과 푸시 발송 상태), `push_subscription`(브라우저 구독).

`services/notifications.py` 의 `notify()` 가 다른 작업이 부르는 입구다. 알림 목록·읽음 API 와 푸시 구독 API 를 더했다(`api/notifications.py`). PM 이 자동 막힘을 한 번에 되돌리는 `POST /tasks/{task_id}/auto-block/undo` 도 더했다.

봇 경로도 같은 발송 직전 확인을 거치도록 `messages.dispatch_due` 에 호출 한 줄을 넣었다. 그래서 `POST /bot/messages/claim` 에 자동 취소·만료된 건이 나오지 않는다. 계약의 그 문장만 고쳤다.

리뷰에서 20건을 고쳤다.

- 날짜 `0001-01-01` 인 태스크 하나가 모든 워크스페이스의 틱을 멈췄다. 제안과 시계 판정을 항목마다 커밋하고 실패를 건너뛰게 바꿨다
- 틱이 봇 가져가기, 추출 저장과 교착했다. 잠금을 하나만 들도록 바꿨다
- 구독 주소를 검사하지 않아 서버가 임의 주소로 요청을 보냈고, 느린 주소 하나가 워커를 멈췄다. 브라우저 푸시 서비스 주소만 받고 계정당 10개로 제한했다. 검증은 발송과 같은 파서로 해서 역슬래시 주소도 막는다
- 푸시를 보내는 동안 행 잠금을 들고 있어 읽음 표시가 걸렸다. 잠금 밖에서 보내고 틱마다 30초로 제한했다
- 같은 구독을 동시에 등록하면 500 이었다
- 막힘 풀기가 낡은 값을 쓰거나 지워졌고, 답장보다 뒤에 사람이 건 막힘까지 풀었다. 재촉이 다시 나가면 시계를 하나만 남기고 되돌릴 값을 넘기며, 그 시계는 답장이나 되돌리기로만 닫는다. 담당자가 바뀐 뒤 옛 대화에 온 답장은 세지 않는다
- 지운 태스크의 재촉이 나갔고, 만료로 승인이 풀려도 PM 이 몰랐고, 알림 문구가 사실과 달랐다

## 왜

D-174 메시지 정책이 재촉 제안, 발송 직전 재확인, 72시간 무응답 처리, 놓친 일정 처리를 BE 에 맡긴다. 설계 근거는 [결정 0038](2026-11-04-0038-reminder-scheduler-and-notifications.md).

## 결과

| 항목 | 값 |
|---|---|
| sqlite 전체 pytest | 1120 passed, 656 skipped |
| PostgreSQL 포함 전체 pytest | 1736 passed, 40 skipped |
| `alembic check`, 내리고 다시 올리기(PostgreSQL) | 차이 없음, 통과 |
| 유료 호출 | 없음 |

실제 푸시는 macOS Chrome 한 대로 확인했다. BE 경로(`notify`, `send_pending_pushes`, `push.send`)로 FCM 을 거쳐 보냈고 결과는 `sent` 다. 처음 두 건은 macOS 가 Chrome 알림을 꺼 두어 배너 없이 서비스 워커의 알림 목록에만 있었다. Chrome 알림을 켠 뒤 세 번째 건은 배너로 떴고, 누르면 `/?type=thread&id=thread-check` 가 열렸다. 비공개키는 PEM 파일 경로로 실제 발송을 확인했고, base64url 문자열은 서명까지만 확인했다. 실제 FE 화면과 EC2 에서는 아직 안 했다.

상태 전이는 코드에서 그림을 그렸고 시각을 바꾸는 테스트로 규칙별로 확인했다. TLA+ 모델 검사는 아직 안 했다.

`feat/266-upload-sweeper` 와는 `git merge-tree` 로 `main.py` 가 충돌 없이 합쳐지는 것을 확인했다. `feature/317-bot-reminder-dm` 은 임시 트리에 합쳐 sqlite 913 passed 를 확인했다(이번 수정 전 기준).

## 다음

- 운영 서버에 `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` 를 넣어야 푸시가 나간다. 없으면 웹 안 알림만 쌓인다
- FE 요청: 서비스 워커, 구독, 알림 목록과 배지, 자동 막힘 표시와 풀기 버튼
- 답장 판정이 붙으면 대화 전체를 응답으로 보는 규칙을 태스크 단위로 바꾼다
- 첫 DM 소개 틀이 머지되면 `reminder_sent` 푸시 미리보기가 인사말 줄로 나가므로 문구를 다시 본다
