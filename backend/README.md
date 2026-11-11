# Backend

회의 → 추출 → 매칭 → 게이트 → 승인 파이프라인의 백엔드다. 웹 화면과 AI 봇이 부르는 API, DB, Notion·Discord 연동을 맡는다.

| 항목 | 내용 |
|---|---|
| 스택 | Python 3.12, FastAPI, SQLAlchemy, Alembic |
| DB | PostgreSQL(pgvector 포함) |
| API 명세 | 서버의 `/docs`(Swagger). 코드에서 자동으로 만들어진다 |
| 배포 | EC2 한 대에 DB와 API를 Docker 컨테이너로 띄운다. [배포 안내](../deploy/README.md) |

## 목차

- [실행](#실행)
- [테스트와 린트](#테스트와-린트)
- [API 명세](#api-명세)
- [폴더 구조](#폴더-구조)
- [기능별 문서](#기능별-문서)
- [심사용 시드](#심사용-시드)
- [계약·계획·결과](#계약계획결과)

## 실행

로컬 DB는 Docker로 띄운다(Docker Desktop 필요).

```bash
uv venv --python 3.12 .venv
uv pip install -r requirements.lock -r requirements-dev.txt   # 운영 잠금 버전 + pytest, ruff
cp .env.example .env

docker compose up -d db         # PostgreSQL(pgvector 포함) 기동, 데이터는 mm-pgdata 볼륨에 남는다
./run.sh                        # alembic upgrade head + uvicorn --reload
```

서버는 `http://localhost:8000`에 뜬다.

| 상황 | 방법 |
|---|---|
| 접속 정보 | docker-compose.yml과 같은 `postgresql+psycopg://mm:mm@localhost:5432/mm`. `DATABASE_URL`을 주지 않으면 이 값이 기본값이다(`app/core/database.py`) |
| 5432 포트를 이미 쓰고 있다 | `POSTGRES_PORT=5433 docker compose up -d db`로 띄우고 `DATABASE_URL`의 포트도 같이 바꾼다 |
| DB를 비우고 다시 만든다 | `docker compose down -v` 후 다시 띄운다 |
| `run.sh` 없이 직접 띄운다 | `.env`를 읽지 않는다. `run.sh`가 `.env`를 읽어 alembic과 uvicorn에 환경변수로 넘긴다 |
| 예전 `mm.db` 파일이 남아 있다 | 지워도 된다. SQLite 시절 데이터와 마이그레이션은 이관(#98) 때 정리했다 |

운영 실행(Docker), 환경변수, 서버 안의 워커는 [운영과 의존성](docs/reference/operations.md)에 있다. `requirements.txt`를 고쳤다면 같은 문서의 [의존성 잠금](docs/reference/operations.md#의존성-잠금)을 따른다.

## 테스트와 린트

```bash
.venv/bin/python -m pytest
.venv/bin/python -m ruff check .     # 설정은 ruff.toml
```

- `pytest`는 기본 SQLite 변형과, `TEST_DATABASE_URL`이 있을 때의 PostgreSQL 변형을 구분한다.
- API 잠금·경합과 pgvector 검색의 PostgreSQL 검증에는 격리된 테스트 DB가 필요하다. 설정은 `tests/api/conftest.py`와 `tests/services/test_embedding_search_pg.py`를 확인한다.
- CI(`.github/workflows/backend-ci.yml`)는 네 가지를 돌린다.
  - ruff 린트
  - pytest
  - 빈 PostgreSQL에 `alembic upgrade head`·`alembic check`
  - 운영 이미지 빌드

> [!NOTE]
> DB가 없어서 건너뛴 검사를 통과로 세지 않는다.

## API 명세

| 경로 | 용도 |
|---|---|
| `/docs` | Swagger UI. 엔드포인트별 요청/응답 스키마를 보고 바로 호출해 볼 수 있다 |
| `/redoc` | ReDoc. 읽기 전용으로 훑어볼 때 |
| `/openapi.json` | 원본 OpenAPI 스펙(Postman 등으로 임포트할 때) |

**프론트엔드는 API 명세를 `/docs`에서 확인하는 게 기준이다.** 코드가 바뀌면 자동으로 갱신되므로, 엔드포인트 목록을 문서에 따로 손으로 옮겨 적지 않는다. 모든 응답의 공통 모양과 에러 코드는 [응답 형식·에러 코드·권한](docs/reference/api-conventions.md)에 있다.

## 폴더 구조

```text
backend/
├── app/
│   ├── main.py        # 앱 생성, 서버 안의 워커 기동(lifespan)
│   ├── api/           # 라우터(엔드포인트)
│   ├── services/      # 도메인 로직, 외부 연동, 워커
│   ├── models/        # SQLAlchemy 모델
│   ├── schemas/       # 요청·응답 스키마
│   ├── core/          # DB 연결, 에러 봉투, 요청 제한
│   └── cli/           # 심사용 시드 등 명령
├── migrations/        # Alembic 마이그레이션
├── tests/             # pytest
├── docs/              # 기능별 문서, 계약, 계획·결과
├── Dockerfile, docker-compose.yml, docker-compose.prod.yml
└── run.sh             # 로컬 실행
```

## 기능별 문서

기능의 동작 규칙은 주제별 문서에 있다.

| 문서 | 다루는 내용 |
|---|---|
| [응답 형식·에러 코드·권한](docs/reference/api-conventions.md) | 응답 봉투, `error.code` 전체 목록, PM 전용 API, 아직 없는 기능 |
| [계정과 인증](docs/reference/auth.md) | 가입·카카오 로그인, 세션 토큰, 로그인 제한, 비밀번호 재설정, 이름 규칙 |
| [Notion 연동](docs/reference/notion.md) | Task를 Notion에 반영하는 방식, 재시도, OAuth 연결 |
| [Discord 연동](docs/reference/discord.md) | 봇 초대 OAuth, 서버 사용자 목록, 채팅 수집 채널, 팀원 연결 옮기기 |
| [유사 검색과 담당자 별칭](docs/reference/matching-and-alias.md) | 유사 task 검색, AI 판단 접수, 별칭 학습, 전사 힌트 |
| [회의 녹음 보관과 재생](docs/reference/meeting-audio.md) | 녹음 저장 위치, 보관 기간, 재생 API |
| [메시지와 알림](docs/reference/messages.md) | 메시지·알림 설정, 읽지 않은 수, 답장 판단 재시도 |
| [운영과 의존성](docs/reference/operations.md) | 운영 실행(Docker), 서버 안의 워커, health ready, KPI view, 의존성 잠금 |
| [심사용 시드](docs/reference/demo-seed.md) | 시연용 계정·공간·회의를 채우는 명령 |

## 심사용 시드

심사 시연용으로 계정 6개, 공간 하나, 팀원 자리, 온보딩 단계, 지난 회의를 채우는 명령이다(#606).

```bash
python -m app.cli.seed_demo --email-pattern 'demo+{n}@example.com'             # 로컬 리허설
python -m app.cli.seed_demo --email-pattern 'demo+{n}@example.com' --dry-run   # 쓰지 않고 확인만
```

준비물, 운영에서 돌리는 방법, 옵션, 종료 코드는 [심사용 시드 문서](docs/reference/demo-seed.md)에 있다.

## 옮긴 절

다른 문서가 이 README의 아래 절을 직접 가리킨다. 내용은 기능별 문서로 옮겼다.

### 에러 코드

[응답 형식·에러 코드·권한](docs/reference/api-conventions.md#에러-코드)에 있다.

### 로그인 제한

[계정과 인증](docs/reference/auth.md#로그인-제한)에 있다.

### Notion 연동

[Notion 연동](docs/reference/notion.md)에 있다.

### KPI view

[운영과 의존성](docs/reference/operations.md#kpi-view)에 있다.

## 계약·계획·결과

| 종류 | 문서 |
|---|---|
| 문서 구조 | [문서 안내](docs/README.md) |
| 계약 | [AI(녹음 봇) 계약](docs/contracts/backend-ai-contract.md). 웹 화면용은 [프론트엔드 대표 계약](../frontend/docs/contracts/frontend-api-contract.md) |
| 계획 | [전체 계획](docs/plan/backend-plan.md), [M0~M7 안내](docs/plan/README.md) |
| 요청 | [녹음 시작 때 배포 재시작 잠금 확인](docs/requests/bot-restart-lock.md)(AI) |
| 배포 | [배포 안내](../deploy/README.md) |

마일스톤별 plan.md는 전체 계획의 해당 절(범위, 작업, 완료 기준)을 옮긴 것이다. 과거 전체 계획의 상태와 후속 구현·검증 결과는 [M0~M7 안내](docs/plan/README.md)에서 구분한다.

### 마일스톤 결과

모두 마일스톤 완료를 판정하지 않았다.

| 마일스톤 | 결과에 기록한 것 |
|---|---|
| [M0](docs/plan/m0/result.md) | 백엔드 CI 보완 |
| [M1](docs/plan/m1/result.md) | 가입 인증·카카오 로그인 PR 최신 기반 검증, 계정 탈퇴·공동 기록 익명화·파일 정리(#575), 동의 기록 API(#564) |
| [M2](docs/plan/m2/result.md) | 승인 때 대상 task 제목 확인 |
| [M3](docs/plan/m3/result.md) | 추출 근거·담당자 별칭(#459), 회의 원문 삭제와 태스크 보존(#576) |
| [M5](docs/plan/m5/result.md) | 업로드 저장, AI 가져가기 API, [화자 지정 만료 이력 조회](docs/plan/m5/result.md#2026-11-04-추가-화자-지정-만료-이력-조회)(#256), 만료 경합과 실패 파일 재시도 |
| [M6](docs/plan/m6/result.md) | AI 처리 단계 보고와 진행 표시(#381), 답장 담당자 변경 승인(#460), 승인 대기 요청 유사 검색과 합치기(#141), 메시지 탭 읽지 않은 수(#480), 범위 변경 승인 이력(#205) |
| [M7](docs/plan/m7/result.md) | 배포 전 CI 검사, 봇 재시작 잠금, 되돌리기 문서, Grafana Cloud 모니터링·KPI view(#675) |

M5 결과의 초기 `AI 미구현` 설명은 당시 기록이다. AI 웹 업로드 처리 코드는 지금 [worker](../ai/capture/worker.py), [가져오기](../ai/upload/intake.py), [화자 지정](../ai/upload/assign.py)에 있다([AI 실행 안내](../ai/README.md)).
