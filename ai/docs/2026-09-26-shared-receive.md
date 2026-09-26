# 수신 공용 계층: 실시간 Cog 의 중복 키 갱신을 지우고 실시간 경로의 보존 범위를 정한다 (멘토 #45 1차 본문 8, 고민 7)

- 날짜: 2026-09-26
- 이슈: #90
- PR: (이 PR)
- 브랜치: refactor/90-shared-receive (#83 위. #83 먼저 머지)
- 작성자: 김동우

## 한 일

- `capture/realtime/adapter.py`: 재연결 키 갱신 리스너 `on_member_speaking_state_update` 와 `_Meeting.secret_key` 를 지웠다. 키 갱신은 `capture/voice_client.py` 의 `_KeyForwardingState` 한 곳에서만 한다 (efa1d2e)
- `tests/capture/realtime/test_realtime_adapter.py`: 리스너를 직접 부르던 테스트 2개를 지우고 2개를 넣었다. 키가 바뀐 뒤 Cog 의 리스너를 py-cord 처럼 전부 불러도 복호화기 갱신이 한 번인지, `/live` 와 `/live-join` 이 공용 `SafeVoiceClient` 로 붙는지 본다 (efa1d2e)
- `tests/capture/test_shared_receive.py`: 배치 `/join` 이 `capture.voice_client.SafeVoiceClient` 로 붙는지, 봇이 방에서 빠져 `stop_recording` 없이 끝나도 재정렬 창에 갇힌 200ms 가 wav 에 남는지 본다 (4638fb5)
- `tests/capture/test_operating_boundary.py`: `run_recorder.build_bot()` 의 Cog 가 RecordingCog 하나인지, 운영 Cog 와 실행기를 새 프로세스에서 import 했을 때 `capture.realtime`·`stt.realtime` 모듈이 하나도 실리지 않는지 본다 (f58dea9)
- `stt/realtime/bench.py`: 옮겨진 리플레이 하니스(`tests/capture/replay.py`)를 찾게 고치고 무과금 합성 실행을 `tests/stt/realtime/test_bench.py` 로 묶었다 (82377a3)
- `capture/realtime/__init__.py`: 운영 Cog, 남긴 이유(비교 실행, 회귀 근거), 의존성, 유지 범위를 적었다. `stt/realtime/__init__.py` 와 `adapter.py`·`run.py`·`selftest.py` 의 낡은 경로와 설명, `.env.example` 의 인텐트·`LOG_LEVEL` 설명을 지금 코드에 맞췄다 (4447e97, 0d30693)
- 결정: 실시간 경로는 이후 회의 중 전사를 다시 넣을 때 쓰려고 폴더로 보관한다. decision_log/0006 의 상태와 다시 볼 조건을 고쳤다

## 왜

멘토는 실시간 코드를 비교·회귀용으로 남겨도 되지만 두 경로에 다 필요한 처리는 공용 계층에 두라고 했다. 두 녹음기를 파일:줄로 맞대 보니 #57 이후에도 남은 중복은 아래와 같았다 (98d49b8 기준).

| 기능 | 배치 `capture/discord_adapter.py` | 실시간 `capture/realtime/adapter.py` | 공용 | 처리 |
|---|---|---|---|---|
| 재연결 키 갱신 | 따로 없음 | 리스너 289-312, `_Meeting.secret_key` 197-198·212·461 | `voice_client.py` 13-37·57-58 | 실시간 쪽을 지웠다 |
| SSRC 제거 가드 | 156 에서 `SafeVoiceClient` 로 연결 | 369·537 | `voice_client.py` 60-67 | 이미 공용 |
| sink 와 재정렬 창 드레인 | 173, 373 | 432, 624 | `streaming_sink.py` 192-209 | 이미 공용 |
| 화자별 트랙 | 172, 377 | 431, 642 | `track_writer.py` | 이미 공용 |
| `is_recording` | 65-69 | 101-105 | 없음 | 남겼다 |
| `required_intents` | 72-80 | 135-147, 값이 같다 | 없음 | 남겼다 |
| 녹음 종료 콜백 예약 | `_on_recording_done` 299-316 | 562-592 | 없음 | 남겼다 |
| 종료 드레인, 트랙 닫기, 표시 이름 | `_finish` 371-382 | `_finish_meeting` 622-646 | 없음 | 남겼다 |

키 갱신을 공용 상태 하나에 맡겨도 되는 근거는 py-cord 설치본(2.8.2.dev91+g10a5e8cf1) 소스로 확인했다. `VoiceClient.__init__` 이 `create_connection_state()` 로 상태 객체를 만들고 (voice/client.py:128) 웹소켓이 그 객체로 만들어지며 (voice/state.py:739-741, voice/gateway.py:496) 새 키가 그 객체의 `secret_key` 에 들어간다 (voice/gateway.py:442). 키가 들어오는 자리가 하나라서 거기서 넘기면 어느 Cog 든 같다. 실시간 Cog 의 두 연결 자리가 모두 `SafeVoiceClient` 라 리스너는 같은 갱신을 한 번 더 하고 있었다.

남긴 네 줄은 배치 쪽 `def` 를 지워야 없어진다. `discord_adapter.py` 는 복구 자동화 작업(#88)이 크게 고치는 중이라 이 PR 에서는 건드리지 않았다. 공용 모듈에 사본을 만들어 실시간만 쓰게 하는 안도 봤는데, 배치 사본이 그대로라 같은 코드가 세 곳이 되고 배치가 공용 코드를 쓴다는 목표도 못 채워서 버렸다. 네 곳 모두 두 경로에 같은 처리가 이미 있어 지금 퇴행할 곳은 없다.

실시간 폴더를 지우지 않는 이유(이후 회의 중 전사를 다시 넣을 수 있다)는 0006 의 다시 볼 조건에 적었다.

## 결과

| 항목 | 값 |
|---|---|
| pytest | 439 통과, 38.27초. 기준 434 에서 옛 리스너 테스트 2개를 빼고 7개를 더했다 |
| 먼저 실패를 본 테스트 | 키 갱신 테스트는 리스너가 있는 동안 복호화기 갱신이 2번이라 실패했다. 벤치 테스트는 `ModuleNotFoundError: No module named 'tests.replay'` 로 실패했다 |
| 처음부터 통과한 특성 테스트 | 배치 연결 클래스, 배치 드레인, 운영 실행기, 운영 경계, 실시간 연결 클래스 5개. 각각 일부러 깨 봤다. 연결 클래스를 일반 `VoiceClient` 로 바꾸면(배치, 실시간), `StreamingSink.cleanup` 을 무력화하면(`0 == 3200`), 운영 실행기에 RealtimeCog 를 더 붙이면, 실시간 모듈을 하나 더 import 하면 전부 실패했다 |
| 벤치 무과금 실행 | `--no-gate` 로 발화 1건, STT 호출 1건, 수신 150, write 오류 0. 말 필터를 켠 기본 실행은 정현파를 말이 아니라고 걸러 발화 0건이다 |
| 유료 호출 | 0 |

```bash
cd ai && .venv/bin/python -m pytest
cd ai && .venv/bin/python -m stt.realtime.bench --no-gate --out /tmp/bench
```

## 남은 것

- 복구 자동화(#88) 머지 뒤 후속. 위 표에서 "남겼다" 인 네 줄을 `capture/voice_client.py` 나 새 공용 모듈로 옮기고 두 Cog 가 import 한다. 지금 줄 번호로는 배치 `discord_adapter.py` 65-69·72-80·299-316·371-382, 실시간 `adapter.py` 103-107·137-149·539-569·599-623 이다
- 배치 `/join` 에는 연결 전 권한 확인, 60초 연결 초과 안내, 연결 전 defer 가 없다. 실시간에는 있다 (`adapter.py` 301·328-335·346-354). 권한이 빠진 채 `/join` 하면 60초 뒤 `TimeoutError` 가 나는데 인터랙션은 3초에 만료돼 사용자는 응답 없음만 본다. 중복이 아니라 배치에 빠진 것이라 이 PR 에 넣지 않았다
- 실제 디스코드 서버에서 녹음 중 재연결 뒤 패킷이 이어지는지는 아직 안 했다. #40 서버 검증 때 음성 채널 지역을 바꿔 본다

## 생각해볼 점

- 이제 키 갱신은 `SafeVoiceClient` 로 붙은 연결에서만 일어난다. 우리 코드의 연결 자리(`discord_adapter.py:156`, `realtime/adapter.py:347·514`)는 전부 그 클래스라 지금은 빈틈이 없다. 다른 코드가 일반 `VoiceClient` 로 먼저 붙여 둔 연결을 `/record` 나 `/live` 가 넘겨받으면 갱신이 안 된다. 지운 리스너는 `/live` 에 한해 그 경우도 잡았고, `/record` 는 원래부터 못 잡았다. BE 쪽 봇 진입점이 생기면 연결을 어느 Cog 가 여는지 같이 봐야 한다
- 수신 단계별 진단(`/selftest`)이 실시간 Cog 에만 있어 운영 봇에서는 못 쓴다. `SafeVoiceClient` 설명은 py-cord 를 올릴 때 그 진단이 깨짐을 잡는다고 적고 있다. 배치에도 수신 프로브를 둘지는 팀과 정할 것
- 운영 Cog 고정 테스트는 지금의 운영 실행기(`capture/run_recorder.py`)를 본다. BE 의 봇 진입점이 생기면 같은 검사를 거기에 둔다
