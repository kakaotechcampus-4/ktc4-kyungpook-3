# 상수 근거 표

`python -m stt.eval.sensitivity report` 가 만든다. 측정 결과는 백엔드와 데이터 묶음마다 따로다.

| 상수 | 값 | 쓰이는 자리 | 근거 종류 | 측정 결과와 범위 | 결정 | 다시 잴 조건 |
|---|---|---|---|---|---|---|
| stt.batch.SR | 16000 | 고정 | 외부 사양 | 위스퍼 입력 규격 16kHz. load_track 이 다른 표본율을 거절한다 | 유지 | - |
| stt.batch.CHUNK_MAX_S | 28.0 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 평탄 15~40 (오류 글자·잃은 발화, 잡음 폭 8); local-large-v3-turbo 정렬본(시간축 합성): 경사(악화 쪽) 24~30 (오류 글자·잃은 발화, 잡음 폭 6) | 유지 | 30초 넘는 독백이 있는 실녹음이 들어오면. LONG_SPLIT_FROM_S 보다 커야 한다 |
| stt.batch.CHUNK_GAP_S | 0.2 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 평탄 0~1.5 (오류 글자·잃은 발화, 잡음 폭 8). 문장 끝 오류 경사 0.1~0.4; local-large-v3-turbo 정렬본(시간축 합성): 경사(악화 쪽) 0~0.4 (오류 글자·잃은 발화, 잡음 폭 6). 문장 끝 오류 평탄 0~1.5 | 유지 | 모델이 바뀌면(문장부호 습관이 모델마다 다르다) |
| stt.batch.TURN_GAP_S | 3.0 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 평탄 0.5~8 (오류 글자·잃은 발화, 잡음 폭 8). 줄 수 0.5: 34, 1: 32, 2: 28, 3~5: 26, 8: 25; local-large-v3-turbo 정렬본(시간축 합성): 평탄 0.5~8 (오류 글자·잃은 발화, 잡음 폭 6). 줄 수 0.5: 21, 1: 15, 2~8: 14 | 유지 | 실녹음 골든셋(짧은 대답·겹침·긴 침묵 뒤 발화)이 들어오면 |
| stt.batch.WORD_TOLERANCE_S | 0.3 | track·whole 모드 전용 | 설계 판단 | chunk 는 묶음 안 위치로 되매핑해 이 값을 안 쓴다(_chunk_lines) | 유지 | track 모드를 다시 쓸 때 |
| stt.batch.TAIL_PAD_S | 0.1 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 절벽(개선 쪽) 0~0.1 (오류 글자·잃은 발화, 잡음 폭 8). 가장자리 오류 평탄 0~0.8. 잃은 발화가 달라진 값 0.2, 0.4, 0.8; local-large-v3-turbo 정렬본(시간축 합성): 평탄 0~0.8 (오류 글자·잃은 발화, 잡음 폭 6). 가장자리 오류 평탄 0~0.8 | 유지 | 실녹음에서 짧은 대답이 말 필터에 걸리는지 볼 때. 합성에서는 이 값이 거른 수를 바꿨다(0012) |
| stt.batch.LONG_SPLIT_FROM_S | 15.0 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 발동 안 함; local-large-v3-turbo 정렬본(시간축 합성): 발동 안 함 | 유지 | 쉼 없이 30초 넘게 말하는 실녹음이 들어오면 |
| stt.batch.WHOLE_SEGMENT_GAP_S | 1.0 | track·whole 모드 전용 | 설계 판단 | whole 은 비교 기준 모드(0008 표 1) | 유지 | - |
| stt.batch.STALL_S | 20.0 | 통계만 | 여기서 측정 | elice 2026-09-16 결과: chunk·clip 호출 88건 중 20초 넘음 14건 (설정별 p95 14.3~37.4초) | 유지 | Elice 서버나 모델이 바뀌면 |
| stt.batch.RETRIES | 2 | 배치 기본 경로 | 설계 판단 | 0008 표 3: 고정 30초 타임아웃 때 호출이 전부 잘려 181원을 버린 뒤 넣었다 | 유지 | 실패율을 잴 만큼 호출이 쌓이면(#40) |
| stt.batch.RETRY_WAIT_S | 2.0 | 배치 기본 경로 | 설계 판단 | 0008. 대기 길이별 성공률은 안 쟀다 | 유지 | 실패율을 잴 만큼 호출이 쌓이면(#40) |
| stt.vad.SPEECH_RMS | 0.006 (환경 변수로 바꿀 수 있다) | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 절벽(개선 쪽) 0.003~0.006 (오류 글자·잃은 발화, 잡음 폭 8). 잃은 발화 절벽 0.003~0.006. 잃은 발화가 달라진 값 0.009, 0.012; local-large-v3-turbo 정렬본(시간축 합성): 평탄 0.003~0.012 (오류 글자·잃은 발화, 잡음 폭 6). 잃은 발화 평탄 0.003~0.012 | 유지 | 실녹음 골든셋(짧은 대답·겹침·긴 침묵 뒤 발화)이 들어오면 |
| stt.vad.NOISE_MARGIN | 1.8 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 발동 안 함; local-large-v3-turbo 정렬본(시간축 합성): 평탄 1.2~3 (오류 글자·잃은 발화, 잡음 폭 6). 잃은 발화 평탄 1.2~3 | 유지 | 배경 소음이 있는 실녹음이 들어오면(정렬본 무음은 0 이다) |
| stt.vad.SILENCE_HOLD_MS | 800 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 경사(악화 쪽) 600~1500 (오류 글자·잃은 발화, 잡음 폭 8); local-large-v3-turbo 정렬본(시간축 합성): 절벽(악화 쪽) 800~1500 (오류 글자·잃은 발화, 잡음 폭 6) | 유지 | 기본값이 평탄 구간의 한쪽 끝이다. 실녹음에서 줄이 잘게 나뉘거나 끝 음절이 빠지면 먼저 본다(0012) |
| stt.vad.MIN_SPEECH_MS | 320 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 경사(양쪽) 200~480 (오류 글자·잃은 발화, 잡음 폭 8). 잃은 발화 경사 200~480. 잃은 발화가 달라진 값 120, 640; local-large-v3-turbo 정렬본(시간축 합성): 발동 안 함 | 유지 | 실녹음 골든셋(짧은 대답·겹침·긴 침묵 뒤 발화)이 들어오면 |
| stt.vad.MAX_SEGMENT_MS | 25000 | 실시간 전용 | 설계 판단 | 배치 cut() 은 max_segment_ms=10**9 로 끄고 split_long 에 맡긴다 | 유지 | - |
| stt.vad.FRAME_MS | 20 | 고정 | 설계 판단 | 디스코드 패킷 20ms 와 같다. ONSET_MS 를 == 로 비교해 ms 상수가 이 배수라는 전제가 코드에 있다 | 유지 | - |
| stt.vad.ONSET_MS | 60 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 절벽(양쪽) 20~60 (오류 글자·잃은 발화, 잡음 폭 8). 잃은 발화 절벽 20~60. 잃은 발화가 달라진 값 100, 160; local-large-v3-turbo 정렬본(시간축 합성): 절벽(악화 쪽) 20~60 (오류 글자·잃은 발화, 잡음 폭 6). 잃은 발화 평탄 20~160 | 유지 | 기본값이 평탄 구간의 한쪽 끝이다. 실녹음에서 줄이 잘게 나뉘거나 끝 음절이 빠지면 먼저 본다(0012) |
| stt.vad.RESTART_SILENCE_MS | 400 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 경사(개선 쪽) 300~800 (오류 글자·잃은 발화, 잡음 폭 8). 잃은 발화 경사 300~800. 잃은 발화가 달라진 값 200; local-large-v3-turbo 정렬본(시간축 합성): 평탄 200~800 (오류 글자·잃은 발화, 잡음 폭 6). 잃은 발화 평탄 200~800 | 유지 | 실녹음 골든셋(짧은 대답·겹침·긴 침묵 뒤 발화)이 들어오면 |
| stt.vad.SOFT_CAP_MS | 8000 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 평탄 4000~20000 (오류 글자·잃은 발화, 잡음 폭 8); local-large-v3-turbo 정렬본(시간축 합성): 평탄 4000~20000 (오류 글자·잃은 발화, 잡음 폭 6) | 유지 | 실녹음 골든셋(짧은 대답·겹침·긴 침묵 뒤 발화)이 들어오면 |
| stt.vad.SOFT_HOLD_MS | 400 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 평탄 200~800 (오류 글자·잃은 발화, 잡음 폭 8); local-large-v3-turbo 정렬본(시간축 합성): 평탄 200~800 (오류 글자·잃은 발화, 잡음 폭 6) | 유지 | 실녹음 골든셋(짧은 대답·겹침·긴 침묵 뒤 발화)이 들어오면 |
| stt.speech_gate.ENABLED | True | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 절벽(개선 쪽) (오류 글자·잃은 발화, 잡음 폭 8). 잃은 발화 절벽. 잃은 발화가 달라진 값 False; local-large-v3-turbo 정렬본(시간축 합성): 발동 안 함 | 유지 | 실녹음에서 짧은 대답이 걸리는지와 말 아닌 소리가 통과하는지를 같이 볼 때. 이 데이터에는 말 아닌 클립이 없다(0012) |
| stt.speech_gate.THRESHOLD | 0.95 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 절벽(양쪽) 0.95~0.95 (오류 글자·잃은 발화, 잡음 폭 8). 잃은 발화 절벽 0.95~0.95. 잃은 발화가 달라진 값 0.5, 0.8, 0.98; local-large-v3-turbo 정렬본(시간축 합성): 발동 안 함 | 유지 | 실녹음에서 짧은 대답이 걸리는지와 말 아닌 소리가 통과하는지를 같이 볼 때. 이 데이터에는 말 아닌 클립이 없다(0012) |
| stt.speech_gate.MIN_SPEECH_RATIO | 0.6 | 배치 기본 경로 | 여기서 측정 | local-large-v3-turbo 재배치 합성: 절벽(양쪽) 0.6~0.6 (오류 글자·잃은 발화, 잡음 폭 8). 잃은 발화 절벽 0.6~0.6. 잃은 발화가 달라진 값 0.3, 0.45, 0.75, 0.9; local-large-v3-turbo 정렬본(시간축 합성): 경사(악화 쪽) 0.3~0.75 (오류 글자·잃은 발화, 잡음 폭 6). 잃은 발화 평탄 0.3~0.9 | 유지 | 실녹음에서 짧은 대답이 걸리는지와 말 아닌 소리가 통과하는지를 같이 볼 때. 이 데이터에는 말 아닌 클립이 없다(0012) |
| stt.elice.WHISPER_KRW_PER_SEC | 6 / 60 | 고정 | 외부 사양 | Elice 단가 6원/60초 (2026-09, stt/elice.py) | 유지 | 단가가 바뀌면 |
| stt.elice.EliceStt.TIMEOUT_PER_AUDIO_S | 0.6 | 배치 기본 경로 | 여기서 측정 | 아직 안 잼 | 유지 | Elice 서버나 모델이 바뀌면 |
| stt.transcribe.MAX_SEC_PER_AUDIO_MIN | 30.0 | 고정 | 외부 사양 | 멘토 기준 (계획서 4장) | 유지 | - |
| capture.audio.TARGET_SR | 16000 | 고정 | 외부 사양 | 위스퍼 입력 16kHz | 유지 | - |
| capture.audio.DECIM | 3 | 고정 | 외부 사양 | 디스코드 PCM 48kHz | 유지 | - |
| capture.recording_store.PCM_RATE | 48000 | 고정 | 외부 사양 | 디스코드 음성 48kHz | 유지 | - |
| capture.recording_store.PCM_CHANNELS | 2 | 고정 | 외부 사양 | 디스코드 음성 스테레오 | 유지 | - |
| capture.recording_store.PCM_SAMPLE_WIDTH | 2 | 고정 | 외부 사양 | 16비트 | 유지 | - |
| capture.streaming_sink.GAP_MS | 60 | 수신 | 여기서 측정 불가 | 주석(20ms 패킷 세 개), tests/capture/test_streaming_sink.py | 유지 | 실서버 녹음과 패킷 도착 기록(패킷별 도착 시각·RTP·SSRC)이 들어오면 |
| capture.streaming_sink.IDLE_FLUSH_MS | 100 | 수신 | 여기서 측정 불가 | 주석(창에 갇힌 발화 끝 320ms 가 MIN_SPEECH_MS 미달로 사라진 사례), test_streaming_sink | 유지 | 실서버 녹음과 패킷 도착 기록(패킷별 도착 시각·RTP·SSRC)이 들어오면 |
| capture.timeline.NOISE_NONZERO_MAX | 1 | 수신 | 여기서 측정 불가 | 주석(디스코드 침묵 프레임, 쓰레기 패킷), Craig | 유지 | 실서버 녹음과 패킷 도착 기록(패킷별 도착 시각·RTP·SSRC)이 들어오면 |
| capture.timeline.REORDER_WINDOW | 16 | 수신 | 여기서 측정 불가 | Craig 와 같은 16패킷(320ms). tests/capture/test_timeline.py | 유지 | 실서버 녹음과 패킷 도착 기록(패킷별 도착 시각·RTP·SSRC)이 들어오면 |
| capture.timeline.HALF_RANGE | 2147483648 | 고정 | 외부 사양 | RTP 32비트 | 유지 | - |
| capture.timeline.REANCHOR_TICKS | 48000 * 300 | 수신 | 설계 판단 | 주석: 정상 재정렬(약 15,360틱)과 자릿수가 다르다 | 유지 | 실서버 녹음과 패킷 도착 기록(패킷별 도착 시각·RTP·SSRC)이 들어오면 |
| capture.track_writer.MAX_GAP_MS | 4 * 60 * 60 * 1000 | 수신 | 설계 판단 | 주석: 60초였을 때 1분 넘게 조용한 화자의 시간축이 당겨졌다 | 유지 | - |
| capture.track_writer.TrackPool.QUEUE_MAX | 4096 | 수신 | 설계 판단 | 주석 | 유지 | 실서버 녹음과 패킷 도착 기록(패킷별 도착 시각·RTP·SSRC)이 들어오면 |
| capture.discord_adapter.FLUSH_EVERY_S | 0.2 | 수신 | 여기서 측정 불가 | 주석(패킷 20ms 마다) | 유지 | 실서버 녹음과 패킷 도착 기록(패킷별 도착 시각·RTP·SSRC)이 들어오면 |
| stt.eval.golden.SR | 16000 | 고정 | 외부 사양 | 위스퍼 입력 16kHz | 유지 | - |
| stt.eval.golden.RUN_GAP_S | 3.0 | 평가(정렬본 생성) | 여기서 측정 | 정렬 원본 7발화판: 1~8 에서 정렬본 wav 같음 (발동 안 함) | 유지 | 새 원본 골든셋을 정렬할 때 |
| stt.eval.golden.PLACE_GAP_S | 1.0 | 평가(정렬본 생성) | 여기서 측정 | 정렬 원본 7발화판: 0.3~3 에서 wav 달라짐, 묶음 입력이 달라진 원본 meeting-02-orig7, 오류 글자는 원본마다 값과 무관하게 같음 (meeting-01-orig7 43, meeting-02-orig7 38) | 유지 | 새 원본 골든셋을 정렬할 때 |
