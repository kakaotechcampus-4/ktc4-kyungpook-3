# Storybook 을 지우고 검사를 RTL·E2E 로 모은다(D-181, D-141 폐기)

- 기록일: 2026-11-07
- 관련 마일스톤: 마일스톤 밖 작업(#482). 결과는 [#482 결과](../../../issues/482-remove-storybook/result.md)

## 문제와 제약

- D-141 은 Storybook 을 `shared/ui` 와 재사용 복합 컴포넌트로 좁히고 CI 에서는 정적 빌드만 보기로 했다. 실제로는 화면 단위 스토리까지 늘었다. develop `94c04ddb` 기준으로 스토리 파일 43개, play 192건이고, CI `test:storybook` 이 play 단언까지 봤다.
- 같은 동작을 E2E·Vitest(RTL)·play 세 곳에서 검사했다. 화면을 바꿀 때 세 곳을 고쳤다(#423, #424).
- play 실패를 잡으려고 별도 장치(`.storybook/playOutcome.ts`, `e2e/storybook/stories.sb.ts`)를 유지했다. Storybook 은 play 안의 단언이 던져도 렌더를 `finished` 로 끝내기 때문이다.
- 팀이 Storybook 화면을 거의 열지 않았다. 외부 배포 없이 CI 아티팩트로만 올렸다. CI `storybook` job 은 약 2.5~3.5분이었다(이슈 #482 본문).
- 제약: 지우더라도 다른 테스트가 보지 않던 검사를 잃으면 안 된다(이슈 #482 할 일).

## 실제 검토한 선택지

이슈 #482 는 팀이 2026-11-07 에 「전부 지우고 가치 있는 검사만 옮긴다」로 정한 뒤 열렸다. 그 전에 다른 선택지(범위를 D-141 대로 다시 좁히기, play 검사만 끄기)를 견준 기록은 없다.

옮기는 방법에서 실제로 견준 것은 아래와 같다.

- 스토리마다 분류: ① 이미 E2E·RTL 이 본다, ② 옮긴다, ③ 옮길 것이 없다.
- 옮길 곳: 앱 단위 Vitest(RTL), 컴포넌트 단위 Vitest, Playwright E2E.
- db 를 직접 고치던 스토리의 상태: E2E 안에서 모의 DB 모듈을 가져와 바꾸기, MSW 시나리오로 만들기.

## 선택과 이유

| 결정 | 고른 길 | 버린 대안과 이유 |
|---|---|---|
| 무엇을 옮기나 | 기존 테스트가 같은 상태와 같은 단언 의도를 이미 보면 ① 로 지운다. 일부만 겹치면 ② 로 옮기고 빠진 단언만 더한다 | 모든 play 를 옮기기: 195건 중 145건은 같은 검사가 이미 있어 세 곳 고치기가 두 곳 고치기로 남는다 |
| 옮길 곳 | 상태(조회 대기·빈 응답·조회 실패·부분 실패·역할별 화면)는 앱 단위 Vitest 에 MSW `server.use` 로. 실제 배치·계산된 색·hover·스크롤이 필요한 것은 E2E | 모두 E2E: 한 번 도는 데 개발 서버와 브라우저가 들고 느리다. 모두 RTL: jsdom 은 Tailwind 를 계산하지 않고 배치가 없다 |
| 업로드 전송률 | `UploadStatus` 컴포넌트 테스트 | 앱 단위 테스트: 전송률을 한 값에 붙잡아 둘 수 없다 |
| 목록 탭 End·Home | RTL(`tasks.test.tsx`) | E2E: 빠진 것이 키 두 개뿐이고 jsdom 에서도 포커스와 선택을 본다 |
| 메시지 긴 문구 | 새 MSW 시나리오 `messages-long-content` 와 `e2e/messages-layout.e2e.ts` | 테스트 안에서 모의 DB 고치기: 이미 있는 `tasks-long-content` 와 같은 방식이 개발 서버에서도 그 화면을 다시 열 수 있다 |
| `발송_시점_저장_중` | 잠긴 `이대로 발송` 이 승인 요청을 보내지 않음은 RTL, 버튼 면·글자색 유지와 hover 면 없음은 E2E | 둘 다 E2E: 요청 수는 RTL 로 충분하다 |
| CI | `storybook` job 을 지운다. 다른 job(check·build·e2e)은 그대로다 | 빌드만 남기기: 스토리가 없으면 빌드할 것이 없다 |

## 장단점과 감수한 제약

- 컴포넌트를 눈으로 둘러보는 화면이 없어진다. 화면 확인은 MSW 개발 서버(`VITE_ENABLE_MSW=true`, `?msw-scenario=`)로 한다.
- 시안 값(픽셀·색)을 보는 E2E(`e2e/task-views-design.e2e.ts`)는 시안이 바뀌면 함께 고쳐야 한다. 스토리 play 가 보던 값을 그대로 옮겼고, 지금 더 느슨하게 하지 않았다.
- 열린 브랜치 `feature/477-select-rollout` 이 더하는 play(Combobox·Select 휴대폰 시트 등)는 모두 ① 이다. 병합할 때 스토리 파일만 지우면 된다.

## 영향 범위와 재검토 조건

- D-141 폐기, D-143(CI 게이트)·D-146(MSW 공유 대상)의 Storybook 부분 변경. [결정 기록 D-181](../../../decision/frontend-decisions.md).
- 재검토: 디자인 시스템 컴포넌트를 팀 밖에 보여 줄 필요가 생기거나, 시각 회귀 도구를 들일 때.

## 근거와 관련 문서

- 이슈 [#482](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/482) 본문(배경 수치와 결정일).
- 분류표: 로컬 검증 자료 `frontend/.verify/reports/482-classification.md`(git 제외). 요약은 [#482 결과](../../../issues/482-remove-storybook/result.md)에 옮겼다.
- [MSW 사용 안내](../../../msw-guide.md) 「E2E 에서 고르기」.
