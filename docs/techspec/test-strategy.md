# 테스트 전략

코드 테스트(유닛·통합·E2E)와 AI 응답 품질 점검을 나눠 운영한다. 코드 테스트는 외부 API 없이 CI 에서 돌고, 실제 API 를 부르는 품질 평가는 손으로 돌려 결과 파일과 결정 기록으로 남긴다. 실행 방법은 [개발 문서 테스트](../dev/testing.md)에 있다.

## 원칙

| 원칙 | 내용 |
|---|---|
| 외부 API 없음 | AI 테스트는 LLM·Jev·임베딩을 Null/Fake 클라이언트로 대신한다. FE 는 MSW 를 유일한 데이터 출처로 쓴다 |
| 평가와 테스트 분리 | 실제 API 를 부르는 평가 스크립트는 pytest 에 넣지 않는다(AI 파트 규칙) |
| 경계는 테스트로 강제 | Discord import 는 `capture/` 에만(`tests/test_platform_isolation.py`), FSD 계층은 ESLint |
| 평가 라벨도 테스트 | 평가 대사 라벨·지표 계산을 단위 테스트가 지킨다(예: `tests/test_eval_evidence.py` 361건) |

## 코드 테스트

| 파트 | 단위 | 통합 | E2E | 규모·최근 결과 |
|---|---|---|---|---|
| AI | judge·draft·stt·upload·capture 모듈 (pytest) | 파이프라인 전체를 가짜 LLM·가짜 BE 로(`tests/test_pipeline.py`), 워커 GPU 전환(`tests/capture/test_worker_gpu.py`) | 실제 API 평가 스크립트(아래) | 1,885 passed (2026-11-09, #580 기록) |
| BE | 서비스(매칭·게이트·스케줄러) | `tests/api/` FastAPI TestClient, SQLite in-memory 기본 + PostgreSQL 전용 변형(`TEST_DATABASE_URL`) | — | `tests/api` 1,461 passed, 1,241 skipped(PG 전용) (2026-11-07, SQLite) |
| FE | Vitest + RTL | 같은 MSW 핸들러로 화면 단위 통합 | Playwright 28 spec, 122 테스트(360·390·768px 레이아웃, 명도 대비 포함) | 3,119 / 3,121 (실패 2개는 부하 시간 초과, #482 기록) |

- 기록된 AI 통과 수 추이: 680(09-30) → 980(10-12) → 1,108(11-04) → 1,290(11-06) → 1,885(11-09).
- 멘토가 #382 리뷰에서 확인한 CI 통과 수(2026-11-06, Actions 실행 42383311396): AI 1,831, BE 3,669, FE 3,245, E2E 264. 위 표와 세는 범위가 달라 숫자가 다르다.

## CI 에서 도는 것

| 워크플로 | 트리거 | 잡 |
|---|---|---|
| `ai-ci` | develop 대상 PR(ai/ 경로) | Python 3.12, 의존성 설치 → `pytest` |
| `backend-ci` | develop 대상 PR(backend/ 경로) | lint(ruff), test(pgvector 서비스), migrations(빈 DB 에 `alembic upgrade head` + `alembic check`), image(운영 Dockerfile 빌드 후 import) |
| `frontend-ci` | develop 대상 PR(frontend/ 경로) | typecheck → lint → format → test, build, e2e |
| `deploy` | develop push | 세 CI 를 같은 커밋으로 다시 돌려 모두 통과해야 배포 |

## AI 응답 품질 점검

실제 API 를 부르는 평가다. 결과는 `ai/judge/eval_results/`, `ai/stt/eval/results/` 와 결정 기록에 남긴다.

| 대상 | 스크립트 | 세트 | 결과 (측정일) | 근거 |
|---|---|---|---|---|
| 1단계 후보 추출 | `judge.eval_golden_set` | 골든셋 325문장, 3회 | 긴 문장 306~309/325, 짧은 문장 14/15~16 (규칙 기반 227/325) (2026-10-02) | `ai/judge/eval_results/2026-10-02-final-main.json` |
| 1인칭 화자 판별 | 같음 | 화자 세트 16건×3 | 담당 유형 57/57, 누적 171건 중 2건(약 1%) 오분류 (2026-11-07, #502) | [프로젝트 상세 §8.2](../프로젝트%20상세%20설명.md#82-판단-품질) |
| Terra 변경 판단 | `judge.eval_final_judge` | 2단계 골든셋 26 | 26/26 두 번 (2026-09-28) | `ai/judge/golden_set_stage2/` |
| 파이프라인 E2E | `judge.eval_pipeline` | 회의 1개, 기대 6개 (가짜 BE) | 6/6 을 6회 연속 (2026-09-29) | [결정 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-09-29-judge-pipeline.md) |
| 암묵적 진척 보고 | `judge.eval_golden_set` | 골든셋 58(40번부터 합성) | 새 사실 보고 12/12, 완료 오판 0 (2026-11-04) | [결정 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-04-terra-implicit-progress-status.md) |
| Jev 근거 검증 | `judge.eval_evidence --repeat 3` | 대사 217개 × 3회 = 651호출, 유형 A~H 8종 | 잘못된 certain 할 일 1/83(상한 6.5%), 마감 1/44(상한 11.8%), 대사 단위 (2026-11-07, #529) | [결정 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-07-jev-evidence-eval-extended.md), `ai/judge/eval_results/2026-11-07-evidence-extended.json` |
| Jev 근거 E2E | 실제 API → BE | 명시·흐린·없는 마감 | certain → auto 생성, inferred → review, missing (2026-11-07, #504) | [결정 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-07-jev-evidence-e2e.md) |
| 전사 오인식 검사 (합성) | 첫 구현의 평가 스크립트(설계 변경으로 지금은 없음) | 튜닝 / 처음 보는 세트 | 처음 보는 세트 93% 차단, 10% 오차단 (2026-11-07) — 가정한 오류 모양으로 잰 값이라 채택 근거로 쓰지 않음 | `ai/judge/eval_results/2026-11-07-asr-check-holdout.json` |
| 전사 오인식 검사 (실제 STT) | `judge.eval_asr_real` | AI Hub KconfSpeech 4회의 1,397발화, 명사 오류 발화 230 | 명사 오류 47%(41~53%) 차단, 정상 19%(17~21%) 차단, Jev 기준 0.8 (2026-11-08, #532) | 결정 [0051](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-07-0051-asr-suspect-gate.md) |
| 리마인드 답장 판단 | `judge.eval_reply` | 합성 30건 × 2 | 나뉨 60/60, 자동 반영 정밀도 26/26, 잘못된 certain 0/38, 평균 9.4초 (2026-11-04) | [결정 기록](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-04-reminder-reply-judgment.md) |
| STT CER | `ai/stt/eval/` | 대본을 읽은 디스코드 회의 3개 | 4.67% (2026-11-03), 업체 비교 녹음 6개 Elice 11.52% / OpenAI 10.22% / 리턴제로 11.17% / Soniox 7.54% (2026-10-14) | `ai/stt/eval/results/` |
| STT 미세조정(LoRA) | `ai/stt/eval/` | 정렬본 2개와 대본 낭독 회의 5개 | 측정 전에 정한 성공 기준에 못 미쳐 채택하지 않음. m01 6.52 → 4.94%, m02 4.86 → 6.31%, 11-04 6인 회의 6.72 → 8.06% (2026-11-07) | 결정 [0052](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-07-0052-lora-not-adopted.md) |
| GPU 전사 동등성 | `ai/stt/eval/` | 62.42분 회의 | CER Elice 와 같음, 159.8초 (2026-11-04) | `ai/stt/eval/results/2026-11-04-gpu-serving/` |
| legacy 추출 | `extract.eval_golden_set` | 17케이스 | 할 일 83개 중 P 99%, R 94%, F1 96% (ai/extract/README.md 예시 출력 기준, 이 출력이 들어간 커밋 243f262e 2026-09-26) | [ai/extract/README.md](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/extract/README.md) |

### 평가 방식에서 지킨 것

- 반복 실행은 독립 표본이 아니므로 오답률·신뢰 상한은 대사 단위(한 번이라도 틀리면 틀린 대사)로 센다. 반복은 흔들림을 보는 데만 쓴다(#382 멘토 재리뷰).
- 기준값은 같은 데이터로 골라 다시 재지 않는다. 오인식 검사 0.8 은 잠정값이고 운영 결과로 다시 정한다.
- 측정 조건이 다른 수치끼리 직접 비교하지 않는다.

## 부하 테스트

k6 로 웹 사용자 시나리오(대시보드 요청 10개를 동시에)와 봇 인계 시나리오를 쟀다. 노트북의 Docker 에서 운영 이미지를 띄워 잰 값이고 운영 서버의 수치가 아니다. 도구와 원자료 안내는 PR #703 에 있다.

| 시나리오 | 고치기 전 | 고친 뒤 (동시 처리 30개 관문, 풀 20+20) |
|---|---|---|
| 웹 20 VU | 4.0 req/s, 실패 20.6% | 48.0 req/s, 실패 0% |
| 웹 50 VU | 4.8 req/s, 실패 100% | 104.4 req/s, 서버 실패 0 |
| 멈추기 시작하는 동시 사용자 | 15 ~ 20 VU | 50 VU 까지 멈추지 않음 |
| 봇 인계, 동시 회의 5개 / 20개 | | 242 req/s p95 61ms / 192 req/s p95 364ms, 실패 0% |

원인은 동기 엔드포인트가 스레드풀과 DB 연결 풀을 서로 기다리는 교착이었다. 운영 서버는 읽기 전용으로 5 VU 까지만 쟀다(11.8 req/s, p95 321ms, 실패 0%). 근거: 결정 [0068](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-11-0068-request-gate.md), [진행 로그](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/ai/docs/basis_for_decision/ai/2026-11-11-request-gate.md).

## 운영에서 이어서 볼 것

- 스위치를 끈 기간(`AUTO_CREATE_ENABLED=false`)의 "켰으면 auto 였을 항목"과 PM 승인·수정·반려 결과 대조 → auto 개방 판단. 항목 ID 가 든 로그는 남고, PM 결정과 맞춰 보는 집계는 아직 돌리지 않았다.
- `asr_suspect` 로 막힌 항목과 안 막힌 항목의 PM 제목 수정 비율 → 오인식 기준값 재조정.
- 지표 정의는 [추가 지표](metrics.md).
