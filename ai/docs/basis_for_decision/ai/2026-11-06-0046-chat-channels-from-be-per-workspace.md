# 채팅 폴링은 BE 가 알려 준 채널마다 워크스페이스별로 돈다

- 기록일: 2026-11-06
- 관련 이슈: BE #428, FE #429 (앞선 구현은 PR #378, [0042](2026-11-04-0042-chat-daily-poll-as-chat-meeting.md))

## 문제와 제약

- 0042 의 채팅 폴링은 테스트 봇 토큰(`CHAT_POLL_BOT_TOKEN`)과 채널 하나(`DISCORD_CHANNEL_ID`)를 `.env` 로 받아 워크스페이스 하나만 읽었다. 운영에서는 워크스페이스마다 채널이 다르다.
- 채널을 누가 어떻게 정하는지, 봇을 몇 개 둘지, 채널 안내를 누가 하는지를 정해야 했다.
- 구현 중이다. BE `GET /bot/chat-channels` 는 BE #428 이 구현하기 전이라 제안 상태이고, 검증 완료가 아니다.

## 실제 검토한 선택지

출처: 사용자와 설계 확정(2026-11-06, grilling). 아래는 그때 함께 비교한 것이다.

1. 봇
   - 음성 봇 하나가 chat_poll 도 한다 (채택). `DISCORD_BOT_TOKEN` 을 쓴다
   - 채팅 전용 별도 봇(`CHAT_POLL_BOT_TOKEN`): 토큰과 서버 초대를 따로 관리해야 해 택하지 않았다
2. 채널 수
   - 워크스페이스마다 여러 채널: 택하지 않았다
   - 워크스페이스마다 채널 하나, BE 목록 `{workspace_id, guild_id, channel_id}` (채택)
3. 채널을 정하는 방법
   - 웹 설정 화면 (채택, FE #429)
   - 온보딩 중 선택, 디스코드 슬래시 명령: 택하지 않았다
4. 채널 등록 공지
   - BE 가 등록 즉시 공지: 택하지 않았다
   - AI 쪽에서 공지: 택하지 않았다
5. 읽기 시작점
   - 채팅 수집을 켠 시각부터 읽기: 택하지 않았다
   - 지금 방식(B) 그대로: 커서가 없으면 처음 24시간, 이후 커서부터 (채택)

## 선택과 이유

- 채널은 BE 목록 `GET /bot/chat-channels`(X-Service-Token, 제안)이 알려 준다. 목록이 `workspace_id` 를 주므로 chat_poll 은 `guild_workspace` 를 부르지 않는다(녹음 경로는 계속 쓴다).
- 워크스페이스마다 기존 poll 흐름(커서·14일·문맥 30·채팅 회의·fail_meeting·시도 기록)을 그대로 돈다. 순차 실행이고 워크스페이스마다 DiscordReader 를 새로 열고 닫는다.
- 한 워크스페이스가 실패(예외 포함)해도 다음으로 넘어가고 종료 코드는 1이다. 목록이 비면 0이다.
- 디스코드 403/404 는 `ChannelUnreadable` 로 그 워크스페이스만 건너뛰고 stderr 경고를 남긴다. 종료 코드에 세지 않는다(0). 시도 기록은 건드리지 않아 다음 날 "N번째 시도" 경고가 남는다.
- 시도 기록은 `runs/chat_poll_attempt_<workspace_id>.json`. CLI 는 `--workspace ID`(목록에 없으면 exit 1)와 `--dry-run`. `CHAT_POLL_BOT_TOKEN`·`DISCORD_CHANNEL_ID`·`--channel` 은 없앴다.
- systemd `TimeoutStartSec=6h`. 순차라 전체 합을 제한하는 값이고, 멈춘 실행이 다음 날을 막지 않으면 되므로 24시간 미만이면 된다. 워크스페이스마다 걸린 시간을 로그 한 줄로 남긴다.

## 장단점과 감수한 제약

- BE #428 이 목록 API 를 구현하기 전에는 배포할 수 없다.
- 순차라 워크스페이스가 늘면 한 번의 실행이 길어진다.
- Message Content Intent 는 포털에서 켜야 한다(코드는 요청하지 않는다).
- 채널은 워크스페이스당 하나다.

## 영향 범위와 재검토 조건

- 바뀐 곳: `ai/capture/chat_poll.py`, `ai/capture/handoff.py`(`BeClient.chat_channels`), `ai/deploy/systemd/mm-chat-poll.service`, `ai/.env.example`, [backend-ai 계약](../../../../backend/docs/contracts/backend-ai-contract.md).
- 재검토: 워크스페이스당 채널이 여럿 필요할 때, 워크스페이스 수가 늘어 순차 실행이 너무 길어질 때, 채팅 수집을 켠 시각부터 읽어야 할 때.

## 근거와 관련 문서

- [진행 로그](2026-11-06-chat-channel-per-workspace.md), [0042](2026-11-04-0042-chat-daily-poll-as-chat-meeting.md)
- 합의 내용: `.superpowers/specs/2026-11-06-chat-channel-per-workspace.md`
