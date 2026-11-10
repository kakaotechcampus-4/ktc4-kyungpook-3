# 환경 변수

파트별 환경 변수의 **이름과 의미**만 모았다. 실제 값과 비밀은 저장소에 두지 않는다. 각 파트의 `.env.example` 을 복사해 `.env` 를 만들고 채운다.

| 파트 | 예시 파일 | 읽는 곳 |
|---|---|---|
| frontend | [`frontend/.env.example`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/frontend/.env.example) | Vite (`VITE_*` 는 브라우저 번들에 들어간다) |
| backend | [`backend/.env.example`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/.env.example) | `run.sh`(로컬), `docker-compose.prod.yml`(운영) |
| ai | [`ai/.env.example`](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/.env.example) | `ai/shared/config.py`, 일부 모듈이 `os.environ` 에서 직접 |

> 비밀키·OAuth client secret 은 프론트엔드 환경 변수에 두지 않는다. `VITE_*` 값은 누구나 볼 수 있다.

## 운영 스위치

기능을 켜고 끄거나 경로를 바꾸는 값이다. 바꾸면 해당 프로세스를 다시 띄워야 반영된다.

| 이름 | 파트 | 값 | 의미 | 운영 메모 |
|---|---|---|---|---|
| `AUTO_CREATE_ENABLED` | BE | true(기본) / false·0·off·no | 확신도가 높은 새 항목을 PM 확인 없이 태스크로 만든다(auto). 끄면 auto 를 review 로 내린다. 모르는 값은 꺼짐 | 처음 운영은 끄고 검증 결과·PM 승인 기록을 본 뒤 여는 것을 권한다(#382, #526). 바꾸면 `docker compose ... up -d` 로 컨테이너를 다시 만든다(restart 로는 반영 안 됨). 운영값 [확인 필요] |
| `MEETING_DELETION_ENABLED` | BE | false(기본) / 정확히 소문자 `true` 만 켜짐(True·1·on 은 꺼짐). `AUTO_CREATE_ENABLED` 와 다르다 | 회의 삭제 API·UI 를 연다. 꺼져 있으면 DELETE 가 503 | 구 봇 교체와 녹음 계보 검증 뒤에만 켠다([deploy README](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/deploy/README.md#회의-삭제-활성화-576)) |
| `UPLOAD_MAX_BYTES` | BE | 바이트 (코드 기본·예시 값 209715200 = 200MiB) | 웹 녹음 업로드 한도 | 바꾸면 프론트 한도(`uploadPolicy`)도 같이 바꾼다 |
| `MM_EXTRACT_PATH` | AI | 비움·legacy / judge | 할 일 추출 경로. judge 는 판단 파이프라인(`judge/pipeline.py`) | judge 는 `TERRA_*`, `LUNA_*`, `BE_*` 가 모두 있어야 돈다. Jev 근거 상태는 judge 에서만 쓴다. 운영값 [확인 필요] |
| `MM_STT_BACKEND` | AI | local(기본) / elice | 전사 백엔드. local 은 로컬 Whisper(`MM_STT_MODEL`, 기본 large-v3-turbo) | 운영은 elice 로 본다(`ai/deploy/gpu-stt/README.md`: "워커는 지금처럼 Elice 만 쓴다"). `.env.example` 에는 없다 |
| `MM_GPU_FAILOVER` | AI | off(기본) / manual / auto | Elice 전사가 계속 실패하면 GPU 대기 서버로 넘길지 | `MM_STT_BACKEND=elice` 일 때만 돈다. 절차는 `ai/deploy/gpu-stt/README.md` |
| `MM_UPLOAD_INTAKE` | AI | 비움(끔) / 1 | 워커가 BE 의 웹 업로드를 가져와 pyannoteAI 로 화자 분리한다(과금) | BE claim 계약이 워커 한 대 전제라 **운영 서버 한 대에서만** 켠다 |
| `MM_SUMMARY_LLM` | AI | 비움(끔) / luna / terra | 회의 요약 생성 모델 | 운영은 `mm-worker` systemd drop-in 으로 `luna` 를 설치한다([deploy README](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/deploy/README.md#자동-회의-요약-560)) |
| `DISCORD_GUILD_ID` | AI | 길드 ID / 비움 | 슬래시 명령을 한 서버에만 즉시 등록 | **운영에선 비운다.** 비우면 글로벌 등록이라 연결한 모든 서버에서 명령이 보인다(반영까지 최대 1시간). 개발 서버에서만 채운다 |
| `PM_AGENT_LLM` | AI | 비움 / off | off 면 키가 있어도 LLM 을 부르지 않는다(Terra·Luna·추출 공통, 임베딩 무관) | 개발·테스트용 |
| `MM_DEBUG_REPORT` | AI | 비움 / 1·on·true | 단계 시작·회의록 파일·처리 시간을 채널에 더 올린다 | 운영에서는 비운다 |

## frontend

| 이름 | 의미 |
|---|---|
| `VITE_API_BASE_URL` | API 루트 주소(`/api/v1` 포함). 비우면 같은 출처 `/api/v1` |
| `VITE_ENABLE_MSW` | true 면 개발 서버가 MSW 모의 데이터로 뜬다. 기본 false(실제 API) |
| `API_PROXY_TARGET` | 개발 서버 proxy 가 `/api` 를 넘길 백엔드 주소. 비우면 `http://localhost:8000`. 번들에 들어가지 않는다 |
| `E2E_PORT` | E2E 용 개발 서버 포트(기본 5211). 다른 worktree 와 겹칠 때만 바꾼다 |

## backend

| 묶음 | 이름 | 의미 |
|---|---|---|
| DB | `DATABASE_URL` | 로컬 PostgreSQL 접속 URL. 운영에선 아래 세 값으로 다시 만든다 |
| | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | 운영 compose 의 DB 계정 |
| | `TEST_DATABASE_URL` | 있으면 pytest 가 PostgreSQL 변형도 돈다(테스트 전용) |
| 서명·인증 | `OAUTH_STATE_SECRET` | OAuth state·가입 이메일 증명·카카오 로그인 서명 키(32자 이상). 비면 운영 compose 가 기동을 멈춘다 |
| | `SERVICE_TOKEN` | AI 봇·워커가 `X-Service-Token` 으로 보내는 공유 비밀. AI 의 `BE_SERVICE_TOKEN` 과 같아야 한다 |
| Notion | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_REDIRECT_URI` | Notion OAuth 연결 |
| | `NOTION_SYNC_INTERVAL_SECONDS` | Notion 반영(outbox) 워커 주기. 0 이면 끈다 |
| Discord | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | 봇 초대 OAuth |
| | `DISCORD_BOT_TOKEN` | 녹음 봇과 같은 봇의 토큰. 서버 사용자 목록을 읽는다 |
| | `DISCORD_BOT_PERMISSIONS` | 봇 초대 때 요청할 권한 값. 비우면 코드 기본값 |
| 카카오 | `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI` | 카카오 로그인 |
| 임베딩 | `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL` | task 제목 임베딩. 비우면 유사 task 검색이 `EMBEDDING_UNAVAILABLE`(502) |
| | `EMBEDDING_SYNC_INTERVAL_SECONDS` | 임베딩 채우기 워커 주기. 0 이면 끈다 |
| 주기 작업 | `UPLOAD_SWEEP_INTERVAL_SECONDS` | 멈춘 업로드 회의를 failed 로 정리하는 주기 |
| | `SESSION_SWEEP_INTERVAL_SECONDS` | 만료 세션 삭제 주기 |
| | `REMINDER_SCHEDULER_INTERVAL_SECONDS` | 리마인드 스케줄러 주기 |
| | `MEETING_PURGE_INTERVAL_SECONDS` | 삭제한 회의·탈퇴 계정의 파일 정리 재시도 간격. 0 이하면 끈다 |
| 웹 푸시 | `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | 브라우저 푸시. 하나라도 비면 웹 안 알림만 쌓는다 |
| 업로드 | `UPLOAD_DIR` | 웹 녹음 저장 위치. 로컬 기본 `backend/uploads`, 운영은 `/data/uploads` 볼륨 |
| 메일 | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TIMEOUT_SECONDS` | 비밀번호 재설정·가입 인증 메일. 빠지면 `MAIL_UNAVAILABLE`(503) |
| | `APP_BASE_URL` | 웹 주소. 재설정 링크와 봇 DM 의 대화 링크에 쓴다 |

운영 스위치(`AUTO_CREATE_ENABLED`, `MEETING_DELETION_ENABLED`, `UPLOAD_MAX_BYTES`)는 위 표에 있다.

## ai

| 묶음 | 이름 | 의미 |
|---|---|---|
| Discord | `DISCORD_BOT_TOKEN` | 녹음 봇·채팅 폴링이 쓰는 봇 토큰 |
| | `CHAT_POLL_CONTEXT_MESSAGES`, `CHAT_POLL_INITIAL_HOURS`, `CHAT_POLL_MAX_DAYS` | 채팅 폴링의 참고 문맥 수, 첫 수집 시간 범위, 최대 따라잡기 일수 |
| 전사(Elice) | `ELICE_API_KEY`, `ELICE_STT_BASE_URL`, `ELICE_STT_CA_BUNDLE` | Elice MLAPI whisper 전사 |
| | `MM_STT_MODEL` | 로컬 전사 모델 이름(기본 large-v3-turbo) |
| GPU 전환 | `GPU_STT_BASE_URL`, `GPU_STT_API_KEY`, `GPU_STT_CA_BUNDLE` | GPU 대기 서버 전사 주소·키·인증서 |
| | `GPU_SWITCH_URL`, `GPU_SWITCH_TOKEN` | GPU 서버 켜기·끄기 스위치 |
| | `MM_OPS_CHANNEL_ID` | 운영 알림과 `/gpu` 명령을 받는 비공개 채널 |
| 화자 분리 | `PYANNOTEAI_API_KEY` | 웹 업로드 화자 분리(pyannoteAI) |
| 임베딩 | `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL` | 유사 task 검색용 임베딩 |
| LLM | `TERRA_API_KEY`, `TERRA_BASE_URL` | 판단 모델(Terra). 비우면 규칙 기반 폴백 |
| | `LUNA_API_KEY`, `LUNA_BASE_URL` | 초안·요약 모델(Luna) |
| | `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | legacy 추출(`extract/llm.py`) 모델 |
| 근거 검증 | `JEV_API_KEY`, `JEV_BASE_URL` | Jev 판정 API. 비우면 근거 상태가 모두 inferred 라 auto 가 열리지 않는다 |
| | `MM_ASR_SEED_NOUNS`, `MM_ASR_YES_THRESHOLD` | 전사 오인식 검사의 명사 목록·Jev yes 기준 |
| BE 인계 | `BE_BASE_URL`, `BE_SERVICE_TOKEN` | 백엔드 주소와 서비스 토큰. 둘 다 있어야 인계가 돈다 |
| | `MEETING_TIMEZONE` | 상대 날짜("내일") 기준 시간대. 기본 Asia/Seoul |
| 재시도·주기 | `MM_EXTRACT_RETRY_MAX` | judge 1단계에서 판단 못 한 finding 이 남을 때 인계를 미루는 횟수(기본 2) |
| | `MM_WORKER_INTERVAL_S` | 워커 한 바퀴 주기(systemd 유닛에서 10) |
| | `MM_PARTIAL_RETRY_MAX`, `MM_RECOVERY_INTERVAL_S` 등 | 부분 실패 재시도·복구 안내 주기. `.env.example` 에는 없고 코드 기본값을 쓴다(`capture/recorder.py`) |
| Notion | `NOTION_API_KEY`, `NOTION_DATABASE_ID` | 개발용 Notion 직접 연동. `ai/shared/config.py` 에서 읽기만 하고 쓰는 곳은 없다. Notion 연동은 BE 의 OAuth·outbox 가 맡는다 |
| 개발용 | `PM_AGENT_TODAY` | 상대 날짜 해석 기준일 고정(테스트·재현) |
| | `LOG_LEVEL` | DEBUG 면 실시간 실행기의 voice 로거를 올린다 |

운영 스위치(`MM_EXTRACT_PATH`, `MM_STT_BACKEND`, `MM_GPU_FAILOVER`, `MM_UPLOAD_INTAKE`, `MM_SUMMARY_LLM`, `DISCORD_GUILD_ID`, `PM_AGENT_LLM`, `MM_DEBUG_REPORT`)는 위 표에 있다.

## 파트 사이에 같아야 하는 값

| AI | BE | 비고 |
|---|---|---|
| `BE_SERVICE_TOKEN` | `SERVICE_TOKEN` | 다르면 봇·워커 요청이 거절된다 |
| `DISCORD_BOT_TOKEN` | `DISCORD_BOT_TOKEN` | 같은 봇 |
| `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL` | 같은 이름 | 같은 임베딩 모델이어야 검색이 맞는다 |

## 관련 문서

- [로컬 실행](local-setup.md) · [배포](deploy.md)
- [backend README](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/backend/README.md) · [ai README](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/README.md) · [deploy README](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/deploy/README.md)
