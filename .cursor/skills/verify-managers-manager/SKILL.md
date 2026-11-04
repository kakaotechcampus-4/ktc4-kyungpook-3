---
name: verify-managers-manager
description: Manager's Manager 웹 UI를 기존 Playwright와 MSW로 실행해 인증, 회의, 태스크, 대시보드, 팀 연결을 검증하고 trace와 화면 증거를 보관한다. 프론트엔드 사용자 흐름을 변경하거나 회귀를 확인할 때 사용한다.
---

# Manager's Manager 웹 UI 검증

저장소 루트의 `docs/agent-rules.md`를 따른다. [기능 지도](features/README.md)를 먼저 읽고 요청에 맞는 항목을 고른다. 모든 명령은 저장소 루트 기준이다.

주 대상은 `frontend/`의 React 웹 앱이다. 기존 `frontend/e2e/` Playwright 테스트와 앱의 MSW API 경계를 사용한다. FastAPI, Discord 녹음 봇, AI 처리 워커는 별도 실행 대상이며 이 스킬로 검증되지 않는다. 실제 OAuth·DB·Notion 반영도 별도 연동 검증이 필요하다.

## Launch

Node 24.x와 npm, Chromium을 준비한다. 기존 설치가 없다면 다음을 실행한다.

```powershell
cd frontend
npm ci
npx playwright install chromium
cd ..
```

한 기능을 검증한다.

```powershell
node .cursor/skills/verify-managers-manager/scripts/verify.cjs run connections
```

이 명령은 실행 ID와 `.verify/managers-manager/<실행 ID>/`의 절대 경로를 출력한다. 임시 포트를 선택하고 기존 설정을 확장한 Playwright가 `frontend/`에서 아래 명령의 개발 서버를 소유한다. 포트 값은 실행마다 달라진다.

```text
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port <run.json의 port> --strictPort
```

서버 환경은 `VITE_ENABLE_MSW=true`, `VITE_API_BASE_URL=''`, `API_PROXY_TARGET=http://127.0.0.1:9`로 고정한다. 마지막 값은 처리되지 않은 `/api` 요청이 개인 `.env`의 실제 서버로 전달되지 않게 한다. 이는 네트워크 차단 모드가 아니며 브라우저는 로컬 서버와 통신한다.

`VITE ... ready`만으로 준비 완료를 판단하지 않는다. Doctor가 새 브라우저에서 로그인 폼, MSW 제어, 비로그인 API 응답을 확인한 뒤 테스트를 시작한다. 시나리오 파라미터로 각 테스트의 데이터를 생성하므로 DB 마이그레이션과 외부 계정은 필요 없다. 테스트마다 새 브라우저 컨텍스트와 빈 sessionStorage를 사용한다. `pm@example.com` / `mock-password`는 모의 로그인 계정이다.

Playwright는 `reuseExistingServer: false`와 `--strictPort`로 기존 서버 사용을 거부한다. 포트 선택 직후 다른 프로세스가 같은 포트를 잡으면 시작이 실패한다. 다른 실행을 조작하지 말고 새 실행을 시작한다. 각 실행은 고유 증거 폴더와 포트를 사용하며 사용자 브라우저 프로필을 열지 않는다.

`HC_TERMINAL_ID`가 있는 herdr 환경에서는 `herdr` 스킬을 읽고 설치와 검증 명령을 보이는 작업 탭에서 실행한다. `herdr-app ls`로 현재 space ID를 확인하고 아래 형식에 실제 ID를 넣는다.

```powershell
hc run --bg --name verify-mm --cwd (Get-Location).Path --label herdr.space=<현재 space ID> node .cursor/skills/verify-managers-manager/scripts/verify.cjs run connections
hc wait verify-mm --timeout 30
hc read verify-mm --lines 80
```

명령이 끝나지 않으면 다른 작업을 진행한 뒤 `hc wait`를 다시 사용한다. 터미널의 exit code와 증거를 함께 읽는다. teardown은 아래 Cleanup에 따른다.

## Doctor

`scripts/doctor.cjs`는 Playwright의 global setup이다. 모든 실행에서 자동으로 다음을 읽어 확인하고 `doctor.json`, `doctor.png`, `doctor.aria.txt`를 남긴다.

- 이번 실행이 새로 띄운 strict-port 서버가 `/@vite/client`를 제공한다.
- 별도 Chromium 컨텍스트의 `/login`에 **이메일**과 **로그인** 버튼이 보인다.
- 읽기 전용 `GET /api/v1/auth/me`가 401을 반환하고 `mockServiceWorker.js`가 페이지를 제어한다.

HTTP 응답과 UI가 서로 다르거나 화면이 멈추면 활성 실행 ID로 재확인한다.

```powershell
node .cursor/skills/verify-managers-manager/scripts/verify.cjs doctor 2026-11-03T10-17-42-625Z-connections-54f7ef6a
```

위 ID는 실제 검증 실행의 예다. 재확인할 때는 현재 실행이 출력한 ID로 바꾼다. Doctor는 기록된 실행 프로세스가 살아 있어야 동작한다. 종료 후 실패하는 것은 정상이다. Doctor는 앱의 값을 저장하거나 시나리오를 재설정하지 않는다. 점검용 빈 컨텍스트에서 앱이 기본 모의 상태를 초기화하며 기존 테스트 컨텍스트에는 접근하지 않는다. 재실행은 같은 Doctor 증거를 덮어쓴다.

## Drive

