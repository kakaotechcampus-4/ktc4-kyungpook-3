# 테크스펙

Manager's Manager 의 기술 명세 요약이다. 각 쪽에는 결론과 근거 수치만 적고, 설계 이유는 [AI 로직](../ai-logic/index.md)과 결정 기록으로 링크한다.

## 한 페이지 요약

| 구분 | 한 줄 |
|---|---|
| 문제 | 회의에서 정한 할 일·담당·마감과 기존 할 일의 변경이 말로만 남고, PM 이 기억에 기대어 Notion 보드를 고친다. 회의 뒤 재촉도 PM 몫이다 |
| 해결 | 회의 음성·업로드·채팅에서 새 할 일과 기존 task 변경을 뽑아 근거(원문·화자·시각)를 붙이고, 조건을 모두 만족한 것만 자동 반영, 나머지는 PM 확인 뒤 Task·Notion 에 반영한다. 마감 전 재촉 DM 과 답장 판단까지 한다 |
| 구조 | AI 워커·봇(전사 → 다단계 판단 → 근거 검증) → Backend(FastAPI + PostgreSQL/pgvector: 매칭·게이트·승인·Notion outbox) → Frontend(React SPA·PWA). EC2 한 대에 세 파트를 올린다 |
| 핵심 장치 | 값을 만든 모델과 다른 모델(Jev)이 근거를 검증하고, 전사 오인식 검사와 자동 생성 스위치까지 세 관문을 지나야 auto 다 |

## 핵심 수치 (측정일·조건은 각 쪽에)

| 지표 | 값 | 쪽 |
|---|---|---|
| STT CER | 4.67% (실제 회의 녹음, 2026-11-03) | [지표](metrics.md) |
| 62분 회의 전사 시간 | Elice 65초 / 로컬 CPU 85분 (2026-10-06) | [아키텍처](architecture.md) |
| Jev 잘못된 certain (할 일) | 대사 단위 1/83, 95% 상한 6.5% (217개×3회, 2026-11-07) | [지표](metrics.md) |
| 전사 오인식 검사 | 명사 오류 47% 차단, 정상 19% 차단 (AI Hub 실제 STT, 2026-11-08) | [요구사항·리스크](requirements-risks.md) |
| 답장 자동 반영 정밀도 | 26/26 (합성 30건×2, 2026-11-04) | [테스트 전략](test-strategy.md) |
| 테스트 | AI 1,885 passed(11-09) / BE `tests/api` 1,461 passed(11-07) / FE 3,119/3,121 + E2E 122 | [테스트 전략](test-strategy.md) |

## 목차

제출 안내의 테크스펙 섹션 순서를 따른다.

| 섹션 | 쪽 | 내용 |
|---|---|---|
| 아키텍처 설계 | [architecture.md](architecture.md) | 구성 요소, 입력 경로 3개, 회의 처리 순서, 단계 상태와 재시작, 기술 스택, 배포 구성 |
| 아키텍처 설계 (에이전트) | [agent-design.md](agent-design.md) | 판단 파이프라인 단계별 모델·도구·입출력·상태·예외, 게이트 |
| 시나리오 | [scenarios.md](scenarios.md) | 회의 → 승인 → Notion, 재촉 → 답장 → 반영, 오프라인 업로드 → 화자 지정 |
| 요구사항·리스크 | [requirements-risks.md](requirements-risks.md) | 기능·비기능 요구사항, 가드레일, 장애 대응, 보안, 알려진 한계 |
| 테스트 전략 | [test-strategy.md](test-strategy.md) | 파트별 코드 테스트, AI 품질 점검, CI |
| 추가 지표 | [metrics.md](metrics.md) | 수집·평가 지표와 현재 측정값 |
| 인터페이스 명세 | [interface.md](interface.md) | API 묶음, 대표 요청·응답, AI↔BE 계약 요약 |

## 함께 볼 곳

- 설계 이유: [AI 로직](../ai-logic/index.md) — [판단 파이프라인](../ai-logic/judge-pipeline.md), [근거 검증](../ai-logic/evidence-check.md), [전사 오인식 검사](../ai-logic/asr-check.md), [답장 판단](../ai-logic/reply-judgment.md), [STT](../ai-logic/stt.md)
- API 전체: [API 문서](../api/index.md)
- 원자료: [프로젝트 상세 설명](../프로젝트%20상세%20설명.md) (2026-11-07 기준)
