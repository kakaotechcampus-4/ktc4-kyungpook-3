# 회의 요약본, 주제, 프로젝트 맵 BE 경로와 AI 요약 워커를 더한다

- 날짜: 2026-11-08
- 이슈: #462
- PR: #560
- 브랜치: feature/462-project-map
- 작성자: 김동우

## 한 일

- BE: 회의 요약 대기열(`Extraction.summary_requested_at`, `summary_attempts`, `summary_claimed_at`)과 주제, 주제의 회의, 주제의 항목, 결정 표를 더했다. 저장은 `services/summary.py` 한 곳에서만 한다
- BE: 봇용 서비스 토큰 경로 넷(`POST /summaries/claim`, `GET /extractions/{id}/summary-input`, `PUT /extractions/{id}/summary`, `POST /workspaces/{id}/summary-requests`)과 웹 경로 넷(`project-map`, `topics/{id}`, `summary.md`, `project-bundle.md`)을 더했다. `/minutes` 에 `summary_status` 를 더했다
- BE: 추출을 등록할 때 요약 일감을 표시한다(`api/extractions.py` 한 줄). 승인 코드는 바꾸지 않았다
- AI: `summary/` 가 회의 하나를 JSON 요약으로 만들고, 응답을 BE 스키마에 맞춰 거른다. 워커가 바퀴 끝에 한 건씩 맡는다(`capture/summary_sweep.py`). 스위치 `MM_SUMMARY_LLM` 이 비면 호출하지 않는다
- AI: 옛 회의를 줄 세우거나 지정 회의만 돌리는 재처리 명령 `capture/backfill_summaries.py`
- 계약: `backend/docs/contracts/backend-ai-contract.md`, `frontend/docs/contracts/frontend-api-contract.md` 4.4.2
- 화면은 FE 요청 이슈 #551 로 넘겼다

## 왜

회의록 요약 칸은 BE·FE 에 있었지만 채우는 쪽이 없어 늘 비어 있었다. 대기열을 BE 에 둔 이유와 할 일 변화를 요약에 남기는 이유는 결정 기록에 있다.

- [0058 회의 요약 대기열을 BE 에 둔다](2026-11-07-0058-meeting-summary-queue-in-be.md)
- [0059 요약의 할 일 변화와 D-104](2026-11-07-0059-summary-task-changes-and-d104.md)

## 결과

| 항목 | 값 |
|---|---|
| BE pytest (SQLite + PostgreSQL) | 4139 통과, 47 건너뜀 |
| AI pytest | 1945 통과 |
| alembic upgrade, downgrade, upgrade, check | 통과 |
| ruff | 통과 |

그래프 응답 크기는 합성 데이터로 로컬 PostgreSQL(pgvector pg16 도커)에서 쟀다. 실제 워크스페이스 값이 아니다.

| 태스크 | 노드 | 선 | 응답 | gzip | 응답 시간 |
|---|---|---|---|---|---|
| 200 | 216 | 468 | 104KB | 14KB | 0.31초 |
| 500 | 536 | 1,173 | 259KB | 44KB | 1.26초 |
| 1,000 | 1,069 | 2,337 | 517KB | 101KB | 4.81초 |

LLM 요약은 실제 호출로 아직 재지 않았다. 운영 서버의 회의 전사를 읽지 못했고, 로컬 Luna·Terra 키가 만료돼 401 이 났다. 유료 호출은 0원이다. 프롬프트 품질, 호출당 비용과 시간, `SUMMARY_TIMEOUT_S`, `REASONING_EFFORT`, 입력 상한은 아직 자리값이다. 태스크끼리 선의 기준(`EDGE_TOP_K`, `EDGE_MIN_SIMILARITY`)도 재지 않았다.

## 다음

- 머지와 배포 뒤 서버에서 회의 두세 건을 `--preview --llm luna`, `--llm terra` 로 돌려 품질과 비용을 재고 모델과 자리값을 정한다
- 그 뒤 스위치를 켜고 옛 회의를 줄 세운다(서버 설정이라 사용자 승인 뒤)
- 태스크가 수백 개를 넘으면 태스크끼리 선을 미리 계산해 저장한다
