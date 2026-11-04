# Bold preload 를 빼면 첫 화면 LCP 가 0.5~1.0초 줄고, 폰트 분할은 이득이 없다

- 날짜: 2026-11-05
- 상태: 반영됨(→ [plan/m2/basis-for-decision/2026-09-16-font-url-and-preload.md](../plan/m2/basis-for-decision/2026-09-16-font-url-and-preload.md))
- 영향 범위: 앱 전체 (모든 화면의 첫 진입)

[2026-09-29 기록](2026-09-29-font-loading.md)의 고칠 거리 1(서브셋)과 2(preload 조정)를 같은 조건에서 비교했다. 그 문서의 숫자는 개발 당시 빌드라 여기서 인용하지 않는다.

## 측정

### 조건

- 빌드는 production(`vite build`)이다. 기준은 `c8fe3ef0`이고, 구성마다 `index.html`·`fonts.css`·폰트 파일만 바꿔 따로 빌드했다.
- 서버는 두 가지다. HTTP/1.1 은 `vite preview`(gzip), HTTP/2 는 `serve-h2.mjs`(Node `http2` + 자체 서명 TLS, gzip)다. 운영은 Caddy HTTPS 라 HTTP/2 쪽이 운영에 가깝다.
- 브라우저는 Playwright Chromium(headless), 1280×900 이다. 매 회 새 컨텍스트를 열고 CDP 로 캐시를 끄고 DevTools `Slow 4G` 값(지연 562.5ms, 내려받기 180,000B/s, 올리기 84,375B/s)을 건다. CPU 제한은 걸지 않았다.
- 화면은 `/login`(로그아웃)과 `/workspaces/ws_01/dashboard`(PM)다. API 응답은 개발 서버 MSW 시나리오 `signed-out`·`dashboard-default`에서 녹화해 지연 없이 재생했다. 실제 API 왕복 시간은 숫자에 들어 있지 않다.
- 구성 6개 × 화면 2개 × 7회를 프로토콜마다 돌렸다(모두 168회). 회차마다 구성 순서를 한 칸씩 돌려 같은 기계의 다른 작업이 만든 잡음을 구성끼리 나눠 갖게 했다.
- 지표는 FCP·LCP(`PerformanceObserver`), CLS(입력 없는 `layout-shift` 합), 폰트 적용 완료(`document.fonts`의 마지막 `loadingdone` 시각), 요청별 시작·끝·우선순위·전송 바이트(CDP `Network`)다.

### 구성

| 구성 | preload | 폰트 파일 |
|---|---|---|
| A (변경 전) | Regular, Bold | 원본 4벌 |
| B (적용) | Regular | 원본 4벌 |
| C | Regular·Bold 의 base·ks 조각 | 굵기마다 base·ks·rest 세 조각, 모두 12개 |
| C2 | Regular 의 base·ks 조각 | C 와 같음 |
| D (참고) | 없음 | 원본 4벌 |
| E (참고) | Regular, Bold | 원본과 같은 글자, CFF 서브루틴을 풀고 쓰이지 않는 글리프 783개를 뺀 4벌 |

조각은 `subset.py`가 만든다. base 는 한글 음절이 아닌 글자 175개(U+2022 제외), ks 는 KS X 1001 완성형 2,350자, rest 는 나머지 음절 8,822자다. 원본에는 한자가 없다.

| 파일 (Regular) | 바이트 |
|---|---|
| 원본 | 161,356 |
| base / ks / rest 조각 | 9,992 / 105,980 / 27,220 |
| E 재인코딩 | 137,940 |

글리프 무게가 ks 2,350자에 몰려 있다. 나머지 8,822자는 27KB 다. 첫 화면 글자는 대부분 ks 에 있어서 분할로 아낄 수 있는 몫은 굵기당 약 45KB(원본 대비 base+ks)다. C 의 CSS 는 1,613개 구간의 `unicode-range` 때문에 47,576B 에서 105,378B(gzip 10.2KB 에서 17.1KB)로 커진다.

### 결과

중앙값이고, 괄호는 7회의 최소~최대다. 단위는 ms, 전송량은 KB(1,000B)다. 168회 모두 HTTP 오류와 녹화되지 않은 API 호출이 0건이다.

HTTP/2, `/login` (LCP 요소는 소개 문단 `한 번의 클릭으로, 매니저가 정리합니다`):

| 구성 | LCP | 폰트 적용 완료 | CLS | 전송량 | 폰트 |
|---|---|---|---|---|---|
| A | 4340 (4332~4368) | 4490 | 0.0072 | 568 | 325 |
| B | **3848** (3820~3876) | 5344 | 0.0002 | 568 | 325 |
| C | 4492 (4484~4512) | 4485 | 0 | 484 | 234 |
| C2 | 3940 (3924~3968) | 5183 | 0.0002 | 484 | 234 |
| D | 3340 (3328~3368) | 5755 | 0.0072 | 568 | 325 |
| E | 4328 (4308~4376) | 4324 | 0 | 519 | 275 |

