# 디스코드 채팅 자동 폴링

- 날짜: 2026-11-04
- 이슈: 없음
- PR: (생성 예정)
- 브랜치: feature/chat-auto-poll
- 작성자: 윤지민 (Claude Code)

## 한 일

- BE: `MeetingSource.CHAT`, `POST /meetings` 의 선택 `started_at`, `sources` 의 chat 허용(14일), `GET /workspaces/{id}/chat-cursor`, chat 회의 create gate AUTO→REVIEW(HOLD 유지), 승인 이력 출처 `chat`, 업로드 가드에서 chat 제외. 계약 문서도 갱신
- judge: 이전 채팅을 번호 없는 `(이전)` 줄로 참고 문맥에 넣고, 근거 메시지 작성일(KST)로 상대 날짜를 푼다
- `capture/chat_poll.py` 재작성: BE 커서부터 읽기, 한 번에 첫 메시지부터 14일까지, 문맥 30개, 새 메시지 없으면 종료, 실패 시 회의를 fail 로 닫고 exit 1, `--dry-run` 만 남김
- 배포: `ai/deploy/systemd/mm-chat-poll.service`(oneshot), `mm-chat-poll.timer`(매일 09:00 KST)
- 문서: 결정 기록 [0042](2026-11-04-0042-chat-daily-poll-as-chat-meeting.md), [chat-poll TODO](2026-10-13-chat-poll.md) 갱신, `ai/CLAUDE.md`

## 왜

[검증 스크립트](2026-10-13-chat-poll.md)는 손으로 돌리고 BE 에 넘기지 않았다. 채팅이 운영에서 주기적으로 판단 경로에 들어가게 한다. 선택과 근거는 [결정 기록 0042](2026-11-04-0042-chat-daily-poll-as-chat-meeting.md).

## 결과

테스트는 스텁으로 했고 실제 LLM·Discord·BE 호출은 하지 않았다. 최종 테스트 결과는 PR 에 적는다. `systemd-analyze` 는 Windows 에서 돌리지 못해 유닛은 기존 `mm-worker.service` 형식과 대조만 했다. 실서버에서 타이머를 켜 본 적은 없다.

## 다음

- [ ] FE: 채팅 회의 표시(출처 chat 인 회의·`started_at`). FE 담당에게 이슈로 넘긴다
- [ ] BE 담당 리뷰: BE 와 계약 변경이 이 PR 에 들어 있다(회의 출처, `started_at`, chat-cursor, create gate, 이력 출처)
- [ ] 서버에 타이머 설치·enable 후 `systemctl list-timers` 와 첫 실행 확인
- 미룸: 웹에서 시각 설정, 여러 채널, 늦게 달린 리액션, 지난 회의록 원문 문맥
