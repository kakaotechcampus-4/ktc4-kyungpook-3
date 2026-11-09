# 프로젝트 맵 그래프의 라이브러리·배치·내비 위치

- 기록일: 2026-11-09
- 관련: #551(BE #560·#602). 마일스톤 계획 밖의 이슈 작업이다. 제품 결정은 [D-186](../../../decision/frontend-decisions.md), 결과는 [#551 결과](../../../issues/551-project-map/result.md)에 있다.

## 문제와 제약

- #551 은 주제·태스크 두 종류 노드와 한 종류 선의 그래프, 확대하면 보이는 태스크 이름, 타임라인 재생, 확대·축소·전체 보기를 요청했다. 라이브러리와 배치는 FE 재량이다.
- 이슈의 크기 표에서 태스크 500개는 노드 536개·선 1,173개, 1,000개는 노드 1,069개·선 2,337개다. 이 크기에서 화면이 멈추지 않아야 한다.
- 그래프는 키보드·화면 낭독기로 쓰기 어렵다. 목록 보기가 같은 정보와 같은 패널을 줘야 한다.
- 초기 chunk 를 늘리지 않는다. 셸은 쉬는 동안 탭 화면 코드를 미리 받는다(#536).
- 앱에는 사이드바가 없다. 768px 미만 아래 탭 막대는 다섯 칸으로 정해져 있다(D-180).

## 실제 검토한 선택지

라이브러리 크기는 같은 방법으로 쟀다. 각 패키지의 진입점을 esbuild 0.24 로 `--bundle --minify --format=esm --external:react --external:react-dom` 묶은 뒤 gzip 한 값이다(2026-11-09).

| 선택지 | minify | gzip | 맞는 점 | 맞지 않는 점 |
|---|---|---|---|---|
| d3-force + 직접 그린 SVG | 14.6KB | 5.6KB | 배치만 맡긴다. 노드 두 종류·선 한 종류라 그리기가 단순하다 | 확대·끌기·라벨 규칙을 직접 짠다 |
| sigma 3 + graphology | 172.5KB | 40.5KB | WebGL 이라 수천 노드도 빠르다 | 크기가 7배. 이 크기에는 과하다 |
| @xyflow/react 12 | 171.9KB | 56.8KB | 확대·끌기 내장 | 배치 엔진이 없어 d3-force 를 또 써야 한다. 노드마다 DOM 이 무겁다 |
| cytoscape 3.30 | 379.2KB | 121.4KB | 배치·확대·전체 보기 내장 | 가장 크다. canvas 라 노드 접근성이 없다 |

배치 시간도 쟀다. d3-force 기본값(alphaDecay 로 300 tick)에 다체·연결·중심·충돌 힘을 넣고 Node v24.11 에서 한 번에 돌렸다.

| 태스크 | 선 | 시간 |
|---|---|---|
| 200 | 468 | 196ms |
| 500 | 1,173 | 558ms |
| 1,000 | 2,337 | 1,245ms |

## 선택과 이유

- **d3-force + SVG.** 필요한 것은 배치 계산뿐이다. 이름 있는 함수만 가져온다(`forceSimulation`·`forceLink`·`forceManyBody`·`forceX`·`forceY`·`forceCollide`).
- **배치는 프레임마다 10ms.** 한 번에 돌리면 500개에서 0.5초 넘게 멈춘다. `createLayout(nodes, edges).step(budgetMs)` 가 시간 한도만큼 tick 을 돌리고, `requestAnimationFrame` 마다 이어 간다. 끝날 때까지 `배치하는 중이에요` 를 보인다. d3-force v3 의 기본 난수는 고정 씨앗이라 같은 맵은 같은 모양이다. 테스트와 화면 캡처가 흔들리지 않는다.
- **그래프는 별도 chunk.** 화면 chunk 안에서 `GraphView` 를 다시 `lazy()` 로 나눴다. 셸이 프로젝트 맵 화면 코드를 미리 받아도 d3-force 는 그래프 탭을 고를 때 받는다. 목록만 보는 휴대폰은 받지 않는다.
- **확대·끌기는 직접.** 상태는 `{ x, y, k }` 하나다. 노드 좌표를 화면 좌표로 옮겨 그리고 원·글자 크기는 배율과 무관하다. 그래서 확대해도 글자가 커지지 않고 태스크 이름은 `k ≥ 1.6` 에서만 보인다. 전체 보기는 배치 범위에 맞추되 1배보다 크게 키우지 않는다.
- **재생은 상태 기계.** `{ phase: 'idle' } | { phase: 'playing'; shown }` 이다. 노드는 `appeared_at` 순서(같으면 id)로 하나씩, 간격은 `clamp(6000 / n, 30, 500)`ms 다. 선은 두 끝이 모두 보일 때만 그린다.
- **노드는 Tab 순서에 없다.** 목록 보기가 주제별 단추와 태스크 단추로 같은 패널을 연다. SVG 에는 목록 보기를 가리키는 이름을 붙였다.
- **내비 위치.** 넓은 화면은 헤더 탭(`메시지` 다음), 휴대폰은 내 계정 메뉴(`설정` 위)다. 셸 탭 표의 `compact: 'bar' | 'menu'` 하나가 아래 막대와 메뉴를 함께 정한다. 두 컴포넌트가 따로 조건을 쓰지 않는다.

## 장단점과 감수한 제약

- 확대·끌기 때마다 모든 노드와 선을 다시 그린다. `project-map-large`(노드 550·선 약 1,184, 개발 모드)에서 60번 끌기 동안 프레임 간격은 108프레임 중 중앙값 17ms, 95% 17ms, 최대 33ms였다(Playwright Chromium, 로컬 검증 스크립트). 이 크기에서는 버벅이지 않았다. 1,000개 이상은 재지 않았다.
- 큰 맵을 전체 보기로 보면 주제 이름이 겹친다. 확대하면 풀린다. 라벨 충돌 피하기는 두지 않았다.
- 노드를 키보드로 고를 수 없다. 목록 보기와 태스크 패널의 `이어진 태스크` 가 대신한다(리뷰 반영 2026-11-10).
- 배치는 주 스레드에서 나눠 돈다. Web Worker 는 jsdom 테스트에 없고 이 크기에서는 필요 없다고 봤다. 1,000개에서 배치는 약 1.2초 동안 화면에 `배치하는 중이에요` 가 보인다(나눠 도므로 화면은 응답한다).

## 영향 범위와 재검토 조건

- 빌드(`vite build`, 2026-11-09): 초기 `index` chunk 는 develop HEAD 479.01KB(gzip 148.41KB) → 483.25KB(gzip 149.58KB). 프로젝트 맵 화면 chunk 14.81KB(gzip 5.20KB), 그래프 chunk 20.49KB(gzip 8.23KB, d3-force 포함). d3-force 는 그래프 chunk 에만 있다.
- 태스크가 1,000개를 넘거나 BE 가 선을 크게 늘리면 Worker 배치나 WebGL(sigma)로 다시 본다. 이슈도 그 크기에서는 BE 가 선을 줄인다고 했다.
- 노드 종류가 늘면(`kind`) 지금은 응답 전체가 `INVALID_RESPONSE` 다(D-184 판별 값). FE 가 먼저 받게 배포해야 한다.

## 근거와 관련 문서

- 코드: `frontend/src/widgets/project-map/lib/layout.ts`, `lib/viewport.ts`, `lib/replay.ts`, `ui/GraphView.tsx`, `ui/ProjectMapView.tsx`, `frontend/src/widgets/app-shell/model/shellTabs.ts`.
- 테스트: `frontend/src/widgets/project-map/lib/layout.test.ts`(노드 536·선 1,173 나눠 돌기·결정성), `frontend/src/app/projectMap.test.tsx`, `frontend/src/app/projectMapCodeSplit.test.tsx`.
- [계약 §4.4.2](../../../contracts/frontend-api-contract.md), [D-180](../../../decision/frontend-decisions.md), [D-184](../../../decision/frontend-decisions.md).
