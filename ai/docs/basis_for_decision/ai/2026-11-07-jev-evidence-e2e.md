# 음성 회의 전사에서 BE 태스크까지 Jev 근거 상태가 붙는지 확인

- 날짜: 2026-11-07
- 브랜치: `feature/jev-evidence-e2e`

## 한 일

팀 할 일 목록의 "E2E: 음성 회의 이후 task 에 Jev 신뢰도가 잘 붙는지"를 확인했다. 음성 파일 대신 전사록 형식의 회의 7줄을 만들었다(`judge/golden_set_pipeline/meeting_jev_evidence_status.json`). 명시 약속과 명시 마감, 흐린 마감("이번 주 안에"), 마감 없음, 조건부 약속("시간 되면")을 한 줄씩 넣었다.

1. AI: judge 파이프라인을 실제 Luna·Terra·임베딩·Jev 로 돌렸다. BE 의 유사 검색만 fixture 로 흉내 낸다(`judge.eval_pipeline`). 기대 조건에 `task_status`·`due_status` 를 더해 이 fixture 가 근거 상태를 확인한다.
2. BE: 첫 실행의 AI 출력을 손대지 않고 `backend/tests/api/data/ai_judge_items_jev_evidence.json` 에 두고, sqlite 인메모리 BE 의 `POST /extractions` 에 넣는 테스트를 더했다(`backend/tests/api/test_extractions_jev_evidence.py`). 실제 API 를 부르지 않아 CI 에서 돈다.

## 결과

실제 실행 2회 모두 같은 근거 상태가 나왔다(두 번째는 `eval_pipeline` 로 3/3 통과). Jev 는 실행마다 3번 불렸고, 실패 시 대체값(inferred)이 아니라 응답 확률로 상태가 정해졌다.

| 할 일 | Jev 응답(첫 실행) | AI 상태 (할 일 / 마감) | BE 저장 | BE 게이트 |
|---|---|---|---|---|
| 로그인 API 연동 (금요일까지) | 할 일 yes 1.0, 마감 yes 0.95 | certain / certain | 같음 | auto, 태스크 생성(담당 하은, 11-13) |
| 검색 성능 개선 검토 (이번 주 안에) | 할 일 yes 1.0, 마감 unclear 0.88 | certain / inferred | 같음 | review (`due_not_certain`) |
| 알림 설정 페이지 개발 (마감 없음) | 할 일 yes 1.0 | certain / missing | 같음 | review (`unsearched_task_exists`) |
| 다크 모드 (시간 되면) | 묻지 않음 | 추출 안 됨 | – | – |

"알림 설정" 은 근거 상태로는 auto 조건을 만족한다. 같은 회의에서 방금 auto 로 만든 태스크가 아직 임베딩 전이라 BE 가 중복을 확인할 수 없어 review 로 보냈다. `matching.auto_blockers` 주석에 적힌 의도된 동작이다.

## 한계

- Jev 는 `MM_EXTRACT_PATH=judge` 일 때만 쓰인다. 기본값 `legacy` 는 Jev 를 부르지 않는다. 운영 서버가 어느 경로인지는 저장소로 확인할 수 없다.
- 음성 파일과 전사(STT)는 거치지 않았다. 전사 결과 모양(`Transcript`)부터 시작한다.
- 담당자 표현은 실행마다 달랐다(첫 실행은 1인칭 화자, 두 번째는 "하은님"). 근거 상태는 같았다.
- 회의 한 건, 실행 2회다. 근거 상태의 정답률은 `judge.eval_evidence` 가 잰다.

## 재현

- AI(키 필요, 비용 발생): `ai/` 에서 `.venv/bin/python -m judge.eval_pipeline`. 모든 fixture 를 돌린다.
- BE: `backend/` 에서 `pytest tests/api/test_extractions_jev_evidence.py`
