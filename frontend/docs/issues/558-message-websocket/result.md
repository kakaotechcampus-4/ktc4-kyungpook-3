# 결과: 메시지 새 글 웹소켓 연결 (#558)

- 기록일: 2026-11-09
- 대상: [#558](https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/issues/558)의 FE 몫이다. BE 몫은 #557(대화 신호 웹소켓, #520)로 develop 에 병합됐다.
- 기준: #519·#525 브랜치(PR #583) 위에 쌓았다. PR은 아직 만들지 않았다.
- 상태: **구현했다.** 단위·화면(RTL)·MSW 테스트, MSW 개발 서버 브라우저(Chromium 1280), 가짜 백엔드에 붙인 Vite 프록시로 확인했다. 실제 BE(로컬·배포)에 붙인 확인은 하지 않았다.

## 작업 근거

마일스톤 계획에 없는 작업이다. 근거는 #558 본문의 요청과 [계약 §5.7](../../contracts/frontend-api-contract.md)의 「대화 신호 웹소켓」(BE #557)이다.

| 커밋 | 요지 |
|---|---|
| `5c26f11c` | 소켓 연결, 닫힘 코드 표, 다시 붙기 간격 표, 세션이 끝나면 닫기 |
| `aba8e8be` | MSW `ws.link` 모의 소켓. 4401·4403, 대화 주인과 PM 전원에게 신호 |
| `7494a357` | 메시지 화면이 소켓을 열고 신호에 메시지 조회를 다시 부른다 |
| `de4f3bc0` | 개발 서버 프록시에 소켓 경로 규칙 |
| `0efea7b2` | 리뷰 반영: 받는 중인 조회와 겹친 신호·열림도 새 글을 다시 받는다 |
| 문서 커밋(이 기록) | 계약 §5.7 의 프론트엔드 연결 |

## 바꾼 것

- **연결** [messageSignals.ts](../../../src/entities/message/api/messageSignals.ts): 소켓 수명을 이 모듈 하나가 맡는다. 열릴 때와 `thread_updated` 를 받을 때 `onSync` 를 부르고, 서버가 닫으면 닫힘 코드 표(`CLOSE_VERDICT`)대로 다시 붙는다. 4401·4403 은 멈추고, 그 밖은 1·2·4·8·16·30초 간격(그 뒤 30초)으로 다시 붙는다. 열리면 간격이 처음으로 돌아간다. 멈추면 그 소켓의 핸들러를 바로 떼어 늦게 온 이벤트가 닿지 않는다.
- **주소**: REST 요청과 같은 API 기준 주소에 붙인다. 경로뿐이면 `window.location` 의 출처를 쓴다. 라우터의 `useLocation()` 은 쓰지 않는다(이슈의 `ws://undefined`).
- **화면** [useMessageSignals.ts](../../../src/widgets/message-inbox/model/useMessageSignals.ts): `MessageInbox` 가 떠 있는 동안 연결하고 `messageKeys(workspaceId)` 를 다시 부른다. 공간이 바뀌거나 화면을 떠나면 닫는다. 연결을 연 세션의 취소 신호를 넘겨, 로그아웃·계정 전환 때는 화면이 떠 있어도 닫는다. 열릴 때 받는 중인 조회가 있으면 끊지 않고, 끝난 뒤 한 번 더 받는다. 신호를 받으면 받는 중인 조회를 데이터가 없는 첫 조회까지 끊고(`cancelQueries`) 다시 받는다. 리뷰 두 곳이 같은 결함을 찾았다. 처음에는 `cancelRefetch` 만 썼는데, TanStack Query 는 데이터가 없는 조회를 그것으로 끊지 않고, 끝난 신호 전 응답이 무효 표시를 지워 새 글이 빠졌다. 첫 조회·재연결 중 조회를 붙잡아 두고 신호를 보낸 뒤 옛 응답을 풀어도 새 글이 보이는 화면 테스트 3개가 고치기 전에 실패하고 고친 뒤 통과했다.
- **Vite** [vite.config.ts](../../../vite.config.ts): 소켓 경로 규칙(`ws: true`, `changeOrigin: false`)을 `/api` 앞에 두었다.
- **MSW** [messageSocket.ts](../../../src/shared/mock/handlers/messageSocket.ts): 세션 없음 4401, 비소속 4403. 답장 쓰기 경로가 글을 저장하면 대화 주인과 PM 전원(쓴 사람 포함)의 소켓에 신호를 보낸다. `handlers` 배열은 `RequestHandler` 만 받는 테스트가 많아, 소켓 처리기는 `server.ts`·`browser.ts` 에서 따로 등록했다.
- **기존 테스트**: `shellPrefetch.test.tsx` 의 「받은 탭으로 처음 옮기면 화면의 조회가 다시 묻지 않는다」는 목록 조회가 한 번 나가는 것으로 바꿨다. 소켓이 열릴 때마다 조회한다는 계약 때문이다. 화면은 캐시로 바로 그린다.

## 검증

- 새 테스트(`--maxWorkers=1`): `messageSignals.test.ts` 24개, `messageSocket.test.ts` 6개, `messagesSignals.test.tsx` 9개 통과. 일부러 코드를 깨면 해당 테스트가 실패하는 것도 봤다.
- 영향받는 기존 메시지·알림·앱 테스트 묶음을 돌려 모두 통과했다. 전체 검사(`ed1aeb90`): `npm run test -- --maxWorkers=1` 284개 파일 3661개 모두 통과, `npm run build` 통과. typecheck·lint 도 통과했다.
- 브라우저(MSW 개발 서버, Chromium 1280): 메시지 화면에 소켓 하나, 다른 계정 글을 넣고 신호를 보내자 135ms 만에 대화에 보임(polling 30초 전), 1012 뒤 다시 붙음, 4401 뒤 다시 붙지 않음, 새로고침 뒤 다시 하나, 화면을 떠나면 닫힘, 소켓 관련 콘솔 오류·경고 없음. 7개 모두 통과했다. 스크립트와 로그는 git 에서 뺀 `frontend/.verify/558/` 에 있다.
- Vite 프록시: 가짜 백엔드를 `API_PROXY_TARGET` 으로 두고 개발 서버를 띄웠다. 소켓 경로가 업그레이드(101)됐고, 백엔드가 받은 `Host`·`Origin` 이 둘 다 개발 서버 주소였다. 일반 `/api` 요청은 `Host` 가 백엔드 주소로 바뀌었다.

## 남은 것

- 실제 BE(로컬 uvicorn `--workers 1`)에 붙인 확인을 하지 않았다. 로컬 BE 는 PostgreSQL(Docker)이 필요한데 이 기계의 Docker Desktop 이 꺼져 있었다. 배포 서버(Caddy)를 거친 연결도 확인하지 않았다.
- 화면이 다시 마운트되지 않은 채 다음 세션으로 넘어가면 그 세션에는 소켓이 없다. 지금은 로그아웃이 화면을 떠나므로 생기지 않고, polling 은 돈다.
- 절대 주소 `VITE_API_BASE_URL` 은 테스트하지 않았다. 주소 계산은 `client.ts` 와 같다.
