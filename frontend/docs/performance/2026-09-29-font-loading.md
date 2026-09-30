# 폰트가 첫 화면을 늦춘다 — NanumSquare 두 벌이 메인 JS 와 대역폭을 나눠 쓴다

- 날짜: 2026-09-29
- 상태: 대기
- 영향 범위: 앱 전체 (모든 화면의 첫 진입)

## 측정

Chrome DevTools 네트워크 `Slow 4G`, 캐시 없는 새 컨텍스트, `/onboarding/ws_03/connect_discord` 첫 진입.

| 빌드 | 요청 | 전송량 | DOMContentLoaded |
|---|---|---|---|
| 개발 서버 (`npm run dev`) | 160 | 약 45KB | 약 40초 |
| 프로덕션 (`npm run build` → `vite preview`) | 17 | 약 520KB | 약 4.0초 |

프로덕션 요청 중 큰 것:

| 파일 | 전송량 | 시작 → 끝(ms) |
|---|---|---|
| `NanumSquare-Regular.woff2` | 158KB | 647 → 4210 |
| `NanumSquare-Bold.woff2` | 159KB | 648 → 4257 |
| `index-*.js` (메인 번들, 원본 약 398KB) | 125KB | 648 → 3910 |
| 나머지 JS 조각 8개 + CSS | 합 약 80KB | 648 → 3370 |

- 개발 서버의 40초는 번들링하지 않는 Vite 개발 모드의 특성이다. 모듈마다 요청이 나가고 import 깊이만큼 왕복이 쌓인다. 사용자가 받는 빌드와 다르므로 이 문서의 대상이 아니다.
- 프로덕션 측정은 백엔드 없이 했다(`/api` 실패). 온보딩 화면 조각(`onboarding-*.js`, 약 5KB)과 API 응답 시간은 위 숫자에 들어 있지 않다.

다시 재는 방법: `npm run build` → `npx vite preview --port 4173` → DevTools에서 `Slow 4G`와 `Disable cache`를 켜고 새로고침한다. Network 탭에서 woff2 두 개와 `index-*.js`의 끝 시각을 본다.

## 원인

- `index.html`이 Regular·Bold를 `<link rel="preload">`로 미리 부른다(`docs/impl-decision/2026-09-16-font-url-and-preload.md`). 두 파일이 메인 JS와 **같은 순간(648ms)에 시작해** 대역폭을 나눠 쓴다.
- 폰트 두 벌이 약 316KB로 첫 진입 전송량의 약 60%다. 한글 전체 글리프(완성형 11,172자 이상)를 담은 파일을 그대로 쓰고 있다.
- 메인 JS가 3.9초에야 끝나 React 가 그 뒤에 그린다. 폰트가 없었다면 JS 는 대역폭을 혼자 써서 더 일찍 끝난다.
- 폰트 네 벌(`src/shared/styles/fonts/`, 각 약 160KB) 중 preload 는 두 벌이다. Light(100–300)·ExtraBold(800–900)는 그 굵기를 쓰는 글자가 화면에 나올 때만 받는다.

## 고칠 거리

1. **서브셋** — 실제로 쓰는 글자만 남긴 woff2 를 만든다.
   - KS X 1001 완성형 2,350자 + 영문·숫자·기호로 줄이는 것이 흔한 선택이다. 파일 크기가 크게 줄지만 줄어드는 비율은 이 폰트로 직접 만들어 재야 한다.
   - `unicode-range` 로 여러 조각(예: 기본 라틴 / 자주 쓰는 한글 / 나머지 한글)으로 나누면 필요한 조각만 받는다. 사용자 입력(팀 이름·팀원 이름)에는 드문 한글이 들어올 수 있으니 전체를 잘라내기보다 조각으로 나누는 편이 안전하다.
   - 도구: `pyftsubset`(fonttools) 등. 라이선스(NanumSquare, SIL OFL)는 서브셋·변환을 허용한다.
2. **preload 조정** — JS 를 먼저 받게 한다.
   - Bold preload 를 빼거나 둘 다 빼면 첫 화면 JS 가 빨리 끝난다. 대신 `font-display: swap` 이라 잠깐 폴백 폰트(Apple SD Gothic Neo · Malgun Gothic)로 그려졌다가 바뀐다(FOUT). 글자 폭이 달라 줄바꿈이 한 번 흔들릴 수 있다.
   - 서브셋으로 파일이 충분히 작아지면 preload 를 유지해도 비용이 작다. 1번을 먼저 하고 다시 재서 정한다.
3. **메인 번들** — 원본 약 398KB(전송 125KB). 폰트를 줄인 뒤 다음 병목이 된다. `vite build` 결과를 분석기(예: `rollup-plugin-visualizer`)로 열어 첫 화면에 필요 없는 모듈이 들어 있는지 본다. 이 문서의 범위 밖이며, 필요하면 별도 문서로 연다.

관련 파일: `index.html`(preload 두 줄), `src/app/styles/fonts.css`(`@font-face` 네 벌), `src/shared/styles/fonts/*.woff2`, `docs/impl-decision/2026-09-16-font-url-and-preload.md`.

## 고칠 때 확인할 것

- **U+2022(`•`) 글리프.** 원본 NanumSquare 의 U+2022 는 모양이 비어 있어 `fonts.css` 의 `unicode-range` 에서 뺐다(`docs/impl-decision/2026-09-29-nanum-bullet-glyph.md`, `src/app/styles/global.test.ts`). 서브셋을 새로 만들면 `unicode-range` 를 다시 쓰게 되는데, 이 제외가 빠지면 비밀번호 칸이 다시 빈칸으로 보인다. 서브셋에서 U+2022 를 아예 빼는 것도 방법이다.
- **굵기 매핑.** `@font-face` 의 weight 범위(100 300 / 400 500 / 600 700 / 800 900)가 "500 → Regular, 600 → Bold" 폴백을 만든다. 조각을 나눠도 범위를 그대로 둔다.
- **바꾼 결정 기록.** preload 목록을 바꾸면 `2026-09-16-font-url-and-preload.md` 의 `다시 고민할 때` 에 따라 그 문서를 고친다.
- **다시 잴 기준.** 같은 조건(프로덕션, Slow 4G, 캐시 없음)에서 DOMContentLoaded 와 woff2·`index-*.js` 의 끝 시각을 위 표와 비교한다. 폴백에서 NanumSquare 로 바뀔 때 레이아웃이 흔들리는지(CLS)도 본다.
