# 채팅 폴링을 BE 가 알려 준 워크스페이스별 채널로 돌리다

- 날짜: 2026-11-06
- 이슈: BE #428, FE #429
- PR: #431
- 브랜치: feature/chat-channel-per-workspace

## 한 일

- `BeClient.chat_channels()` 가 `GET /bot/chat-channels` 를 부른다.
- `poll_all` 이 목록 항목마다 `DiscordReader(DISCORD_BOT_TOKEN, channel_id)` 로 기존 poll 을 돈다. 시도 기록은 `runs/chat_poll_attempt_<workspace_id>.json`.
- 디스코드 403/404 는 그 워크스페이스를 건너뛴다(경고, 종료 코드 0). 다른 실패는 종료 코드 1.
- CLI 는 `python -m capture.chat_poll [--workspace ID] [--dry-run]`. `CHAT_POLL_BOT_TOKEN`·`DISCORD_CHANNEL_ID`·`--channel` 을 없앴다.
- `.env.example`, systemd 서비스(`TimeoutStartSec=6h`), `ai/CLAUDE.md`, realtime 주석을 맞췄다. backend-ai 계약은 develop 의 #432 절을 그대로 쓴다(이 PR 은 바꾸지 않는다).

## 왜

선택지와 이유는 [0046](2026-11-06-0046-chat-channels-from-be-per-workspace.md).

## 운영 영향

- BE #432(목록 API)는 2026-11-06 머지됐다. 배포 순서는 BE 배포, PM 이 채널 켬, AI 전환 순이다. 켜기 전에 AI 가 전환하면 수집이 멈춘다.
- 옛 `runs/chat_poll_attempt.json` 은 더 읽지 않는 고아 파일이다. 지워도 된다.
- 서버 `.env` 에 남은 `CHAT_POLL_BOT_TOKEN`·`DISCORD_CHANNEL_ID` 는 코드가 읽지 않아 무해하다.
- 포털에서 봇의 Message Content Intent 를 켜야 한다.

## 다음

PR 을 ready 로 바꾼다.

## 2026-11-07 추가: #432 리뷰 후속

- `poll_all` 이 워크스페이스마다 읽기 직전에 `chat_channels()` 를 다시 받는다. 목록에 없으면 건너뛰고(종료 코드 0), 재조회 실패는 그 워크스페이스 실패(1)다. 첫 워크스페이스와 `--dry-run` 도 다시 받는다. 근거는 [0046](2026-11-06-0046-chat-channels-from-be-per-workspace.md).
- develop 을 merge 해 계약 중복 절을 없앴다. 계약 문서는 develop 과 차이가 없다.
