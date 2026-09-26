# 멘토의 #45 1차 리뷰를 반영한다. 전사 실패 복구, 서버 범위, 공용 계층, BE 인계 (#57 소급)

- 날짜: 2026-09-19 작업과 머지(10:31 KST). 2026-09-26 소급 작성
- 이슈: #56
- PR: #57
- 브랜치: feature/56-review-45
- 작성자: 김동우

멘토가 #45(develop → main)에 남긴 1차 리뷰(2026-09-17 KST) 중 녹음·전사 쪽 항목 R01~R11, R26, Q03 을 반영했다. 요지는 실패한 전사가 조용히 완료로 닫히지 않고 마지막으로 성공한 단계 다음부터 다시 이어지는 것, 그리고 결과를 봇이 BE 에 넘기는 것이다. 머지 커밋 `940e158`, 커밋 13개, 파일 25개(+1935 -319). 머지할 때 남기지 않은 로그를 뒤늦게 쓰고, 사실은 PR 본문과 머지 커밋의 코드에서 모았다.

## 한 일

단계 재개와 실패 복구
- 종료 뒤 처리를 단계로 나눴다. 매니페스트 `status` 는 recording, saved, transcribed(일부 실패면 partial), extracted, handed_off 로 가고 단계별 완료 시각은 `stages` 에 적는다. `recorder.process_session` 이 빠진 단계부터 끝까지 돌고 `/stop` 뒤 처리와 `/recover` 가 이 함수 하나를 쓴다. 죽은 단계는 `failed`, `failed_stage`, `error` 로 남는다. R05 (`fb7d463`)
- 전사 호출이 하나라도 실패하면 partial 로 두고 `failed_units` 에 화자, 구간, 오류를 적는다. `/recover` 가 그 구간만 다시 전사해 회의록에 끼운다. R03 (`8bd3aa0`, `09d3f9e`)
- 녹음 중 프로세스가 죽은 회의는 디렉토리에서 트랙을 다시 찾는다. 매니페스트는 `.tmp` 에 쓴 뒤 `os.replace` 로 바꿔 끼운다. R04
- 채널 알림은 `_notify` 로 감싸 실패해도 상태 처리와 완료 신호를 막지 않는다. R06. 녹음 중인 회의와 후처리 중인 회의를 나눠 `/end` 는 자기 회의만 기다리고 그 사이 시작한 새 녹음을 끊지 않는다. R07 (`97829d8`)

서버 범위와 날짜
- 회의 ID 를 `<guild>_<ts>` 로 통일하고 `/recover` 는 그 서버의 회의만 원래 채널에 올린다. R08
- 매니페스트에 `timezone`(기본 Asia/Seoul, `MEETING_TIMEZONE`)을 적고, `started_at` 을 그 시간대로 바꾼 날짜를 `extract_tasks` 의 today 로 넘긴다. 복구를 며칠 뒤에 돌려도 "내일" 의 기준이 회의 날짜다. R11
- 단어 시각이 없는 묶음은 구간 전체를 한 줄로 두고 `timing=chunk` 로 표시한다. 로컬 백엔드는 클립 단위로 다시 전사한다. Q03 (`8bd54f6`)

공용 계층과 부하
- 재연결로 음성 키가 바뀌면 복호화기를 갱신하는 처리를 실시간 폴더에서 `SafeVoiceClient` 로 옮겼다. 키가 바뀌는 순간 `reader.update_secret_key` 를 부른다. R09 (`636992a`)
- `stt/batch.py` 가 트랙을 하나씩 읽어 묶음을 복사한 뒤 원본 배열을 놓는다. 모델은 프로세스에 하나만 만들고 회의 후처리는 세마포어로 줄 세운다. R10 (`8bd54f6`)
- 최대 RSS 를 `peak_rss_bytes` 로 모았다. darwin 은 바이트, 그 외는 KiB 라 1024 를 곱한다. R26 (`58a792a`)

