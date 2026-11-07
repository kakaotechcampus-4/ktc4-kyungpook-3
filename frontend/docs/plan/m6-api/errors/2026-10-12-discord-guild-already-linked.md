# 이미 연결된 Discord 서버를 고르면 이유 없이 실패로만 보임

- 구분: BE 요청 후보
- 상태: 미요청. 원인은 사용자 확인으로 추정했고, 서버 로그의 `reason=`은 보지 않았다.

## 현상

배포 주소에서 새 테스트 워크스페이스에 Discord를 연결했다. Discord가 정상 `code`와 서버 ID(`guild_id`)를 돌려줬지만, 서버는 `oauth_result=failed`로 돌려보냈다(2026-10-12 13:01:53, 13:02:29 UTC). 화면에는 「연결하지 못했어요. 다시 시도하거나 건너뛸 수 있어요.」만 보였다.

## 원인

- 서버는 Discord 서버 하나를 워크스페이스 하나에만 연결한다. 다른 워크스페이스에 이미 연결된 서버면 `guild_already_linked`로 실패시킨다(`backend/app/api/integrations.py`의 `discord_oauth_callback`).
- 사용자가 고른 서버는 이전에 배포 사이트에서 다른 워크스페이스에 연결한 서버와 같았다.
- 같은 위치에서 코드상 남는 다른 실패 이유는 `token_exchange`(토큰 교환 실패)와 `concurrent_connect`(동시 연결)다. 사용자 확인에 따라 `guild_already_linked`로 판단했다.

규칙 자체는 의도된 동작이다. 봇이 녹음한 회의를 넣을 공간을 서버 ID로 정한다.

## 요청 후보

- 서버가 복귀 주소에 실패 이유를 싣는다(예: `oauth_reason=guild_already_linked`). 그러면 프론트가 「이 Discord 서버는 이미 다른 워크스페이스에 연결돼 있어요」처럼 안내할 수 있다.
- 지금 실패 이유는 서버 로그(`Discord 연결 callback result=failed reason=...`)에만 남는다.
