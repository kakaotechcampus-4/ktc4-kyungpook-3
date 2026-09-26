# fixtures/

저장된 채점 결과를 모델 없이 다시 채점할 때 쓰는 정답 텍스트다. `tests/stt/test_rescore_results.py` 가 CI 에서 `results/2026-09-16-batch/` 의 score_*.json 60개를 이 정답으로 다시 채점해 저장된 `cer`, `cer_by_speaker`, `insertion_rate` 와 같은지 본다. 채점 기준이 모르고 바뀌는 것을 잡으려는 것이고, 기준을 일부러 바꾸는 것은 막지 않는다(아래 "채점 기준을 바꿀 때").

| 파일 | 내용 | 화자 | 글자 수(len) |
|---|---|---|---|
| `meeting-01-aligned/truth_by_speaker.json` | 실제 6인 녹음 1회차 정렬본의 화자별 정답 | 6 | 1,064 |
| `meeting-02-aligned/truth_by_speaker.json` | 같은 대본을 읽은 2회차 | 6 | 1,054 |

레포 밖 골든셋의 `meeting-0N-aligned/truth_by_speaker.json` 을 2026-09-26 에 바이트 그대로 복사했다. 오디오는 넣지 않는다. 그래서 전사를 다시 돌리는 데는 못 쓰고, 결과 파일에 남은 전사(`hyp_by_speaker`)를 다시 채점하는 데만 쓴다.

## 이 정답으로 말할 수 없는 것

원본 `meta.json` 의 known_issues 를 옮긴다. 대본을 읽은 녹음이라 회의체 자유발화(어·음, 말 끊김, 되묻기)가 없다. 정렬본의 시간축은 합성이다. 원본 트랙은 시작 시각이 화자마다 달라(김환의 첫 발화가 1회차 24.4초, 2회차 47.4초이고 나머지는 0초 근처) 회의 순서를 복원할 수 없어서, 대본 순서대로 발화를 놓고 사이에 1.0초 침묵을 넣었다. 목소리는 원본 그대로다. 화자별 CER 은 이 영향을 받지 않지만 순서·시각 지표는 합성 순서 대비라 실제 회의 성능으로 읽지 않는다.

meeting-01 은 유재환 첫 클립 앞의 대본 밖 발화 "다시 하겠습니다." 를 2026-09-16 에 정답에 넣었다. 원본의 "네," 는 VAD 가 놓쳐 정렬본 오디오에 없고 정답에도 없다. meeting-02 정답은 원본 골든셋과 바이트까지 같다.

## 채점 기준을 바꿀 때

정규화, `score`, rescore 의 합산, 이 정답 중 하나를 일부러 바꾸면 `stt/eval/eval.py` 의 `SCORING_VERSION` 을 1 올린다. 결과 파일에는 채점한 기준 버전이 `scoring_version` 으로 적히고, 적히기 전에 만든 결과는 1 로 본다.

- 버전을 올리면 옛 버전 결과는 실패 대신 건너뜀으로 보인다. 테스트 요약의 "N skipped" 가 아직 옛 기준인 결과 수다
- 새 기준 수치가 필요하면 아래 명령으로 다시 채점하고 `git diff` 로 파일마다 옛 값과 새 값을 비교한다. 결론이 바뀌면 decision_log 수치도 고친다
- 버전을 안 올렸는데 수치가 달라지면 테스트가 실패한다. 채점 라이브러리 버전이 바뀐 경우도 여기서 걸린다

2026-09-26 에 `meeting-01-aligned/score_chunk_local-large-v3-turbo-perturn.json` 하나를 다시 채점했다. 위 정답 수정 전에 채점한 값(6.31%)이 남아 있었고, 지금 정답으로 5.47% 다.

## 정답을 고칠 때

골든셋 원본과 이 fixture 를 같이 고치고 `SCORING_VERSION` 을 올린 뒤 같은 PR 에서 결과를 다시 채점한다. rescore 는 결과 파일을 제자리에서 고쳐 쓴다. ai/ 안에서:

```bash
.venv/bin/python -m stt.eval.rescore --session stt/eval/fixtures/meeting-01-aligned \
  --results stt/eval/results/2026-09-16-batch/meeting-01-aligned
.venv/bin/python -m stt.eval.matrix report --out stt/eval/results/2026-09-16-batch
.venv/bin/python -m pytest tests/stt/test_rescore_results.py
```
