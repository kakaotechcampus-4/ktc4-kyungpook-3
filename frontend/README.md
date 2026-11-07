# Frontend

React + TypeScript + Vite 앱. Node 24 LTS만 사용한다 (`engines`: `>=24 <25`). 로컬은 `frontend/.nvmrc`를 따른다.

## 설치와 실행

```bash
cd frontend
npm ci
npm run dev
```

개발 서버는 `http://localhost:5173`에서 뜬다.

## 검사

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
```

포맷을 맞출 때는 `npm run format`, 린트 자동 수정은 `npm run lint:fix`.

## Storybook

```bash
npm run storybook        # http://localhost:6006
npm run build-storybook  # storybook-static/
npm run test:storybook   # 빌드 뒤 정적으로 띄워 스토리 handler 회귀를 본다 (포트 6211)
```

스토리는 앱과 같은 MSW handler 로 데이터를 받는다. 스토리마다 `parameters.scenario` 로 시작 상태를 고르고, `parameters.msw` 는 기본 handler 위에 얹는다 (`.storybook/preview.tsx`).

## E2E

```bash
npx playwright install chromium  # 처음 한 번
npm run test:e2e                  # Vite 개발 서버(MSW)를 5211 포트로 띄워 Chromium 으로 돈다
```

E2E 는 매번 자기 개발 서버를 새로 띄운다 — 이미 떠 있는 서버를 재사용하지 않는다. 여러 worktree 를 함께 띄운 환경에서
다른 worktree 의 서버가 5211 을 쓰고 있으면 시작이 실패한다. 그때는 `E2E_PORT=5212 npm run test:e2e` 처럼 다른 포트를 준다.

테스트마다 `?msw-scenario=` 로 모의 데이터를 초기화한다 (`e2e/support.ts`). 실패하면 `playwright-report/`·`test-results/` 에 스크린샷이 남는다 — `npx playwright show-report`. trace 는 다시 돌릴 때만 기록한다(`on-first-retry`, CI 는 retries 1). 로컬에서 trace 가 필요하면 `npx playwright test <파일> --trace on`.

## 개발 모드의 모의 데이터

모의 데이터는 `VITE_ENABLE_MSW=true`를 명시했을 때만 쓴다. E2E·Storybook·Vitest는 이 설정과 상관없이 MSW를 쓴다. 실제 API 호출이 실패해도 모의 응답으로 자동 전환하지 않는다.

`VITE_ENABLE_MSW=true` 면 브라우저는 **비로그인**으로 시작하고, 가입·워크스페이스·온보딩 진행이 같은 탭의 sessionStorage 에 남는다(새로고침·OAuth 왕복).
픽스처 계정은 `pm@example.com` / `mock-password` 다. 시작 상태를 고르려면 주소에 `?msw-scenario=` 를 붙인다 —
`signed-out` · `no-workspace` · `single-workspace` · `multiple-workspaces` · `incomplete-workspace`.
Discord·Notion 연결은 모의 OAuth 화면(`/__mock/oauth/...`)으로 흉내 낸다 (`docs/plan/m4/basis-for-decision/2026-09-29-msw-storage-oauth-mock.md`).

## 백엔드 연동

백엔드 FastAPI는 `:8000`, 경로 prefix는 `/api/v1`이다. CORS가 없으므로 브라우저는 백엔드를 직접 호출하지 않는다.

개발 서버는 기본으로 실제 API를 부른다(`VITE_ENABLE_MSW=false`). `VITE_API_BASE_URL`은 비워 두고 Vite proxy를 쓴다. `/api` 요청은 `API_PROXY_TARGET`으로 전달되며, 비워 두면 `http://localhost:8000`이다. 이 값은 개발 서버만 읽고 브라우저 번들에는 들어가지 않는다.

로컬 백엔드에 붙일 때:

```bash
cd ../backend && ./run.sh
```

배포 백엔드에 붙일 때:

```bash
API_PROXY_TARGET=https://managers-manager.duckdns.org npm run dev
```

프록시 확인: `http://localhost:5173/api/v1/auth/me`가 백엔드의 `401 UNAUTHENTICATED` 봉투를 돌려주면 연결된 것이다. 백엔드 `/health`는 `/api` 밖이라 프록시로 확인할 수 없다.

예전에 MSW로 띄운 브라우저에는 mock worker가 남아 있을 수 있다. 실제 API로 띄우면 앱이 시작할 때 그 worker를 해제하고 한 번 다시 불러온다. 이미 만든 `.env`가 `VITE_ENABLE_MSW=true`이면 실제 API로 바뀌지 않으니 값을 확인한다.

환경 변수 예시는 `.env.example`. 비밀키와 OAuth client secret은 프론트엔드 환경 변수에 두지 않는다.

## 디렉터리

프론트엔드는 인증·공간 선택·온보딩·회의 업로드·처리 추적·회의록 표시와 태스크 목록·상세·확인 필요 승인을 담당한다. 백엔드와의 API 경계는 [대표 계약](docs/contracts/frontend-api-contract.md), 파트 간 처리 순서는 [전체 흐름](../docs/파트별%20전체%20흐름.md)에 정리한다.

