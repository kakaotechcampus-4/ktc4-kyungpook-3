# 파일처럼 오래 보내는 응답은 보내기 전에 DB 세션을 닫는다

- 기록일: 2026-11-04 (PR #270 머지 뒤 발견, 수정 PR #333, 리뷰 권장으로 기록)
- 관련 마일스톤: M5

## 문제와 제약

- 원본 재생 `GET /meetings/{id}/audio`(#270)와 AI 녹음 다운로드 `GET /uploads/{id}/file` 은 DB 로 권한과 파일 위치를 확인한 뒤 `FileResponse` 로 디스크의 파일을 보낸다. 파일 전송에는 DB 가 필요 없다.
- `get_db` 는 `yield` 의존성이고, FastAPI 0.118 부터 그 정리(세션 닫기)는 응답을 다 보낸 뒤에 실행된다. `requirements.txt` 는 `fastapi>=0.115` 라 운영 이미지에는 최신이 깔린다(확인 당시 0.162.0).
- 그래서 파일을 보내는 동안 빌린 DB 연결이 `idle in transaction` 으로 묶인다. 브라우저 `<audio>` 는 재생하면서 조금씩 받으므로 요청이 오래 열려 있다.
- DB 연결 풀은 SQLAlchemy 기본값(5 + 추가 10 = 15)이고, 운영은 `--workers 1` 이라 웹 API·봇/AI API·Notion·임베딩 워커가 이 15개를 같이 쓴다. 바닥나면 DB 가 필요한 요청은 30초 기다린 뒤 `QueuePool limit ... reached` 로 실패한다.

## 실제 검토한 선택지

1. 라우터에서 확인이 끝나면 `FileResponse` 를 만들기 전에 `db.close()` 로 연결을 풀에 돌려준다.
2. `Depends(get_db, scope="function")`(FastAPI 0.121+)으로 의존성 정리를 함수가 끝날 때로 당긴다.

## 선택과 이유

- **1번을 골랐다.** 오래 보내는 응답은 지금 이 두 라우터뿐이고, 한 줄씩이면 된다. 2번은 `requirements.txt` 의 FastAPI 하한을 같이 올려야 하는데, 효과는 같다.
- 리뷰(PR #333)에서 두 라우터 모두 `db.close()` 뒤에 DB 를 쓰지 않고, `get_db` 에 commit 이 없고, 같은 세션을 쓰는 의존성(`get_current_user`·`require_pm`)이 `yield` 가 아니어서 일찍 닫아도 안전하다고 확인했다. 앱에서 `FileResponse` 를 쓰는 곳도 이 두 곳뿐이다.
- 앞으로 `FileResponse`·`StreamingResponse` 처럼 오래 보내는 응답을 새로 만들 때도 **보내기 전에 DB 세션을 닫는다.** 닫은 뒤에는 세션의 객체를 쓰지 않도록 필요한 값(파일 경로, Content-Type, 파일명)을 먼저 꺼내 둔다.

## 장단점과 감수한 제약

- 규칙이 코드 구조로 강제되지 않고 라우터마다 직접 지켜야 한다. 대신 두 라우터에 "보낼 때 트랜잭션이 없는지" 보는 테스트를 두어 되돌아가지 않게 했다.
- 권한 확인은 요청이 시작될 때 한 번이다. 재생 도중 권한이 사라져도 이미 받고 있는 요청은 끝까지 받는다. 수정 전에도 같았다.
- 테스트는 모든 요청이 DB 세션 하나를 같이 쓰므로, 이런 라우터를 부른 뒤에는 테스트가 들고 있던 객체가 세션에서 떨어진다. 필요한 ID 는 먼저 꺼내 둔다.

## 영향 범위와 재검토 조건

- 영향: [meetings.py](../../../../app/api/meetings.py) `get_meeting_audio`, [uploads.py](../../../../app/api/uploads.py) `download_upload`.
- 다시 볼 때: 오래 보내는 응답이 여러 곳으로 늘어나면 2번이나 공통 처리로 옮긴다. `get_db` 가 정리할 때 commit 하도록 바뀌거나, 확인 뒤에 DB 에 쓰는 라우터가 생기면 일찍 닫는 위치를 다시 정한다.

## 근거와 관련 문서

- 재현(2026-11-04, PR #333 본문): PostgreSQL 16 + 운영 `Dockerfile` 이미지 + Caddy(HTTPS) + 실제 Chromium 16개. PM 15명이 각자 자기 녹음을 재생하자 `idle in transaction` 15개, 16번째 PM 의 `/audio` 는 30.0초 뒤 500, Notion 동기화 워커는 `TimeoutError` 로 실패했다. 수정 뒤에는 연결 0개, 16번째도 바로 재생됐다.
- Chrome 은 첫 재생 요청을 약 95초(약 11.8MB 받을 때까지) 열어 두고 스스로 끊었고, 구간 이동 뒤의 새 요청은 10초 안에 연결이 풀렸다. 파일 형식·브라우저에 따라 달라질 수 있다.
- 테스트: `tests/api/test_speaker_assignment_api.py::test_audio_returns_the_db_connection_before_sending_the_file`, `tests/api/test_uploads_api.py::test_file_returns_the_db_connection_before_sending_the_file`. 수정 전 코드에서는 SQLite·PostgreSQL 모두 실패한다.
- 관련 결정: [화자 지정 흐름](2026-11-02-speaker-assignment-flow.md)
