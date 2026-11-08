# 다시 돌린 판단 결과를 얘기 단위로 합친다

- 날짜: 2026-11-07
- 이슈: #217
- PR:
- 브랜치: fix/217-judge-retry-selection
- 작성자: 김동우

## 한 일

- `judge/pipeline.py`: `PipelineResult.outcomes` 를 더했다. 나간 카드와 실패마다 근거 문장 번호와 결과(항목·건너뜀·실패)가 하나씩 있다. 앞 카드에 합쳐진 finding 의 번호는 그 카드의 결과에 더하고, 회의 안에서 되돌린 카드의 결과는 건너뜀으로 바꾼다
- `capture/judge_path.py`: `JudgeOutput` 이 `outcomes` 를 갖고 `items`, `failures` 는 여기서 읽는다. `merge_runs` 가 여러 실행의 결과를 근거 문장 번호가 겹치는 것끼리 묶어 얘기마다 합친다. 기준은 [0054](2026-11-07-0054-merge-judge-reruns-by-story.md)
- `capture/recorder.py` `_keep_judge_output`: 실행마다 결과와 전사 해시를 `session_<회의ID>.judge_runs.json` 에 쌓고, 합친 결과로 항목 파일과 `extract_failures` 를 쓴다. `extract_dropped` 는 실행마다 하나씩 리스트로 남긴다. 전사가 바뀌면 `judge_runs` 도 지운다(`_JUDGE_KEYS`)
- `capture/recorder.py`: 전사 재시도 상한에 닿아 빠진 구간을 둔 채 넘어간 회의는 그 구간을 다시 전사하지 않는다. 다시 전사하면 바퀴마다 전사 단계가 닫혀 `recovery` 가 지워지고, 추출이 계속 실패하는 회의가 포기 없이 STT 와 파이프라인을 계속 불렀다. 상한을 올리면 지금처럼 다시 보낸다
- 결정 기록 0054, 0016 에 바뀐 규칙을 가리키는 줄

## 왜

멘토 리뷰(#128 `recorder.py:971`, #175 10/8·10/10)가 항목 수로 실행 하나를 고르면 다시 돌려서 성공한 finding 이 버려진다고 짚었다. 검토한 선택지와 버린 이유, 엇갈린 항목을 auto 게이트에 맡긴 이유는 0054 에 적었다.

## 결과

| 항목 | 값 |
|---|---|
| 전체 테스트 | 1900 통과 |
| 실제 파이프라인 재현 | `test_a_rerun_of_the_real_pipeline_keeps_what_each_run_judged` 는 LLM 응답만 가짜로 두고 파이프라인을 두 번 돌린다. 옛 항목 수 규칙을 임시로 되살리면 실패하고, 되돌리면 통과한다 |
| 카드 합치기 | `test_pipeline.py` 의 모든 실행에서 `outcomes` 가 `items`, `failures` 를 순서대로 정확히 한 번씩 가리키는지 본다 |
| 얘기 묶기 | 멘토 예, 모든 실행이 실패한 얘기만 실패 하나, 다른 실행이 건너뛴 얘기의 항목 유지, finding 없는 실행, 실행마다 다르게 쪼갠 얘기, 한 실행에서 합쳐진 카드를 다른 실행이 쪼갠 경우 |
| 끝없는 재시도 | `test_a_meeting_closed_with_missing_lines_gives_up_instead_of_retrying_stt_forever` 는 수정 전 코드에서 포기하지 않아 실패하고, 수정 뒤 다섯 번째 바퀴에 포기한다 |
| 실제 회의 | 저장된 회의로 돌리는 유료 검증은 아직 안 했다. 판단 품질 수치는 새로 재지 않았다 |
| 비용 | 0원 |

```
cd ai && .venv/bin/python -m pytest -o addopts=""
```

## 남은 것

- 배포 때 재시도 중이던 회의는 실행 기록이 없어 옛 규칙으로 견주고, 새 실행이 이기면 그때부터 합친다
- `extract_dropped` 를 실행마다 리스트로 바꾼 것과 얘기를 묶는 기준은 판단 담당의 확인을 받는다

## 생각해볼 점

- 다시 볼 조건은 0054 에 모았다. 엇갈린 빈도와 근거 문장이 안 겹치는 카드 두 장의 빈도는 아직 재지 않았다
