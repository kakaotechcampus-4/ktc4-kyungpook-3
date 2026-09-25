"""디스코드 실시간 전사 경로. 운영에는 올리지 않고 비교 실행과 회귀 근거로 남긴다 (decision_log/0014).

운영 Cog 는 capture/discord_adapter.py 의 RecordingCog 하나다. 회의가 끝난 뒤 배치로 전사한다
(decision_log/0008). 운영 봇(지금은 capture/run_recorder.py)은 이 폴더의 Cog 를 붙이지 않고 이 폴더와
stt/realtime/ 의 모듈을 하나도 싣지 않는다. tests/capture/test_operating_boundary.py 가 그것을 본다.

남긴 이유
  비교 실행  회의 중 전사의 지연, 비용, 서버 부하를 배치와 같은 녹음으로 다시 잰다. 두 방식을 같은
             오디오로 나란히 잰 적은 아직 없다 (decision_log/0006 의 남은 일).
             python -m stt.realtime.bench --tracks <녹음 디렉토리> --pace   (무과금. --stt elice 는 유료)
             python -m capture.realtime.run                                (실제 서버, /live /live-stop)
  회귀 근거  decision_log 0003~0006 의 실측이 이 코드로 나왔다. 이 폴더의 테스트(tests/capture/realtime,
             tests/stt/realtime)는 공용 수신 계층을 발화 단위 흐름으로 한 번 더 지난다.

의존성 (이 폴더에서 밖으로 한 방향)
  capture/  voice_client.SafeVoiceClient, streaming_sink.StreamingSink, track_writer.TrackPool,
            recording_store.write_manifest
  stt/      realtime/ (session, turns, latency, bench), vad, speech_gate, elice, transcript_writer, lines, backend
  shared/   config
  tests/    capture/replay (벤치가 녹음을 패킷처럼 흘리는 하니스)
  운영 경로 전용 모듈(capture/discord_adapter.py, recorder.py, handoff.py)은 import 하지 않는다.

유지 범위
  새 기능을 넣지 않는다. 고치는 것은 공용 계층 변경에 맞추는 것, 테스트와 벤치가 도는 것까지다.
  수신 공용 계층(capture/voice_client.py, streaming_sink.py, track_writer.py, audio.py, timeline.py)을
  바꾸는 변경은 이 폴더의 테스트까지 녹색이어야 한다. CI(ai-ci)가 전체 pytest 로 돌린다.
  재연결 키 갱신, SSRC 가드, 재정렬 창 드레인처럼 두 경로에 다 필요한 처리는 공용 계층에만 둔다.
  /selftest(수신 단계별 진단)는 이 Cog 에만 있고 운영 봇에는 없다.

지우는 조건은 decision_log/0014 에 있다. 지울 때는 이 폴더와 stt/realtime/, tests/capture/realtime/,
tests/stt/realtime/ 을 폴더째 지운다.
"""
