# 회의 업로드·처리·회의록

PM이 녹음 파일과 참석자를 제출하고 처리 완료 후 회의록을 읽는다. 화면을 떠난 동안의 완료 알림, 실패, 일반 팀원 권한도 확인한다.

## Sub-features

- `upload-minutes`는 짧은 WAV 업로드부터 해당 회의록 열기까지 확인한다.
- `background-complete`는 다른 화면에서 완료 알림의 회의록 링크를 연다.
- `member-denied`는 팀원의 직접 업로드 접근과 회의록의 업로드 링크를 제한한다.
- `processing-failed`는 실패 안내와 목록에서 실패 회의 제외를 확인한다.

## How to get to it (user POV)

- 헤더 **회의록** 화면의 **회의 올리기** 링크로 `/workspaces/ws_01/meetings/upload`에 간다.
- **정리 중** 헤더 링크는 처리 화면을 다시 연다.
- 다른 화면에서 **회의 정리가 끝났어요** 알림의 **회의록 보기**를 누른다.
- 일반 팀원은 업로드 주소를 직접 열어 접근 제한을 확인한다.

## Driving it with Playwright

Preconditions:

- 업로드 성공은 `meeting-instant`, 다른 화면으로 이동하는 흐름은 `meeting-demo`를 사용한다.
- `frontend/e2e/fixtures/short-meeting.wav`는 1초 WAV다. 해당 파일이 없으면 업로드 여정은 실패다.

- **실행.** `node .cursor/skills/verify-managers-manager/scripts/verify.cjs run meetings`로 네 테스트를 실행한다.
- **업로드.** `getByLabel('녹음 파일').setInputFiles('e2e/fixtures/short-meeting.wav')` 후 파일 길이 표시를 기다린다. **추가** → **박민수**를 고르고 **정리 시작하기**를 누른다. 업로드 POST, 처리 URL, 회의록의 `short-meeting.wav` 제목과 선택된 회의 항목이 함께 증거다.
- **백그라운드 완료.** 처리 중 헤더 **태스크**로 이동한다. 알림이 뜨되 태스크 URL이 유지되는지 확인한 뒤 알림의 **회의록 보기**를 누른다. 업로드한 회의 ID의 회의록이 열려야 한다.
- **권한과 실패.** `meeting-member`는 업로드 요청 없이 태스크로 이동하고 권한 안내가 나온다. `meeting-fail`은 재업로드 안내와 실패 회의가 없는 목록을 확인한다. trace의 요청과 UI 단언을 함께 읽는다.
- **진입점 추가 확인.** 현재 자동 테스트는 업로드 주소에서 시작한다. 헤더 **회의록** → **회의 올리기**와 처리 중 **정리 중** 링크의 실제 클릭도 요청 범위에 포함되면 같은 ARIA 링크를 사용해 별도 증거를 남긴다. 기본 실행은 링크 존재·href 확인까지만 포함한다.

## Gotchas

- 파일의 길이 확인이 끝나기 전에는 제출할 수 없다.
- `meeting-instant`는 바로 완료되므로 다른 화면으로 떠나는 검증에는 부적합하다. 이를 이유로 `background-complete`를 약화하지 않는다.
- 실제 전사·추출·파일 서버 저장은 이 모의 처리의 검증 범위 밖이다.
- 자동 이동과 완료 링크 이동은 화면 도착 시점에 따라 달라져 기존 `expectMinutesOpened`가 둘을 처리한다.
