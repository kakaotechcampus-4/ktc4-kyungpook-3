# #593 E2E 간헐 실패 원인과 교정

2026-11-09 사용자 요청에 따라 [#593](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/593)의 설정 연결 해제·보드 포커스 실패를 조사했다. 마일스톤 계획 밖 이슈 작업이며 전체 계획과 사람의 트러블슈팅 기록은 수정하지 않았다.

## 확인한 원인과 변경

### 연결 해제 응답과 모의 DB 저장의 순서

기존 [브라우저 MSW 초기화](../../../../../src/shared/mock/browser.ts)는 `response:mocked` 이벤트에서 `sessionStorage`에 DB를 저장했다. 이 이벤트는 실제 HTTP 응답과 별도의 서비스 워커 `RESPONSE` 알림으로 전달된다. 따라서 DELETE 204를 받은 시점에 저장소에는 아직 연결 상태가 남을 수 있었다.

실제 Chromium에서 Notion 연결을 끊고, HTTP 응답은 그대로 전달하면서 후속 `RESPONSE` 알림만 차단했다. 원본 구현은 204 뒤 새로고침하면 연결됨으로 돌아갔고, 같은 사용자 흐름을 3회 모두 재현했다. DB나 저장값을 테스트에서 고쳐 만든 실패가 아니다.

저장을 `request:match`로 옮겼다. 설치된 MSW에서 이 이벤트는 resolver 완료 후 응답 전달 전에 동기적으로 발생한다. 저장 실패를 삼키는 기존 [저장소 정책](../../../../../src/shared/mock/persistence.ts)은 유지한다. [연결 해제 회귀](../../../../../e2e/settings-team.e2e.ts)는 같은 알림 차단 조건에서도 새로고침 뒤 연결 안 됨을 확인한다.

### 동작 줄이기 규칙이 새로 만든 포커스 전환

기존 [전역 CSS](../../../../../src/app/styles/global.css)는 동작 줄이기에서 모든 요소에 `transition-duration: 0.01ms`를 지정했다. 전환을 선언하지 않은 보드 입력의 form에도 기본 `transition-property: all`과 결합해 전환이 생겼다. input이 이미 `:focus-visible`인 첫 포커스 이벤트·microtask·첫 프레임에 form 테두리는 3px/offset 0px이고, 이후 2px/offset -1px로 바뀌었다.

같은 원본 코드로 대조한 결과 `reduce`에서는 3회 모두 초기 3px/0px, `no-preference`에서는 3회 모두 초기부터 2px/-1px였다. 초기 포커스 스타일을 동기적으로 기록하는 새 회귀도 원본에서 3회 모두 실패했다.

동작 줄이기의 `transition-duration`만 `0s`로 바꿨다. 애니메이션 시간 `0.01ms`와 반복 횟수는 유지한다. 앱 소스에 transition 종료 이벤트를 기다리는 소비자는 없고, 설치된 Radix Presence의 unmount는 별도 animation 이벤트에 의존한다. [보드 회귀](../../../../../e2e/task-views-design.e2e.ts)는 첫 포커스부터 2px/-1px와 전환 시간 0을 확인한다. 기존 스타일 검사의 단언·대기 시간은 바꾸지 않았다.

### 재시도로 통과한 CI 기록 보존

조사한 CI 실행 `42566965432`와 `42567011750`은 첫 시도 실패 뒤 재시도로 통과했고, 아티팩트에는 `frontend-dist`만 있었다. 당시 trace를 읽어 원인을 확정한 것은 아니다. 원본 4개 노드를 10회씩 실행한 로컬 기준선도 40개 단언이 통과해 자연 발생 실패는 재현되지 않았다. 위 두 원인은 각각 응답 전달 경계와 최초 포커스 시점의 대조 실험으로 입증했다.

[CI 설정](../../../../../../.github/workflows/frontend-ci.yml)의 업로드 조건을 `failure()`에서 `!cancelled()`로 바꿔 재시도로 통과한 실행의 HTML 보고서와 `on-first-retry` trace도 남긴다. 이는 첫 실패 자체의 trace가 아니라 첫 재시도의 trace다. 파일이 없는 준비 단계 실패는 `if-no-files-found: ignore`로 넘기며 보관 기간 7일은 유지한다.

## 검증

Node 24.21.0, 실제 Chromium, 격리된 브라우저 컨텍스트와 MSW로 실행했다. 외부 OAuth·실서비스·실제 사용자 데이터는 사용하지 않았다. 로컬 검증은 재시도 0으로 실행했다.

| 검사                          | 결과                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 연결 해제 알림 차단 회귀      | 원본 3/3 실패 → 수정 후 3/3 통과                                                                            |
| 초기 포커스 회귀              | 원본 3/3 실패 → 수정 후 3/3 통과                                                                            |
| 동작 줄이기 대조              | 원본 reduce 초기 3px/0px 3회, no-preference 초기 2px/-1px 3회                                               |
| 기존 실패 지점·신규 회귀 반복 | 기존 설정 3개 너비·보드 1개와 신규 2개를 각 10회, 2 workers로 총 60개 통과. 재시도 0, 실제 Node 종료 코드 0 |
| 영향 범위의 사용자 흐름       | 복원·설정/팀·초대·메시지·키보드 모달·로그인 스플래시 6개 파일 24개 통과. 재시도 0, 실제 Node 종료 코드 0    |
| 키보드 최초 포커스            | Enter로 보드 입력을 열어 첫 포커스의 테두리·전환 시간을 추가 관측. 3회 통과, 재시도 0                       |
| TypeScript                    | 통과                                                                                                        |
| 변경 TypeScript ESLint·포맷   | 통과                                                                                                        |
| 저장소·메시지 소켓 Vitest     | 2파일 23개 통과. 저장소 접근 실패 시 예외를 내보내지 않는 정책 포함                                         |

60회 반복과 영향 범위 검증은 전후 두 애플리케이션 파일과 두 E2E 파일의 SHA-256이 같았다. trace와 종료 화면, JSON 보고서, 실제 자식 프로세스 종료 코드는 로컬 검증 기록에 보관했다.

회귀 재실행은 `frontend/`에서 다음처럼 할 수 있다. 사용하는 포트는 다른 개발 서버와 분리한다.

```sh
E2E_PORT=5212 npm run test:e2e -- e2e/settings-team.e2e.ts e2e/task-views-design.e2e.ts --grep '응답 관측 알림|첫 포커스부터|설정·팀 화면은 가로로 넘치지 않고|보드 직접 추가' --repeat-each=10 --workers=2 --retries=0 --trace=on
E2E_PORT=5212 npm run test:e2e -- e2e/restore.e2e.ts e2e/settings-team.e2e.ts e2e/member-invitations.e2e.ts e2e/messages-reply.e2e.ts e2e/meeting-keyboard.e2e.ts e2e/login-splash.e2e.ts --workers=2 --retries=0 --trace=on
```

## 영향과 한계

HTTP 모의 handler가 처리한 가입·온보딩·초대·메시지 등의 DB도 응답 전에 저장된다. WebSocket handler는 DB를 변경하지 않고 HTTP handler가 만든 변경 신호만 보낸다. 별도 백엔드 API 계약이나 운영 저장 방식은 바꾸지 않았다.

최초 CI 실행의 trace가 없으므로 당시 프로세스의 정확한 이벤트 순서까지 소급해 확인할 수는 없다. 기준선의 40개 단언 통과와 셸 wrapper의 종료 코드 1도 구분한다. 이번 교정 검증은 실제 Node 자식 프로세스의 종료 코드와 보고서, trace·화면을 함께 보관했다. CI 업로드 조건의 실제 원격 실행은 PR CI에서 확인해야 한다.
