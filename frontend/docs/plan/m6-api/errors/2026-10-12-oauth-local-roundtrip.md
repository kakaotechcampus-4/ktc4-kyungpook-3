# 로컬 FE에서는 OAuth 왕복이 실패함

- 구분: 구성 제약
- 상태: 로컬 FE에서는 OAuth 검증을 보류한다. 사용자가 배포 주소에서 Discord·Notion 연결을 확인했다(2026-10-12, 수동).

## 현상

로컬 FE(`localhost:5173`, `API_PROXY_TARGET`으로 배포 백엔드에 연결)에서 Discord 연결을 시작하면, Discord 허용 뒤 배포 사이트의 온보딩 화면으로 돌아가고 「연결하지 못했어요」가 보인다.

## 원인

1. 연결 시작(`.../integrations/discord/start`)이 짝 쿠키 `discord_oauth_nonce`를 응답한다. 로컬에서 시작하면 이 쿠키는 `localhost`에 저장된다.
2. Discord는 등록된 redirect URI인 배포 주소의 callback(`https://managers-manager.duckdns.org/api/v1/integrations/discord/callback`)으로 돌아간다.
3. 배포 주소 요청에는 `localhost` 쿠키가 실리지 않는다. 서버는 짝 쿠키를 받지 못해 실패로 돌려보낸다(`backend/app/api/integrations.py`의 `_check_callback`, `nonce_mismatch`).
4. 서버는 복귀 주소를 경로만으로 만든다(`backend/app/services/oauth_state.py:148`). 그래서 브라우저는 callback이 온 배포 주소의 화면으로 이동한다. 로그인 세션도 배포 주소의 쿠키를 따로 쓴다.

근거: Chromium에서 로컬 시작 시도 뒤 `localhost`에 쓰이지 않은 `discord_oauth_nonce` 쿠키가 남은 것을 확인했다. 이 시도에서는 Discord 쪽 결과도 `error=access_denied`였다.

## 대응

- OAuth는 배포 주소에서 검증한다. 로컬 검증이 필요하면 BE에 개발용 redirect URI와 복귀 주소 설정을 요청한다.
- Notion도 같은 구조(짝 쿠키, 경로만 돌려주는 복귀 주소)라 같은 제약이 있다(코드 확인).
