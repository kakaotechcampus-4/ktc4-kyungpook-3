# 운영 서버에서 부른 GPU 전사 서버 시간

- 날짜: 2026-11-05
- 이슈: [#393](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/393)
- 데이터: 정렬본을 이어 붙인 62.42분 합성 회의. 시간과 자원만 본다. 정확도 근거로 쓰지 않는다

운영 서버(t3.medium)에서 개인 AWS 의 g4dn.xlarge(vLLM, whisper-large-v3)를 공인 인터넷과 TLS 로 불렀다. `on` 부터 첫 200 까지 335초, 전사 166.2초로 합계 501초(8.35분)다. 초안 10분 기준에서 전사 몫은 들어온다. 각각 한 번 잰 값이다.

이 합계는 장애를 알아채는 시간, 워커 재시작, 추출과 인계를 넣지 않았다. 남는 시간은 1.65분이고 워커 재시작은 처리 중인 회의가 있으면 20분까지 걸릴 수 있다. 그래서 회의 하나가 끝날 때까지 전체가 10분 안에 든다는 뜻은 아니다.

이 값은 처음 전사하는 회의의 경로다. 장애에 걸려 포기된 회의를 다시 돌리는 경로는 회의를 하나씩, 클립을 하나씩 보내며 재지 않았다.

| 항목 | 값 |
|---|---|
| `on` 부터 첫 `/health` 200 | 335초 |
| 62.42분 합성 전사 | 166.2초 |
| 합계 | 501초 (8.35분) |
| 호출 / 실패 / 재시도 | 168 / 0 / 0 |
| 보낸 오디오 | 3402초 |
| 호출 p50 / p95 / 최대 | 5.03 / 6.39 / 6.66초 |
| 측정 프로세스 CPU / 최대 메모리 | 50.0초 / 약 483MiB |
| 측정 중 최대 동시 호출 | 6 |

[GPU 서버 안에서 부른 측정](../2026-11-04-gpu-serving/README.md)은 같은 회의가 159.8초였다. 호출 수와 보낸 오디오는 같고 차이는 6.4초(4%)다. 한 번씩 잰 값이라 전송 비용으로 단정하지 않는다. 콜드 스타트는 지난번 5.0분보다 0.6분 길다. 이번 값은 `on` 호출 21초와 운영 서버의 10초 간격 확인을 포함한다.

키 없는 `/v1/models` 는 401, 키가 있으면 200 이었다. 측정은 운영 워커를 쓰지 않았다. 코드를 임시 폴더에 복사해 일회성으로 돌렸고 워커는 재시작하지 않았으며 운영 `.env` 도 바꾸지 않았다. 그래서 워커 전환 경로는 이 측정으로 확인되지 않았다. 측정 뒤 인스턴스 0대를 확인했다.

## 재현

커밋 `83e1672c` 의 `ai/` 와 같은 코드로 돌렸다. 임시 폴더라 결과 JSON 의 `git_commit` 은 비어 있다. 원자료는 레포 밖 `mm/eval-runs/393-gpu-stt-fallback/2026-11-05-prod-long-60/` 에 있다.

Mac 에서 합성하고 GPU 서버를 켠다.

```bash
python -m stt.eval.capacity.synth --source $DATA/m01 --source $DATA/m02 --out $DATA/long-60 --minutes 60 --gap 5
deploy/gpu-stt/gpu-stt.sh on
```

`.env` 가 없는 임시 폴더로 코드와 `long-60` 을 옮겨, 운영 서버에서 돌린다. `--spend-file` 은 Elice 측정과 옵션을 맞춘 것이고 실제 과금이 아니다.

```bash
set -a; . <(sudo cat /etc/mm/gpu-stt.env); set +a
/opt/mm/ai/.venv/bin/python -m stt.eval.capacity.runner seq --tracks-dir $DATA/long-60 --label long-60 \
  --backend elice --spend-file $RUN/spend.jsonl --cap-krw 1000000 --out-dir $RUN --pids-file $RUN/pids
```