`src/`는 Feature-Sliced Design이다. 의존은 위에서 아래로만 흐른다.

`app` → `pages` → `widgets` → `features` → `entities` → `shared`

## 문서

- 메시지 화면 실제 API 연결(#315, 2026-11-04): 계약 §5.7 의 메시지 API 로 응답 타입·매퍼·요청·MSW 를 옮기고 준비 중 안내를 지워 production 에서도 연다. 서버에 없는 답장 판정·`지금 바로`·채널 대화 등은 뺐다. MSW 기준 검증이며 실서버 연동은 미검증이다. [M8-C 결과](docs/plan/m8/result-c.md#2026-11-04-실제-메시지-api-연결-315) · [API 계약 §5.7](docs/contracts/frontend-api-contract.md).
- 메시지·알림 설정 연결(#340, 2026-11-05): 설정의 알림 절이 `GET`·`PATCH /workspaces/{id}/message-settings` 로 값을 읽고 PM 이 바꾼 키만 저장한다. 일반 팀원은 읽기만 하고, 실패하면 값을 되돌리고 알린다. 재촉 규칙(마감 0~3일 전, 0~23시 정시)이 토글 제목과 메시지 화면의 마감 기준 보낼 시각을 정한다. `웹으로만` 안내는 `pms[].discord_linked` 로 정하고, 이미 만든 제안 안내와 저장만 되는 두 항목의 준비 중 문구를 더했다. 모의 DB 버전이 10이 되었다. MSW 기준 검증이며 실서버 연동은 미검증이다. [M8-B 결과](docs/plan/m8/result-b.md#2026-11-05-알림-절의-설정-저장-api-연결-340) · [API 계약 §5.7](docs/contracts/frontend-api-contract.md)
- 메시지 묶음 합치기 뒤 선택 옮기기(#368, 2026-11-05): 보낼 시각을 옮겨 같은 팀원의 예정 메시지와 합쳐지면 화면이 합친 메시지로 옮겨 가고, 승인이 풀렸으니 다시 확인하고 승인하라고 알린다. MSW 도 BE 처럼 합치며 시나리오 `messages-merge` 로 재현한다. MSW 기준 검증이며 실서버 연동은 미검증이다. [M8-C 결과](docs/plan/m8/result-c.md#2026-11-05-합친-묶음으로-선택-옮기기-368)
- 재촉 직접 만들기와 태스크 빼기·메모 고치기(#370, 2026-11-05): PM 이 태스크 상세의 `재촉` 과 메시지 화면의 `새 재촉` 에서 재촉을 만들고, 보내기 전 확인에서 묶은 태스크 하나를 빼거나 메모를 고친다. 마지막 태스크를 빼면 그 메시지를 보내지 않는다고 먼저 묻는다. 담당자 없는 태스크와 완료한 태스크는 만들 수 없고, Discord 미연결 팀원은 알리기만 한다. 보낼 시각 고르기를 `entities/message-settings/ui` 로 옮겼고 모의 DB 버전이 11이 되었다. MSW 기준 검증이며 실서버 연동은 미검증이다. [M8-C 결과](docs/plan/m8/result-c.md#2026-11-05-재촉-직접-만들기와-묶음에서-태스크-빼기메모-고치기-370) · [API 계약 §5.7](docs/contracts/frontend-api-contract.md) · [결정 기록](docs/plan/m8/basis-for-decision/2026-11-05-reminder-create-entry-rules.md)
- PM 자기 대화 답장(#367, 2026-11-06): 워크스페이스 응답의 `member_id` 를 받아 대화의 `member_id` 와 같으면 PM 에게도 답장 칸을 보인다. 남의 대화와 `member_id` 가 없거나 `null` 인 응답은 지금처럼 안내 바다. 답장 기다림 표시 등 PM 화면 정책은 그대로다. 시나리오 `messages-pm-self`. MSW 에서 공간을 만든 계정이 새 PM 행과 이어지고 모의 DB 버전이 12 가 되었다. MSW 기준 검증이며 실서버 연동은 미검증이다. [M8-C 결과](docs/plan/m8/result-c.md#2026-11-06-pm-자기-대화-답장-367) · [API 계약 §4.2.1·§5.7](docs/contracts/frontend-api-contract.md)

- 메시지 갱신과 메시지 E2E(#371, 2026-11-06): 메시지 목록·대화는 AI 초안을 기다리는 묶음이 있을 때만 10초마다 다시 받고 탭이 가려지면 멈춘다. 알림 목록에 메시지 알림이 새로 오면 메시지 쿼리를 무효화한다. 상시 polling 은 없다. E2E 에 승인 → 예정, 409 `BUNDLE_CHANGED`, 팀원 답장, 초안 도착을 더했다. D-117·D-136 보류를 풀었다. MSW 기준 검증이며 실서버는 미검증이다. [M8-C 결과](docs/plan/m8/result-c.md#2026-11-06-메시지-갱신과-메시지-e2e-371) · [결정](docs/plan/m8/basis-for-decision/2026-11-06-message-sync-and-e2e.md) · [API 계약 §5.7](docs/contracts/frontend-api-contract.md)

- 리마인드 답장 판단 결과(#344, 2026-11-06): AI 가 태스크를 정하지 못한 답장을 PM 이 대화에서 고르고(`정하기`, 해당 없음 포함), 태스크 상세의 변경 이력이 답장과 그 답장이 바꾼 값을 한 칸으로 보이며, PM 이 자동 반영을 `되돌리기`로 되돌린다. 팀원에게는 답장 글 대신 안내가 보인다. 답장에서 온 승인은 회의 대신 답장을 근거로 보이고, 알림 `reply_judged`·`reply_unjudged` 에 제목이 생겼다. D-179 를 확정했다. 시나리오 `reply-judgment`·`reply-judgment-member`, 모의 DB 버전 14. MSW 기준 검증이며 실서버는 미검증이다. [M8-C 결과](docs/plan/m8/result-c.md#2026-11-06-리마인드-답장-판단-결과-연결-344) · [API 계약 §5.7](docs/contracts/frontend-api-contract.md)
- PM 자기 리마인드 대화 구역(#417, 2026-11-07): PM 의 자기 대화를 메시지 목록 맨 위 `내 리마인드` 구역에 두고 팀원 화면 규칙(봇 왼쪽·자기 답장 오른쪽·기다림 표시 없음·기기 알림 띠)으로 그린다. `대화` 와 `답장 기다리는 중 N` 에서는 뺀다. 표시 규칙과 답장 칸을 (역할, 대화 주인)으로 고르는 `threadPolicy` 하나가 정한다. `member_id` 가 없는 응답이면 구역이 없다. 예정 묶음 확인·태스크 고르기 같은 PM 권한은 그대로다. MSW 기준 검증이며 실서버는 미검증이다. [M8-C 결과](docs/plan/m8/result-c.md#2026-11-07-pm-자기-리마인드-대화-구역-417) · [API 계약 §5.7](docs/contracts/frontend-api-contract.md)
- 회의 채팅 채널 고르기(#429, 2026-11-07): PM 이 설정 연결 탭의 Discord 카드 아래에서 연결한 서버의 텍스트 채널을 고르면 매일 09:00 채팅 자동 수집이 켜지고 `사용 안 함` 으로 끈다. 저장 전에 안내를 보이고, 봇이 채널을 읽거나 보낼 수 없으면 채널 권한에서 고칠 방법을 알린다. Discord 연결 끊기 확인 창은 채팅 채널도 함께 꺼진다고 알린다. 선택 칸은 공용 선택 상자(`shared/ui/select`, #471)다. 모의 DB 버전 15. MSW 기준 검증이며 실서버는 미검증이다. [M8-B 결과](docs/plan/m8/result-b.md#2026-11-07-회의-채팅-채널-고르기-429) · [API 계약 §4.3.1](docs/contracts/frontend-api-contract.md) · [결정](docs/plan/m8/basis-for-decision/2026-11-07-chat-channel-save-flow.md)

- 온보딩·가드 테스트 4건 재검증(2026-11-04): 기본 테스트 브라우저의 모션 선호를 고정하고 실제 마스코트의 모션 감소 분기를 사용한다. 기존 모션 허용·변경·API 누락 검증을 보존했으며 관련 104개와 전체 단위 176개 파일·2,141개 테스트가 통과했다. [M4 추가 결과](docs/plan/m4/result.md#2026-11-04-추가-결과-온보딩가드-테스트의-모션-환경)에 재현과 검증을 기록한다.

- 수동 업로드 실패 안내·만료 이력(#256, 2026-11-04): 알려진 실패 사유를 구분하고 화자 지정 만료 이력을 목록·상세에 남긴다. BE 목록 필터와 실패 사유 필드를 함께 보완했다. [M5 추가 결과](docs/plan/m5/result.md)에 검증과 제출 UI 후속 작업을 기록한다. 자동 만료 PR #301과 실서버 연동은 별도다.
- 화자 지정 화면(#256·#342, 2026-11-05): 업로드 회의가 화자 지정 대기가 되면 PM을 처리 화면·토스트·회의록 목록의 `화자 지정 필요` 행에서 `/meetings/:id/speakers`로 안내한다. 샘플 구간을 들어 보고 모든 화자를 팀원·외부 참석자로 지정해 제출하면 처리가 이어진다. 409 만료 안내와 근거 화자 이름의 팀원 ID 조회(A1)를 함께 넣었다. 모의 DB 버전이 8이 되었다. MSW 기준이며 실서버와 m4a 재생 시각은 미검증이다. [M5 추가 결과](docs/plan/m5/result.md#2026-11-05-추가-결과-화자-지정-화면과-샘플-구간-256-342)
- 탭 패널 초점·회의 날짜 Tab 순서(#337, 2026-11-04): 회의록·태스크 목록 탭 패널은 안에 누를 것이 없을 때만 Tab으로 닿는다. 회의 날짜의 갇힘은 Chromium 153·Chrome 156에서 재현되지 않아 기본 날짜 입력을 유지한다. [M5 추가 결과](docs/plan/m5/result.md#2026-11-04-추가-결과-탭-패널-초점과-회의-날짜-tab-순서-337)에 재현 기록과 검증을 남긴다.

- 로그인 후 시작 방식 선택 추가·디자인 통일(2026-11-03): 소속이 없는 계정은 팀원 작업과 PM 생성을 먼저 고른다. 기존 온보딩 프레임·매스 말풍선·카드를 재사용한다. 타입·린트·빌드·포맷과 Chromium E2E 12개가 통과했다. 전체 단위 묶음은 시간 초과가 남았으며, [M4 추가 결과](docs/plan/m4/result.md)에 원본 검사와 단독 재검사 근거를 기록한다. 초대·가입 API와 실제 외부 연동은 미검증이다.
- [문서 안내](docs/README.md): 대표 경로, 기존 문서 대응과 유지한 자료.
- [API 계약](docs/contracts/frontend-api-contract.md): 기존 백엔드 요청과 현재 코드 차이를 한 문서에서 관리.
- [전체 계획](docs/plan/frontend-plan.md) · [마일스톤 상태·기록](docs/plan/README.md): M0~M8. M0~M5는 기존 계획 원문을 각 `plan.md`로 이동했다. M6·M7은 계획과 결과([M6](docs/plan/m6/result.md), [M7](docs/plan/m7/result.md))가 있고 M8은 0바이트 초기화 파일이다.
- 캘린더 상태 색 외 구분(#338, 2026-11-05): 캘린더 칩·범례에 `마감 임박`·`확인 필요` 아이콘을 더하고, 아이콘이 없는 진행 중·할 일·완료를 포함해 모든 칩 링크 이름을 상태부터 읽게 했다. 팀 화면의 기한 지난 마감에도 같은 아이콘을 붙였다. 표식 모양은 디자인 합의 전 기본값이다. [M8-A 추가 결과](docs/plan/m8/result-a.md#2026-11-05-추가-결과-캘린더-상태를-색-외-표식으로도-구분-338) · [결정](docs/plan/m8/basis-for-decision/2026-11-05-calendar-status-marks.md)
- M6 후속 #311: 태스크 진행률을 현재 모델·화면에서 제거하고, 생성·수정 승인 보완값을 실 API 요청과 MSW에 연결했다. 충돌 재확인·완료값 표시는 [M6 후속 결과](docs/plan/m6/result.md)와 [API 계약](docs/contracts/frontend-api-contract.md)에 기록한다. 실 백엔드 연동은 BE PR #307 배포 환경에서 확인해야 한다.
- 마일스톤 밖 수정: 태스크 상세 재조회 실패가 화면에 안 보이고 polling이 조용히 멈추던 문제(#236) — 판정 함수 `queryView`를 `shared/lib/query-view`로 옮겨 상세 화면과 Notion polling이 함께 쓰고, 갱신 실패 시 본문 유지·안내·`다시 시도`를 두고 Storybook 스토리를 추가했다. [계획](docs/plan/refactor/plan-task-detail-refetch-error.md) · [결과](docs/plan/refactor/result-task-detail-refetch-error.md) · [M6 결과](docs/plan/m6/result.md). Node v24.11.0에서 typecheck·lint·format·vitest·build·관련 E2E·Storybook 통과(스토리 추가 후 105건), 독립 검증 완료, MSW 기준이며 실서버 미검증.
- 마일스톤 밖 수정: 온보딩에서 기존 PM을 체크해 Discord 중복 멤버 생성 방지(#228) — [계획](docs/plan/refactor/plan-onboarding-pm-discord-link.md) · [결과](docs/plan/refactor/result-onboarding-pm-discord-link.md). MSW 기준 검증, 실서버 미검증.
- 마일스톤 밖 수정: 강조색·흐린 글자의 명도 대비(#336, 2026-11-04) — `accent`를 `#c43636`, `accent-soft`를 `#cf4545`로 바꾸고 읽어야 하는 `faint` 글자는 `dim`으로 옮겼다. 색 값은 디자인 합의 전 기본값이다. [결정](docs/plan/m2/basis-for-decision/2026-11-04-accent-faint-contrast.md). 마일스톤이 문서로 정해지지 않아 result.md는 만들지 않았다.
- 마일스톤 밖 수정: 대시보드 최신 완료 회의 선택에서 전체 목록 복사·정렬을 없앴다(#350, 2026-11-05). 완료 회의만 한 번 훑어 고르며 선택 결과·동률·날짜 누락 처리는 같다. 호출 1회 30건 약 50µs → 3~4µs, 1만 건 약 61ms → 1.5ms(Node 측정, 체감 개선은 주장하지 않음). [계획](docs/plan/refactor/plan-latest-done-meeting.md) · [결과](docs/plan/refactor/result-latest-done-meeting.md)
- 마일스톤 밖 수정: 간트 보기의 담당자별 묶음(`widgets/task-board/lib/ganttGroups.ts`)을 항목을 한 번 훑어 만든다(#353, 2026-11-05). 묶음 순서·문구는 이전과 같다. [계획](docs/plan/refactor/plan-gantt-group-rows.md) · [결과](docs/plan/refactor/result-gantt-group-rows.md)
- 마일스톤 밖 수정: 폰트 preload 재측정(#352, 2026-11-05). production 빌드·Slow 4G 에서 Bold preload 를 빼 LCP 를 0.5~1.0초 줄였다. 굵은 글씨는 첫 화면 뒤 약 1.5초 동안 기본 폰트로 보인다. unicode-range 분할은 LCP 가 늘어 적용하지 않았다. 운영 Caddy 설정과 실제 API 왕복은 반영하지 않은 측정이다. [측정·재현](docs/performance/2026-11-05-font-loading-remeasure.md)
- 마일스톤 밖 수정: 비밀번호 재설정 화면(#356, 2026-11-05). `/forgot-password`에서 메일을 요청하고 60초 동안 다시 보내기를 막는다. 메일 링크의 `/reset-password#token=`은 토큰을 주소에서 지운 뒤 확인하고, 바꿀 계정을 가린 이메일로 보이며, 만료·재사용·무효 링크를 나눠 안내한다. 바꾼 뒤에는 세션 상태를 비우고 로그인 화면에 안내를 띄운다. BE는 PR #398로 열려 있고 병합 전이다. 로그인 화면의 링크는 비활성으로 두었고 BE 배포와 운영 메일 설정 뒤 켠다. 시나리오는 `password-reset`·`-expired`·`-used`·`-invalid`·`-cooldown`·`-server-error`·`-mail-unavailable`이고 MSW 모드의 `/__mock/mail`에서 보낸 링크를 연다. 모의 DB 버전이 9가 되었다. MSW 기준이며 실서버와 실제 메일은 미검증이다. 마일스톤이 정해지지 않아 result.md는 만들지 않았다. [API 계약](docs/contracts/frontend-api-contract.md) §4.1.1
- 마일스톤 밖 기록: TaskBoard 파생 연산 측정(#351, 2026-11-05). 보기에 필요 없는 파생값과 탭 개수 반복은 태스크 2,000건에서 한 번에 5.3~8.7ms(Chromium 153, 프로덕션 모양 번들)이고, 개발 빌드 화면에서 동작 CPU 시간의 최대 약 5%라 코드 변경을 보류했다. 프로덕션 화면 효과는 미검증이다. URL 변경마다 `board`가 다시 도는 memo 무효화는 #391로 남겼다. [측정](docs/performance/2026-11-05-taskboard-derived.md) · [계획](docs/plan/refactor/plan-taskboard-derived.md) · [결과](docs/plan/refactor/result-taskboard-derived.md)
- 마일스톤 밖 수정: 채팅 출처 회의 표시(#379, 2026-11-05). 회의록 목록은 채팅 회의에 `채팅` 배지를 달고 길이를 뺀다. 회의록 머리는 서울 시각 범위, 전사문과 근거는 실제 작성 시각(`MM/DD HH:mm`)으로 보인다. 녹음 회의 표시는 그대로다. 승인 카드의 근거 시각은 #397로 남겼다. MSW 기준 검증이며 실서버는 미검증이다. [결과](docs/issues/379-chat-meeting/result.md)
- 마일스톤 밖 수정: 채팅 회의 승인의 근거 시각(#397, 2026-11-05). 대시보드 확인 필요 목록, 승인 검토(범위 변경 포함), 태스크 보드 승인 카드가 승인의 회의를 회의 목록에서 찾아, 채팅 회의는 실제 작성 시각(`MM/DD HH:mm`)으로, 녹음 회의는 그대로 `mm:ss`로 보인다. 회의를 찾지 못하면 시각을 숨기거나 `알 수 없음`으로 둔다. BE 계약은 그대로다. 시나리오 `approval-chat`. MSW 기준 검증이며 실서버는 미검증이다. [결과](docs/issues/397-chat-approval-evidence-time/result.md)
- 마일스톤 밖 수정: 받아 둔 회의 상세 뒤 403·404(#405, 2026-11-06). 처리 화면, 화자 지정 화면, 회의록 본문이 상세·회의록·화자 목록을 받아 둔 뒤 403·404를 받으면 처음부터 볼 수 없는 회의와 같은 「이 회의를 볼 수 없어요」로 바뀐다. 처리 화면이 추적이 멈춘 채 「정리하고 있어요」에 남던 것을 고치기 전 테스트로 재현했다. 대시보드 최근 반영은 404면 회의 목록을 다시 받아 다음 완료 회의를 보이고, 403이면 오류 카드다. 판정(`isAccessLost`·`isMeetingUnavailable`)을 회의 엔티티로 옮겼다. MSW 기준 검증이며 실서버는 미검증이다. [결과](docs/issues/405-meeting-unavailable/result.md) · [결정](docs/plan/m5/basis-for-decision/2026-11-06-meeting-unavailable-after-cached-detail.md)
- 마일스톤 밖 수정: 로그인 뒤 돌아가기와 기기 알림 안내(#411, 2026-11-06). 로그인이 풀린 채 보호 주소(푸시로 연 대화·태스크 포함)를 열면 `/login?next=`로 가고 로그인 뒤 그 주소로 돌아간다. `next`는 앱 안 보호 경로만 받고, 직접 로그아웃한 화면에는 붙이지 않는다. 팀원이 리마인드 대화를 열면 대화 머리 아래에 기기 알림을 켜자는 띠가 보이고, 권한은 [알림 켜기]를 누를 때만 묻는다. 닫거나 켜거나 거절하면 이 기기·계정에서 다시 보이지 않는다. MSW 기준 검증이며 실서버와 실기기 푸시는 미검증이다. [결과](docs/issues/411-login-return-push-prompt/result.md)
- 마일스톤 밖 수정: 강조색 레드 다섯 값(#423, 2026-11-06). 벽돌색 `#c43636` 하나를 `accent`(`#c62828`, 작은 글자·경계), `accent-point`(`#e62e2d`, 점·포커스 선), `accent-solid`(`#d32f2f`, 흰 글자 면·플레이스홀더), `accent-badge`(`#fbe9e7`, 글자 있는 배지 면), `accent-chip`(`#f4d9d7`, 캘린더 칩·안내 띠)으로 나누고 자리마다 필요한 대비로 골랐다. `accent-soft`는 지웠다. 설정 알림 절 문구를 「켜면 새 알림이 올 때 이 기기로 바로 알려 드려요.」로 고쳤다. 디자인 문서 색 표는 #395에서 맞춘다. MSW 기준 검증이다. [결과](docs/issues/423-accent-red/result.md) · [결정](docs/plan/m2/basis-for-decision/2026-11-06-accent-red-r2.md)
- 마일스톤 밖 수정: 로딩 스플래시·설치한 앱 시작 화면·첫 방문 인트로(#430, 2026-11-06). `index.html` 의 먹 마스코트가 JS 보다 먼저 그려지고 React 가 같은 자리에서 둘러보기·눈웃음·사라짐을 이어 한다. 라우트 뼈대가 그려진 동안 덮고 대시보드 카드 데이터는 기다리지 않는다. 로그인 직후에도 덮고, 랜딩은 React 가 뜨면 바로 걷는다. 마스코트에 눈웃음·속도 옵션을 더했다. iOS 시작 이미지 29장을 `npm run startup-images` 로 만든다. 함께 넣은 첫 방문 인트로는 #465 로 뺐다. MSW·프로덕션 번들 기준 검증이며 실제 iOS 기기는 미검증이다. [결과](docs/issues/430-splash/result.md) · [결정](docs/plan/m2/basis-for-decision/2026-11-06-splash-direction-a-smile.md)
- 마일스톤 밖 수정: 첫 방문 인트로 빼기(#465, 2026-11-06). #430 이 넣은 매스 인트로를 두 자리(랜딩 `시작하기` 첫 클릭, 온보딩을 마친 뒤 첫 대시보드) 모두 뺐다. 랜딩이 이미 서비스를 소개해서 같은 이야기를 한 번 더 했기 때문이다(사용자 결정). `시작하기` 는 다시 바로 `/login` 으로 간다. 인트로 컴포넌트, `localStorage` 본 기록, 온보딩 완료·「내 팀 확인」 첫 선택의 신호, 스플래시의 「덮는 중」 신호를 지웠다. 이미 저장된 키를 지우는 코드는 두지 않았다. 스플래시, iOS 시작 이미지, 탭 제목, 마스코트 눈웃음·속도 옵션은 그대로다. MSW 기준 검증이다. [결과](docs/issues/465-remove-intro/result.md) · [결정](docs/plan/m2/basis-for-decision/2026-11-06-splash-direction-a-smile.md#이후-변경-첫-방문-인트로를-뺐다-465)
- 마일스톤 밖 수정: 회의 정리 진행 토스트(#424, 2026-11-06). 헤더 「정리 중」 링크를 지우고 오른쪽 아래 토스트 하나가 정리 중(펼침·접힘)·화자 지정 필요·완료·실패를 이어서 보인다. 기존 완료·화자 지정·실패 토스트는 이 토스트의 상태가 됐고, 완료·실패는 닫을 때까지 남는다. 정리 중은 화면 폭과 상관없이 접힌 알약으로 시작하고, 고정 토스트가 있는 동안 본문 아래를 그 높이만큼 비운다. 팀원은 정리 중·완료만 본다. 지금 공간의 회의만 보이고 처리·화자 지정 화면에서는 숨는다. 다른 토스트는 그 위로 쌓인다. 화자 지정 대기 회의도 공간 목록에서 찾아 새로고침 뒤에도 카드가 남는다. 접힌 알약의 점은 토큰 `accent-signal`(`#ff2e2e`)이다. MSW 기준 검증이며 실서버는 미검증이다. [결과](docs/issues/424-processing-toast/result.md) · [결정](docs/plan/m5/basis-for-decision/2026-11-06-processing-toast.md)
- 마일스톤 밖 수정: 태스크 보드 본문 폭(#466, 2026-11-06). 보드도 리스트와 같은 960px 컨테이너(본문 864px)를 써서 리스트↔보드를 오가도 제목·보기 전환·도구줄이 좌우로 움직이지 않는다. 캘린더·간트는 셸 폭 그대로다. 보드 카드는 864px에서 넘치거나 겹치지 않아 고치지 않았다. 휴대폰 폭은 같다. MSW 기준 검증이다. [결과](docs/issues/466-board-width/result.md)
- 마일스톤 밖 수정: 로딩 스플래시 키우기(#472, 2026-11-07). 마스코트를 96 → 176px, 워드마크 글자를 18 → 24px, 간격을 12 → 18px 로 키웠다(사용자 결정). 마스코트·워드마크가 올라오는 거리도 크기에 비례해 22px·8px 로 바꿨다. 순서·시간은 그대로다. 크기는 `src/app/splash/splashSize.ts` 한 곳에 두고 `SplashHost`·시작 이미지 스크립트가 읽으며, `index.html` 사본은 테스트가 맞춰 본다. iOS 시작 이미지 29장을 다시 만들었다. MSW 기준 검증이며 실제 iOS 기기는 미검증이다. [결과](docs/issues/472-splash-size/result.md) · [결정](docs/plan/m2/basis-for-decision/2026-11-06-splash-direction-a-smile.md#이후-변경-마스코트와-워드마크를-키웠다-472)
- 마일스톤 밖 수정: 휴대폰 셸(#478 첫 PR, 2026-11-07). 최소 지원 폭을 360px 로 바꿨다(D-180, D-123·D-124 대체). 폭 768px 미만은 위 헤더의 탭 대신 화면 아래 탭 막대(홈·회의록·태스크·메시지·팀)를 두고, 위에는 공간 메뉴·알림·계정만 남긴다. 안전 영역을 반영하고 정리 중 토스트는 막대 위로 올린다. 360px 에서 모든 화면이 같은 폭만큼 넘치던 원인은 줄지 않는 헤더 한 줄이었다. 화면 안쪽 배치와 그 화면들의 넘침 검사는 다음 PR 이 한다. 메시지 탭의 새 글 수는 #480 뒤에 붙인다. 768px 이상은 그대로다. MSW 기준 검증이며 실제 기기는 미검증이다. [결과](docs/issues/478-mobile/result.md)
- 마일스톤 밖 수정: 휴대폰 화면 배치(#478 둘째 PR ②a, 2026-11-07). 폭 768px 미만에서 대시보드를 H-2 시안(요약 카드 칸, 한 열)으로, 태스크 보드를 H-3 시안(위 칸 고르기, 요약 한 줄, 카드 한 열)으로 바꿨다. 태스크 리스트·캘린더·간트, 회의록·회의 상세, 팀, 설정, 회의 올리기는 한 열로 쌓는다. 360·390px 넘침이 모두 0 이고 레이아웃 E2E 가 360·390·768px 에서 본다. `max-md:` 클래스만 더해 768px 이상은 같다. 메시지·로그인은 다음 PR 이다. MSW 기준 검증이며 실제 기기는 미검증이다. [결과](docs/issues/478-mobile/result.md)
- 마일스톤 밖 수정: 태스크 상세·승인 확인 다시 그리기(#471, 2026-11-07). 태스크 상세는 PM 전용 상태 트랙, 담당자·마감·Notion 정보 패널, 바뀐 필드만 보내는 저장 줄, 막힘일 때만 막힌 사유, 재촉 카드, 구분선 변경 이력으로 바꿨다. 저장은 버전 비교 없이 마지막 저장이 이긴다(BE 에 409 없음). 승인 확인은 질문형 제목과 한 카드 안에서 태스크명·담당자·마감을 바로 고치고(「보완하기」 삭제), 근거와 「확인이 필요한 이유」를 같이 보이며, 원문 마감이 확실한 표현이면 회의 날짜 기준 「M/D(요일)로 채우기」를 제안한다. 공용 선택 상자 `shared/ui/select`(Radix Select 2.3.7)와 날짜 칸 `shared/ui/date-field` 를 더했고 선택 상자는 승인 확인 담당자에만 썼다(나머지는 #477). #344 의 답장 이력·되돌리기·답장 근거는 그대로다. MSW 기준 검증이다. [결과](docs/issues/471-detail-approval-redesign/result.md) · [결정](docs/plan/m6/basis-for-decision/2026-11-07-due-fill-from-raw-expression.md)
- 마일스톤 밖 수정: 휴대폰 메시지 화면(#478 PR ②b, 2026-11-07). 768px 미만 메시지는 목록이 먼저 보이고, 항목을 누르면 셸 헤더·아래 탭 막대 대신 뒤로 가기·제목 머리를 둔 상세가 화면 전체로 열린다(H-4·H-5). 목록에서 연 상세의 뒤로 가기는 브라우저 뒤로 가기와 같다. 768px 을 넘나들어도 고른 항목과 쓰던 답장이 남는다. 화면 높이를 휴대폰 헤더·탭 막대에 맞춰 바깥 페이지가 더 스크롤하던 문제를 없앴고, 목록의 정리 중 토스트 아래로도 마지막 행을 꺼낼 수 있다. 768px 경계를 `shared/lib/compact-screen` 으로 옮겼다. 태스크 상세·승인 확인은 이미 넘치지 않아 넘침 검사만 더했다. 768px 이상은 그대로다. MSW 기준 검증이며 실제 기기는 미검증이다. [결과](docs/issues/478-mobile/result.md)
- 마일스톤 밖 수정: 정리 중 채팅 회의가 업로드를 막던 문제(#450, 2026-11-07). 업로드 진입과 응답 잃은 업로드 복구가 `source: chat` 회의를 세지 않아, 채팅 회의가 정리 중이어도 PM 이 업로드 화면에서 올릴 수 있다. 정리 중 토스트는 채팅 회의를 그대로 따라간다. `failed_stage=chat_stalled` 실패는 「채팅 대화를 정리하다 멈췄어요. 다음 수집 때 다시 정리해요.」로 안내하고 재업로드 링크를 감춘다(문구는 감독 기본값). MSW 기준 검증이며 실서버는 미검증이다. [결과](docs/issues/450-chat-upload-entry/result.md)
- 마일스톤 밖 수정: 나머지 선택 상자 다섯 곳(#477, 2026-11-07). 승인 카드·태스크 상세 담당자, 수정 제안 상태, 재촉 만들기 받는 사람·태스크, 설정 재촉 며칠 전·시각이 #471 공용 선택 상자를 쓴다. 폭 560px 아래에서는 아래 시트로 고르고, 재촉할 태스크가 8개를 넘으면 찾기 칸으로 거른다. 담당자 줄 조립은 `entities/member`, 상태 이름·표식은 `entities/task` 에 모았다. MSW 기준 검증이다. [결과](docs/issues/477-select-rollout/result.md) · [결정](docs/plan/m6/basis-for-decision/2026-11-07-select-sheet-and-combobox.md)
- [공통 작업 규칙](../docs/agent-rules.md) · [문서 양식](../docs/README.md).
- `docs/requests/`: 실제 독립 요청 발생 시 기록. 기존 백엔드 요청은 API 계약 §4에 유지.
- [제품·기술 결정](docs/decision/frontend-decisions.md) · [구현 결정 안내](docs/plan/basis-for-decision-guide.md): 구현 결정 원문은 해당 마일스톤의 `basis-for-decision/`에 있다.
- [디자인](docs/design/design-system.md) · [캔버스](docs/design/canvas/README.md) · [마스코트](docs/mascot/mascot.md).
- [성능 개선 거리](docs/performance/README.md): 측정했지만 아직 고치지 않은 것.

### 마일스톤 상태

M0~M3은 대응 코드가 있으나 이번 문서 작업에서 완료조건을 재검증하지 않았다. M4·M5는 기존 계획·인수인계에 **MSW 기준 완료 판정**이 기록되어 있다. M5 인수인계는 실제 백엔드 성공 흐름을 미검증으로 남겼다. M6는 [계획](docs/plan/m6/plan.md)의 구현 순서 1~5를 진행했고 [결과](docs/plan/m6/result.md)에 완료조건별 상태와 검증을 기록했다. 목록의 확인 필요 카드, 실 API 보류의 비활성 승인, 키보드 상세 진입, 리스트 본문 폭은 완료 검증 뒤에 현재 화면에 맞춰 다시 확인했다. 최종 게이트는 Node 24가 아닌 Node v22.17.1에서만 실행해 Node 24 게이트는 미실행이고, 실 API 보완·승인 조회 PM 제한·실제 Notion 반영은 미검증 연동 과제로 남아 완료를 선언하지 않는다. M7은 [계획](docs/plan/m7/plan.md)의 구현 순서 1~5를 진행했고 [결과](docs/plan/m7/result.md)에 AC-01~AC-06의 프론트·MSW 기준 충족과, 리뷰 지적 E-01~E-05 수정 뒤 Node v24.21.0 전체 게이트 재실행 통과(2026-10-18)를 기록했다(커밋 전). 실 API 되돌리기와 실제 Notion 페이지 보관은 미검증 연동 과제다. M8은 폴더 초기화만 진행했다. 각 계획과 존재하는 검증 기록은 [마일스톤 안내](docs/plan/README.md)에서 연결한다.
