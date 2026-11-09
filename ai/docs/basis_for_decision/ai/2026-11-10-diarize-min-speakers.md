# 업로드 화자 분리에 참석자 수를 넘긴다

- 날짜: 2026-11-10
- 이슈: #625
- PR: -
- 브랜치: fix/625-diarize-min-speakers
- 작성자: 김동우

## 한 일

- `upload/diarize.py`: `Diarizer.submit`·`PyannoteAiDiarizer.submit` 이 `min_speakers` 를 받는다. 1 이상이면 `/v1/diarize` 본문에 `minSpeakers` 를 싣고, 0·None 이면 지금처럼 녹음 주소만 보낸다
- `upload/intake.py`: 업로드의 참석자 수를 `min_speakers` 로 넘긴다
- `frontend/src/features/meeting-upload/ui/AttendeePicker.tsx`: 참석자 고르기 아래 안내를 "녹음에서 실제로 말한 사람만 골라 주세요. 적어도 이 인원수로 목소리를 나눠요." 로 바꿨다. 원래 있던 안내 줄(`aria-describedby` 로 묶인 줄)의 문구만 바꿨다

## 왜

4명이 말한 업로드 회의가 3명으로 나뉘어 PM 에게 3명만 화자 지정을 요청했다. 정확한 수가 아니라 최소 수로 넘긴 이유는 [0064](2026-11-10-0064-diarize-min-speakers-from-attendees.md).

## 결과

| 항목 | 값 |
|---|---|
| AI 테스트 | `.venv/bin/python -m pytest -q` 2966 통과 |
| FE 테스트 | `npx vitest run` 309 파일 4047 통과, `npx tsc --noEmit` 통과 |

새 테스트:

- `tests/upload/test_diarize.py`: `min_speakers=4` 면 본문에 `minSpeakers: 4`, None·0 이면 없음
- `tests/upload/test_intake.py`: 참석자 4명이면 4, 없으면 0 이 넘어감
- `frontend/src/app/meetingUpload.test.tsx`: 참석자 묶음의 설명이 새 안내 문구

실제 pyannoteAI 로 다시 나눠 보는 것은 원본 녹음이 서버에서 지워져 아직 안 했다.

## 다음

- 배포 뒤 4인 테스트 녹음을 다시 올려 화자가 4명 이상으로 나뉘는지 본다
- `frontend/docs/design/canvas/Upload.dc.html` 에 옛 안내 문구가 남아 있다. 디자인 캔버스라 이 PR 에서 고치지 않았다
