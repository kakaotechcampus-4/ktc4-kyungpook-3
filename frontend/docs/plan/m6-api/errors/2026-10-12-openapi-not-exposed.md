# 배포 주소에서 Swagger·OpenAPI를 볼 수 없음

- 구분: BE 요청 후보
- 상태: 미요청. 이번 대조는 배포 커밋 코드로 만든 명세로 대신했다.

## 현상

배포 주소의 `/docs`, `/redoc`, `/openapi.json`이 Swagger가 아니라 프론트 화면(`<title>frontend</title>`)을 응답한다. 백엔드 `/health`도 같다.

## 원인

- 백엔드는 FastAPI 기본값대로 이 경로들을 `/api/v1` 밖(루트)에 둔다(`backend/app/main.py`). 백엔드 문서는 엔드포인트별 스키마의 기준을 서버 `/docs`로 정해 두었다(`backend/docs/README.md`).
- 배포 서버 앞의 Caddy는 `/api/*`만 백엔드로 보내고, 나머지는 프론트 정적 파일로 보낸다.

## 대신 쓴 방법

GitHub Actions의 마지막 배포 성공 커밋(`a1e623b`)을 확인하고, 그 커밋의 백엔드 앱에서 `app.openapi()`로 명세를 만들었다(OpenAPI 3.1, 경로 40개, 스키마 92개). 배포 서버가 실제로 같은 명세를 내는지는 직접 확인하지 못했다.

## 요청 후보

- Caddy에서 `/docs`·`/openapi.json`을 백엔드로 보내거나, FastAPI 문서 경로를 `/api/v1/docs` 등 `/api` 아래로 옮긴다.
- 공개 범위(운영에서 Swagger를 열어 둘지)는 BE가 정한다.
