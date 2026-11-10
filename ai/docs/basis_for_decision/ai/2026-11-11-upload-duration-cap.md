# 업로드 음성은 3시간까지만 풀어 처리한다

- 날짜: 2026-11-11
- PR: #690
- 브랜치: fix/upload-duration-cap
- 작성자: 김동우

## 한 일

- `upload/tracks.py`: `to_wav_16k` 가 `max_seconds` 와 `format` 을 받는다. 풀어 낸 샘플 수가 상한을 넘는 조각에서 디코딩을 멈추고 `ValueError` 를 내며, 쓰던 wav 는 지운다. `format` 을 주면 `_decode_mono_16k` 가 그 형식으로만 파일을 연다
- `upload/intake.py`: 원본 확장자(mp3, m4a, wav, ogg, webm)마다 FFmpeg 형식을 정해 변환에 넘긴다. 목록에 없는 확장자는 바로 실패로 보고한다. 상한은 `MM_UPLOAD_MAX_SECONDS`(기본 10800초)에서 읽고, 비었거나 숫자가 아니거나 0 이하면 기본값을 쓴다
- `.env.example`: `MM_UPLOAD_MAX_SECONDS` 를 추가했다

상한을 넘거나 형식이 맞지 않는 파일은 기존 영구 실패 경로를 탄다. 변환 단계(`claimed`)에서 실패하므로 pyannoteAI 제출 단계(`converted`)에 가지 않고, BE 에는 계약에 있는 `failed_stage=diarize` 로 보고한다.

## 왜

BE 는 업로드를 바이트(200MB)로만 막는다. 비트레이트가 낮은 파일은 200MB 안에 아주 긴 음성이 들어가고, 워커는 그 길이만큼 16k wav 를 만든 뒤 전체를 메모리에 올리고(`load_mono_16k`), 화자마다 같은 길이의 배열을 만들고(`write_virtual_tracks`), 유료 화자 분리와 전사에 보낸다. 운영 서버 메모리는 4GB 다. 3시간은 정기 회의 길이보다 넉넉하고 BE sweeper 의 3시간 규칙과 같은 단위라 기본값으로 잡았다. 상한은 원본을 다 풀어 본 뒤가 아니라 푸는 도중에 잰다.

## 결과

| 항목 | 값 |
|---|---|
| AI 테스트 | `.venv/bin/python -m pytest -q` 3122 수집, 종료 코드 0(요약 줄이 출력되지 않아 종료 코드로 확인) |

새 테스트:

- `tests/upload/test_tracks.py`: 끝없이 나오는 디코딩 조각을 상한 1초로 변환하면 `ValueError` 이고 dst 가 남지 않으며, 꺼낸 샘플이 상한 + 조각 하나를 넘지 않는다. 상한과 같은 길이는 그대로 남는다. mp3, m4a, ogg, webm, wav 를 정한 형식으로 열어 변환하고, 이름과 내용이 다른 파일(ogg 로 연 wav)은 `ValueError` 다
- `tests/upload/test_intake.py`: 상한 5초에 12초 업로드는 `failed`(`diarize`)이고 분리기 제출이 없으며 원본·wav 가 지워진다. 상한 20초면 끝까지 간다. 확장자가 `bin` 이면 제출 없이 실패한다. 상한 값이 비었거나 깨졌으면 10800초다

## 다음

- 사용자 화면에는 지금처럼 화자 분리 실패로만 보인다. 길이 때문이라는 이유를 보이려면 BE·FE 와 실패 사유 표시를 따로 정해야 한다
- 상한까지는 디코딩하므로 거절 전에 쓰는 CPU·디스크는 상한 길이만큼이다
- 수동 업로드 CLI(`upload/prepare.py`)는 운영자가 로컬 파일을 넣는 경로라 상한과 형식 지정을 넣지 않았다