```powershell
node .cursor/skills/verify-managers-manager/scripts/verify.cjs list
node .cursor/skills/verify-managers-manager/scripts/verify.cjs run auth
node .cursor/skills/verify-managers-manager/scripts/verify.cjs run meetings
node .cursor/skills/verify-managers-manager/scripts/verify.cjs run tasks
node .cursor/skills/verify-managers-manager/scripts/verify.cjs run dashboard
node .cursor/skills/verify-managers-manager/scripts/verify.cjs run connections
```

다섯 명령은 각각 독립 실행이다. 기능 파일의 경로·ARIA 이름·기대 결과를 기준으로 trace와 결과를 읽는다. 일부 진입점만 확인할 때는 실제 테스트 이름으로 필터링한다.

```powershell
node .cursor/skills/verify-managers-manager/scripts/verify.cjs run auth --grep '가입 → 워크스페이스 만들기'
```

필터 실행은 선택한 테스트만 검증한다. 선택된 테스트가 0개이거나 skip·flaky·실패가 있으면 성공으로 보고하지 않는다. `tasks`와 `connections`의 기본 필터는 UI로 상태를 바꾸는 테스트만 고른다. 기존 전체 E2E에 있는 모의 Notion 상태 직접 변경이나 API DELETE로 준비한 레이아웃 테스트는 사용자 경로의 증명에 포함하지 않는다.

## Evidence

증거는 `.verify/managers-manager/<실행 ID>/`에 남는다. 이 폴더는 Git에서 제외하며 cleanup은 삭제하지 않는다.

- `run.json`에 기능, 실제 테스트 파일·필터, 명령, URL·포트, 실행 PID, Node 버전, HEAD와 작업 트리 상태가 있다. HEAD만으로 미커밋 코드의 동일성을 주장하지 않는다.
- `doctor.*`에 준비 상태를 기록한다. `console.log`에 서버와 테스트 실행 출력을 남긴다.
- `results.json`과 `report/index.html`에 테스트별 단언·상태·소요 시간을 기록한다.
- `test-results/` 아래 테스트별 `trace.zip`과 PNG를 성공·실패 모두 보관한다. trace에는 클릭·입력·이동과 그때의 DOM·네트워크 정보가 있다.
- `cleanup.json`의 `portOpen: false`로 해당 포트가 닫힌 것을 확인한다.

보고서를 열려면 저장소 루트에서 실제 실행 ID를 사용한다.

```powershell
cd frontend
npx playwright show-report ../.verify/managers-manager/2026-11-03T10-17-42-625Z-connections-54f7ef6a/report --host 127.0.0.1
```

증명은 사용자가 한 동작과 결과를 모두 포함한다. 마지막 화면만으로 성공을 판정하지 않는다. 저장·승인·연결은 새로고침, 다른 화면의 목록 또는 읽기 전용 조회로 후속 상태를 확인한다. feature map에 여러 진입점이 있으면 각각 결과를 적고, 한 진입점의 성공으로 다른 진입점을 대체하지 않는다.

MSW는 앱의 기존 외부 API 경계다. sessionStorage의 모의 저장과 모의 OAuth 왕복은 실제 DB 행·외부 메시지·Notion 페이지 생성의 증거가 아니다. 실제 부작용이 필요한 요청에서는 서비스의 읽기 전용 조회와 결과물을 추가로 확보한다. 이 스킬에는 실서비스 쓰기나 외부 메시지 전송 권한이 포함되지 않는다. 필요한 데이터가 없는 흐름은 실패와 부족한 전제조건을 기능 파일의 Gotchas에 남긴다.

## Cleanup

정상 종료와 테스트 실패 시 Playwright가 자신이 시작한 Vite와 Chromium을 닫는다. wrapper는 종료 뒤 포트가 닫혔는지 확인한다. `cleanup.json`이 없거나 `portOpen: true`이면 정리 완료로 보고하지 않는다. 실패한 실행도 증거를 보존하고 정리 결과를 확인한 후 다시 실행한다.

실행 중 중단은 실행 터미널에 Ctrl+C를 보낸다. 강제 종료나 터미널 연결 단절로 정상 정리가 실행되지 않으면 `run.json`과 터미널의 자식 프로세스 트리를 대조한다. 그 실행이 만든 PID만 종료한다. 프로세스 이름이나 포트 검색 결과만으로 종료하지 않는다. Windows의 재귀 삭제가 필요하면 절대 경로가 해당 실행의 scratch 디렉터리인지 확인한다. 증거 폴더는 삭제하지 않는다.

herdr에서 직접 만든 작업 탭은 결과를 읽은 뒤 그 ID만 정리한다.

```powershell
hc kill verify-mm
hc rm verify-mm
```

이 명령은 자신의 실행이 끝난 탭에만 사용한다. 보고서 뷰어를 따로 열었다면 그 실행도 Ctrl+C로 종료한다.

## Helpers

- `scripts/verify.cjs`는 Node로 실행하는 CLI다. `list`, `run <기능> [--grep <정규식>]`, `doctor <실행 ID>`를 지원한다. 위 명령이 공개 진입점이다.
- `scripts/playwright.config.cjs`는 기존 설정을 확장해 포트·증거·Doctor를 연결한다. wrapper가 환경 변수를 설정한 뒤 `playwright test --config`로 호출한다. 직접 실행하지 않는다.
- `scripts/doctor.cjs`는 global setup과 `doctor` 명령이 호출한다. 별도 의존성이나 전역 패키지는 설치하지 않는다.

기능과 선택자가 바뀌면 `/maintain-verification-skill`로 기능 지도와 실행 절차를 갱신한다.
