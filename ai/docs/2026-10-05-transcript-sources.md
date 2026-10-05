# 전사가 끝나면 발화를 BE 에 저장한다

- 날짜: 2026-10-05
- 이슈: #146
- PR: #NN
- 브랜치: feature/146-transcript-sources
- 작성자: 김동우

## 한 일

- `capture/handoff.py`
  - `BeClient.create_sources`: `POST /api/v1/meetings/{id}/sources` 를 `X-Service-Token` 으로 부른다(e356fdc)
  - `Handoff.save_sources`: 회의를 확보하고 `transcript.json` 에서 Transcript 모양만 골라 `speaker_names`(매니페스트 `speakers` 의 표시 이름)와 보낸다. 발화가 없으면 BE 를 부르지 않는다(bed781b). 보낸 BE 회의 ID 를 `be.sources` 에 남기고, `_fresh` 는 그것을 지우고, `register` 가 같은 실행 안에서 새 회의로 옮길 때는 발화를 먼저 보낸다(1ceedd2). 400 의 `details.fields` 를 오류에 붙인다(3202fe0)
- `capture/recorder.py`
  - 전사와 추출 사이의 단계 `sourced`, `FAILED_STAGE` 의 `sources`, 토큰이 없으면 건너뛰기, 재전사 뒤 다시 보내기(80c282e)
  - 저장 완료 판정 `sources_saved`(1ceedd2), 뒤 단계 실패 횟수를 이어 세기(a9ac729), 중간 재전사에서 살아난 줄도 다시 보내기(f516352), 바로 포기는 (상태, 코드) 쌍으로(3202fe0)
- `capture/discord_adapter.py`: 채널에 `🗂 BE 회의록 저장 N줄`, 단계 이름 "회의록 저장"(915ff91)
- `capture/worker.py`: 워커 로그에 저장 줄 수와 건너뛴 이유(f9d6b08)
- `capture/backfill_sources.py`(새): 인계가 끝났는데 지금 BE 회의에 발화가 없는 회의에 한 번 보낸다. `--dry-run`, 처리 중이던 회의가 있으면 종료 코드 2(dc95d68, f9d6b08)
- `stt/eval/constants.py`: develop 에서 실패하던 상수 목록 검사를 고쳤다. #127 의 채널 상수 두 개가 #93 의 목록에 빠져 있었다(2f47b89)
- 결정 기록 `decision_log/0017-transcript-sources-stage.md`

## 왜

BE 의 발화 저장 API(#130)를 봇이 부르지 않아 웹 회의록의 전사본·참석자·회의 길이가 비어 있었다. 보내는 시점, 실패 처리, 거절 판정, 저장 완료 판정의 대안과 버린 이유는 0017 에 있다.

구현 중에 정한 것이 하나 있다. BE 설정은 있는데 서비스 토큰만 없으면 이 단계를 건너뛰고 채널에 이유를 올린다. 옛 추출 경로는 토큰 없이 돌았는데, 저장 실패를 "멈추고 재시도" 로 두면 토큰이 없다는 이유로 추출과 인계까지 막힌다.

구현 뒤 다섯 관점(상태 흐름, BE 계약, 사용자와 운영, 테스트, 범위)으로 따로 리뷰하고 지적마다 반박 검증을 두 번 했다. 지적 27개 중 15개가 남았고 겹치는 것을 묶으면 9가지였다. 가장 큰 것은 추출에서 포기한 회의를 /recover 하면 새 BE 회의에 발화가 없는 경로였다. 9가지 모두 회귀 테스트를 먼저 쓰고 고쳤다.

## 결과

| 항목 | 값 |
|---|---|
| 테스트 | 804 통과(작업 전 develop 771 통과, 1 실패) |
| 새 테스트 | 32개. handoff 5, recorder 14, 채널 2, 소급 9, 워커 1, judge wiring 1 |
| 서버 소급(10/5, t3.medium, develop 0517775 로 돈 10/2 21:04 회의) | 발화 7줄 저장, `meeting.duration_ms` 67540, 다시 돌리면 대상 0개 |

```
cd ai && .venv/bin/python -m pytest        # 804 passed
python -m capture.backfill_sources --dry-run
```

서버 확인은 이 브랜치의 `ai/` 를 서버 임시 폴더에 풀고 서버의 `.env`·녹음·BE 를 그대로 써서 돌렸다. 새 회의를 녹음해 봇이 저장 단계를 도는 것은 아직 안 했다.

## 남은 것

- 근거를 seq 로 잇는 것(#124 evidence_seqs)은 BE 다음 작업이다. 그때까지 evidence_quote·evidence_speaker·evidence_at_ms 를 그대로 보낸다
- 409 에서 새 회의를 만들어 다시 보내기. `end()` 가 failed 회의를 이미 새 회의로 바꿔서 409 는 그 사이 경합에서만 난다
- 실패한 줄이 남아 멈춘 회의(partial)의 중간 전송. 단계가 닫힐 때 한 번 보낸다
- 말이 없는 회의가 실패로 닫히는 문제(계약 파일 없음)는 따로 고친다

## 생각해볼 점

- 서비스 토큰이 발화 저장과 유사 검색에만 걸려 있다. 회의 생성·종료·실패·추출 등록에도 같은 경계를 둘지는 BE 와 정한다(#128 고민 4)
- 재전사 중간에 partial 로 돌아가면 추출·인계 기록을 지우지 않는 것은 develop 에 원래 있던 동작이다. 이번에는 발화 저장만 다시 보내게 했다