HTTP/2, 대시보드:

| 구성 | FCP | LCP | 폰트 적용 완료 | CLS |
|---|---|---|---|---|
| A | 3728 | 4700 (4684~4732) | 4728 | 0.0157 (0.0014~0.0201) |
| B | 3236 | **4136** (4096~4176) | 4962 | 0.0137 (0.0015~0.0164) |
| C | 3896 | 4728 (4696~4748) | 4724 | 0.0132 (0.0008~0.0157) |
| C2 | 3324 | 4292 (4272~4312) | 4802 | 0.0136 (0.0012~0.0161) |
| D | 2740 | 3652 (3632~3680) | 5378 | 0.0145 (0.0020~0.0170) |
| E | 3736 | 4568 (4556~4584) | 4563 | 0.0155 (0.0008~0.0157) |

HTTP/1.1(`vite preview`):

| 구성 | 로그인 LCP | 로그인 폰트 적용 | 대시보드 LCP | 대시보드 폰트 적용 |
|---|---|---|---|---|
| A | 6520 (6500~6592) | 6517 | 7300 (7224~7344) | 7296 |
| B | **5512** (5448~5544) | 7003 | **6732** (6716~6772) | 7086 |
| C | 6664 (6612~6692) | 6659 | 7356 (7308~7400) | 7361 |
| C2 | 5644 (5524~5660) | 6870 | 6952 (6876~7000) | 7009 |
| D | 4952 (4900~5000) | 7352 | 6192 (6132~6232) | 7689 |
| E | 6448 (6376~6468) | 6439 | 7164 (7100~7208) | 7163 |

B 의 Bold 는 7회 모두 받았다. 첫 그림 직후(HTTP/2 로그인 3.83초) `VeryHigh` 우선순위로 시작해 5.33초에 끝난다. A 는 Regular·Bold 를 0.6초에 `High` 로 함께 시작해 4.4초 무렵 끝낸다.

## 원인

- 첫 그림은 JS 를 다 받은 뒤에 나온다. `index-*.js`는 정적 import 조각 25개(`modulepreload`)를 모두 받아야 실행되고, 그 뒤에야 화면 조각(`login-*.js` 등)을 받는다. HTTP/1.1 A 로그인의 요청 순서를 한 회 펼쳐 보면 마지막 `modulepreload` 조각이 5.8초, DOMContentLoaded 가 5.9초, 화면 조각이 6.5초에 끝나 LCP 가 6.5초다.
- 이 구간에서 preload 한 폰트가 JS 와 같은 회선을 나눠 쓴다. A 는 0.6초에 폰트 두 벌(325KB)과 JS 를 함께 받기 시작한다. 180KB/s 에서 Bold 163KB 는 약 0.9초 분량이다. Bold 를 빼면 LCP 가 HTTP/2 에서 0.49초(로그인)와 0.56초(대시보드), HTTP/1.1 에서 1.01초와 0.57초 준다. 줄어든 시간이 Bold 를 받는 시간 안팎이라 폰트가 쓰던 대역폭이 JS 로 돌아간 것으로 본다. HTTP/1.1 로그인의 1.01초는 0.9초보다 조금 크다. 호스트당 연결 6개 중 하나를 Bold 가 3.5초 동안 잡던 몫까지 풀린 것으로 추정한다(따로 재지 않음).
- 분할(C)은 첫 화면 폰트를 325KB 에서 234KB 로 줄였지만 LCP 가 A 보다 늦다(HTTP/2 로그인 +152ms, 대시보드 +28ms). 메인 JS 가 끝나는 시각도 늦다(HTTP/2 로그인 3641ms → 3803ms). C 는 첫 화면 폰트 요청이 2개에서 4개로 늘고, 렌더를 막는 CSS 가 gzip 으로 7KB 커진다. DevTools 네트워크 제한은 동시에 받는 요청끼리 대역폭을 나눠서 폰트 요청이 늘면 JS 몫이 준다고 추정한다(검증하지 않음). 측정으로 확인한 것은 "폰트 바이트가 줄어도 LCP 는 줄지 않았다"까지다. Regular 만 preload 하는 정책끼리 비교해도(C2 대 B) 분할이 두 화면·두 프로토콜에서 92~220ms 늦다.
- E(굵기당 약 23KB 감소)는 대시보드 LCP 를 132ms 줄였다(범위가 겹치지 않음). 로그인은 범위가 겹쳐 차이가 없다.

## 고른 것

