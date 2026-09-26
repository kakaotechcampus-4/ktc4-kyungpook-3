# 후처리 복구를 자동으로 돌리고 워커 프로세스로 뗄 수 있게 한다

- 날짜: 2026-09-26
- 이슈: #88
- PR: #94
- 브랜치: feature/88-recovery-loop (#83 위. #83 먼저 머지)
- 작성자: 김동우

## 한 일

복구 자동화

- `recorder.process_session`: 단계를 닫지 못한 실행(failed, partial)을 `recovery.attempts` 로 센다. 다음 시도는 60초에서 두 배씩 미루고 한 시간에서 멈춘다. 상한(`MM_RECOVERY_MAX_ATTEMPTS`, 기본 5)에 닿으면 포기하고 그때 처음 BE 에 fail 을 보낸다. 전에는 첫 실패에서 바로 보냈다
- `recorder.recovery_targets`, `recover_one`, `recover_pass`: 한 바퀴의 대상 고르기, 회의 하나 돌리기, 바퀴 전체. 봇의 루프, `/recover`, 워커가 같이 쓴다. 대상은 바퀴를 시작할 때 정하고 먼저 시작한 회의부터 돈다
- 봇 안의 루프: `on_ready`(준비된 뒤 붙었으면 붙는 자리)에서 뜨고 첫 바퀴를 바로 돈다. 주기 `MM_RECOVERY_INTERVAL_S`(기본 60초, 0 이면 끔). `cog_unload` 가 취소한다
- 포기 때 BE 가 꺼져 fail 이 안 닿았으면 fail 만 다시 보낸다. 자동 복구 전에 failed 로 끝난 회의와 서버가 적히지 않은 옛 매니페스트는 루프가 집지 않는다
- 처리 도중 죽은 실행(메모리 상한, 종료 대기 시간 초과)은 다음에 잡는 쪽이 남은 `claimed_by` 를 보고 실패 한 번으로 센다. 안 세면 다시 뜬 워커가 같은 회의를 곧바로 다시 집고 또 죽는다
- 채널 알림: "N분 뒤 자동으로 다시" 와 포기를 알린다(루프가 떠 있을 때만). 봇이 녹음 중에 죽었다 다시 뜨면 끊긴 회의 채널에 재시작 안내를 한 번 올린다(끊긴 지 한 시간 안일 때만, 워커가 먼저 집은 회의도)

회의 잠금과 워커 분리

- `recorder.try_lock`, `Claims`: 누가 회의를 처리할지는 `session_<회의ID>.lock` 의 flock 하나로 정한다. 매니페스트의 `claimed_by`·`claimed_at` 은 "누가 몇 분째" 를 보여 주는 표시로만 남기고 만료 규칙과 `MM_RECOVERY_CLAIM_TTL_S` 는 없앴다
- `/record` 는 잠금을 먼저 잡고 recording 을 쓴다. 봇 모드는 스스로 처리하는 동안까지, 워커 모드는 saved 를 다 쓸 때까지 쥔다. 같은 초에 시작한 녹음은 다음 초의 회의 ID 를 쓴다
- `capture/worker.py`: `python -m capture.worker`. asyncio 로 돌고 처리는 스레드에서 한 번에 한 회의만 한다. 주기 `MM_WORKER_INTERVAL_S`(기본 10초). 살아 있다는 표시와 깨우기 파일은 `recordings/.worker/` 에 둔다. 종료 신호를 받으면 하던 회의만 마친다. discord 를 import 하지 않는다
- `MM_PIPELINE_MODE=worker` 의 봇: 저장까지만 하고 "처리되면 웹에서 확인(앞에 N건)" 을 올린다. `/recover` 는 워커를 깨우고 대기열과 워커 상태를 알린다. 전사 백엔드를 싣지 않는다. 다른 모드 값이면 시작할 때 멈춘다
- 잠금은 플랫폼별로 나눴다. POSIX 는 fcntl.flock, 윈도는 msvcrt.locking(첫 1바이트, 기다리지 않음)이고 import 는 분기 안에서 한다. 모듈 맨 위에서 fcntl 을 부르면 윈도로 AI 코드를 돌리는 동료의 테스트가 capture 부터 깨진다. 윈도 이벤트 루프에는 add_signal_handler 가 없어 워커는 signal.signal 로 종료 신호를 받는다
- `ai/deploy/systemd/`: 봇과 워커의 서버 설정 예시. 배포는 팀이 정한다
- 결정과 기본값은 `decision_log/0013-recovery-worker-and-meeting-lock.md`

## 왜

- 결정과 버린 선택지는 0013 에 있다
- 코드를 읽다 #83 의 `/recover` 에서 경쟁을 찾았다. 보유 회의 집합은 세마포어를 기다리기 전에 만들고 목록은 기다린 뒤 스레드에서 만들어서, 기다리는 사이 시작된 녹음의 wav 를 집었다. 테스트로 재현하니 새 녹음이 `recording` 에서 `transcribed` 로 바뀌었다
- 처음에는 매니페스트 표시와 만료로 배제했다. 죽은 프로세스의 표시가 만료(2시간)까지 회의를 막았고 두 프로세스 사이는 원자적이지 않았다. flock 은 쥔 쪽이 죽으면 OS 가 풀어 이 둘이 같이 없어진다
- `/record` 에 잠금을 넣자 같은 초에 시작한 두 녹음이 같은 회의 ID 를 받는 것이 드러났다. 전에는 뒤 녹음이 앞 회의의 매니페스트를 덮어썼다
- 내 개발 기기의 `recordings/` 를 읽어 보니 끝나지 않은 매니페스트가 8개였고 모두 서버가 적히지 않은 9/12 녹음이었다. 서버별 `/recover` 는 이것들을 못 집는데 모든 서버를 보는 루프는 첫 바퀴에 전부 처리하려 했다. 서버가 적힌 회의만 집게 해 0개가 됐다
- 워커 모드에서는 봇이 다시 뜨는 몇 초 사이에 워커(10초 주기)가 끊긴 녹음을 먼저 집는다. recording 만 보면 재시작 안내가 거의 안 나가서 워커가 트랙을 되찾은 회의도 본다

## 결과

| 항목 | 값 |
|---|---|
| pytest | 496 통과, 기준 435 (`.venv/bin/python -m pytest`) |
| 새 테스트 | `tests/capture/test_recovery.py` 27, `test_recovery_loop.py` 19, `test_worker.py` 15. 55개는 고치기 전 코드에서 실패를 먼저 봤다. 5개는 바로 통과했다(기존 handoff 우회를 확인하는 수동 재시도 2개, 죽은 실행을 잘못 세지 않는지 지키는 2개, 워커 모드 봇의 import 검사). 이 가운데 import 검사와 죽은 실행 가드 1개는 코드를 망가뜨려 실패하는 것을 확인했다. 재시작 안내 중복 1개는 구현 뒤 썼고 막는 코드를 빼면 실패하는 것을 확인했다 |
| 하위 프로세스로 본 것 | 다른 프로세스가 쥔 잠금은 못 잡고 그 프로세스를 죽이면 잡힌다, 워커가 discord 를 import 하지 않는다, 워커 모드 봇이 전사 백엔드(`stt.batch`, `stt.local` 등)를 import 하지 않는다, 워커가 SIGTERM 에 0 으로 끝난다 |
| 윈도 | fcntl 을 막은 하위 프로세스에서 capture.recorder, worker, discord_adapter 가 import 되는 것과, 가짜 msvcrt 로 윈도 분기가 같은 뜻을 내는 것만 봤다. 윈도에서는 아직 실제로 안 돌렸다 |
| 바꾼 옛 테스트 | 첫 실패에 BE fail 을 단언하던 것, 옛 `recover` 호출 인자를 단언하던 것 |
| 한 바퀴 대상 목록 | 매니페스트 100개 중앙값 3.7ms, 1000개 41.2ms (M4, 합성. 재현 명령은 0013) |
| 유료 호출 | 0 |

## 남은 것

- 서버에서 어느 모드를 쓸지, 전사 백엔드, 워커 메모리 상한과 종료 대기 시간 (#40 측정 뒤)
- 워커 모드에서 녹음 중에 끊긴 회의는 화자 이름이 uid 로 남는다. 워커는 서버 멤버를 조회하지 못한다
- 끊긴 회의 뒤 새 녹음을 같은 회의로 묶기
- `discord_adapter.py` 의 기존 import 줄에 이제 안 쓰는 `recover` 가 남아 있다. 수신 공용 계층 작업이 같은 줄을 바꾸는 중이라 그 머지 뒤 지운다
- `ai/README.md` 의 `/recover` 설명과 워커 실행법. README 를 고치는 다른 작업과 겹쳐 이 PR 에서 뺐다
- `capture/realtime/adapter.py` 의 `import resource` 도 POSIX 전용이라 윈도에서 그 모듈과 tests/capture/realtime 이 import 되지 않는다. 이 PR 전부터 있던 것이고 배치 경로는 import 하지 않는다
- 복구로 되살린 회의와 워커 모드에서는 `on_session_saved` 훅이 불리지 않는다. 훅을 BE 연결 지점으로 쓰려면 같이 불러야 한다

## 생각해볼 점

- 워커가 영영 안 뜨면 BE 회의는 processing 에 남는다. 봇의 `/recover` 가 "워커가 N분째 응답이 없습니다" 를 알리지만 PM 화면에서도 보이려면 BE Meeting 에 갱신 시각이 필요하다(회의 안건)
- 포기한 회의의 수동 재시도는 한 번이다. 상한을 새로 줄지는 운영해 보고 정한다
- 재시작 안내의 한 시간 기준은 잠정값이다
- 파일 잠금은 한 기계의 로컬 디스크에서만 막는다. 녹음을 S3 나 다른 기계로 옮기면 배제를 다시 정한다
