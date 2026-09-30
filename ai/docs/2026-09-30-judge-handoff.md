# 판단 파이프라인을 회의 후처리의 추출·인계 단계에 연결

- 날짜: 2026-09-30
- 이슈: #NN
- PR: #NN
- 브랜치: feature/NN-judge-handoff (base: feat/106-judge-pipeline, #109 위에 쌓은 PR)
- 작성자: 김동우

## 한 일

- `capture/handoff.py`
  - `BeClient.similar_tasks(workspace_id, text)`. `POST /workspaces/{id}/tasks/similar` 를 `X-Service-Token` 으로 부르고 `NotionCandidate` 목록을 돌려준다. 메서드 이름이 같아서 `BeClient` 가 그대로 파이프라인의 `CandidateSource` 다 (560da47)
  - `Handoff.register` 가 매니페스트에 `items` 가 있으면 변환 없이 보낸다. 빈 문자열은 null 로, BE 가 받지 않은 항목 수는 `be.dropped_items`, 판단하지 못한 발화 수는 `be.missing_findings` (2ea51a5)
- `capture/judge_path.py` (새 파일)
  - `extract_path()`. `MM_EXTRACT_PATH=legacy|judge`, 모르는 값이면 ValueError
  - `build_extractor()`. 설정을 확인하고, 화자를 이름으로 바꿔 `judge.pipeline.run` 을 부르고, 결과의 화자를 uid 로 되돌린다. 항목 없이 실패만 있으면 `JudgeAllFailed` (5e73279)
- `capture/recorder.py`
  - `build_extractor` 가 플래그로 고른다. `extract_after_transcription` 이 판단 결과를 `session_<id>.items.json` 과 매니페스트에 적는다 (aa09e23)
  - 판단하지 못한 발화가 남으면 `ExtractIncomplete` 로 단계 실패를 세고 다시 돌린다. `MM_EXTRACT_RETRY_MAX`(기본 2)번 뒤에는 가장 나은 결과로 닫는다. 전사가 바뀌면 옛 판단 결과를 버린다 (6e39d6e, 042ea5d)
- `capture/discord_adapter.py`, `capture/worker.py`
  - 시작할 때 플래그를 검사한다 (e0c03bd)
  - 봇 모드 채널에 판단 결과(새 항목, 수정)의 설명 문장, 판단하지 못한 발화, BE 가 받지 않은 항목 수를 올린다 (fc8460d)
- `shared/config.py` 에 `be_service_token`, `.env.example` 과 README 에 `BE_SERVICE_TOKEN`, `MM_EXTRACT_PATH`
- 테스트 39개. `tests/capture/test_judge_path.py`, `test_judge_stage.py`, `test_judge_wiring.py` 새 파일, `test_handoff.py`, `test_discord_adapter.py`, `test_worker.py` 에 추가. `fake_be.py` 에 유사 검색과 헤더

## 왜

판단 파이프라인(#109)의 작업 기록에 남은 "봇 연결" 을 맡았다. 후처리는 봇 모드와 워커 모드가 같은 `process_session` 을 쓰므로, 추출 단계의 추출기만 바꿔 끼우면 두 모드가 같이 된다. 단계 구조, 재시도, 회의 잠금은 건드리지 않았다.

선택지와 버린 이유는 `decision_log/0016` 에 적었다. 요지는 셋이다.

- 빈 추출을 등록하지 않는다. BE 가 꺼졌거나 토큰이 틀리면 모든 발화가 유사 검색에서 실패하는데 파이프라인은 예외 없이 항목 0개를 돌려준다. BE 는 회의당 추출을 한 번만 받아서 그대로 등록하면 되돌릴 수 없다
- 판단하지 못한 발화가 있으면 먼저 보내지 않고 다시 돌린다. 판단 실패는 대기로 남기고 재시도하라는 #78 리뷰를 따랐다
- BE 로 가는 화자는 uid, LLM 이 읽는 화자는 이름이다. BE 가 1인칭 담당자를 uid 로 찾기 때문이다

`ai/judge/`, `ai/draft/`, `backend/` 는 건드리지 않았다.

## 결과

| 확인한 것 | 방법 | 결과 |
|---|---|---|
| 전체 테스트 | `.venv/bin/python -m pytest` | 669 통과 (작업 전 630) |
| 봇 모드에서 새 경로 | 가짜 디스코드 객체로 `/record` → `/stop` | 판단 항목이 가짜 BE 에 그대로 등록되고 채널에 설명 문장이 올라간다 |
| 워커 모드에서 새 경로 | `Worker.run_pass` | 같은 항목이 가짜 BE 에 등록된다 |
| 실제 파이프라인 배선 | `judge.pipeline.run` 에 가짜 LLM, 가짜 BE | 1단계 프롬프트에 이름이 보이고, 유사 검색에 토큰이 실리고, 1인칭 항목의 화자가 uid 로 돌아온다. 진척 발화가 상태 변경으로 BE 까지 간다 |
| 유사 검색 호출 | 로컬 HTTP 서버에 `requests` 로 실제 연결 | 경로, 헤더, 본문이 그대로 간다 |
| 토큰이 틀릴 때 | 가짜 BE 가 발화마다 401 | 등록하지 않고 추출 단계 실패로 센다 |

실제 LLM 과 실제 BE 로는 아직 안 돌렸다. 회의 하나의 LLM 호출 수는 1 + 발화 수 + 의미 있는 발화 수이고, 호출 단가와 시간은 아직 재지 않았다.

## 남은 것

- 실제 실행. BE 주소, 워크스페이스, 임베딩 설정을 갖춘 환경에서 두 모드로 회의 하나를 끝까지 돌린다. 그 뒤에 기본값을 `judge` 로 바꿀지 정한다
- 실패한 발화만 다시 돌리기. 지금은 파이프라인을 통째로 다시 돌린다. 파이프라인에 진입점이 생기면 바꾼다
- 워커 모드에서는 판단하지 못한 발화가 매니페스트와 로그에만 남는다. 웹에서 보이려면 BE 가 받을 칸이 있어야 한다
- 참여 명단(PM 이 정한 이름)을 BE 에서 받아 화자 이름으로 쓰기. BE 에 서비스 토큰으로 읽는 명단 API 가 없다
- ai-ci 는 develop 대상 PR 에서만 돈다. 이 PR 은 #109 가 머지돼 대상이 develop 으로 바뀐 뒤에 CI 가 돈다

## 생각해볼 점

- 새 항목의 확신도. `to_item` 이 `task_confidence` 를 보내지 않아 BE 에서 새 항목이 전부 hold 가 된다. 인계에서 숫자를 만들지 않고 그대로 보냈다. 값은 파이프라인에서 채우는 것이 맞다고 본다
- 1인칭 담당자. 파이프라인은 근거 묶음의 마지막 줄 화자를 넘긴다. "제가 맡을게요" 뒤에 다른 사람의 "네, 감사합니다" 가 같은 묶음이면 감사 인사를 한 사람이 담당자가 된다. 결정 근거와 담당자 근거를 나누는 것은 파이프라인 출력이 바뀌어야 한다. 지금 동작을 `test_judge_wiring.py` 에 적어 두었다
- LLM 호출에 제한 시간이 없다(`llm.MLAPIClient`). 응답이 멈추면 호출 하나가 SDK 기본값(읽기 600초, 재시도 2회)만큼 잡고, 후처리는 한 번에 한 회의라 뒤 회의가 기다린다
- 같은 회의 안에서 같은 일을 두 번 말하면 뒤 발화의 유사 검색에 앞 발화가 안 잡힌다. 앞의 것이 아직 task 가 아니어서다. 새 항목이 둘 나올 수 있다
- "지민님" 과 별칭 "지민" 은 글자가 달라 BE 가 못 찾는다. 옛 경로도 같다. 호칭을 어느 쪽에서 뗄지 정해야 한다
