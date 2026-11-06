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
   - 음성 봇 하나가 chat_poll 도 한다 (채택). 사용자 단계가 음성과 같아지고, 이미 연결한 서버는 재초대가 필요 없다(디스코드 연결 OAuth 가 VIEW_CHANNEL·READ_MESSAGE_HISTORY 를 이미 준다). `DISCORD_BOT_TOKEN` 을 쓴다
   - 채팅 전용 별도 봇(`CHAT_POLL_BOT_TOKEN`): 웹에 초대 버튼이 하나 더 생기고 PM 이 두 번 초대해야 해서 택하지 않았다
2. 채널 수
   - 워크스페이스당 하나, BE 목록 `{workspace_id, guild_id, channel_id}` (채택). 나중에 넓혀도 데이터가 깨지지 않는다
   - 여러 개: 커서와 채팅 회의 구조를 채널 단위로 바꿔야 해서 택하지 않았다
3. 채널을 정하는 곳
   - 웹 설정 화면, PM 만 (채택)
   - 온보딩: 화면이 두 곳이 되어 택하지 않았다
   - 슬래시 명령: 봇에 명령 처리가 더 필요하고 웹에서 상태를 보기 어려워 택하지 않았다
4. 고지
   - 화면 안내 + 봇이 채널에 공지 한 번(켤 때·끌 때) (채택)
   - 화면 안내만: 팀원이 모르는 채로 수집될 수 있어 택하지 않았다
   - 팀원 개별 동의: 동의 상태·화면·필터가 필요해 범위가 커서 택하지 않았다
5. 공지 주체
   - BE 가 저장하는 즉시 공지 (채택). 공지 시각과 수집 범위가 맞는다
   - AI 가 다음 09:00 실행 때 공지: 저장부터 공지 사이의 대화가 공지 없이 수집 범위에 들어가서 택하지 않았다
6. 읽기 시작점
   - 지금 방식, 안 B: 처음 24시간, 이후 커서부터 (사용자가 선택)
   - 안 A(켠 시각 이후만): 추천안이었으나 사용자가 택하지 않았다

## 선택과 이유

- 채널은 BE 목록 `GET /bot/chat-channels`(X-Service-Token, 제안)이 알려 준다. 목록이 `workspace_id` 를 주므로 chat_poll 은 `guild_workspace` 를 부르지 않는다(녹음 경로는 계속 쓴다).
- 워크스페이스마다 기존 poll 흐름(커서·14일·문맥 30·채팅 회의·fail_meeting·시도 기록)을 그대로 돈다. 순차 실행이고 워크스페이스마다 DiscordReader 를 새로 열고 닫는다.
- 한 워크스페이스가 실패(예외 포함)해도 다음으로 넘어가고 종료 코드는 1이다. 목록이 비면 0이다.
- 디스코드 403/404 는 `ChannelUnreadable` 로 그 워크스페이스만 건너뛰고 stderr 경고를 남긴다. 종료 코드에 세지 않는다(0). 건너뛴 실행도 시작할 때 시도 기록을 남기므로(지우지 않음) 다음 날 "N번째 시도" 경고가 남는다.
- 시도 기록은 `runs/chat_poll_attempt_<workspace_id>.json`. CLI 는 `--workspace ID`(목록에 없으면 exit 1)와 `--dry-run`. `CHAT_POLL_BOT_TOKEN`·`DISCORD_CHANNEL_ID`·`--channel` 은 없앴다.
- systemd `TimeoutStartSec=6h`. 순차라 전체 합을 제한하는 값이고, 멈춘 실행이 다음 날을 막지 않으면 되므로 24시간 미만이면 된다. 워크스페이스마다 걸린 시간을 로그 한 줄로 남긴다.

## 장단점과 감수한 제약

- BE #428 이 목록 API 를 구현하기 전에는 배포할 수 없다.
- 순차라 워크스페이스가 늘면 한 번의 실행이 길어진다.
- 음성 봇에 Message Content Intent 가 필요하고, 토큰이 유출되면 영향이 크다. 포털에서 켠다(코드는 요청하지 않는다).
- 처음 켜면 켜기 전 24시간, 다시 켜면 꺼져 있던 기간(최대 14일씩)도 읽는다.
- 운영 중 채널을 못 읽으면 그 워크스페이스는 건너뛰고 로그만 남긴다. PM 화면 표시는 나중이다.
- 채널은 워크스페이스당 하나다.

## 영향 범위와 재검토 조건

- 바뀐 곳: `ai/capture/chat_poll.py`, `ai/capture/handoff.py`(`BeClient.chat_channels`), `ai/deploy/systemd/mm-chat-poll.service`, `ai/.env.example`, `ai/shared/config.py`(필드 2개 삭제), realtime 주석 2곳(`ai/capture/realtime/adapter.py`, `run.py`), [backend-ai 계약](../../../../backend/docs/contracts/backend-ai-contract.md).
- 이 기록이 정한 것 중 BE 몫은 [#428](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/428), FE 몫은 [#429](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/429)다.
  - BE #428: 채널 설정 저장 위치, 저장 때 봇이 읽을 수 있는지 확인, 저장 즉시 채널 공지(켤 때·끌 때), 디스코드 연결 해제 시 채널 설정 삭제, `GET /bot/chat-channels`.
  - FE #429: 웹 설정 화면(PM 만)과 화면 안내.
- 재검토: 워크스페이스당 채널이 여럿 필요할 때, 워크스페이스 수가 늘어 순차 실행이 너무 길어질 때, 채팅 수집을 켠 시각부터 읽어야 할 때.

## 근거와 관련 문서

- [진행 로그](2026-11-06-chat-channel-per-workspace.md), [0042](2026-11-04-0042-chat-daily-poll-as-chat-meeting.md)
- 근거: BE #428, FE #429 이슈 본문
