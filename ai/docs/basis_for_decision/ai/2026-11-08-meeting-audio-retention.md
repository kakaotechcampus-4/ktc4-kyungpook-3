# 인계 끝난 회의 음성을 바로 지우고 녹음 공지에 외부 전송을 알린다

- 날짜: 2026-11-08
- 이슈: #561, #562
- 브랜치: feature/561-audio-retention
- 작성자: 김동우

## 한 일

- `capture/recorder.py`: `prune_audio` 를 더했다. 인계가 끝나 더 돌 일이 없는 회의의 트랙 wav 는 바로, 처리를 포기한 회의는 포기 7일 뒤, 인계도 포기도 못 하고 멈춘 디스코드 회의는 마지막 진행 7일 뒤 지운다. 매니페스트·대본·처리 기록은 남기고 잠긴 회의는 건너뛴다. 정책 시행(`AUDIO_PRUNE_SINCE`, 2026-11-09 00:00 KST) 전에 인계되거나 포기한 회의는 팀원 동의를 받은 검증용이라 남기고, 지우려면 사람이 직접 지운다
- `capture/worker.py`: 바퀴마다 `prune_audio` 를 부른다. 실패해도 로그만 남기고 바퀴는 계속 돈다
- `capture/discord_adapter.py`: 녹음 공지(`/record` 와 늦게 들어온 사람 알림)에 "전사와 정리를 위해 음성을 외부 서비스(Elice)로 보냅니다. 녹음을 원하지 않으면 음성 채널에서 나가 주세요." 를 더했다
- 업로드 트랙을 인계 7일 뒤 지운다고 적은 문서(`ai/CLAUDE.md`, `ai/README.md`, 결정 기록 0044, `upload/cleanup.py` 주석)를 바꿨다

## 왜

#360 의 "회의가 완료되면 음성을 지운다" 결정과 AI 서버 동작이 달랐다. 디스코드 녹음은 지우는 코드가 없었다. 보관 기간을 고른 근거는 [0053](2026-11-08-0053-meeting-audio-retention.md).

## 결과

| 항목 | 값 |
|---|---|
| 새 테스트 | `tests/capture/test_prune_audio.py` 14건, `test_worker.py` 2건, `test_discord_adapter.py` 1건 |
| 전체 | `.venv/bin/python -m pytest -q -p no:warnings` 종료 코드 0 |


## 다음

- 운영 서버의 옛 회의 7개(트랙 wav 30개, 매니페스트에 없는 wav 4개)는 지우지 않는다. 필요 없어지면 사람이 직접 지운다
