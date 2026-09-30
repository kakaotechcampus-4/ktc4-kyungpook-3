# 판단 파이프라인을 회의 후처리의 추출·인계 단계에 연결

- 날짜: 2026-09-30
- 이슈: #NN
- PR: #NN
- 브랜치: feature/NN-judge-handoff (판단 파이프라인 #109 위에서 작업)
- 작성자: 김동우

## 한 일

- `capture/handoff.py`
  - `BeClient.similar_tasks(workspace_id, text)`. `POST /workspaces/{id}/tasks/similar` 를 `X-Service-Token` 으로 부르고 `NotionCandidate` 목록을 돌려준다. 파이프라인은 이것을 1단계가 고른 finding(결정이나 진척 보고 하나. 근거 줄 하나나 여러 줄과 요약 문장)마다 그 요약 문장으로 부른다. 메서드 이름이 같아서 `BeClient` 가 그대로 파이프라인의 `CandidateSource` 다 (560da47)
  - `Handoff.register` 가 매니페스트에 `items` 가 있으면 변환 없이 보낸다. 빈 문자열은 null 로, BE 가 받지 않은 항목 수는 `be.dropped_items`, 판단하지 못한 finding 수는 `be.missing_findings` (2ea51a5). BE 에 옛 추출이 남은 경우에는 두 수를 덮어쓰지 않는다
- `capture/judge_path.py` (새 파일)
  - `extract_path()`. `MM_EXTRACT_PATH=legacy|judge`, 모르는 값이면 ValueError
  - `build_extractor()`. 설정을 확인하고, 화자를 이름으로 바꿔 `judge.pipeline.run` 을 부르고, 결과의 화자를 uid 로 되돌린다. 항목 없이 실패만 있으면 `JudgeAllFailed` (5e73279, 7720852)
  - 같은 이름을 가르려고 붙인 꼬리표("민수(2)")를 담당자 호칭, 제목, 설명 문장에서 뗀다 (a283b3f)
- `capture/recorder.py`
  - `build_extractor` 가 플래그로 고른다. `extract_after_transcription` 이 판단 결과를 `session_<id>.items.json` 과 매니페스트에 적는다 (aa09e23)
  - 판단하지 못한 finding 이 남으면 `ExtractIncomplete` 로 단계 실패를 세고 다시 돌린다. `MM_EXTRACT_RETRY_MAX`(기본 2)번 뒤에는 가장 나은 결과로 닫는다 (6e39d6e, 042ea5d)
  - 다시 돌린 결과는 항목이 더 많을 때, 같으면 실패가 더 적을 때만 바꿔 끼운다 (0d27847)
  - 포기 직전 차례에 파이프라인이 통째로 실패하면 앞선 결과로 닫고 이유를 `extract_error` 에 남긴다 (b851d7d)
  - 전사가 바뀌면 옛 판단 결과를 버린다. 다시 돌리려고 둔 결과도 버린다 (471731d)
- `capture/discord_adapter.py`, `capture/worker.py`
  - 시작할 때 플래그를 검사한다 (e0c03bd)
  - 봇 모드 채널에 판단 결과(새 항목, 수정)의 설명 문장, 판단하지 못한 finding, BE 가 받지 않은 항목 수를 올린다 (fc8460d)
- `shared/config.py` 에 `be_service_token`, `.env.example` 과 README 에 `BE_SERVICE_TOKEN`, `MM_EXTRACT_PATH`
- 테스트 50개. `tests/capture/test_judge_path.py`, `test_judge_stage.py`, `test_judge_wiring.py` 새 파일, `test_handoff.py`, `test_discord_adapter.py`, `test_worker.py` 에 추가. `fake_be.py` 에 유사 검색과 헤더
- `tests/capture/conftest.py`. 개발 기기의 `.env` 에 `MM_PIPELINE_MODE=worker` 나 `MM_EXTRACT_PATH=judge` 가 있어도 기본값을 보는 테스트가 깨지지 않게 테스트마다 두 값을 지운다. `MM_PIPELINE_MODE=worker` 로 돌리면 이 작업 전에도 21개가 실패했다

## 왜

판단 파이프라인(#109)의 작업 기록에 남은 "봇 연결" 을 맡았다. 후처리는 봇 모드와 워커 모드가 같은 `process_session` 을 쓰므로, 추출 단계의 추출기만 바꿔 끼우면 두 모드가 같이 된다. 단계 구조, 재시도, 회의 잠금은 건드리지 않았다.

선택지와 버린 이유는 `decision_log/0016` 에 적었다. 요지는 셋이다.

- 빈 추출을 등록하지 않는다. BE 가 꺼졌거나 토큰이 틀리면 finding 이 모두 유사 검색에서 실패하는데 파이프라인은 예외 없이 항목 0개를 돌려준다. BE 는 회의당 추출을 한 번만 받아서 그대로 등록하면 되돌릴 수 없다
- 판단하지 못한 finding 이 있으면 먼저 보내지 않고 다시 돌린다. 판단 실패는 대기로 남기고 재시도하라는 #78 리뷰를 따랐다
- BE 로 가는 화자는 uid, LLM 이 읽는 화자는 이름이다. BE 가 1인칭 담당자를 uid 로 찾기 때문이다

`ai/judge/`, `ai/draft/`, `backend/` 는 건드리지 않았다.

## 결과

| 확인한 것 | 방법 | 결과 |
|---|---|---|
| 전체 테스트 | `.venv/bin/python -m pytest` | 680 통과 (작업 전 630) |
| 환경 변수를 바꿔서 | `MM_PIPELINE_MODE=worker MM_EXTRACT_PATH=judge MM_EXTRACT_RETRY_MAX=0` 을 주고 전체 테스트 | 같은 수가 통과한다 |
| 다시 돌린 결과가 비었을 때 | 첫 실행은 항목 둘에 실패 하나, 다음 실행은 항목 0에 실패 0 | 가진 결과를 두고 다시 돈 뒤 항목 둘을 등록한다. 고치기 전에는 빈 추출이 등록됐다 |
| 봇 모드에서 새 경로 | 가짜 디스코드 객체로 `/record` → `/stop` | 판단 항목이 가짜 BE 에 그대로 등록되고 채널에 설명 문장이 올라간다 |
| 워커 모드에서 새 경로 | `Worker.run_pass` | 같은 항목이 가짜 BE 에 등록된다 |
| 실제 파이프라인 배선 | `judge.pipeline.run` 에 가짜 LLM, 가짜 BE | 전사록 5줄에서 1단계가 finding 3개를 고르면 유사 검색 3번, Terra 3번, Luna 초안 3번, 등록 1번이다. 1단계 프롬프트에 이름이 보이고, 유사 검색에 토큰이 실리고, 1인칭 항목의 화자가 uid 로 돌아온다. 진척 보고가 상태 변경으로 BE 까지 간다 |
| 유사 검색 호출 | 로컬 HTTP 서버에 `requests` 로 실제 연결 | 경로, 헤더, 본문이 그대로 간다 |
| 토큰이 틀릴 때 | 가짜 BE 가 finding 마다 401 | 등록하지 않고 추출 단계 실패로 센다 |

실제 LLM 과 실제 BE 로는 아직 안 돌렸다. 회의 하나의 LLM 호출은 1(1단계) + F(finding 마다 Terra) + M(그중 의미 있다고 본 것마다 Luna 초안)이고 많아야 1 + 2F 다. F 는 전사록의 줄 수가 아니라 1단계가 고른 finding 수다. 일시 오류면 재시도로 요청이 더 나갈 수 있다. 호출 단가와 시간은 아직 재지 않았다.

## 남은 것

- 실제 실행. BE 주소, 워크스페이스, 임베딩 설정을 갖춘 환경에서 두 모드로 회의 하나를 끝까지 돌린다. 그 뒤에 기본값을 `judge` 로 바꿀지 정한다
- 실패한 finding 만 다시 돌리기. 지금은 파이프라인을 통째로 다시 돌린다. 파이프라인에 진입점이 생기면 바꾼다
- 워커 모드에서는 판단하지 못한 finding 이 매니페스트와 로그에만 남는다. 웹에서 보이려면 BE 가 받을 칸이 있어야 한다
- 참여 명단(PM 이 정한 이름)을 BE 에서 받아 화자 이름으로 쓰기. BE 에 서비스 토큰으로 읽는 명단 API 가 없다
- ai-ci 는 develop 대상 PR 에서만 돈다
- 빠진 구간을 둔 채 넘어간 회의(전사 재시도 상한에 닿은 partial)는 뒤 단계가 실패하면 실패 횟수가 매번 지워져 포기하지 않는다. 실패한 구간도 그때마다 전사에 다시 보낸다. 이 작업 전부터 있던 것이고 옛 경로도 같다. 따로 고친다

## 생각해볼 점

- 새 항목의 확신도. `to_item` 이 `task_confidence` 를 보내지 않아 BE 에서 새 항목이 전부 hold 가 된다. 인계에서 숫자를 만들지 않고 그대로 보냈다. 값은 파이프라인에서 채우는 것이 맞다고 본다
- 1인칭 담당자. 파이프라인은 근거 묶음의 마지막 줄 화자를 넘긴다. "제가 맡을게요" 뒤에 다른 사람의 "네, 감사합니다" 가 같은 묶음이면 감사 인사를 한 사람이 담당자가 된다. 결정 근거와 담당자 근거를 나누는 것은 파이프라인 출력이 바뀌어야 한다. 지금 동작을 `test_judge_wiring.py` 에 적어 두었다
- LLM 호출에 제한 시간이 없다(`llm.MLAPIClient`). 응답이 멈추면 호출 하나가 SDK 기본값(읽기 600초, 재시도 2회)만큼 잡고, 후처리는 한 번에 한 회의라 뒤 회의가 기다린다
- 같은 회의 안에서 같은 일을 두 번 말하면 뒤 finding 의 유사 검색에 앞 finding 이 안 잡힌다. 앞의 것이 아직 task 가 아니어서다. 새 항목이 둘 나올 수 있다
- "지민님" 과 별칭 "지민" 은 글자가 달라 BE 가 못 찾는다. 옛 경로도 같다. 호칭을 어느 쪽에서 뗄지 정해야 한다
