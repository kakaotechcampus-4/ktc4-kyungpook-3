# 2026-09-16 배치 전사 방식 비교 결과

`decision_log/0008` 의 표가 여기서 나왔다. 설정마다 새 프로세스로 돌려 최대 RSS 를 따로 쟀다.

- `meeting-01-aligned/`, `meeting-02-aligned/`: 실제 6인 녹음 두 회의를 대본 순서대로 놓은 정렬본의 설정별 점수.
  파일 이름은 `score_<모드>_<백엔드>[-<모델>][-<변형>].json`. 화자별 전사(`hyp_by_speaker`)가 들어 있어
  `python -m stt.eval.rescore` 로 다시 채점할 수 있다
- `fleurs/`: 공개 FLEURS 한국어 120클립의 모델별 점수. `-nogate` 가 모델 순위(필터 없음), 꼬리표 없는 것은 필터를
  클립 통째에 건 것(43개 거름, 0005 참고), `-trimgate` 는 앞뒤 무음을 떼고 필터를 건 것
- `matrix.md`: 위 JSON 을 표로 뽑은 것. `python -m stt.eval.matrix report --out <이 디렉토리>` 로 다시 만든다

Elice 의 첫 측정(고정 30초 타임아웃으로 전부 잘린 것)은 여기 없다. 2026-09-17 오전에 타임아웃을 길이에
비례시키고 다시 잰 값이다. 오디오는 레포 밖에 있다. 정렬본은 `python -m stt.eval.golden align` 이 원본 골든셋에서 만든다.
재현: `python -m stt.eval.matrix run --golden <정렬본…> --fleurs <fleurs_ko> --out <디렉토리>`.