- B 를 적용했다. `index.html`의 preload 는 Regular 하나다. Bold·Light·ExtraBold 는 그 굵기를 쓰는 글자가 그려질 때 `@font-face`가 받는다.
- 대가는 굵은 글씨의 글꼴 교체다. 첫 그림 뒤 약 1.5초(HTTP/2 로그인 3.85초~5.34초) 동안 굵은 글씨는 폴백 폰트(Malgun Gothic 등)로 보이다가 NanumSquare Bold 로 바뀐다. 본문(Regular)은 처음부터 NanumSquare 다. 교체 때 CLS 는 로그인 0.0002, 대시보드는 A 와 같은 0.014 안팎이다. 모든 폰트가 적용되는 시각은 A 보다 로그인 0.85초, 대시보드 0.23초 늦다(HTTP/2).
- 분할(C, C2)은 적용하지 않았다. 같은 preload 정책끼리 비교해도 LCP 가 늦었고, 폰트 파일 12개와 CSS 증가를 감수할 이득이 없다.
- D(preload 없음)는 B 보다 LCP 가 약 0.5초 더 빠르다. 대신 본문까지 폴백으로 그렸다가 바꾸고(로그인 CLS 0.0072), 폰트 적용 완료가 가장 늦다. 이슈의 후보가 아니었고 화면 전체 글꼴이 바뀌어서 고르지 않았다. 본문 글꼴 교체를 받아들이면 Regular preload 도 빼는 것이 다음 선택지다.
- E 는 이슈 범위 밖이라 적용하지 않았다. 서브루틴을 푼 글꼴이 모든 화면에서 같게 그려지는지는 이번에 네 굵기 표본 문장으로만 봤다.

## 확인한 것

- A 와 B 의 로그인·대시보드 최종 화면 스크린샷이 HTTP/1.1·HTTP/2 모두 바이트 단위로 같다.
- `glyphs.mjs`는 네 굵기(300·400·700·800)로 `가나다 똠방각하 뷁쌰 ABC xyz 0123456789 ₩1,000 … “인용” → ≤ ① ㎡ ™`를 그린다. A 와 B 의 픽셀이 같고, 비밀번호 칸의 `•` 도 같게 보인다. `fonts.css`는 바꾸지 않아 U+2022 제외가 그대로다.
- `npm run build`가 만든 `dist/index.html`은 측정한 B 빌드와 같다.
- `src/app/styles/global.test.ts`가 preload 를 지킨다. preload 는 Regular 하나여야 하고, preload 파일은 `@font-face`가 쓰는 파일과 같아야 하며 `crossorigin`이 있어야 한다. 파일이 다르면 같은 굵기를 두 번 받는다.

## 다시 재는 방법

준비물은 Python 3 와 `fonttools`·`brotli`(`pip install fonttools brotli`), `openssl`, 설치된 `frontend/node_modules`다. 명령은 `frontend/`에서 실행한다. 도구는 [2026-11-05-font-loading-bench/](2026-11-05-font-loading-bench/)에 있고, 결과는 `node_modules/.cache/font-bench/`에 쌓인다. 아래에서 `$B`는 `docs/performance/2026-11-05-font-loading-bench`다.

1. 분할·재인코딩 폰트를 만든다: `python $B/subset.py`
2. MSW 개발 서버를 띄운다: `VITE_ENABLE_MSW=true npx vite --port 43529 --strictPort`
3. API 응답을 녹화하고 개발 서버를 끈다: `node $B/record.mjs`
4. 구성 6개를 빌드한다: `node $B/build-variants.mjs`. 이 스크립트는 `index.html`·`fonts.css`·폰트 파일을 잠시 바꿔 빌드하고 원래대로 돌려놓는다.
5. HTTP/1.1 서버를 구성마다 띄운다: `npx vite preview --outDir node_modules/.cache/font-bench/dist-<구성> --port <포트> --strictPort`. 포트는 A 43521, B 43522, C 43523, C2 43524, D 43525, E 43526 이다.
6. HTTP/2 서버를 띄운다. 먼저 `openssl req -x509 -newkey rsa:2048 -nodes -keyout node_modules/.cache/font-bench/cert/key.pem -out node_modules/.cache/font-bench/cert/cert.pem -days 7 -subj "/CN=localhost"`로 인증서를 만들고 `node $B/serve-h2.mjs`를 실행한다. 포트는 43531~43536 이다.
7. 측정한다: `node $B/measure.mjs --runs=7`, `node $B/measure.mjs --runs=7 --proto=h2`
8. 표를 만든다: `node $B/summarize.mjs results-h1.json`, `node $B/summarize.mjs results-h2.json`
9. 글자 표시를 비교한다: `node $B/glyphs.mjs`. HTTP/1.1 의 A·B 서버가 필요하다.

## 한계와 다음 병목

- 운영 Caddy 의 HTTP 버전과 압축 설정은 저장소에 없다. HTTP/2 와 gzip 은 가정이다.
- API 를 지연 없이 재생했다. 실제 대시보드는 API 왕복만큼 LCP 가 더 늦다.
- 데스크톱 CPU 로 쟀다. 느린 휴대폰에서는 JS 실행이 길어져 비율이 달라질 수 있다(재지 않음).
- 지금 첫 화면을 막는 것은 JS 다. B 의 HTTP/2 로그인에서 메인 JS 가 3.15초에 끝나고, 그 뒤 화면 조각을 받아 3.85초에 그린다. `modulepreload` 조각 25개와 화면 조각의 직렬 대기는 2026-09-29 기록의 고칠 거리 3(메인 번들)에서 다룬다.
