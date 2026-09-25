# 0008 표 3 을 바로잡고, 채점 기준이 모르고 바뀌면 CI 가 알리게 한다

- 날짜: 2026-09-26
- 이슈: #87
- PR: (이 PR)
- 브랜치: fix/87-rescore-regression
- 작성자: 김동우

## 한 일

- `capture/run_recorder.py`: `sys.path.insert` 를 뺐다. ai/ 안에서 `python -m capture.run_recorder` 로 돈다. 실행 명령이 적힌 `Makefile`, `ai/CLAUDE.md`, `ai/README.md` 도 고쳤다
- `stt/eval/fixtures/meeting-0N-aligned/truth_by_speaker.json`: 정렬본 두 회의의 화자별 정답 텍스트. 레포 밖 골든셋에서 그대로 복사했고 음성은 넣지 않았다
- `stt/eval/eval.py` 에 채점 기준 버전 `SCORING_VERSION` 을 두었다. `rescore` 와 `golden score` 가 결과 파일에 `scoring_version` 을 적는다. 버전을 적기 전에 만든 결과는 1 로 본다
- `tests/stt/test_rescore_results.py`: 저장된 결과 60개를 fixture 정답으로 다시 채점해 `cer`, `cer_by_speaker`, `insertion_rate` 가 저장값과 같은지 본다. 버전이 다른 결과는 이유를 달고 건너뛴다
- `meeting-01-aligned/score_chunk_local-large-v3-turbo-perturn.json` 을 다시 채점했다. 정답 수정 전 값이 남아 있었다. `matrix.md` 의 같은 행도 다시 만들었다
- `decision_log/0008` 표 3: m01 턴마다 묶음 6.31% 를 5.47% 로 고치고, "앞 턴의 문맥이 없어져서" 라는 원인 문장을 관찰한 사실로 바꿨다
- 소급 로그 둘: `2026-09-18-batch-transcription-retro.md`(#42 #43 #44 #46 #48), `2026-09-19-review-45-1st-retro.md`(#57)

## 왜

0008 의 6.31% 는 정답을 고친 뒤에도 옛 정답으로 채점한 값이 결과 파일에 남아서 생겼다. 누구도 몰랐고, 그 차이에 원인 설명까지 붙였다. 채점 기준이 바뀌었는데 저장된 수치가 그대로인 상황을 알아챌 방법이 필요했다.

세 방법을 비교했다.

| 방법 | 모르고 바뀐 것 | 일부러 바꾼 것 | 판단 |
|---|---|---|---|
| 저장값과 다르면 무조건 CI 실패 | 잡는다 | 막는다. 같은 PR 에서 결과를 전부 다시 채점해야 통과 | 버림. 채점 기준은 사람이 정하고 결과를 직접 비교하는 일이라 CI 가 막을 일이 아니다 |
| CI 없이 절차만 문서에 | 못 잡는다 | 바꾼 사람이 기억해야 한다 | 버림. 6.31% 가 바로 이렇게 생겼다 |
| 기준 버전으로 나누기 | 버전을 안 올렸는데 수치가 다르면 실패 | 버전을 올리면 옛 결과는 건너뜀으로만 보인다 | 골랐다 |

`python -m` 과 `pip install -e .` 중에서는 `python -m` 을 골랐다. 둘 다 멘토가 든 관행이고, editable install 은 pyproject 에 빌드 설정을 새로 넣어야 해 이 작업보다 크다.

## 결과

| 항목 | 값 |
|---|---|
| pytest | 491 passed (작업 전 424) |
| 새 테스트 | `test_run_recorder.py` 2, `test_rescore_results.py` 65 (결과 파일 60, 버전과 비교 규칙 4, 경로 가드 1) |
| 실패 먼저 확인 | import 테스트는 고치기 전에 실패했다. 재채점 테스트는 버전 상수가 없어 import 에서 실패했고, 구현 뒤에는 정답 수정 전 파일 하나만 실패했다 |
| 다시 채점한 파일 | cer 0.0631 → 0.0547, 유재환 0.0791 → 0.0435, 삽입률 0.0194 → 0.0154. `matrix.md` 는 그 행 하나만 바뀌었다 |
| 버전을 올려 보면 | `SCORING_VERSION = 2` 로 두고 돌리면 5 passed, 60 skipped. 사유는 "채점 기준 1 로 채점한 결과다(지금 2). rescore 로 다시 채점하면 다시 검사한다" |
| 턴마다 묶음과 기본값 | 두 회의, 로컬 turbo 와 Elice 모두 호출 7번, 보낸 오디오(m01 138.0초, m02 145.5초), 화자별 전사 텍스트가 같다 |
| 유료 호출 | 0 |

재현 (ai/ 안에서): `.venv/bin/python -m pytest tests/stt/test_rescore_results.py -rs`

## 남은 것

- 실시간 쪽 두 파일(`capture/realtime/run.py:78`, `stt/realtime/bench.py:38`)의 `sys.path.insert`. 실시간 폴더를 고치는 다른 작업과 겹쳐 뺐다
- PR #44 본문의 같은 표와 문장. 고칠 문구만 준비했다
- #24(9/12 실시간 전사)의 진행 로그는 이번에 쓰지 않았다

## 생각해볼 점

- 이 테스트는 채점만 지킨다. 전사를 바꾸는 변경(모델, VAD, 묶음 규칙)은 음성이 레포 밖이라 못 잡는다. 그건 평가 도구를 사람이 다시 돌려 잰다
- 정답이 골든셋 원본과 fixture 두 곳에 있다. 정답을 고치면 둘 다 고치고 버전을 올린다
- 0008 과 PR #44 본문의 "m01 1,062자" 는 지금 정답 파일의 글자 수(1,064)와 다르다. 무엇을 셌는지 확인하지 않아 고치지 않았다
