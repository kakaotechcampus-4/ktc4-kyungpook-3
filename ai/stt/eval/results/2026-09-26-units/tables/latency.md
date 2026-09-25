# Elice 호출 지연

이전 측정(`stt/eval/results/2026-09-16-batch`, 정렬본 두 회의 Elice 설정 12개): 트랙 통째를 뺀 chunk·clip 호출 88건 중 20초 넘은 호출 14건, 재시도 3건, 실패 0건. 설정별 p50·p95 는 아래 표.

| 회의 | 설정 | 호출 | p50 | p95 | 20초 넘음 | 재시도 | 실패 |
|---|---|---|---|---|---|---|---|
| meeting-01-aligned | chunk-perturn | 7 | 16.88 | 26.95 | 2 | - | 0 |
| meeting-01-aligned | chunk-w6 | 7 | 9.98 | 21.95 | 1 | 0 | 0 |
| meeting-01-aligned | chunk-w9 | 7 | 14.17 | 25.19 | 1 | 0 | 0 |
| meeting-01-aligned | chunk | 7 | 30.33 | 37.39 | 7 | 2 | 0 |
| meeting-01-aligned | clip | 15 | 10.8 | 17.69 | 0 | - | 0 |
| meeting-01-aligned | whole | 6 | 24.92 | 29.29 | 6 | 0 | 0 |
| meeting-02-aligned | chunk-perturn | 7 | 17.64 | 18.5 | 0 | - | 0 |
| meeting-02-aligned | chunk-w6 | 7 | 11.34 | 20.75 | 1 | 0 | 0 |
| meeting-02-aligned | chunk-w9 | 7 | 9.17 | 20.38 | 1 | 1 | 0 |
| meeting-02-aligned | chunk | 7 | 10.39 | 22.87 | 1 | 0 | 0 |
| meeting-02-aligned | clip | 17 | 9.64 | 14.34 | 0 | - | 0 |
| meeting-02-aligned | whole | 6 | 28.43 | 49.05 | 6 | 0 | 0 |


이번 측정에서 Elice 로 보낸 호출이 없다.
