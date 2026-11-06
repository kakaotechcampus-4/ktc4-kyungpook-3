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
- `.env.example`, systemd 서비스(`TimeoutStartSec=6h`), `ai/CLAUDE.md`, backend-ai 계약(`GET /bot/chat-channels` 제안), realtime 주석을 맞췄다.

## 왜

선택지와 이유는 [0046](2026-11-06-0046-chat-channels-from-be-per-workspace.md).

## 운영 영향

- BE #428 머지 전에는 배포하지 않는다. 목록 API 가 없으면 chat_poll 이 돌지 못한다.
- 옛 `runs/chat_poll_attempt.json` 은 더 읽지 않는 고아 파일이다. 지워도 된다.
- 서버 `.env` 에 남은 `CHAT_POLL_BOT_TOKEN`·`DISCORD_CHANNEL_ID` 는 코드가 읽지 않아 무해하다.
- 포털에서 봇의 Message Content Intent 를 켜야 한다.

## 다음

BE #428 머지 뒤 PR 을 ready 로 바꾼다.