BE 인계
- `capture/handoff.py` 의 `BeClient` 가 `POST /meetings`, `PATCH /meetings/{id}/end`, `PATCH /meetings/{id}/fail`, `POST /extractions` 를 부른다. `/record` 에서 회의를 만들고, 트랙을 닫으면 end, 추출이 끝나면 extractions, 어느 단계가 실패하면 `failed_stage` 와 함께 fail 을 보낸다. R01·R02 의 녹음기 몫 (`e3907fe`)
- 추출 결과를 `ExtractionItemCreate` 로 바꿔 근거 문장을 말한 트랙의 uid 와 그 발화 시각, `assignee_type` 을 싣는다
- BE 가 done 으로 닫은 회의에 뒤늦게 실패를 알려도 failed 로 적지 않고 (`998ff3f`), 실패한 BE 회의를 새 회의로 바꿀 때 옛 실패 표시를 지운다 (`23c36aa`)
- 결정과 버린 대안은 `decision_log/0009` (`364bdb7`)

## 왜

리뷰가 짚은 것은 복구 경로에서 데이터가 사라지는 길이었다. 전사 호출 하나가 실패해도 transcribed 로 닫혀 `/recover` 대상에서 빠졌고, 녹음 중 프로세스가 죽으면 트랙이 있어도 복구가 건너뛰었고, 복구는 전사까지만 해서 추출만 실패한 회의는 다시 돌릴 길이 없었다(#56 작업 개요).

BE 인계는 봇이 BE 회의 API 를 직접 부르는 쪽으로 정했다. BE 가 매니페스트나 훅을 보고 가져가는 대안은 BE 가 봇의 파일 구조를 알아야 하고, 봇이 죽은 뒤 복구한 회의를 누가 다시 넘길지가 다시 빈다. 자세한 근거는 `decision_log/0009` 에 있다.

## 결과

| 항목 | 값 |
|---|---|
| 머지 커밋 `940e158` 의 전체 테스트 | 397 passed (2026-09-26 의 venv 로 다시 돌림. PR 본문의 397 과 같다) |
| 이 PR 이 더한 테스트 | 35 (첫 부모 `b8a2ed8` 362 개에서 397 개) |
| 새 테스트 파일 | `tests/capture/test_handoff.py`, `test_voice_client.py`, `tests/stt/test_sysinfo.py`, 가짜 BE `tests/capture/fake_be.py` |

PR 본문에는 develop 의 BE 코드(`backend/app`)를 프로세스 안에 띄워 인계를 맞춰 본 결과도 적었다. 회의 생성, 종료, 추출 등록이 done 까지 갔고, 같은 회의를 다시 보내면 같은 extraction 이 돌아왔다. 별칭을 등록한 3인칭 항목은 AUTO 로 Task 가 생겼고, 1인칭 항목은 uid 로 팀원을 등록해 두어도 member_id 가 비어 review 로 갔다.

재현: `git archive 940e158 ai | tar -x -C <빈 디렉토리>` 뒤 그 안의 `ai/` 에서 `<venv>/bin/python -m pytest -p no:cacheprovider`.

## 남은 것

- 실제 디스코드 서버에서 녹음 중 음성 채널 지역을 바꿨을 때 재연결 뒤 패킷이 오는지, 봇을 죽였다 살려 `/recover` 가 잇는지. 아직 안 했다
- 60분 회의에서 전사, 추출, 다음 녹음이 겹칠 때의 RSS 와 완료 시간 (#40)
- BE 와 정할 것: 1인칭 담당자를 별칭 텍스트가 아니라 `discord_user_id` 로 찾기, failed 뒤 되돌리는 전이, 길드와 워크스페이스의 연결, 추출 확신도를 숫자 신뢰도로 바꾸는 규칙 (`decision_log/0009` 남은 것)

## 생각해볼 점

- 멘토 2차 리뷰(#45, 9/19)가 이 PR 의 복구 경로에서 구멍을 더 찾았다. 녹음 중인 회의를 `/recover` 가 집을 수 있고, 일부만 살아난 partial 회의가 인계까지 가서 복구에서 빠지고, 전사가 채워져도 다시 추출하지 않는다. #83 으로 올렸고 2026-09-26 현재 열려 있다
- 이 PR 은 실패한 줄을 한 번 다시 보낸 뒤에도 남으면 그 줄이 빠진 채 추출과 인계로 넘어갔다. 나중에 그 줄이 살아나면 다시 추출하고 다시 넘겨야 하는데 BE 는 done 회의에 새 추출을 받지 않는다. #83 은 재시도 상한(기본 3회)까지 기다렸다 보낸다
- 판단(judge) 결과가 봇에 붙으면 `to_extraction_items` 의 입력이 바뀐다. 인계에 무엇을 싣는지는 judge·BE 담당과 다시 맞춰야 한다
