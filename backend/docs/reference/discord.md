# Discord 연동

[Backend README](../../README.md)로 돌아가기

팀 Discord 서버 연결과, 그 서버를 쓰는 사용자 목록·채팅 수집·봇용 API를 적는다.

## Discord 연결 (봇 초대 OAuth)

PM이 온보딩에서 Discord를 연결하면 녹음 봇이 팀 서버에 들어가고, 서버 ID가 `Integration` 행(`provider="discord"`, `provider_channel_id`=서버 ID)에 저장된다(#171). 이어지는 팀원 매핑 단계는 그 서버의 실제 사용자 목록으로 디스코드 계정과 팀원을 잇고, 봇은 이어진 계정으로 녹음한 화자를 팀원으로 찾는다(1인칭 담당자, 화자 이름).

1. 프론트가 `GET /api/v1/workspaces/{workspace_id}/integrations/discord/start?state=<돌아올 앱 경로>`로 이동한다. PM만 통과하고, 서명한 state와 짝 쿠키(`discord_oauth_nonce`)를 만들어 Discord 허용 화면으로 보낸다.
2. PM이 봇을 들일 서버를 고르고 허용한다.
3. Discord가 `GET /api/v1/integrations/discord/callback`으로 돌려보낸다. state·짝 쿠키·로그인 사용자·PM 여부를 확인하고, code를 토큰으로 바꿔 Discord가 확인해 준 서버 ID를 저장한 뒤 `<앱 경로>?oauth=discord&oauth_result=success`로 보낸다.

scope는 `bot applications.commands identify`다. 봇 초대 scope만 요청하면 Discord가 callback 없이 끝나서 `identify`를 더해 code grant로 잇는다(Discord 문서 OAuth2 "Advanced Bot Authorization"). 토큰 응답에 봇을 들인 서버(`guild`)가 담긴다. 받은 사용자 토큰은 쓰지 않아 저장하지 않는다.

- 결과는 항상 앱 화면으로의 302다. `oauth_result`는 `success` · `cancelled`(허용 화면에서 취소) · `failed`이고 JSON 오류를 보이지 않는다.
- 주소의 `guild_id`는 바꿀 수 있어서 믿지 않는다. 토큰 응답의 서버 ID와 다르면 `failed`다.
- 다른 워크스페이스에 이미 연결된 서버면 `failed`다(DB 부분 유일 인덱스 `uq_integration_discord_guild`도 막는다). 같은 워크스페이스에서 다시 연결하면 서버 ID를 바꾼다.
- 봇 권한은 채널 보기, 메시지·링크·파일 보내기, 메시지 기록 보기, 음성 채널 접속이다(`discord_oauth.DEFAULT_BOT_PERMISSIONS`). `DISCORD_BOT_PERMISSIONS`로 바꿀 수 있다.
- 보안은 Notion 연결과 같다. state는 제공자까지 서명해서 Notion 연결의 state로는 통과하지 못한다.
- 봇은 회의마다 [서버로 워크스페이스 찾기](#서버로-워크스페이스-찾기)로 워크스페이스를 정한다(AI #199). `ai/.env`에는 `BE_WORKSPACE_ID`가 필요 없다.

## Discord 서버 사용자 목록

`GET /api/v1/workspaces/{workspace_id}/discord/members`는 소속이면 누구나 부른다. 연결한 서버의 사용자(봇 포함)를 `{discord_user_id, username, display_name, avatar_url, is_bot}`로 주고, 봇은 프론트가 걸러 낸다.

- 봇 토큰으로 Discord REST API `GET /guilds/{guild_id}/members`를 1000명씩 이어 부른다(`app/services/discord.py`).
- 표시 이름은 서버 별명 → 계정 표시 이름(global_name) → 사용자 이름 순이다. 녹음 봇이 화자 이름을 정하는 순서와 같다.
- 아바타는 서버 전용 아바타 → 계정 아바타 → 없으면 `null`이다.
- 연결 행이 없거나 서버 ID가 비어 있으면 409 `INTEGRATION_NOT_CONNECTED`다.
- 봇 토큰이 없거나 Discord가 목록을 주지 않으면 502 `DISCORD_API_FAILED`(`details.status`)다. 401은 봇 토큰, 403은 Server Members Intent·권한, 404는 봇이 서버에 없는 경우가 많다.

## 채팅 수집 채널

PM이 디스코드 서버의 텍스트 채널 하나를 골라 두면 녹음 봇이 매일 그 채널 대화를 읽어 task 제안에 쓴다(#428). 채널은 디스코드 `Integration` 행의 `chat_channel_id`·`chat_channel_name`에 저장하고, 연결 행을 지우면 같이 사라진다. 결정 근거는 [채팅 수집 채널 설정 결정 기록](../plan/m4/basis-for-decision/2026-11-06-discord-chat-channel-setting.md)에 있다.

| 경로 | 권한 | 동작 |
|---|---|---|
| `GET /workspaces/{workspace_id}/discord/channels` | PM | 고를 수 있는 채널 `{items: [{channel_id, name}], total}` |
| `PUT /workspaces/{workspace_id}/integrations/discord/chat-channel` | PM | 요청 `{channel_id}` → `{channel_id, name}`. 채널을 확인하고 켬 공지를 보낸 뒤 저장 |
| `DELETE /workspaces/{workspace_id}/integrations/discord/chat-channel` | PM | 수집을 끈다. 200 `{off_notice_sent}` |
| `GET /bot/chat-channels` | 서비스 토큰 | 봇이 읽을 대상 `{items: [{workspace_id, guild_id, channel_id}]}`, `workspace_id` 순. 서버와 채널이 모두 있는 연결만 준다 |

연결 조회(`GET /workspaces/{workspace_id}/integrations`)의 `discord`에는 `chat_channel: {channel_id, name}`이 있고(꺼져 있거나 연결 전이면 `null`) 소속이면 누구나 본다.

채널 목록은 일반 텍스트 채널(type 0)만 준다. 공지·포럼·음성 채팅 채널은 뺀다. 순서는 카테고리 없는 채널, 그다음 카테고리 position 순이고, 같은 카테고리 안은 채널 position, 같으면 id 순이다.

### 저장과 공지

PUT은 연결 행을 `FOR UPDATE`로 잠근 채 아래를 차례로 하고, 모두 성공하면 두 열을 저장·커밋한다. 하나라도 실패하면 아무것도 저장하지 않는다.

1. 서버의 텍스트 채널인지 확인한다.
2. 읽기 확인(`GET /channels/{id}/messages?limit=1`)을 한다.
3. 켬 공지를 보낸다. 보내지 못하면 저장 실패다.

- 같은 워크스페이스의 동시 저장은 순서대로 처리되고, 그동안 연결 해제도 기다린다. Discord 호출마다 5초 제한이 있고 세 번 부르므로 대략 15초 안팎 걸릴 수 있다(합계 상한은 아니다).
- `GET /channels/{id}/messages?limit=1`은 VIEW_CHANNEL만 있고 READ_MESSAGE_HISTORY가 없으면 403이 아니라 200 빈 목록을 줄 수 있어(Discord 동작, 확인 필요) 읽을 수 없는 채널도 통과할 수 있다.
- 같은 채널을 다시 저장하면 Discord를 부르지 않고 현재 값을 200으로 준다. 채널 이름은 저장한 시점의 값이다.
- 켬 공지는 "이 채널 대화는 매일 09:00(KST)에 Manager's Manager 가 읽어 task 추가·수정 제안에 씁니다. 제안은 PM 승인 뒤에만 반영됩니다."이고 멘션 알림은 보내지 않는다(`allowed_mentions.parse: []`).
- 끔 공지 "이 채널 대화 수집을 껐습니다."는 채널 해제, 다른 채널로 변경(옛 채널), 디스코드 연결 해제 때 DB 커밋 뒤 시도한다. 실패해도 해제·변경·연결 해제는 성공이다.
- `DELETE`는 204가 아니라 200 `{off_notice_sent}`다. 공지를 보냈으면 `true`, 이미 꺼져 있거나 연결 행이 없으면 공지 없이 `false`다.
- `DELETE .../integrations/discord`(204 그대로)는 채팅 채널도 지우고 커밋 뒤 끔 공지를 시도한다. 다른 서버로 다시 연결하면 공지 없이 채널을 비우고(이전 서버의 채널은 의미가 없다), 같은 서버로 다시 연결하면 유지한다.

### 오류

| 상황 | 응답 |
|---|---|
| `channel_id`가 앞뒤 공백을 지운 숫자 1~20자가 아님 | 400 `INVALID_REQUEST` |
| 연결이 없음 | 409 `INTEGRATION_NOT_CONNECTED` |
| 서버의 텍스트 채널이 아님 | 404 `DISCORD_CHANNEL_NOT_FOUND` |
| 봇이 읽지 못함(403) | 409 `DISCORD_CHANNEL_NOT_ACCESSIBLE` `need: "read"` |
| 켬 공지를 보내지 못함(403) | 409 `DISCORD_CHANNEL_NOT_ACCESSIBLE` `need: "send"` |
| 봇 토큰이 없거나 그 밖의 Discord 실패(채널 목록 조회 실패 포함) | 502 `DISCORD_API_FAILED`(`details.status`, `details.reason`) |

채널 목록은 연결 확인이 먼저다. PUT은 봇 토큰 확인이 먼저라 토큰이 없으면 연결이 없어도 502 `DISCORD_API_FAILED`, `details.reason: "bot_token_missing"`이고, 같은 채널 재저장도 `DISCORD_BOT_TOKEN`이 없으면 502다.

## 서버로 워크스페이스 찾기

`GET /api/v1/integrations/discord/guilds/{guild_id}/workspace`는 녹음 봇용이다(#180). 봇이 `/record` 때 녹음하는 서버의 ID로 불러 회의를 보낼 워크스페이스를 정한다.

- 응답은 `{guild_id, workspace_id}`다. 한 서버는 한 워크스페이스에만 연결되므로(`uq_integration_discord_guild`) 결과는 하나다.
- 그 서버를 연결한 워크스페이스가 없으면(연결 해제 포함) 409 `INTEGRATION_NOT_CONNECTED`이고 `details`는 `{provider: "discord", guild_id}`다.
- 사용자 세션 대신 서비스 토큰(`X-Service-Token`)으로 막는다. 토큰이 없거나 틀리면 401 `UNAUTHENTICATED`이고, 워크스페이스 멤버의 세션도 토큰을 대신하지 못한다.

## 환경변수와 개발자 포털 설정

`.env.example`을 참고한다.

| 이름 | 값 |
|---|---|
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Discord 개발자 포털 → 앱 → OAuth2 |
| `DISCORD_REDIRECT_URI` | 프론트와 같은 주소의 callback. 로컬 `http://localhost:5173/api/v1/integrations/discord/callback`, 운영 `https://<서비스 주소>/api/v1/integrations/discord/callback` |
| `DISCORD_BOT_TOKEN` | 녹음 봇(`ai/.env`)과 같은 봇의 토큰. 서버 사용자 목록과 채팅 수집 채널의 채널 목록·읽기 확인·켬·끔 공지에 쓴다 |
| `OAUTH_STATE_SECRET` | Notion 연결과 같은 서명 키 |

Discord 개발자 포털에서는 다음을 설정한다.

- OAuth2 → Redirects에 `DISCORD_REDIRECT_URI`와 같은 값을 등록한다.
- Bot → Privileged Gateway Intents에서 Server Members Intent를 켠다(녹음 봇도 이미 쓴다).
- 채팅 수집을 쓰려면 Message Content Intent도 켠다(AI 담당이 켠다).

## 팀원 디스코드 연결 옮기기

`PATCH /api/v1/members/{member_id}`에 `{discord_user_id, move_discord_link: true}`를 보내면, 그 계정을 가진 같은 워크스페이스의 다른 활성 팀원의 연결을 풀고 이 팀원에 잇는다(#652). 응답은 이 팀원의 `MemberResponse`다.

- 한 트랜잭션이고, 두 팀원 행을 `member_id` 순서로 잠근다.
- 앞 팀원의 이름은 그대로이고 `discord_profile` 별칭은 연결 해제 때처럼 지운다.
- 플래그가 없거나 `false`면 409 `DISCORD_USER_ALREADY_MAPPED`다.

팀원에 계정을 이으면(`POST`의 `discord_user_id`, `PATCH`의 새 계정, 옮기기) 같은 트랜잭션에서 이 워크스페이스 회의의 `source` 중 `speaker_discord_user_id`가 그 계정인 행의 `member_id`를 이 팀원으로 바꾼다. 연결이 없던 발화와 삭제한 팀원에 붙어 있던 발화도 포함한다.

- 연결을 풀기만 하면 발화는 그대로다.
- 계정 탈퇴는 그 팀원 발화의 화자 계정을 지우므로 다시 붙지 않는다.
- 이미 저장된 요약 문서와 승인 카드 payload의 `evidence_speaker_member_id`는 바꾸지 않는다.

결정 근거는 [M1 결정 기록](../plan/m1/basis-for-decision/2026-11-10-discord-link-move-decision.md)에 있다.
