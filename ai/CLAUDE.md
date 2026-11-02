# AI 파트 지침

이 파일은 **지도**다. 규칙과 위치만 적고 자세한 내용은 링크한 문서에 둔다. 100줄 안팎을 유지하고,
내용이 길어지면 `docs/`에 문서를 만들고 여기에는 링크만 남긴다. 저장소 공통 규칙은 루트 `CLAUDE.md`가
안내하는 `../docs/agent-rules.md`를 따른다.

## 무엇을 하는가

회의 음성(지금은 Discord 녹음)을 전사하고, 할 일과 기존 task의 변경을 찾아 근거(원문·화자·시각)와 함께
BE에 넘긴다. PM 승인과 Notion 반영은 BE·FE 몫이다. 목표와 단계는 [전체 계획](docs/plan/전체%20계획.md).

## 명령 (모두 `ai/` 안에서)

```bash
make setup                      # uv venv + 의존성 + .env.example 복사. venv 안에서는 pip 대신 uv pip
.venv/bin/python -m pytest -q   # 외부 서비스·API 키 없이 돈다. 변경 후 항상 실행
python -m capture.run_recorder  # 개발용 봇 (/join /record /stop)
python -m capture.worker        # 저장된 회의 처리. --retry <서버ID> 로 포기한 회의 재시도
```

lint/format 설정은 없다. 있다고 가정하지 않는다.

## 코드 지도

| 위치 | 역할 | 먼저 볼 곳 |
|---|---|---|
| `capture/` | Discord 녹음, 워커, 단계 진행, BE 인계 | `recorder.py`의 `process_session`, `worker.py`, `handoff.py` |
| `stt/` | 화자별 트랙 전사 (운영 기본 Elice API, 로컬 faster-whisper는 장애 대응) | `batch.py`의 `run`, `transcribe.py` 상단 주석 |
| `judge/` | 판단 파이프라인: 1단계 → 유사 task 검색 → Terra → Luna Phase 2 | `pipeline.py` 상단 주석 |
| `extract/` | 옛 추출 경로 (`MM_EXTRACT_PATH=legacy`, 기본값) | [extract/README.md](extract/README.md), [TASK_CRITERIA.md](extract/TASK_CRITERIA.md) |
| `draft/` | 승인 항목의 제목·마감일·설명 초안 (Luna Phase 2) | `doc_draft.py` |
| `shared/` | BE와 공유하는 타입 계약, `.env` 로딩 | `schemas.py`, `config.py` |
| `llm.py`, `embedding.py` | Terra·Luna·임베딩 클라이언트 (Elice MLAPI) | 파일 상단 주석 |
| `deploy/systemd/` | 운영 서비스 `mm-bot`, `mm-worker` | |

추출 경로는 `MM_EXTRACT_PATH`로 고른다(`capture/judge_path.py`). 매니페스트 형식과 단계 상태(recording →
saved → transcribed → extracted → handed_off)는 [README](README.md)의 "AI ↔ BE 경계".

## 깨면 안 되는 규칙

1. **Discord는 `capture/` 안에만 있다.** `stt`, `extract`, `judge`, `draft`, `shared`는 `discord`를
   import하지 않고 순수 dict와 `shared.schemas` 타입만 주고받는다. 화자는 불투명한 문자열 uid로 다룬다.
   예외는 설정 이름(`DISCORD_BOT_TOKEN` 등)과 주석뿐이다. `tests/test_platform_isolation.py`가 지키고,
   워커는 `tests/capture/test_worker.py::test_the_worker_does_not_import_discord`가 따로 지킨다.
2. **`shared/schemas.py`는 BE와 공유하는 계약이다.** 필드를 바꾸면 BE에 알리고
   [backend-ai 계약](../backend/docs/contracts/backend-ai-contract.md)도 같이 고친다(`contract-update` 스킬).
3. **BE와는 HTTP API로만 이야기한다.** BE DB를 직접 읽거나 쓰지 않는다. 호출은 `capture/handoff.py`의
   `BeClient`를 거친다.
4. **LLM 호출 실패는 `None`이다.** 호출자는 `None`을 받으면 규칙 기반 폴백이나 "판단 못 함"으로 처리한다.
   그래서 API 키 없이도 pytest가 돈다. 테스트에서 실제 API를 부르지 않는다.
5. **실제 API를 부르는 평가 스크립트는 pytest에 넣지 않는다.** 비용이 들고 결과가 매번 다르다.
   요청받았을 때만 돌리고, 한 번 어긋났다고 프롬프트를 바로 고치지 않는다.
6. **상대 날짜("내일")의 기준일은 처리한 날이 아니라 회의 날짜다.** `started_at`을 매니페스트의
   `timezone`으로 바꾼 날짜(`recorder.meeting_date`).
7. **`.env`는 읽지 않는다.** 필요한 변수 이름은 `.env.example`에서 확인한다.

## 검증

| 바꾼 곳 | 돌릴 것 |
|---|---|
| 어디든 | `.venv/bin/python -m pytest -q` |
| 하나의 모듈 | `tests/` 아래 같은 이름의 테스트부터: `-k`나 파일 경로로 좁혀 실행 |
| `judge/` 프롬프트·로직 | pytest 후, 요청이 있으면 `python -m judge.eval_golden_set` · `python -m judge.eval_pipeline` (키 필요, 비용 발생) |
| `extract/` | 요청이 있으면 `python -m extract.eval_golden_set` (키 필요) |
| `stt/` 전사 방식 | `stt/eval/` 도구. 측정 방법은 결정 기록 0008, 0012와 `2026-10-06-server-capacity` |

완료라고 말하기 전에 실제로 돌린 명령과 결과를 보고한다. 돌리지 못했으면 못 했다고 쓴다.

## 지식이 있는 곳

저장소에 없는 지식은 에이전트에게 없는 것과 같다. 디스코드나 회의에서 정한 것은 아래에 기록한다.

| 무엇 | 어디 |
|---|---|
| 목표·마일스톤 | [docs/plan/전체 계획.md](docs/plan/전체%20계획.md) (보호 문서, 직접 수정 금지) |
| 왜 이렇게 했나 | [docs/basis_for_decision/](docs/basis_for_decision/): 결정 기록 `YYYY-MM-DD-NNNN-*.md`, 진행 로그 `YYYY-MM-DD-*.md`. AI가 쓰면 `ai/`, 사람이 쓰면 `member/`. 양식은 [docs/README.md](docs/README.md) |
| BE와의 약속 | [backend-ai 계약](../backend/docs/contracts/backend-ai-contract.md), 웹 API는 [frontend-api 계약](../frontend/docs/contracts/frontend-api-contract.md) |
| 다른 파트의 요청 | [docs/request/](docs/request/) |
| 전체 흐름 그림 | [../docs/Manager's Manager AI flow.excalidraw](../docs/Manager's%20Manager%20AI%20flow.excalidraw), [파트별 전체 흐름](../docs/파트별%20전체%20흐름.md) |
| 골든셋 기준 | [extract/golden_set/README.md](extract/golden_set/README.md), `judge/golden_set*/` |

코드 주석이 결정 기록을 번호(예: "0013")로 가리킨다. 번호로 `docs/basis_for_decision/`에서 찾는다.

## 이 파일 관리

- 이 파일의 설명이 코드와 다르면 코드가 맞다. 발견하면 이 파일을 고치거나 보고한다.
- 새 규칙은 가능하면 테스트로 강제하고, 여기에는 규칙 한 줄과 그 테스트 이름만 적는다.
