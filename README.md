


<div align="center">

<img src="./docs/assets/readme-banner.png" width="100%" alt="Manager's Manager 소개 배너. 회의만 하면 할 일이 정리됩니다" />

# Manager's Manager

**회의만 하면 할 일이 정리되는 PM 에이전트**

https://github.com/user-attachments/assets/9d2d7842-b822-4dd7-88dd-68f9444b1ba9

[![Service](https://img.shields.io/badge/Service-%EB%A7%A4%EC%8A%A4_%EC%8B%9C%EC%9E%91%ED%95%98%EA%B8%B0-191919?style=flat-square)](https://managers-manager.duckdns.org)
![Node.js](https://img.shields.io/badge/Node.js-24-3c873a?style=flat-square&logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776ab?style=flat-square&logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169e1?style=flat-square&logo=postgresql&logoColor=white)
![Discord](https://img.shields.io/badge/Discord_Bot-5865f2?style=flat-square&logo=discord&logoColor=white)

[서비스 소개](#서비스-소개) • [주요 기능](#주요-기능) • [AI 판단 방식](#ai가-판단하는-방식) • [서비스 구성](#서비스-구성) • [시작하기](#시작하기) • [팀](#팀) • [문서](#문서)

</div>

회의에서 정한 할 일과 일정 변경을 **근거와 함께** 찾아, 확실한 것은 바로 태스크로 만들고 애매한 것만 PM에게 묻습니다. 카카오테크 캠퍼스 4기 경북대 3팀 프로젝트입니다.

> [!TIP]
> 바로 써 보려면 **[managers-manager.duckdns.org](https://managers-manager.duckdns.org)** 에 접속하고 [처음 쓰는 분을 위한 안내](./docs/user/quick-guide.md)를 따라 하세요. 심사·체험용 테스트 계정과 샘플 회의는 준비 중입니다(#606).

<!-- 대표 화면 GIF 자리: docs/assets/readme-hero.gif (#654) -->

## 서비스 소개

"제가 금요일까지 할게요", "그거 다음 주로 미룰게요"처럼 회의에서 정한 일은 말로만 남기 쉽습니다. 회의록을 다시 읽고 보드에 옮기는 일은 결국 PM의 몫입니다.

Manager's Manager(화면 이름 **매스**)는 Discord 회의를 듣고 **새 할 일과 기존 할 일의 변경**을 찾아 태스크와 Notion 보드에 반영합니다. 모든 항목에는 원문 인용·화자·회의 안 시각이 붙어, 왜 이 일이 나왔는지 바로 확인할 수 있습니다.

```text
Discord /record → 회의 → /stop → 전사 · 판단 → 반영된 것 / 확인 필요 / 보류
                                                   │
                        Notion 보드 동기화  ←  PM 승인  →  마감 전 리마인드 DM → 웹 답장
```

## 주요 기능

- **세 가지 입력** — Discord 음성 회의(`/join` → `/record` → `/stop`), 녹음 파일 업로드, Discord 텍스트 채널
- **변경까지 추적** — 새 할 일뿐 아니라 기존 태스크의 마감·상태·담당 변경을 찾아 해당 태스크에 연결
- **근거가 붙는 회의록** — 결정·담당자·마감과 원문 인용, 회의록 원문으로 바로 이동
- **확실한 것만 자동** — 검사를 모두 통과한 일만 승인 없이 태스크가 되고, 나머지는 PM이 확인
- **배우는 담당자 매칭** — PM이 보류 카드에서 담당자를 고르면 그 호칭을 다음 회의부터 기억
- **회의 뒤 관리** — 마감 전 Discord DM 리마인드, 웹 답장, 답장을 읽은 진행 상태 제안, Notion 동기화

| 표시 | 뜻 |
| --- | --- |
| **반영된 것** | 아래 검사를 모두 통과해 승인 없이 태스크가 된 일 |
| **확인 필요** | 마감이 애매하거나("다음 주 중") 전사 오류가 의심되는 일. PM이 보고 승인 |
| **보류** | 담당자를 찾지 못한 일. PM이 담당자를 골라 승인 |

## AI가 판단하는 방식

LLM이 뽑은 결과를 그대로 반영하지 않고, 여러 검사를 지난 항목만 자동으로 반영합니다.

```text
전사 → 할 일 후보 추출 → 기존 태스크 검색 → 새 일·변경 판단 → 제목·마감 초안
     → 근거 검증(Jev) → 전사 오류 검사 → 반영 조건 → 반영된 것 / 확인 필요 / 보류
```

| 단계 | 하는 일 |
| --- | --- |
| **근거 검증** | 할 일과 마감이 원문에 분명히 있는지(`certain`), 추측인지(`inferred`), 없는지(`missing`) 별도 판정 모델로 확인 |
| **전사 오류 검사** | 제목의 명사가 팀 용어 목록에 없으면 "맞게 받아 적은 말인가"를 다시 확인. 용어 목록은 이전 회의에서 두 사람 이상이 말한 말과 PM이 승인한 제목으로 쌓임 |
| **반영 조건** | 말한 담당자가 팀원으로 확정되고, 말한 할 일·마감의 근거가 분명하고, 겹칠 수 있는 기존 태스크가 없을 때만 자동 반영 |

> [!NOTE]
> 자동 반영은 운영 설정으로 끌 수 있습니다. 판단 파이프라인과 평가 결과는 [설계 심화](./docs/design/index.md)와 [테크스펙](./docs/techspec/index.md)에 있습니다.

## 서비스 구성

```mermaid
flowchart LR
  subgraph 입력
    V[Discord 음성 채널]
    U[웹 음성 업로드]
    C[Discord 텍스트 채널]
  end
  V --> BOT[AI 녹음 봇]
  U --> W[AI 워커]
  C --> P[채팅 수집]
  BOT --> W
  P --> W
  W -- "전사 · 판단 · 초안" --> BE[Backend<br/>FastAPI + PostgreSQL]
  BE -- "반영된 것 / 확인 필요 / 보류" --> FE[Frontend<br/>React PWA]
  BE --> N[Notion 보드]
  BE -- 리마인드 --> BOT
  BOT --> M[팀원 개인 DM]
```

| 파트 | 기술 |
| --- | --- |
| Frontend | React 19 · TypeScript · Vite · TanStack Query · Tailwind CSS · PWA |
| Backend | FastAPI · SQLAlchemy · Alembic · PostgreSQL 16(pgvector) |
| AI | Python 3.12 · py-cord(Discord 녹음) · Elice STT · Elice MLAPI(LLM·임베딩·Jev) |

## 시작하기

### 준비물

- [Node.js](https://nodejs.org) 24 LTS — frontend
- Python 3.12와 [uv](https://docs.astral.sh/uv/) — backend, ai
- [Docker](https://www.docker.com/) — backend 의 PostgreSQL(pgvector)
- Discord 봇 토큰과 외부 API 키(Elice MLAPI 등) — ai. 없으면 해당 기능만 꺼집니다

> [!TIP]
> 화면만 보고 싶다면 백엔드 없이 frontend 의 모의 API(MSW)로 띄울 수 있습니다. 아래 Frontend 를 펼쳐 보세요.

<details open>
<summary><strong>Frontend</strong></summary>

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173
```

- 백엔드 없이 띄우려면 `frontend/.env` 에 `VITE_ENABLE_MSW=true` 를 두고, 모의 계정 `pm@example.com` / `mock-password` 로 로그인합니다.
- 배포 백엔드에 붙이려면 `API_PROXY_TARGET=https://managers-manager.duckdns.org npm run dev`

</details>

<details>
<summary><strong>Backend</strong></summary>

```bash
cd backend
uv venv --python 3.12 .venv
uv pip install -r requirements-dev.txt
cp .env.example .env                     # OAUTH_STATE_SECRET, SERVICE_TOKEN 등을 채운다
docker compose up -d db                  # PostgreSQL(pgvector)
source .venv/bin/activate                # Windows Git Bash 는 .venv/Scripts/activate
./run.sh                                 # 마이그레이션 + uvicorn (:8000)
```

API 문서는 `http://localhost:8000/docs` 에서 봅니다.

</details>

<details>
<summary><strong>AI</strong></summary>

```bash
cd ai
uv venv --python 3.12 .venv
uv pip install -r requirements.txt
source .venv/bin/activate
cp .env.example .env               # DISCORD_BOT_TOKEN, BE_BASE_URL, BE_SERVICE_TOKEN, 모델 키
python -m capture.run_recorder     # 녹음 봇: Discord 에서 /join → /record → /stop
python -m capture.worker           # 처리 워커: 전사·판단 후 BE 로 넘김
```

> [!IMPORTANT]
> Discord 음성 수신은 DAVE(E2EE)가 필수라 PyPI 의 py-cord 로는 녹음되지 않습니다. `ai/requirements.txt` 의 브랜치 버전을 그대로 씁니다.

</details>

환경 변수, 테스트, CI/CD와 배포는 [개발자 가이드](./docs/dev/local-setup.md)와 [배포 안내](./deploy/README.md)에 있습니다.

## 팀

**카카오테크 캠퍼스 4기 경북대 3팀**이 기획부터 개발·배포까지 함께 만든 프로젝트입니다.

| 파트 | GitHub |
| --- | --- |
| AI | [@dw021213](https://github.com/dw021213) · [@Y-Jimin](https://github.com/Y-Jimin) · [@letsgojh](https://github.com/letsgojh) |
| Backend | [@wkddnjswns](https://github.com/wkddnjswns) · [@hwnv](https://github.com/hwnv) |
| Frontend | [@hotpringles](https://github.com/hotpringles) |
| 멘토 | [@minsang0850](https://github.com/minsang0850) |

역할과 협업 방식은 [협업 문서](./docs/collab/index.md)에, 기여 내역은 [Contributors](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/graphs/contributors)에 있습니다.

## 문서

| 알고 싶은 내용 | 문서 |
| --- | --- |
| 서비스 사용법 | [사용자 가이드](./docs/user/getting-started.md) · [처음 쓰는 분을 위한 안내](./docs/user/quick-guide.md) |
| 실행·환경 변수·테스트·배포 | [개발자 가이드](./docs/dev/local-setup.md) |
| 설계와 AI 판단 방식 | [테크스펙](./docs/techspec/index.md) · [설계 심화](./docs/design/index.md) |
| API | [API 문서](./docs/api/index.md) |
| 그라운드룰·브랜치·컨벤션·리뷰 | [협업 문서](./docs/collab/index.md) |
| 파트별 계약·계획·결과 | [문서 안내](./docs/README.md) · [FE API 계약](./frontend/docs/contracts/frontend-api-contract.md) · [BE·AI 계약](./backend/docs/contracts/backend-ai-contract.md) |

문서는 `docs/` 폴더에 있고 [문서 첫 화면](./docs/index.md)에서 시작합니다.
