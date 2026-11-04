# 디스코드 채팅을 하루 한 번 읽어 채팅 회의 하나로 넘긴다

- 기록일: 2026-11-04
- 관련 마일스톤: 확인 필요 (이슈 없음, 브랜치 feature/chat-auto-poll)

## 문제와 제약

- [채팅 폴링 검증 스크립트](2026-10-13-chat-poll.md)는 손으로 한 번 돌리고 BE 에는 인계하지 않았다. 운영에서는 사람이 돌리지 않아도 채팅이 주기적으로 판단 경로에 들어가야 한다.
- BE 는 회의 단위로 항목을 받는다. 채팅에는 회의가 없으므로 인계 단위, 읽은 위치(커서), 날짜 기준을 정해야 했다.
- 채팅 판단은 아직 품질을 더 봐야 해서 PM 이 거치지 않고 Task 가 만들어지면 안 된다(Q2).
- 지난 회의록 원문은 읽지 않는다(Q1). BE 수정도 같은 PR 에 넣는다(Q11).

## 실제 검토한 선택지

2026-11-04 grilling 에서 사용자와 합의했다(합의 질문 Q1~Q16). 선택지별 장단점은 그때 설계 초안에서 나온 것만 적는다. 기록이 없는 대안은 "대안 검토 기록 없음"으로 둔다.

1. 실행 주체
   - systemd timer + oneshot 으로 `python -m capture.chat_poll` (채택)
   - 워커 루프나 봇 안에서 돌리기: 대안 검토 기록 없음. 하루 한 번 고정 시각(Q3·Q5·Q7)이라 상주 프로세스에 넣을 이유가 없고, 워커·봇은 녹음 처리에 쓰인다
2. 인계 단위
   - 1회 폴링분 = source=chat 회의 하나 (채택, Q6). 새 메시지가 없으면 회의를 만들지 않는다
   - 하루치를 한 회의에 덧붙이기, 별도 채팅 API: 대안 검토 기록 없음. 회의 하나로 두면 같은 judge 파이프라인·승인 흐름을 그대로 쓴다(Q1)
3. 읽은 위치
   - BE 가 가진 가장 최근 done chat 회의에서 계산 (채택, Q9). `GET /workspaces/{id}/chat-cursor` 가 `{meeting_id, last_message_at = started_at + duration_ms}` 또는 null 을 준다
   - 메시지 ID 칼럼을 BE 에 추가, 로컬 파일: 대안 검토 기록 없음. 채택안은 BE 마이그레이션이 없고(MeetingSource.CHAT 도 마이그레이션 없음), 서버를 옮겨도 위치가 따라온다
4. 이전 대화 문맥
   - 이전 폴링 마지막 30개(기본)를 참고 문맥으로만 넣는다 (채택, Q4). 1단계 프롬프트에 번호 없는 `(이전) 이름: 본문` 줄로 넣어, 번호가 붙은 새 메시지만 evidence 가 된다
   - 지난 회의록 원문을 문맥으로: 미룸(Q1)
5. 승인
   - chat 회의의 create 는 AUTO 를 REVIEW 로 바꾸고 HOLD 는 그대로 (채택, Q2·Q12)
6. 날짜 기준
   - 근거 메시지의 작성일(KST) (채택, Q8). `dates: dict[int, date]`(seq → 작성일)를 넘기고 `run` 은 `dates.get(finding.seq, today)` 를 쓴다
   - 실행한 날: [검증 스크립트 결과](2026-10-13-chat-poll.md)에서 9/8 메시지의 "이번 주"가 10/18 로 나온 문제

## 선택과 이유

- 하루 1회 09:00 KST 고정, systemd timer 가 oneshot 서비스를 띄운다. 웹에서 시각을 바꾸는 설정은 미뤘다. 타이머는 `Persistent=true` 라 서버가 꺼져 있었어도 켜진 뒤 한 번 돈다.
- 첫 실행(커서 없음)은 최근 24시간(Q13). 그 뒤는 커서 이후 전부 따라잡되 한 번에 첫 새 메시지부터 최대 14일까지만 보낸다. 메시지 발화 offset 을 BE 가 14일까지만 받기 때문이다(`sources` 상한 14일, 회의 자체는 24시간 유지). 14일을 넘는 나머지는 다음 실행이 이어 읽는다.
- 커서는 마지막 새 메시지 시각이 되도록 메시지마다 end = start 로 보낸다. 같은 메시지를 두 번 읽지 않아 제안이 중복되지 않는다.
- 회의를 만든 뒤 실패하면 fail 로 닫는다(exit 1). failed 회의는 커서에 들지 않아 다음 실행이 같은 구간을 다시 읽는다.
- 항목이 0건이어도 extraction 은 만든다. 커서와 이력이 남는다.
- 승인 이력의 출처는 `ChangeSource.CHAT` (create·update). 업로드 가드에서 chat 회의는 제외한다(Q15).
- CLI 는 `--dry-run` 만 남기고 `--minutes`·`--tasks` 를 뺐다(Q14). 채널은 1개(Q10).

## 장단점과 감수한 제약

- BE 변경이 따라온다(회의 출처 chat, `started_at`, chat-cursor, create gate, 이력 출처). 같은 PR 에 넣었으므로 BE 담당 리뷰가 필요하다.
- 하루 한 번이라 채팅이 최대 하루 늦게 반영된다.
- 읽은 뒤 달린 리액션은 놓친다. 지난 회의록 원문 문맥은 쓰지 않는다. 채널은 하나만 읽는다.
- 문맥 메시지를 읽기 위해 Discord history 호출이 한 번 더 든다.

## 영향 범위와 재검토 조건

- 바뀐 곳: `ai/capture/chat_poll.py`, `ai/judge/`(문맥·날짜), `ai/deploy/systemd/mm-chat-poll.*`, BE 회의·승인, [backend-ai 계약](../../../../backend/docs/contracts/backend-ai-contract.md).
- 재검토: 하루 한 번이 길다는 요청이 나올 때, 채널을 여럿 읽어야 할 때, chat 항목의 승인 품질이 충분해져 AUTO 를 열고 싶을 때, 14일 넘게 밀리는 일이 잦을 때.

## 근거와 관련 문서

- [진행 로그](2026-11-04-chat-auto-poll.md), [이전 검증 기록](2026-10-13-chat-poll.md)
- 합의 내용: `.superpowers/specs/2026-11-04-chat-auto-poll.md` (Q1~Q16)
- [mm-chat-poll.service](../../../deploy/systemd/mm-chat-poll.service), [mm-chat-poll.timer](../../../deploy/systemd/mm-chat-poll.timer)
