# M2 구현 사양 — 디자인 토큰 · 폰트 · shared/ui 1차

> **이 문서만 읽고 구현할 수 있도록 작성했다.** 결정 기록(`../decision/frontend-decisions.md`, 약 1,700줄)과
> 시안 25장(`../design/canvas/*.dc.html`)을 다시 열 필요가 없다.
> **값이 충돌하면 결정 기록과 `canvas/Foundations.dc.html`이 우선한다. 이 문서는 거기서 파생된 요약이다.**
> 관련 이슈 #36 · 브랜치 `feature/36-design-tokens-and-ui` · 커밋 타입 `feat(frontend):`

이 문서의 모든 수치는 `frontend/docs/design/canvas/*.dc.html`의 인라인 스타일을 직접 grep 해서 뽑았다.
시안에는 CSS 변수가 없다 — 저장소 전체에 `var(--…)`가 0건이고 전부 인라인 하드코딩이다.
따라서 이 작업은 기존 파일을 참조하는 게 아니라 **신규 저작**이다.

값마다 근거 파일명을 적어 두었다. 값이 의심스러우면 그 파일을 열어 확인한다.
실측 근거가 없는 값에는 **`제안`** 또는 **`확인 필요`**를 붙였다. 그대로 확정하지 말고 근거를 읽고 판단한다.

---

## 0. 목표와 완료 기준

`frontend/`에 **디자인 토큰 · 웹폰트 · 공통 컴포넌트 1차 세트**를 세운다.
**화면(페이지)은 만들지 않는다.** 토큰이 서고, 컴포넌트가 시안과 육안으로 일치하고, 검사가 통과하면 끝이다.

**끝난 상태**

| | 산출물 |
|---|---|
| 폰트 | `src/shared/styles/fonts/*.woff2` 4개 + `src/app/styles/fonts.css`의 `@font-face` 4개 + `index.html`의 preload |
| 토큰 | `src/app/styles/tokens.css` — Tailwind v4 `@theme`. 색 16 · 간격 34 · 반경 10 · 타이포 6 · 레이아웃 7 |
| 전역 | `src/app/styles/global.css` — reset + `:focus-visible` |
| 컴포넌트 | `src/shared/ui/` 아래 12종 (§7 목록) |
| 마스코트 | `src/shared/ui/mascot/Mascot.tsx` — 8 포즈, `viewBox 0 0 240 240` |

**검증 명령** (§10에 상세)

```bash
cd frontend
npm ci
npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
```

**완료 기준**: 1차 컴포넌트가 시안과 육안 일치하고, **토큰 밖 하드코딩 색·간격이 `src/` 안에 남아 있지 않다.**
(`grep -rn '#[0-9A-Fa-f]\{6\}' src/ --include=*.tsx` 의 결과가 마스코트 SVG를 빼면 0건이어야 한다.)

---

## 1. 하지 말 것 (이슈 #36 금지 목록)

문서 앞쪽에 둔다. 이걸 어기면 구현을 되돌려야 한다.

| # | 금지 | 근거 |
|---|---|---|
| 1 | **`font-weight: 500` 사용 금지** | 나눔스퀘어는 Light 300 · Regular 400 · Bold 700 · ExtraBold 800 **네 단뿐**이라 500은 조용히 400으로 떨어진다. 캔버스 25장 전체에서 `font-weight: 500`이 **0건**이다(실측: 400 → 114회, 600 → 526회, 700 → 211회). 600은 700으로 렌더되지만 문서와 시안이 쓰므로 유지한다. 토큰에서 `font-medium` 유틸 자체를 제거한다(§5-6) |
| 2 | **`#000000` 금지** | 잉크는 `#171717` 하나다. 마스코트의 몸·눈·타이머 버튼도 `#171717`이다. design-system.md §12 명시. Tailwind 기본 팔레트를 `--color-*: initial`로 비워 `black`·`red-500` 같은 유틸이 아예 생기지 않게 한다 |
| 3 | **그림자로 고도를 만들지 않는다** | design-system.md §5 "그림자로 고도를 만들지 않는다(거의 안 씀)". 깊이는 1px 헤어라인이 낸다. **그림자 토큰을 만들지 않는다** — 시안에 4곳 있지만 §3-④ 충돌 항목 참고 |
| 4 | **`ok`/`warn`/`bad`/`pri` 같은 의미색 토큰을 만들지 않는다** | design-system.md §3-3·§12 명시. 문서가 쓰는 역할 이름(ink · 보조 · 흐림 · 미세 · 면 · 선 · 구분선 · 컨트롤 · 비활성 · 입력 경계 · 강조)을 그대로 옮긴다. 유채색은 `#FF6969`·`#FF8989` 두 값뿐이고 그 밖에 유채색을 만들지 않는다 |
| 5 | **`site-runtime/*.ttf`를 쓰지 않는다** | IBM Plex / JetBrains / Space Grotesk는 폐기된 프로토타입 자산이다. 루트 `.gitignore:76`에 `frontend/docs/design/site-runtime/`이 등록돼 있고 이 워크트리에는 **디렉터리 자체가 없다.** 번들에 포함하지 않는다 |
| 6 | **`canvas/`를 수정하지 않는다** | 읽기 전용 스냅샷이다. 값이 틀려 보여도 고치지 않고 이 문서에 충돌로 기록한다 |
| 7 | **공통 컴포넌트에 기능 전용 한국어 문구를 하드코딩하지 않는다** | `승인`·`반려`·`회의 올리기` 같은 문구를 `Button`·`EmptyState` 안에 박지 않는다. `label`·`title`·`description`·`action` 등 props로 받는다(D-149). 예외: `aria-label="닫기"` 같은 **컴포넌트 자신의 구조에 속하는 접근성 문구**는 기본값을 두되 props로 덮을 수 있게 한다 |

추가로:

- **Radix는 동작·접근성만 쓰고 시각 스타일은 직접 입힌다.** MUI처럼 자체 디자인이 강한 라이브러리는 쓰지 않는다(D-113).
- **Radix는 primitive별 패키지로 개별 import 한다.** `import { Dialog } from 'radix-ui'` 금지 — `eslint.config.js:104`의 `no-restricted-imports`가 이미 막고 있다.
- **`managers-manager-refined.html`을 값의 근거로 쓰지 않는다.** 이전 세대 디자인이다(ink `#0A0A0A`, weight 500, IBM Plex). `frontend/docs/design/`에 668KB로 남아 있지만 참조 대상이 아니다.
- **849KB `_fonts.css`를 그대로 import 하지 않는다.** base64를 풀어 `.woff2` 파일로 저장한다(§4).

---

## 2. 지금 저장소 상태 (M0 직후)

`frontend/package.json` 실측:

- React 19.3 / Vite 8.3 / TypeScript 6.0 / Vitest 5.0 / ESLint 9.39. Node `>=24 <25`.
- **Tailwind 미설치. Radix 미설치.** M2에서 처음 넣는다.
- `src/` 는 FSD 골격만 있다 — `app/` `pages/` `widgets/` `features/` `entities/` `shared/{api,config,lib,mock,types,ui,test}` 전부 `.gitkeep`뿐이다.
- `src/App.tsx` 는 `return null`. `src/index.css` 는 `body { margin: 0 }` 한 줄이고 `src/main.tsx` 가 이걸 import 한다.
- `src/app/styles/` 와 `src/shared/styles/` 는 **아직 없다.** M2에서 만든다.
- `eslint.config.js` 의 `boundaries/element-types` 가 FSD 단방향 의존을 강제한다. `shared`는 `shared`만 import 할 수 있다 — 공통 컴포넌트가 `entities`·`features`를 참조하면 lint 에러다.
- `.prettierignore` 가 `docs` 전체를 제외한다 → 이 문서는 `format:check` 대상이 아니다.
- `git check-ignore frontend/src/shared/styles/fonts/*.woff2` → **무시되지 않는다.** 폰트 커밋 가능.

**M2에서 손대는 파일**

```
frontend/
  index.html                          ← preload 링크 추가
  vite.config.ts                      ← @tailwindcss/vite 플러그인 추가
  package.json                        ← tailwind · radix 추가
  src/
    main.tsx                          ← import './index.css' → './app/styles/index.css'
    index.css                         ← 삭제 (app/styles 로 이동)
    app/styles/
      index.css                       ← 진입점
      fonts.css                       ← @font-face 4개
      tokens.css                      ← @theme
      global.css                      ← reset + focus-visible
    shared/styles/fonts/*.woff2       ← 추출한 폰트 4개
    shared/ui/                        ← 컴포넌트 12종 + mascot/
```

---

## 3. 충돌 — design-system.md 와 Foundations/아트보드 실측이 어긋나는 곳

design-system.md 머리말이 **"`canvas/Foundations.dc.html`이 실측 원본이다 — 이 문서의 표와 어긋나면 그쪽이 맞다"**고 명시한다.
아래는 실제로 어긋난 자리다. **조용히 한쪽을 고르지 않고 전부 기록했다.** 각 항목의 "채택"이 M2의 구현값이다.

### ① 색 개수 — 15 vs 16

| | 주장 |
|---|---|
| design-system.md §3 | "캔버스 22개 화면에서 실제로 쓰이는 색은 15개뿐이다" |
| 이슈 #36 | "색 15종 — 텍스트 4 / 면 4 / 선 5 / 비활성 채움 1 / 강조 2" → **합이 16이다** |
| Foundations 실측 | 글자 4 + 면 5 + 선 5 + 강조 2 = **16개**, 중복 없음. "면 5단 · 선 5단 — 이 열 개로 모든 화면을 만듭니다" |

**채택: 16개 전부 토큰화한다.** 근거 — 이슈의 분류를 그대로 더해도 16이고, Foundations가 면/선을 각 5단으로 못박는다.
"15"는 `#FFFFFF`(페이지 바탕)를 색으로 세지 않았을 때의 수로 보인다. 값을 빼면 화면이 안 그려지므로 16을 쓴다.

### ② `확인 필요` 배지 — 채움 없음 vs 먹 채움

| | 주장 |
|---|---|
| design-system.md §3-4 | "**채움 없음.** 5px 점(`currentColor`) + `확인 필요` 텍스트 … 회색 배지 필로 그리면 캔버스 실물과 어긋난다" |
| 실측 | `Main.dc.html` 6곳 · `Tasks.dc.html` 4곳 · `Landing.dc.html` 2곳 전부 `background: #171717; color: #FFFFFF` **먹 채움**에 5px `currentColor`(=흰) 점 |
| Foundations 배지표 | 11종을 싣는데 **`확인 필요`가 목록에 없다** |

**채택: 먹 채움 + 흰 글자 + 5px 흰 점.** 근거 — 실측 12곳이 만장일치다.
문서가 금지한 것은 "**회색** 배지 필"인데 실물은 회색이 아니라 먹이다. 문서의 의도(회색 필 금지)와 실물이 정면충돌하지는 않는다.

### ③ `보류` 카드 면 — 눌린 면 vs 흰 면 + 점선

| | 주장 |
|---|---|
| design-system.md §3-4 | 보류 카드 = `#FAFAFA`(눌린 면) + `#E8E8E8` 테두리 |
| 실측 (`Tasks.dc.html`) | `background-color: #FFFFFF; border: 2px dashed #BDBDBD; border-radius: 16px; padding: 20px 22px` |

**채택: 흰 면 + 2px 점선 `#BDBDBD`.** 근거 — 실측. `#BDBDBD`의 Foundations 용례가 "비어 있음 · 아직 정해지지 않음"이라 보류의 의미와도 맞는다.

### ④ 그림자 — "안 쓴다" vs 4곳에 쓰임

| | 주장 |
|---|---|
| design-system.md §5 · 이슈 #36 | "그림자로 고도를 만들지 않는다" — 금지 |
| Foundations "그림자 2종" | `0px 8px 24px 0px #17171733` ×3, `0 6px 20px rgba(23, 23, 23, 0.09)` ×1 |
| 실측 위치 | 앞 값 — `Tasks.dc.html`의 `확인 필요` 카드 2장, `Upload.dc.html`의 폼 카드 1장. 뒤 값 — `Main.dc.html`의 팀 전환 드롭다운 `.team-menu` |

**채택: 그림자 토큰을 만들지 않는다.** 근거 — 이슈의 명시적 금지가 우선한다.
`Card` 컴포넌트에 `shadow` prop을 두지 않는다. 드롭다운(팝오버)은 M2 범위 밖이므로, M4에서 팝오버를 그릴 때 **팝오버 한정 예외**로 다시 논의한다. 이 문장을 그때 근거로 쓴다.

### ⑤ 세그먼트 손잡이 색 — `#F0F0F0` vs `#FFFFFF`

| | 주장 |
|---|---|
| design-system.md §3-2 | `#F0F0F0` "선택 — 선택된 행 · 활성 탭 · **세그먼트 손잡이**" |
| design-system.md §7-12 | "세그먼티드: 선택 항목만 **컨트롤 회색**(`#EDEDED`) 면" ← 같은 문서 안에서 §3-2와도 어긋난다 |
| 실측 (5곳 전부) | 트랙 `#EDEDED`(컨트롤) · 선택 손잡이 `#FFFFFF`(바탕). `Tasks` `TasksBoard` `TasksCalendar` `TasksGantt` `Upload` |

**채택: 트랙 `#EDEDED`, 손잡이 `#FFFFFF`.** 근거 — 실측 5/5 만장일치이고, 문서의 두 주장이 서로도 어긋나 문서를 기준으로 삼을 수 없다.
(`#F0F0F0`은 헤더 **탭**의 활성 면으로는 실제로 쓰인다 — `Main.dc.html` 헤더 `nav`. 문서가 탭과 세그먼트를 뭉뚱그린 것으로 보인다.)

### ⑥ 선택 카드 선택 테두리 — 먹 vs `#C9C9C9`

| | 주장 |
|---|---|
| design-system.md §7-12 | "선택 카드: 선택 시 경계가 **먹**으로 진해진다" |
| 실측 (`Settings.dc.html`) | 미선택 `#E8E8E8` → 선택 `#C9C9C9`. 캔버스 25장 전체에 `border: 1px solid #171717` **0건** |

**채택: `#C9C9C9`.** 근거 — 실측. `#C9C9C9`의 Foundations 용례가 "강조 테두리 — 지금 봐야 하는 카드 한 겹"이라 선택 상태와 맞는다.

### ⑦ 버튼 높이·라운드 — "제품 r9 · 최소 36px" vs 화면군별로 다름

| | 주장 |
|---|---|
| design-system.md §7-6 | "제품은 라운드 9, 랜딩은 알약. 높이는 제품 최소 36px, 랜딩 최대 44px" |
| 실측 | **온보딩 4화면은 r8 · 40px**(`SetupTeam` `SetupDiscord` `SetupNotion` `SetupMembers`), **인증 2화면은 알약 · 48px**(`Login` `Signup`), 랜딩 히어로는 알약 · 44px, 랜딩 헤더는 알약 · 38px |

**채택: 화면군별 값을 그대로 유지한다.** 근거 — 실측. §7-1의 버튼 표에 화면군을 함께 적었다.
"랜딩은 알약"은 틀렸다 — **인증도 알약**이다. 알약을 쓰지 않는 것은 제품 화면(대시보드·태스크·회의록·업로드·설정)과 온보딩이다.

### ⑧ 필드 라벨 — "12 / 400 / 보조 회색" vs 3종

| | 주장 |
|---|---|
| design-system.md §7-7 | "라벨: 12px / **400** / 보조 회색, 입력 **위**" |
| 실측 | 제품(`Tasks`) 12 / 400 / `#5A5A5A` · 제품(`Upload`) 12.5 / 400 / `#5A5A5A` · 온보딩(`SetupTeam`) 12 / 400 / `#666666` · 인증(`Login`·`Signup`) **13** / 400 / `#666666` |

**채택: 화면군별 3종.** 근거 — 실측. "입력 위 · 400"은 4/4 화면군 전부 맞다. 크기·색만 갈린다.

### ⑨ 빈 상태 — "아이콘 32px · 주 액션 1개" vs 마스코트 96px · 액션 2개

| | 주장 |
|---|---|
| design-system.md §7-15 | "아이콘 32px → 제목 → 설명 2줄 이내 → **주 액션 1개**" |
| 실측 (3장 전부 동일) | 마스코트 SVG **96px** → h1 24/700 → p 14/400 → **주 버튼 + 텍스트 링크 2개**. `EmptyTasks` `EmptyMeetings` `EmptyMessages` |

**채택: 실측.** 근거 — 3/3 만장일치. "아이콘 32px"은 §6의 "빈 상태: 아이콘 32px + 미세 회색"과 짝인데, 실물은 아이콘이 아니라 마스코트다.

### ⑩ 입력 폰트 크기 — Foundations 샘플 vs 아트보드 실물

| | 값 |
|---|---|
| Foundations 컨트롤 절 "입력 · 제품" 샘플 | `padding: 0 13px; font-size: 13.5px` |
| `Tasks.dc.html` 실물 | `padding: 0 12px; font-size: 13px` |
| `Upload.dc.html` 실물 | `padding: 0 13px; font-size: 13.5px` |

**채택: 제품 입력 = padding `0 13px` · 13.5px.** 근거 — Foundations 샘플과 `Upload` 실물이 일치하고, `Tasks`는 좁은 3열 그리드 안이라 줄인 일회성 값으로 본다.
**확인 필요**: `Tasks` 카드 안 필드를 그릴 M4 시점에 12px/13px로 좁힐지 재확인한다.

### ⑪ 문서 누락 (충돌은 아님)

- Foundations 타이포 표에는 **`버튼 · 라벨 · 배지 13 / 600` 행이 없다.** 본문/메타/랜딩 리드/랜딩 본문/캡션 5행만 싣는다.
  그런데 같은 파일 "컨트롤" 절의 버튼 마크업이 전부 `font-size: 13px; font-weight: 600`이고, 아트보드에서도 600이 526회로 압도적이다.
  → design-system.md §4-1과 이슈의 "13 / 600 · 161회"를 **그대로 채택**한다. 값이 어긋나는 게 아니라 표에서 빠진 것뿐이다.

---

## 4. 폰트

### 4-1. 원본 확인 결과 (실측)

`frontend/docs/design/canvas/_fonts.css` — 869,032 바이트, `@font-face` **4개**, 전부 `data:font/woff2;base64` 인라인.

```
/* NanumSquare (c) NAVER Corp. — subset embedded for this design canvas export. */
@font-face{font-family:'NanumSquare';font-style:normal;font-weight:100 300;font-display:swap;src:url(data:font/woff2;base64,…) format('woff2')}
@font-face{font-family:'NanumSquare';font-style:normal;font-weight:400 500;font-display:swap;src:url(data:font/woff2;base64,…) format('woff2')}
@font-face{font-family:'NanumSquare';font-style:normal;font-weight:600 700;font-display:swap;src:url(data:font/woff2;base64,…) format('woff2')}
@font-face{font-family:'NanumSquare';font-style:normal;font-weight:800 900;font-display:swap;src:url(data:font/woff2;base64,…) format('woff2')}
```

base64를 풀어서 확인한 결과:

| weight 범위 | 파일명(제안) | 크기 | sfnt flavor | 테이블 |
|---|---|---|---|---|
| `100 300` | `NanumSquare-Light.woff2` | 161,888 B | `OTTO` | BASE CFF GPOS GSUB OS/2 VORG cmap head hhea hmtx maxp name post vhea vmtx |
| `400 500` | `NanumSquare-Regular.woff2` | 161,356 B | `OTTO` | 〃 |
| `600 700` | `NanumSquare-Bold.woff2` | 162,996 B | `OTTO` | 〃 |
| `800 900` | `NanumSquare-ExtraBold.woff2` | 165,040 B | `OTTO` | 〃 |

합계 651,280 B (약 636 KiB).

**중요 — `fvar` 테이블이 없다. 가변 폰트가 아니라 정적 CFF/OTF 4벌이다.**
`font-weight: 400 500`은 "가변 축"이 아니라 **정적 폰트 하나를 두 weight에 걸어 둔 범위 선언**이다.
이것이 design-system.md의 "500은 400으로, 600은 700으로 떨어진다"의 실제 메커니즘이다 —
`500`을 요청하면 `400 500` 범위의 Regular 파일이, `600`을 요청하면 `600 700` 범위의 Bold 파일이 그려진다.
**따라서 `@font-face`를 다시 쓸 때 이 범위를 그대로 유지해야 한다.** `font-weight: 400` 단일 값으로 바꾸면 600 요청이 합성 볼드로 떨어진다.

**글리프 커버리지** (cmap format 4를 풀어서 셈, 4개 파일 동일):

| 범위 | 커버 |
|---|---|
| 한글 음절 `AC00–D7A3` | **11,172 / 11,172 — 전부** |
| ASCII `0020–007E` | 95 / 95 — 전부 |
| Latin-1 보충 `00A0–00FF` | 39 |
| 총 코드포인트 | 11,348 |
| 호환 자모 `3130–318F` (ㄱ ㅋ ㅎ …) | **0 / 96 — 없음** |
| CJK 한자 `4E00–9FFF` | **0 — 없음** |
| 전각 괄호·문장부호 `3000–303F` (「」《》〈〉) | **0 / 64 — 없음** |
| 전각 영숫자 `FF00–FF5E` | **0 / 95 — 없음** |

개별 확인: `·` `—` `–` `…` `“` `”` `‘` `’` `₩` `°` `±` `×` `÷` `•` `→` `←` `↑` `↓` `※` `©` **있음** /
`✓` `△` `○` `●` `■` `□` `★` `☆` `㈜` `℃` `€` `®` `「」` `《》` `〈〉` **없음**.

**실무 영향**

- 제품이 쓰는 한국어 본문은 전부 커버된다. 디자인 카피의 문장부호(`·` `—` `…` `“ ”`)도 전부 있다.
- **단독 자모(`ㅋㅋㅋ`, `ㅠㅠ`)와 한자는 폴백 서체로 그려진다.** 디스코드 메시지 미리보기·전사문 인용에 들어올 수 있으므로 폴백 스택이 실제로 동작해야 한다(§4-4).
- **`✓` 같은 기호를 문자로 쓰지 않는다.** 체크·화살표는 SVG 아이콘으로 그린다 — design-system.md §6의 아이콘 정책과도 일치한다.

### 4-2. 추출 절차 (실행 가능)

`frontend/` 에서 실행한다. **아래 스크립트는 실제로 돌려서 위 표의 크기·해시를 확인한 것이다.**

```bash
cd frontend
mkdir -p src/shared/styles/fonts
```

임시 스크립트를 만든다 (레포에 커밋하지 않는다 — 한 번만 쓰고 지운다):

```bash
cat > /tmp/extract-fonts.mjs <<'EOF'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const css = readFileSync('docs/design/canvas/_fonts.css', 'utf8')
const out = 'src/shared/styles/fonts'
mkdirSync(out, { recursive: true })

const names = {
  '100 300': 'NanumSquare-Light',
  '400 500': 'NanumSquare-Regular',
  '600 700': 'NanumSquare-Bold',
  '800 900': 'NanumSquare-ExtraBold',
}
const re = /font-weight:(\d+ \d+);[^}]*?base64,([A-Za-z0-9+/=]+)\)/g

let m, n = 0
while ((m = re.exec(css))) {
  const name = names[m[1]]
  if (!name) throw new Error(`알 수 없는 weight 범위: ${m[1]}`)
  const buf = Buffer.from(m[2], 'base64')
  if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${name}: woff2 매직 불일치`)
  writeFileSync(`${out}/${name}.woff2`, buf)
  console.log(`${name}.woff2  weight ${m[1]}  ${buf.length} bytes`)
  n++
}
if (n !== 4) throw new Error(`@font-face 4개를 기대했는데 ${n}개를 찾았다`)
EOF

node /tmp/extract-fonts.mjs
rm /tmp/extract-fonts.mjs
```

**기대 출력** — 이 네 줄이 그대로 나와야 한다:

```
NanumSquare-Light.woff2  weight 100 300  161888 bytes
NanumSquare-Regular.woff2  weight 400 500  161356 bytes
NanumSquare-Bold.woff2  weight 600 700  162996 bytes
NanumSquare-ExtraBold.woff2  weight 800 900  165040 bytes
```

크기가 다르면 `_fonts.css`가 바뀐 것이다. 멈추고 확인한다.

**주의**

- 정규식은 `font-weight:` 뒤의 범위를 파일명에 매핑한다. 순서에 의존하지 않는다.
- `.woff2`가 `.gitignore`에 걸리지 않는 것은 확인했다(`git check-ignore` 종료코드 1).
- `docs/design/canvas/_fonts.css`를 **읽기만** 한다. 지우거나 옮기지 않는다.

### 4-3. `@font-face` — `src/app/styles/fonts.css`

**weight 범위 4개를 원본 그대로 유지한다.** 이유는 §4-1.

```css
/* NanumSquare (c) NAVER Corp.
   frontend/docs/design/canvas/_fonts.css 의 base64 를 추출한 것이다.
   weight 범위(100 300 / 400 500 / 600 700 / 800 900)는 원본 그대로 유지한다 —
   정적 폰트 4벌이므로 이 범위가 "500 → Regular, 600 → Bold" 폴백을 만든다. */

@font-face {
  font-family: 'NanumSquare';
  font-style: normal;
  font-weight: 100 300;
  font-display: swap;
  src: url('@/shared/styles/fonts/NanumSquare-Light.woff2') format('woff2');
}

@font-face {
  font-family: 'NanumSquare';
  font-style: normal;
  font-weight: 400 500;
  font-display: swap;
  src: url('@/shared/styles/fonts/NanumSquare-Regular.woff2') format('woff2');
}

@font-face {
  font-family: 'NanumSquare';
  font-style: normal;
  font-weight: 600 700;
  font-display: swap;
  src: url('@/shared/styles/fonts/NanumSquare-Bold.woff2') format('woff2');
}

@font-face {
  font-family: 'NanumSquare';
  font-style: normal;
  font-weight: 800 900;
  font-display: swap;
  src: url('@/shared/styles/fonts/NanumSquare-ExtraBold.woff2') format('woff2');
}
```

> `@` 별칭은 `vite.config.ts`의 `resolve.alias`에 이미 있다(`{'@': resolve(import.meta.dirname, 'src')}`).
> Vite의 CSS `url()` 해석이 별칭을 못 받으면 상대 경로 `../../shared/styles/fonts/…`로 바꾼다.
> **확인 필요**: `npm run build` 후 `dist/assets/`에 `.woff2` 4개가 해시 파일명으로 나왔는지 본다.

**`font-display: swap`을 반드시 건다.** 유일한 서체라 `block`이면 폰트가 올 때까지 텍스트가 안 그려진다.
원본 `_fonts.css`도 4개 전부 `swap`이다.

### 4-4. 폰트 스택

캔버스 25장의 `body { font-family }`가 전부 이 한 줄이다(실측 25/25):

```
'NanumSquare','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif
```

토큰으로는 §5-6에 `--font-sans`로 선언한다.

**숫자에는 별도 모노 서체를 쓰지 않는다.** 캔버스의 `.mono` 클래스 정의가 25/25 동일하다:

```css
.mono {
  font-family: 'NanumSquare','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
```

같은 서체에 `tabular-nums`만 건 것이다. §6-3에서 유틸 클래스로 옮긴다.

### 4-5. preload

`frontend/index.html` `<head>`에 추가한다.

```html
<link
  rel="preload"
  as="font"
  type="font/woff2"
  crossorigin
  href="/src/shared/styles/fonts/NanumSquare-Regular.woff2"
/>
<link
  rel="preload"
  as="font"
  type="font/woff2"
  crossorigin
  href="/src/shared/styles/fonts/NanumSquare-Bold.woff2"
/>
```

**Regular(400 500)와 Bold(600 700) 두 개만 선로드한다.** 근거 — 아트보드 22장에서 실제로 쓰인 weight는
**400(71회) · 600(485회) · 700(91회)** 셋뿐이다. 300과 800은 **0회**다.
Light·ExtraBold는 `@font-face`로 선언만 해 두고(이슈가 4개를 요구한다) 선로드하지 않는다 — 넣으면 327KB를 헛되이 당긴다.

- `crossorigin`은 **반드시** 붙인다. 폰트 요청은 항상 CORS 모드라 없으면 preload가 버려지고 두 번 받는다.
- `as="font"` + `type="font/woff2"`도 붙인다.

**확인 필요** — Vite가 `index.html`의 `link[href]`를 빌드 산출물 경로로 다시 써 주는지 확인한다:

```bash
npm run build
grep -o 'rel="preload"[^>]*' dist/index.html
```

`href`가 `/assets/NanumSquare-Regular-<hash>.woff2`로 바뀌어 있으면 정상이다.
`/src/...` 그대로면 **폴백**으로 전환한다 — 폰트를 `frontend/public/fonts/`로 옮기고 `href="/fonts/NanumSquare-Regular.woff2"`를 쓴다.
(이때 파일명에 버전 접미사를 붙여 캐시를 깬다. 예: `NanumSquare-Regular-v1.woff2`)
폴백을 쓰면 `@font-face`의 `src`도 같은 경로로 맞춘다.

---

## 5. 토큰

### 5-0. Tailwind 설치와 설정 방식 — **v4 `@theme`으로 간다**

**결정: Tailwind CSS v4 + `@tailwindcss/vite` 플러그인 + `@theme` 블록.**

이유:

- M0이 Vite 8.3이다. v4의 Vite 플러그인은 PostCSS 단계를 건너뛰어 `postcss.config.js`가 필요 없다 — 설정 파일이 하나 줄어든다.
- v4의 `@theme` 변수는 그대로 `:root`의 CSS 변수로 나온다. **이슈가 요구하는 "CSS 변수로 토큰 선언 + Tailwind에서 참조"가 한 번에 끝난다.** v3는 `tailwind.config.ts`에 `var(--…)`를 다시 적어야 해서 같은 값을 두 곳에 쓴다.
- v4는 네임스페이스 단위 초기화(`--color-*: initial`)를 지원한다. **"4px 배수 스케일이 아니다"와 "`#000000` 금지"를 기본 스케일 제거로 강제**할 수 있다. v3에서는 `theme` vs `theme.extend`를 헷갈리기 쉽다.

**설치**

```bash
cd frontend
npm i -D tailwindcss@^4 @tailwindcss/vite@^4
```

**`vite.config.ts`** — `plugins` 배열에 추가한다. 나머지는 M0 그대로 둔다.

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // resolve / server / test 는 M0 그대로
})
```

**`src/app/styles/index.css`** — 진입점. 순서가 중요하다.

```css
@import 'tailwindcss';

@import './fonts.css';
@import './tokens.css';
@import './global.css';
```

**`src/main.tsx`** — import 경로를 바꾸고 `src/index.css`를 지운다.

```ts
import './app/styles/index.css'
```

> **확인 필요** — v4의 API 표면은 마이너 버전에서 조정된 적이 있다. 설치 후 `npx tailwindcss --help`와 설치된 버전의 문서로
> ① `@theme` 안의 `--namespace-*: initial` 초기화, ② `--spacing: initial`로 동적 간격 스케일 끄기, ③ `--text-<name>--line-height` 같은 하위 키가
> 그대로 동작하는지 확인한다. 동작이 다르면 **값은 그대로 두고 문법만** 설치된 버전에 맞춘다.
> M0 문서도 같은 원칙을 쓴다("설치 후 실제 버전 기준으로 동작하는지 확인하고, 다르면 해당 플러그인 문서에 맞춰 조정한다").

### 5-1. 색 — 16종 전부

역할 이름은 design-system.md와 Foundations가 쓰는 이름을 그대로 로마자로 옮긴 것이다.
**`ok`/`warn`/`bad`/`pri` 같은 의미색 이름을 새로 만들지 않았다.**

| 분류 | 문서의 역할 이름 | 토큰 | hex | 용도 (Foundations 실측) | 등장 |
|---|---|---|---|---|---|
| 글자 | 먹 | `ink` | `#171717` | 제목 · 본문 · 강조 · 주 버튼 채움 | 글자로 500회 |
| 글자 | 보조 | `sub` | `#5A5A5A` | 설명문 · 카드 부제 | 글자로 301회 |
| 글자 | 흐림 | `dim` | `#666666` | 메타 · 캡션 · 시각 · 날짜 | 글자로 347회 |
| 글자 | 미세 | `faint` | `#999999` | 플레이스홀더 · 비활성 버튼 글자 · 스텝 표시 | 글자로 9회 |
| 면 | 바탕 · 카드 | `surface` | `#FFFFFF` | 페이지와 카드가 앉는 면 | 면으로 210회 |
| 면 | 눌린 면 | `surface-sunken` | `#FAFAFA` | 인용 블록 · 패널 · 완료 카드 | 면으로 43회 |
| 면 | 선택 | `surface-selected` | `#F0F0F0` | 선택된 행 · 활성 탭 · 말풍선 | 면으로 52회 |
| 면 | 컨트롤 | `control` | `#EDEDED` | 보조 버튼 · 칩 · 보류 배지 · 세그먼트 트랙 | 면으로 49회 |
| 면 | 비활성 표식 | `inactive` | `#DCDCDC` | 온보딩 스텝 점 · 토글 트랙 (**면이지 테두리가 아니다**) | 면으로 13회 |
| 선 | 입력 경계 | `input-border` | `#949494` | 입력칸 테두리 — 선 중 가장 진하다 | 선으로 13회 |
| 선 | 선 | `line` | `#E8E8E8` | 카드 테두리 · 표 경계 · 리스트 구분 | 선으로 168회 |
| 선 | 구분선 | `divider` | `#EFEFEF` | 헤더 아래 · 행과 행 사이 | 선으로 38회 |
| 선 | 강조 테두리 | `line-strong` | `#C9C9C9` | 지금 봐야 하는 카드 한 겹 · 인증/온보딩 입력 경계 | 선으로 28회 |
| 선 | 점선 | `dashed` | `#BDBDBD` | 비어 있음 · 아직 정해지지 않음 | 선으로 21회 |
| 강조 | 강조 · 경고 | `accent` | `#FF6969` | 위험 배지 · 승인을 막는 입력의 라벨·경계 | 면·선·글자 22회 |
| 강조 | 연한 짝 | `accent-soft` | `#FF8989` | 위 입력의 플레이스홀더에만 | 글자 2회 |

**`accent`라는 이름에 대해** — 금지된 것은 `ok`/`warn`/`bad`/`pri`처럼 **상태 의미를 발명하는** 이름이다.
`accent`는 문서가 쓰는 역할 이름 "**강조** · 경고"의 직역이고, 값이 `#FF6969` 하나뿐이라 새 의미 축을 만들지 않는다.
`--color-danger`·`--color-error`로 부르면 안 된다.

**선 색 3개가 글자에도 쓰인다** (Foundations 명시, 실제로는 7단):

| 값 | 글자로 쓰이는 자리 | 횟수 |
|---|---|---|
| `#E8E8E8` | 비활성 탭 글자 | ×6 |
| `#BDBDBD` | 캘린더의 다른 달 날짜 | ×6 |
| `#C9C9C9` | 온보딩 `이전` 비활성 | ×3 |

새 토큰을 만들지 않고 `text-line` / `text-dashed` / `text-line-strong`으로 쓴다.
**`#949494`보다 연한 색으로 본문 글자를 쓰지 않는다.**

**대비 기준** (design-system.md §3-5, 그대로 유지)

| 대상 | 최소 대비 |
|---|---|
| 본문 · 라벨 (14px 이하) | 4.5:1 |
| 큰 텍스트 (19px 이상 / 15px bold) | 3:1 |
| 경계선 · 아이콘 등 비텍스트 | 3:1 |

`#666666` on `#FFFFFF`가 이 선의 하한이다.

### 5-2. 간격 — 4px 배수 스케일이 아니다

**실측**: 아트보드 22장의 `gap` 1,091건 중 **4의 배수는 470건(43.1%)뿐이다.** 절반 이상이 4의 배수가 아니다.
`gap`·`padding`을 합쳐 **3회 이상** 쓰인 값 34종:

```
 1(28)   2(30)   3(51)   4(64)   5(104)  6(77)   7(103)  8(155)  9(128)  10(98)
11(35)  12(210) 13(81)  14(89)  15(18)  16(85)  18(80)  20(48)  22(17)  24(64)
26(9)   28(25)  30(24)  32(6)   34(6)   36(6)   40(21)  44(7)   48(32)  56(7)
64(5)   72(10)  96(3)  128(5)
```

**결정: Tailwind의 동적 간격 스케일(`--spacing` × n)을 끄고, 위 34종을 px 이름 그대로 토큰화한다.**
그러면 `gap-7` = 7px, `p-13` = 13px 이 되어 **아트보드의 인라인 값을 1:1로 옮겨 적을 수 있다.**
`gap-7`이 28px가 되는 기본 스케일을 남겨 두면 옮겨 적을 때마다 나눗셈을 해야 하고 반드시 틀린다.

7 · 9 · 13 · 14 · 18 처럼 4의 배수가 아닌 값이 상위권에 몰려 있는 것이 이 디자인의 성격이다.
**새 화면을 그릴 때 인접 화면의 값을 그대로 재사용하고, 임의로 4px 배수에 맞추지 않는다.**

### 5-3. 반경 — 10종과 쓰이는 곳

Foundations "라운드" 표 실측:

| 토큰 | 값 | 쓰는 곳 | 횟수 |
|---|---|---|---|
| `rounded-999` | `999px` | 알약 — 아바타 · 카운트 배지 · 토글 · 스텝 점 · 인증/랜딩 버튼 | ×196 (`999`·`9999` 혼용) |
| `rounded-9` | `9px` | **컨트롤 · 버튼 · 제품 입력 · 헤더 탭** — 가장 많다 | ×181 |
| `rounded-6` | `6px` | 배지 · 칩 · 체크박스 | ×59 |
| `rounded-16` | `16px` | 카드 · 패널 | ×43 |
| `rounded-7` | `7px` | 간트 막대 · 소형 칩 · 로고 마크(24px) | ×40 |
| `rounded-10` | `10px` | 말풍선 · 온보딩 카드 | ×38 |
| `rounded-12` | `12px` | 칸반 카드 · 인증 입력 · 근거 블록 | ×22 |
| `rounded-8` | `8px` | 온보딩 입력 · 온보딩 버튼 · 팀 아바타(28px) | ×15 |
| `rounded-11` | `11px` | 세그먼트 트랙 | ×5 |
| `rounded-4` | `4px` | 간트 눈금 · 미세 표식 | ×9 |

**`999`와 `9999`가 섞여 있다** — 토큰은 `999px` 하나로 통일한다. 렌더 결과가 같다.

**목록 밖 6종은 토큰화하지 않는다**: `24` `0` `15` `2` `14` `28` — 합쳐서 ×25회, 전부 일회성이다.
필요하면 해당 컴포넌트에서 임의 값(`rounded-[28px]`)으로 쓰고 주석에 근거 화면을 적는다.
실제 자리: `28` = 인증 사이드 카드(`Login`·`Signup`), `24` = 랜딩 목업 프레임(`Landing`), `14` = 팀 전환 드롭다운(`Main`).

### 5-4. 타이포

**본문 스케일** (Foundations 타이포 표 + design-system.md §4-1)

| 이름 | 토큰 | 크기 / 굵기 | 용도 |
|---|---|---|---|
| 본문 | `text-body` | 13.5 / 400 | 제품 화면 기본 |
| 메타 | `text-meta` | 11.5 / 400 | 시각 · 날짜 · 카운트 — `tabular-nums` |
| 버튼 · 라벨 · 배지 | `text-control` | 13 / 600 | 캔버스에서 가장 많이 쓰이는 조합 (161회) |
| 캡션 | `text-caption` | 12.5 / 400 | 카드 밑단 · 보조 설명 |
| 랜딩 리드 | `text-lead` | 18 / 400 | 히어로 아래 한 줄 |
| 랜딩 본문 | `text-landing` | 16 / 400 | 섹션 설명 |

**제목** (Foundations 실측, 화면군별로 다르다)

| | h1 | h2 | h3 | 그 밖 |
|---|---|---|---|---|
| 제품 15장 | **28 / 700** (최다 ×5) | **19 / 700** (최다 ×5) | **14 / 600** (최다 ×2) | h1 32·30·24·22·17 / 700, h2 28·26·17 / 700 · 15·14·13.5 / 600 |
| 랜딩 1장 | **60 / 700** | **36 / 600** (최다 ×8) | **24 / 600** (최다 ×4) | h1 17 / 700, h2 26 / 700, h3 16 · 14 / 600 |

제목은 화면마다 크기가 달라 **토큰으로 고정하지 않는다.** §6-2의 전역 `h1`/`h2`/`h3` 규칙(굵기·행간·자간)만 걸고,
크기는 각 화면이 M4에서 지정한다. M2에서 필요한 것은 `EmptyState`의 h1(24 / 700 / lh 1.35 / ls -0.035em)과
`Modal`의 h3(17 / 700 / ls -0.02em)뿐이고, 둘 다 컴포넌트 안에 고정한다.

**굵기** — 실측 400 · 600 · 700 셋뿐이다(각 114 / 526 / 211회). **500과 300·800은 0회.**

| 토큰 | 값 | 비고 |
|---|---|---|
| `font-normal` | 400 | 본문 · 메타 · 캡션 · 라벨 |
| `font-semibold` | 600 | 버튼 · 탭 · 배지 · 소제목 — **Bold(700)로 렌더된다** |
| `font-bold` | 700 | h1 · h2 |

**`font-medium`(500) 유틸을 없앤다.** §5-6의 `--font-weight-*: initial` 초기화로 처리한다.

**한글 규칙** (design-system.md §4-2)

- 자간을 조이지 않는다. 본문 트래킹 **0**. 음수 자간은 제목만.
- 줄바꿈은 `word-break: keep-all`.
- 본문 한 줄 길이는 약 640px 안쪽.
- 캡션 행간은 본문보다 더 넉넉하게.

### 5-5. 레이아웃

Foundations "치수" 표 실측:

| 이름 | 토큰 | 값 | 쓰는 곳 |
|---|---|---|---|
| 앱 헤더 높이 | `h-header` → `--spacing-header: 76px` | **76px**, `padding: 0 40px`, 하단 `1px solid #EFEFEF` | 제품 15장 공통 |
| 앱 셸 본문 최대 폭 | `max-w-shell` | **1360px** | `main` 에 `max-width` + `margin-inline: auto` |
| 안쪽 컬럼 | `max-w-column` | **1000px** | `Tasks` `Settings` 등 한 컬럼 화면 |
| 좌측 목록 aside | `w-aside` | **308px** | `Meetings` · `Messages` · `MessagesThread` |
| 좁은 aside | `w-aside-narrow` | **252px** | `TasksGantt` — 간트만 다르다 |
| 랜딩 텍스트 | `max-w-landing-text` | **1024px** | 랜딩 텍스트 섹션 |
| 랜딩 카드 | `max-w-landing-card` | **1200px** | 랜딩 목업·카드 |

`main` 실측 (`Main` `Tasks` `Upload` `Settings` `EmptyTasks` 동일): `padding: 48px 48px 72px`.

### 5-6. 토큰 CSS — 복붙 가능한 완성본

**`src/app/styles/tokens.css`**

```css
/* ============================================================
   Manager's Manager — 디자인 토큰
   근거: frontend/docs/design/canvas/Foundations.dc.html (실측 원본)
        frontend/docs/design/design-system.md
        frontend/docs/plan/m2-design-tokens.md (이 값들의 유래)
   금지: #000000 / font-weight 500 / 그림자 / ok·warn·bad·pri 의미색
   ============================================================ */

@theme {
  /* ---------- 기본 스케일 제거 ----------
     Tailwind 기본 팔레트·간격·반경·폰트를 전부 비우고
     아래에 선언한 것만 유틸로 만든다.
     - --color-*   : #000000 과 유채 팔레트가 아예 생기지 않게 한다
     - --spacing   : gap-7 이 28px 가 되는 4px 배수 스케일을 끈다
     - --font-weight-* : font-medium(500) 유틸을 없앤다 */
  --color-*: initial;
  --spacing: initial;
  --spacing-*: initial;
  --radius-*: initial;
  --font-*: initial;
  --font-weight-*: initial;
  --text-*: initial;
  --container-*: initial;
  --shadow-*: initial;
  --drop-shadow-*: initial;
  --blur-*: initial;
  --animate-*: initial;

  /* ---------- 색 · 글자 (4단) ---------- */
  --color-ink: #171717; /* 먹 — 제목·본문·강조·주 버튼 채움 */
  --color-sub: #5a5a5a; /* 보조 — 설명문·카드 부제 */
  --color-dim: #666666; /* 흐림 — 메타·캡션·시각·날짜 */
  --color-faint: #999999; /* 미세 — 플레이스홀더·비활성 버튼 글자 */

  /* ---------- 색 · 면 (5단) ---------- */
  --color-surface: #ffffff; /* 바탕·카드 */
  --color-surface-sunken: #fafafa; /* 눌린 면 — 근거 블록·패널·완료 카드 */
  --color-surface-selected: #f0f0f0; /* 선택 — 선택된 행·활성 탭·말풍선 */
  --color-control: #ededed; /* 컨트롤 — 보조 버튼·칩·보류 배지·세그먼트 트랙 */
  --color-inactive: #dcdcdc; /* 비활성 표식 — 스텝 점·토글 트랙 (면이지 테두리가 아니다) */

  /* ---------- 색 · 선 (5단) ---------- */
  --color-input-border: #949494; /* 입력 경계 — 선 중 가장 진하다 */
  --color-line: #e8e8e8; /* 선 — 카드 테두리·표 경계·리스트 구분 */
  --color-divider: #efefef; /* 구분선 — 헤더 아래·행과 행 사이 */
  --color-line-strong: #c9c9c9; /* 강조 테두리 — 지금 봐야 하는 카드 한 겹 */
  --color-dashed: #bdbdbd; /* 점선 — 비어 있음·아직 정해지지 않음 */

  /* ---------- 색 · 강조 (유일한 유채색 2개) ---------- */
  --color-accent: #ff6969; /* 강조·경고 — 위험 배지, 승인을 막는 입력의 라벨·경계 */
  --color-accent-soft: #ff8989; /* 연한 짝 — 위 입력의 플레이스홀더에만 */

  /* ---------- 간격 ----------
     4px 배수 스케일이 아니다. 아트보드 22장에서 3회 이상 쓰인 34종.
     이름 = px 값이므로 시안의 인라인 값을 그대로 옮겨 적는다 (gap-7 = 7px). */
  --spacing-1: 1px;
  --spacing-2: 2px;
  --spacing-3: 3px;
  --spacing-4: 4px;
  --spacing-5: 5px;
  --spacing-6: 6px;
  --spacing-7: 7px;
  --spacing-8: 8px;
  --spacing-9: 9px;
  --spacing-10: 10px;
  --spacing-11: 11px;
  --spacing-12: 12px;
  --spacing-13: 13px;
  --spacing-14: 14px;
  --spacing-15: 15px;
  --spacing-16: 16px;
  --spacing-18: 18px;
  --spacing-20: 20px;
  --spacing-22: 22px;
  --spacing-24: 24px;
  --spacing-26: 26px;
  --spacing-28: 28px;
  --spacing-30: 30px;
  --spacing-32: 32px;
  --spacing-34: 34px;
  --spacing-36: 36px;
  --spacing-40: 40px;
  --spacing-44: 44px;
  --spacing-48: 48px;
  --spacing-56: 56px;
  --spacing-64: 64px;
  --spacing-72: 72px;
  --spacing-96: 96px;
  --spacing-128: 128px;

  /* 레이아웃 고정 치수 */
  --spacing-header: 76px; /* 앱 헤더 높이 — 제품 15장 공통 */
  --spacing-aside: 308px; /* 좌측 목록 aside */
  --spacing-aside-narrow: 252px; /* TasksGantt 전용 */

  /* ---------- 반경 (10종) ---------- */
  --radius-4: 4px; /* 간트 눈금·미세 표식 */
  --radius-6: 6px; /* 배지·칩·체크박스 */
  --radius-7: 7px; /* 간트 막대·소형 칩·로고 마크 */
  --radius-8: 8px; /* 온보딩 입력·온보딩 버튼 */
  --radius-9: 9px; /* 컨트롤·버튼·제품 입력·헤더 탭 — 최다 */
  --radius-10: 10px; /* 말풍선·온보딩 카드 */
  --radius-11: 11px; /* 세그먼트 트랙 */
  --radius-12: 12px; /* 칸반 카드·인증 입력·근거 블록 */
  --radius-16: 16px; /* 카드·패널 */
  --radius-999: 999px; /* 알약 — 시안의 999/9999 를 하나로 통일 */

  /* ---------- 서체 ---------- */
  --font-sans:
    'NanumSquare', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif;

  /* 실측 400·600·700 셋뿐. 500 은 캔버스에 0건이고 400 으로 폴백되므로 만들지 않는다. */
  --font-weight-normal: 400;
  --font-weight-semibold: 600; /* 나눔스퀘어에서 Bold(700) 로 렌더된다 */
  --font-weight-bold: 700;

  /* ---------- 타이포 스케일 ---------- */
  --text-meta: 11.5px; /* 시각·날짜·카운트 */
  --text-meta--line-height: 1.6;
  --text-caption: 12.5px; /* 카드 밑단·보조 설명 */
  --text-caption--line-height: 1.7;
  --text-control: 13px; /* 버튼·라벨·배지 — 항상 600 과 함께 쓴다 */
  --text-control--line-height: 1;
  --text-body: 13.5px; /* 제품 화면 본문 */
  --text-body--line-height: 1.7;
  --text-landing: 16px; /* 랜딩 섹션 설명 */
  --text-landing--line-height: 1.8;
  --text-lead: 18px; /* 랜딩 히어로 아래 한 줄 */
  --text-lead--line-height: 1.7;

  /* ---------- 레이아웃 폭 ---------- */
  --container-shell: 1360px; /* 앱 셸 본문 최대 폭 */
  --container-column: 1000px; /* 안쪽 컬럼 */
  --container-prose: 640px; /* 본문 한 줄 길이 상한 (design-system.md §4-2) */
  --container-landing-text: 1024px;
  --container-landing-card: 1200px;

  /* ---------- 자간 ---------- */
  --tracking-normal: 0; /* 한글 본문은 트래킹 0 — 조이지 않는다 */
  --tracking-h1: -0.045em;
  --tracking-h2: -0.025em;
  --tracking-h3: -0.02em;

  /* ---------- 그림자 ----------
     의도적으로 비어 있다. design-system.md §5 와 이슈 #36 이 금지한다.
     깊이는 1px 헤어라인(--color-line)이 낸다.
     시안에 4곳 있으나 m2-design-tokens.md §3-④ 참고. */
}
```

### 5-7. 유틸 이름 정리 (구현 시 참조용)

| 쓰려는 것 | 유틸 |
|---|---|
| 본문 글자색 | `text-ink` / `text-sub` / `text-dim` / `text-faint` |
| 카드 면 | `bg-surface` + `border border-line` + `rounded-16` |
| 눌린 패널 | `bg-surface-sunken rounded-12` |
| 주 버튼 | `bg-ink text-surface rounded-9` |
| 보조 버튼 | `bg-control text-ink rounded-9` |
| 입력 (제품) | `h-[42px] px-13 border border-input-border rounded-9 text-body` |
| 배지 | `rounded-6 text-meta font-semibold` |
| 헤더 높이 | `h-header` |
| 앱 셸 폭 | `max-w-shell mx-auto` |
| 간격 7px | `gap-7` / `p-7` / `mt-7` |

---

## 6. 전역 스타일

### 6-1. reset 범위

**최소 reset만 건다.** `normalize.css`나 `@tailwindcss/typography` 같은 외부 리셋을 추가하지 않는다.
Tailwind v4의 preflight가 이미 마진 제거·`box-sizing`·이미지 블록화를 처리하므로, **아래는 캔버스 25장의 helmet에 실제로 있던 규칙만** 옮긴 것이다.

캔버스 실측 (괄호 안은 25장 중 몇 장에 있었는지):

| 규칙 | 적용 |
|---|---|
| `* { box-sizing: border-box; }` | 25/25 |
| `body` 마진 0 / 배경 `#FFFFFF` / 글자 `#171717` | 25/25 |
| `body` `font-size: 14px; line-height: 1.75; word-break: keep-all; -webkit-font-smoothing: antialiased` | 25/25 |
| `a { color: #171717; text-decoration: none; }` + `a:hover { color: #5A5A5A; }` | 25/25 |
| `button { font: inherit; color: inherit; cursor: pointer; }` | 25/25 |
| `input { font: inherit; color: inherit; }` | 9/25 (입력이 있는 화면 전부) |
| `h1 { font-weight: 700; line-height: 1.4; letter-spacing: -0.045em; }` | 25/25 |
| `h2, h3 { font-weight: 700; line-height: 1.55; letter-spacing: -0.025em; }` | 25/25 |
| `p { line-height: 1.85; }` | 25/25 |
| `::selection { background: #171717; color: #FFFFFF; }` | 25/25 |
| `:focus-visible { outline: 2px solid #171717; outline-offset: 4px; }` | 캔버스 25/25. **구현은 `outline: none` (§6-4 채택)** |

> `body { font-size: 14px }`는 캔버스의 기본값이다. 제품 본문 토큰은 13.5px(`--text-body`)이고,
> 실제 본문 요소는 대부분 자기 크기를 직접 지정한다. 14px는 크기를 지정하지 않은 요소의 기본값으로만 쓰인다.

### 6-2. `src/app/styles/global.css`

`.mono` `@utility`를 제외한 이 파일 전체는 `@layer base` 안에 둔다.
밖에 두면 `button { color: inherit }`가 주 버튼 `text-surface`를 이긴다.

```css
/* 캔버스 25장의 helmet 에 실제로 들어 있던 규칙만 옮겼다.
   근거: frontend/docs/design/canvas/*.dc.html
   @layer base 로 감싼다 — 유틸이 전역 button/h1/p 를 이기게. */

html {
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  background: var(--color-surface);
  color: var(--color-ink);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.75;
  word-break: keep-all;
  letter-spacing: 0;
  -webkit-font-smoothing: antialiased;
}

a {
  color: var(--color-ink);
  text-decoration: none;
}

a:hover {
  color: var(--color-sub);
}

button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}

input,
textarea,
select {
  font: inherit;
  color: inherit;
}

h1 {
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: -0.045em;
}

h2,
h3 {
  font-weight: 700;
  line-height: 1.55;
  letter-spacing: -0.025em;
}

p {
  line-height: 1.85;
}

::selection {
  background: var(--color-ink);
  color: var(--color-surface);
}

/* 포커스는 outline 링을 쓰지 않는다 — 테두리 있는 컨트롤에서 선이 두 겹이 된다.
   채택: design-system.md §3-3 (v0.4). */
:focus,
:focus-visible {
  outline: none;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 6-3. `.mono` 유틸

캔버스의 `.mono`는 서체를 바꾸지 않는다 — 같은 나눔스퀘어에 숫자만 고정폭으로 돌린다.
`global.css` 아래쪽에 유틸로 둔다.

```css
@utility mono {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
```

> v4의 `@utility`가 설치된 버전에서 동작하지 않으면 그냥 `.mono { … }` 평범한 클래스로 둔다. 값이 중요하지 문법이 중요하지 않다.

### 6-4. 포커스 — **채택: outline 없음**

캔버스 25장은 `outline: 2px solid #171717; offset 4px`를 싣고 있다. 구현에 옮기면
테두리가 있는 버튼·입력·선택 카드에서 선이 두 겹이 된다.

**채택 값** (`global.css` · `@layer base`)

```css
:focus,
:focus-visible {
  outline: none;
}
```

호버·눌림은 면과 테두리 색으로만 표시한다.

> **남은 구멍 — 키보드 포커스 표시가 없다.**
> `outline: none`을 넣었지만 그 자리를 채운 것이 없다. `hover:`·`active:`는 둘 다 포인터 전용이라
> **탭으로 이동할 때 아무 변화가 없다.** 산출 CSS의 포커스 규칙은 `outline:none` 한 줄이 전부고,
> `src/shared/ui/` 어느 컴포넌트에도 `focus-visible:` 유틸이 없다.
> `WCAG 2.2 AA` SC 2.4.7 미충족이며 **M4 화면 작업 전에 반드시 채운다.**
> design-system.md §13-1은 "`outline` 배제만 확정, 대체 표현 미정"으로 **미결 유지**다.
> 후보와 경위는 `docs/impl-decision/2026-09-16-focus-ring-not-ink.md`.

### 6-5. hover / pressed

캔버스 실측 — hover 규칙은 딱 5종뿐이다:

| 선택자 | 값 | 출처 |
|---|---|---|
| `a:hover` | `color: #5A5A5A` | 25/25 |
| `.modal-cancel:hover` | `background: #EDEDED` | `Main` `Tasks` (고스트 버튼 hover) |
| `.modal-trigger:hover` | `background: #EDEDED`, 내부 svg `stroke: #171717` | `Main` `Tasks` (아이콘 버튼 hover) |
| `.team-btn:hover` | `background: #FAFAFA` | `Main` (테두리 버튼 hover) |
| `.team-row:hover` | `background: #F0F0F0` | `Main` (메뉴 항목 hover) |

**`:active`는 캔버스 전체에 0건이다.** pressed 상태는 실측 근거가 없다 → §7의 각 표에서 **`제안`**으로 표시했다.

---

## 7. 컴포넌트 사양

이슈 #36의 목록만 만든다. 목록에 없는 컴포넌트는 각 슬라이스에서 증분 추가한다.

### 7-0. Radix 사용 여부와 설치

**Radix는 동작·접근성만 쓰고 시각 스타일은 직접 입힌다**(D-113). `primitive`별 패키지로 개별 import 한다.

```bash
cd frontend
npm i @radix-ui/react-checkbox @radix-ui/react-dialog @radix-ui/react-radio-group @radix-ui/react-toast @radix-ui/react-toggle-group
```

| 컴포넌트 | Radix | 패키지 | 왜 / 왜 아닌가 |
|---|---|---|---|
| `Button` | ✕ | — | 네이티브 `<button>`으로 충분하다. `asChild`가 필요해지면 그때 `@radix-ui/react-slot`을 넣는다 |
| `TextField` | ✕ | — | 네이티브 `<input>`. `id`↔`htmlFor`와 `aria-describedby`는 직접 잇는다 |
| `Label` | ✕ | — | `<label htmlFor>`가 네이티브로 포커스 이양을 한다. Radix Label이 더하는 것은 더블클릭 텍스트 선택 방지뿐이라 의존성 값을 못 한다 |
| `ErrorText` | ✕ | — | `<p role="alert">` |
| `Card` / `Panel` | ✕ | — | 순수 표현 |
| `Checkbox` | ○ | `@radix-ui/react-checkbox` | indeterminate, 키보드, `aria-checked`. 시안의 체크박스는 커스텀 SVG라 네이티브 `<input type=checkbox>`를 숨기고 그리는 것보다 Radix가 깔끔하다 |
| `SelectCard` | ○ | `@radix-ui/react-radio-group` | roving tabindex + 방향키 이동. 라디오 그룹을 손으로 만들면 반드시 틀린다 |
| `Segmented` | ○ | `@radix-ui/react-toggle-group` | `type="single"`. 방향키 이동 + `aria-pressed` |
| `Modal` | ○ | `@radix-ui/react-dialog` | 포커스 트랩, Esc, 스크롤 락, `aria-modal`. 직접 만들 이유가 없다 |
| `Toast` | ○ | `@radix-ui/react-toast` | 스와이프 해제, `aria-live`, 포커스 복귀 |
| `EmptyState` | ✕ | — | 순수 표현 |
| `Skeleton` | ✕ | — | 순수 표현 |
| `Mascot` | ✕ | — | 인라인 SVG |

**공통 props 원칙** (D-149)

- 기능 전용 한국어 문구를 컴포넌트에 고정하지 않는다. `label` · `title` · `description` · `action` · `placeholder`를 props로 받는다.
- **예외**: 컴포넌트 구조에 속하는 접근성 문구(`Modal`의 닫기 버튼 `aria-label` 등)는 기본값을 두되 props로 덮을 수 있게 한다.
- `className`을 마지막 props로 받아 덮어쓸 수 있게 한다. 병합은 `clsx` 정도면 충분하다(선택 — 안 넣어도 된다).
- 모든 컴포넌트가 해당 DOM 요소의 props를 확장한다: `React.ComponentPropsWithoutRef<'button'>` 등.

---

### 7-1. `Button`

**근거 아트보드**: `Foundations.dc.html`(컨트롤 절) · `Tasks.dc.html` · `Main.dc.html` · `EmptyTasks.dc.html` · `SetupTeam.dc.html` · `SetupNotion.dc.html` · `SetupDiscord.dc.html` · `Login.dc.html` · `Signup.dc.html` · `Upload.dc.html` · `Settings.dc.html` · `Landing.dc.html`

#### 변형 × 상태

| 변형 | 기본 | hover | pressed | focus | 비활성 | 오류 |
|---|---|---|---|---|---|---|
| `primary` (주 액션, ink-fill) | 면 `#171717` · 글자 `#FFFFFF` · 테두리 없음 | **채택** 면 `#666666` · 글자 `#FFFFFF` | **제안** 면 `#5A5A5A` | `outline: none` | **실측** 면 `#F0F0F0` · 글자 `#999999` (`SetupNotion`·`SetupDiscord`의 `다음`) | 해당 없음 |
| `default` (기본) | 면 `#EDEDED` · 글자 `#171717` · `border: 1px solid transparent` | **채택** 면 `#C9C9C9` · 글자 `#171717` (같은 회색이 한 단 진해짐. 차콜+흰글자 아님) | **제안** 면 `#DCDCDC` | 〃 | **제안** 면 `#F0F0F0` · 글자 `#999999` | 해당 없음 |
| `ghost` (고스트) | 면 `transparent` · 글자 `#5A5A5A` · 테두리 없음 | **실측** 면 `#EDEDED` (`.modal-cancel:hover`) | **제안** 면 `#E8E8E8` | 〃 | **실측** 글자 `#C9C9C9` (`SetupTeam`의 비활성 `이전`, `aria-disabled="true"`) | 해당 없음 |
| `text` (텍스트) | 면 `transparent` · 글자 `#999999` | **제안** 글자 `#666666` | **제안** 글자 `#5A5A5A` | 〃 | **제안** 글자 `#C9C9C9` | 해당 없음 |
| `outline` (테두리 — 인증 Google 버튼·헤더 팀 버튼) | 면 `#FFFFFF` · 테두리 `1px solid #E8E8E8` · 글자 `#171717` | **채택** 면 `#EDEDED` (고스트 hover와 같음). 테두리 유지 | **제안** 면 `#F0F0F0` | 〃 | **제안** 테두리 `#F0F0F0` · 글자 `#C9C9C9` | 해당 없음 |

> `outline` 변형은 이슈의 4종 목록에 없다. 그러나 `Login`·`Signup`의 Google 버튼과 `Main`·`Tasks`·`EmptyTasks`의 팀 전환 버튼이
> 실측으로 존재하고 M4가 바로 필요로 한다. **추가 제안**으로 표시한다. 리뷰에서 빼기로 하면 M4에서 만든다.
>
> **hover 채택 (M2 갤러리에서 확정).** 기본은 `#EDEDED` → `#C9C9C9` (회색 축). 주 액션은 `#171717` → `#666666`.
> 아웃라인은 고스트와 같은 `#EDEDED`. 차콜 면 + 흰 글자는 기본 버튼에서 이질감이 커서 쓰지 않는다.
> pressed는 여전히 제안 — 캔버스에 `:active` 0건.

#### 크기 — 화면군별 실측 (전부 그대로 적는다)

| 크기 토큰 | 높이 | padding | 반경 | 글자 | 쓰는 화면 | 근거 파일 |
|---|---|---|---|---|---|---|
| `sm` | 32px | `0 11px` ~ `0 12px` | `9` | 13 / 600 | 헤더 팀 버튼 · 헤더 탭 | `Main` `Tasks` `EmptyTasks` |
| `md` (기본) | **36px** | `0 20px`(primary) / `0 16px`(ghost) | `9` | 13 / 600 | 제품 카드 액션 — `승인` `반려` `직접 채우기` | `Tasks` `Foundations` |
| `md-compact` | 34px | `0 13px` | `9` | 12.5 / 600 | 설정 행 액션 | `Settings` |
| `lg` | 40px | `0 20px` | `9` | 13.5 / 600 | 빈 상태 주 액션 | `EmptyTasks` `EmptyMeetings` `EmptyMessages` |
| `lg-onboarding` | 40px | `0 18px`(primary) / `0 30px`(`다음`) / `0 14px`(텍스트) | **`8`** | 13.5 / 600 | 온보딩 4화면 | `SetupTeam` `SetupDiscord` `SetupNotion` `SetupMembers` |
| `xl` | 44px | `0 22px` | `9` | 14.5 / 600 | `정리 시작하기` | `Upload` |
| `auth` | 48px | 폭 100% | **`999`** | 15 / 600 | 로그인 · 가입 · Google | `Login` `Signup` |
| `landing-hero` | 44px | `0 24px` | **`999`** | 16 / 600 | 랜딩 히어로 CTA | `Landing` |
| `landing-nav` | 38px | `0 18px` | **`999`** | 15 / 600 | 랜딩 헤더 CTA | `Landing` |

> **`SetupTeam`의 `만들기` 버튼만 `font-weight: 700`이다** (같은 파일의 `다음`은 600).
> `SetupNotion`의 `이 보드로 연결`, `SetupDiscord`의 `연결하기`도 700이다.
> 온보딩 카드 안의 확정 버튼만 700, 하단 내비의 `다음`은 600 — 일관된 패턴이다. 그대로 따른다.

#### props 설계

```ts
type ButtonVariant = 'primary' | 'default' | 'ghost' | 'text' | 'outline'
type ButtonSize = 'sm' | 'md' | 'md-compact' | 'lg' | 'lg-onboarding' | 'xl' | 'auth' | 'landing-hero' | 'landing-nav'

interface ButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant   // 기본 'default'
  size?: ButtonSize         // 기본 'md'
  fullWidth?: boolean       // auth 폼에서 쓴다
  loading?: boolean         // true 면 disabled + aria-busy. 스피너는 넣지 않는다(§8 "스피너 전면 표시 금지")
  startIcon?: React.ReactNode
  endIcon?: React.ReactNode
}
```

**라벨은 반드시 `children`으로 받는다.** `승인`·`반려` 같은 문구를 컴포넌트에 넣지 않는다.

**규칙**

- **주 액션은 화면당 1개.** 컴포넌트가 강제할 수 없으므로 **JSDoc에 적어 둔다.** (승인 카드가 여럿이면 카드마다 하나.)
- **파괴적 빨강 채움 버튼은 없다.** `반려`·`보내지 않음`·`팀 삭제`도 `ghost` 또는 `default`로 그린다. `#FF6969` 채움 버튼을 만들지 않는다.
- `disabled` 대신 `aria-disabled`를 쓰는 자리가 있다(`SetupTeam`의 `이전`). 포커스를 남겨야 하면 `aria-disabled`, 완전히 뺄 것이면 `disabled`.

---

### 7-2. `TextField`

**근거 아트보드**: `Foundations.dc.html`(컨트롤 절 + 입력 높이 표) · `Tasks.dc.html` · `Upload.dc.html` · `SetupTeam.dc.html` · `Login.dc.html` · `Signup.dc.html`

#### 톤(화면군) 3종 — Foundations "입력 높이" 표와 실물이 일치한다

| 톤 | 높이 | padding | 테두리 | 반경 | 글자 | 쓰는 화면 | 근거 파일 |
|---|---|---|---|---|---|---|---|
| `product` | **42px** | `0 13px` | `1px solid #949494` | **9** | 13.5 / 400 | Tasks · Upload | `Upload.dc.html`, `Foundations` 샘플 |
| `onboarding` | **42px** | `0 13px` | `1px solid #C9C9C9` | **8** | 13.5 / 400 | SetupTeam 등 온보딩 4화면 | `SetupTeam.dc.html` |
| `auth` | **48px** | `0 16px` | `1px solid #C9C9C9` | **12** | 15 / 400 | Login · Signup | `Login.dc.html` `Signup.dc.html` |

> **제품만 `#949494` 경계를 쓴다.** 온보딩과 인증은 `#C9C9C9`이고 라운드도 다르다.
> "`#949494` 경계에 42px" 한 줄로 적으면 화면 절반이 빠진다 — Foundations의 경고 문장 그대로다.
>
> 시안의 인라인은 `height: 40px; min-height: 42px`처럼 두 값이 겹쳐 있다. **렌더 결과인 42px를 쓴다.**

#### 상태

| 상태 | product | onboarding | auth |
|---|---|---|---|
| 기본 | 테두리 `#949494` · 면 `#FFFFFF` · 글자 `#171717` | 테두리 `#C9C9C9` | 테두리 `#C9C9C9` |
| placeholder | **제안** 글자 `#999999` (미세) | 〃 | 〃 |
| hover | **제안** 변화 없음 | 〃 | 〃 |
| focus | `outline: 2px solid #171717; outline-offset: 4px` (전역) | 〃 | 〃 |
| **오류** | **실측** 테두리 `#FF6969` · placeholder `#FF8989` · 라벨 `#FF6969` · 우측 아이콘 `stroke: #FF6969` | **확인 필요** — 시안 없음 | **확인 필요** — 시안 없음 |
| 비활성 | **제안** 면 `#FAFAFA` · 테두리 `#E8E8E8` · 글자 `#999999` | 〃 | 〃 |

**오류 상태 실측 원문** (`Tasks.dc.html`):

```html
<label style="font-size: 12px; font-weight: 400; color: #FF6969">담당자 — 골라 주세요</label>
<div style="... border: 1px solid #949494; border-radius: 9px; ... border-color: #FF6969">
  <span style="color: #FF8989">미지정</span>
  <svg ... style="stroke: #FF6969">
</div>
```

> `#FF6969`는 **"비우면 승인이 막히는 입력"에만** 쓴다(Foundations 강조 절). 일반 검증 실패에 쓰지 않는다.
> 일반 미입력 필수칸은 design-system.md §7-7대로 **경계를 먹(`#171717`)으로** 그린다.
> **확인 필요** — 먹 경계의 실측 사례가 캔버스에 없다. M4에서 첫 사례를 만들 때 정한다.

#### props 설계

```ts
type FieldTone = 'product' | 'onboarding' | 'auth'

interface TextFieldProps extends Omit<React.ComponentPropsWithoutRef<'input'>, 'size'> {
  tone?: FieldTone            // 기본 'product'
  label?: string              // 없으면 라벨을 그리지 않는다 (aria-label 을 직접 넘긴다)
  labelTone?: 'normal' | 'required-blocking'  // 'required-blocking' 이면 라벨·경계가 #FF6969
  description?: string
  error?: string              // 있으면 ErrorText 를 그리고 aria-invalid + aria-describedby 를 잇는다
  startAdornment?: React.ReactNode
  endAdornment?: React.ReactNode   // 비밀번호 보기 버튼, 캘린더 아이콘 등
}
```

- **`id`는 내부에서 `useId()`로 만들고 props의 `id`가 있으면 그걸 쓴다.** `label htmlFor`·`aria-describedby`를 자동으로 잇는다.
- 문구는 전부 props다. `이메일`·`팀 이름` 같은 라벨을 컴포넌트에 넣지 않는다.
- `endAdornment` 실측: 비밀번호 보기 버튼 = 34×34, `border-radius: 9999px`, 배경 투명, svg 17×17 `stroke: #666666` `stroke-width: 1.7` (`Login` `Signup`).
- 비밀번호 입력의 래퍼 실측: `height: 48px; padding: 0 8px 0 16px; gap: 6px`이고 안쪽 `<input>`은 `border: 0; background: transparent; letter-spacing: 0.14em`.

---

### 7-3. `Label` · `ErrorText`

**근거 아트보드**: `Tasks.dc.html` · `Upload.dc.html` · `SetupTeam.dc.html` · `Login.dc.html` · `Signup.dc.html`

#### `Label`

| 톤 | 크기 / 굵기 | 색 | 위치 | 근거 파일 |
|---|---|---|---|---|
| `product` | 12 / 400 | `#5A5A5A` (보조) | 입력 **위**, `gap: 6px` | `Tasks.dc.html` |
| `product` (Upload) | 12.5 / 400 | `#5A5A5A` | 입력 위, `gap: 7px` | `Upload.dc.html` |
| `onboarding` | 12 / 400 | `#666666` (흐림) | 입력 위, `gap: 7px` | `SetupTeam.dc.html` |
| `auth` | 13 / 400 | `#666666` | 입력 위, `gap: 8px` | `Login.dc.html` `Signup.dc.html` |
| `required-blocking` | 12 / 400 | **`#FF6969`** | 〃 | `Tasks.dc.html` |

**굵기는 4/4 화면군 전부 400이다.** 라벨에 600을 쓰지 않는다.
(design-system.md §4-1의 "버튼·라벨·배지 13/600"은 **배지·버튼**을 말한다. 필드 라벨은 §7-7대로 400이다. 이 둘을 섞지 않는다.)

```ts
interface LabelProps extends React.ComponentPropsWithoutRef<'label'> {
  tone?: 'product' | 'onboarding' | 'auth'
  blocking?: boolean   // true 면 #FF6969 — "비우면 승인이 막히는 입력"에만
}
```

#### `ErrorText` — **실측 근거 없음. 전부 제안이다.**

캔버스 25장에 **오류 메시지 텍스트가 한 줄도 없다.** 시안은 오류를 라벨 색과 경계 색으로만 표현한다.
따라서 아래는 기존 토큰에서 유도한 제안이다.

| 항목 | 제안 값 | 근거 |
|---|---|---|
| 크기 / 굵기 | 12 / 400 | 라벨과 같은 단. 오류가 라벨보다 커지면 시선을 뺏는다 |
| 색 | `#FF6969` | 경계·라벨과 같은 색. 유채색을 새로 만들지 않는다 |
| 위치 | 입력 **아래**, `margin-top: 6px` | D-142 "필드 오류는 입력 아래" |
| 역할 | `<p role="alert" id={errorId}>` | 입력의 `aria-describedby`가 이걸 가리키고 `aria-invalid="true"`가 붙는다 |
| 아이콘 | 없음 | design-system.md §7-13 "유채 정보/성공/경고/오류 박스를 쓰지 않는다" |

**비필드 서버 오류는 폼 상단**에 놓는다(D-142). 그 블록은 §7-13대로 **눌린 면 + 먹 본문 + 대체 경로 버튼**이고,
`ErrorText`가 아니라 M4에서 `FormErrorPanel`로 따로 만든다. M2 범위 밖이다.

```ts
interface ErrorTextProps extends React.ComponentPropsWithoutRef<'p'> {
  children: React.ReactNode   // 문구는 호출자가 준다
}
```

---

### 7-4. `Card` / `Panel`

**근거 아트보드**: `Tasks.dc.html` · `Settings.dc.html` · `Upload.dc.html` · `SetupTeam.dc.html` · `Main.dc.html` · `Login.dc.html`

#### `Card` 변형

| 변형 | 면 | 테두리 | 반경 | padding (실측) | 쓰는 곳 | 근거 파일 |
|---|---|---|---|---|---|---|
| `default` | `#FFFFFF` | `1px solid #E8E8E8` | **16** | `18px 20px` / `22px` / `16px 18px` / `15px 18px` | 설정 연결 행 · 알림 행 · 업로드 드롭존 | `Settings` `Upload` |
| `attention` (지금 봐야 하는) | `#FFFFFF` | **`1px solid #C9C9C9`** | 16 | `28px 30px` | `확인 필요` 태스크 카드 | `Tasks` |
| `pending` (보류) | `#FFFFFF` | **`2px dashed #BDBDBD`** | 16 | `20px 22px` | `보류` 태스크 카드 | `Tasks` |
| `onboarding` | `#FFFFFF` | `1px solid #E8E8E8` | **10** | `22px 22px 18px` | 온보딩 4화면의 본문 카드 | `SetupTeam` `SetupNotion` `SetupDiscord` |

> `attention`은 시안에서 `box-shadow: 0px 8px 24px 0px #17171733`도 같이 쓴다. **그림자는 넣지 않는다** — §3-④.
> 테두리 `#C9C9C9` 한 겹만으로 "지금 봐야 하는 카드"를 표현한다. design-system.md §3-2가 그 색의 용도를 정확히 그렇게 적는다.

#### `Panel` (눌린 면 — 근거 블록)

| 항목 | 값 | 근거 |
|---|---|---|
| 면 | `#FAFAFA` (눌린 면) | `Tasks.dc.html` |
| 테두리 | 없음 | 〃 |
| 반경 | **12** | 〃 |
| padding | `18px 20px` | 〃 |
| 내부 `gap` | `7px` | 〃 |
| 좌측 액센트 색 | **없음** | design-system.md §7-4 명시 |

근거 블록 내부 실측 (§7-4의 구조 그대로):

```
출처(mono 11 / 400 / #666666)              원문 듣기(11.5 / 400 / #666666)
"인용"(13.5 / 400 / #171717, line-height 1.7)
보충 설명(12.5 / 400 / #666666)
```

> 인증 화면의 우측 사이드 카드는 `border-radius: 28px; background: #FAFAFA; padding: 44px`이다(`Login` `Signup`).
> 반경 28은 토큰 목록 밖 일회성이라 `Card`에 넣지 않는다. M4에서 인증 레이아웃을 그릴 때 그 화면에서 직접 쓴다.

```ts
interface CardProps extends React.ComponentPropsWithoutRef<'div'> {
  variant?: 'default' | 'attention' | 'pending' | 'onboarding'
  as?: 'div' | 'article' | 'section' | 'label'   // Tasks 는 article, Settings 선택 카드는 label
}

interface PanelProps extends React.ComponentPropsWithoutRef<'div'> {}
```

---

### 7-5. `Checkbox`

**근거 아트보드**: `Signup.dc.html` — **캔버스 전체에서 체크박스는 여기 한 곳뿐이고, 체크된 상태만 있다.**

| 상태 | 값 | 근거 |
|---|---|---|
| **checked** | 18×18 · `border-radius: 6px` · 면 `#171717` · 테두리 없음 · 체크 svg 11×11 `stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round"` path `m20 6-11 11-5-5` (viewBox 0 0 24 24) | **실측** `Signup.dc.html` |
| unchecked | 18×18 · `rounded-6` · 면 `#FFFFFF` · 테두리 `1px solid #949494` | **제안** — `#949494`가 "입력 경계"의 역할이고, 체크박스도 입력이다 |
| indeterminate | 18×18 · 면 `#171717` · 흰 가로 막대 9×2 `rounded-999` | **제안** |
| hover (unchecked) | 테두리 `#171717` | **제안** |
| pressed | 면 `#5A5A5A` (checked) / 테두리 `#171717` (unchecked) | **제안** — `:active` 실측 0건 |
| focus | `outline: 2px solid #171717; outline-offset: 4px` | 전역 |
| **disabled** | 면 `#DCDCDC`(비활성 표식) · 테두리 없음 · 체크 `#FFFFFF` / unchecked 테두리 `#C9C9C9` | **제안** — `#DCDCDC`의 Foundations 용례가 "비활성 표식"이다 |
| error | 테두리 `#FF6969` | **제안** — 약관 동의 미체크 차단에만 |

라벨 붙은 행 실측 (`Signup.dc.html`):

```
display: flex; align-items: flex-start; gap: 10px; padding-top: 2px;
font-size: 13px; line-height: 20px; color: #666666; cursor: pointer;
체크박스에 margin-top: 1px
```

```ts
interface CheckboxProps {
  checked?: boolean | 'indeterminate'
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean | 'indeterminate') => void
  disabled?: boolean
  invalid?: boolean
  id?: string
  name?: string
  value?: string
  children?: React.ReactNode   // 라벨. 문구는 호출자가 준다
  className?: string
}
```

구현: `@radix-ui/react-checkbox`의 `Root` + `Indicator`. `Root`에 시각 스타일을 입히고 `Indicator` 안에 SVG를 넣는다.

---

### 7-6. `SelectCard`

**근거 아트보드**: `Settings.dc.html` — "자동 반영 기준" 3개 라디오 카드. **3상태가 전부 실측으로 있다.**

| 상태 | 카드 | 라디오 표식 (17×17, `rounded-999`) | 제목 | 설명 |
|---|---|---|---|---|
| 미선택 | 면 `#FFFFFF` · 테두리 `1px solid #E8E8E8` · `rounded-16` · `padding: 16px 18px` | 테두리 `1px solid #999999` · 안쪽 비어 있음 | 13.5 / 600 / `#171717` | 12.5 / 400 / `#666666` |
| **선택** | 테두리 **`1px solid #C9C9C9`** (나머지 동일) | 테두리 `1px solid #999999` + 안쪽 점 **8×8 `#171717` `rounded-999`** | 13.5 / 600 / `#171717` | 12.5 / 400 / **`#5A5A5A`** |
| 비활성 | 테두리 `1px solid #E8E8E8` | 테두리 **`1px solid #C9C9C9`** · 안쪽 비어 있음 | 13.5 / 600 / **`#666666`** | 12.5 / 400 / `#666666` |

행 배치: `display: flex; align-items: flex-start; gap: 13px`, 라디오에 `margin-top: 3px`, 텍스트 영역 `flex: 1`.
제목과 설명은 `display: block`으로 쌓는다.

> design-system.md §7-12는 "선택 시 경계가 **먹**으로 진해진다"고 적지만 실물은 `#C9C9C9`다. §3-⑥ 참고.
> hover는 시안에 없다 — **채택**: 면 `#EDEDED` (아웃라인 버튼 hover와 같음). 테두리는 바꾸지 않는다.
> pressed는 여전히 제안: 면 `#FAFAFA`.

```ts
interface SelectCardGroupProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  name?: string
  children: React.ReactNode
  className?: string
}

interface SelectCardProps {
  value: string
  disabled?: boolean
  title: React.ReactNode        // 문구는 호출자가 준다
  description?: React.ReactNode
  className?: string
}
```

구현: `@radix-ui/react-radio-group`의 `Root` + `Item` + `Indicator`. `Item`을 카드 전체로 만들고 `Indicator`가 8px 점을 그린다.

---

### 7-7. `Segmented`

**근거 아트보드**: `Tasks.dc.html` · `TasksBoard.dc.html` · `TasksCalendar.dc.html` · `TasksGantt.dc.html` · `Upload.dc.html` — **5곳 전부 값이 같다.**

| 부위 | 값 |
|---|---|
| 트랙 | `display: inline-flex; gap: 3px; padding: 3px; border: 1px solid transparent; border-radius: 11px; background: #EDEDED` |
| 항목 (미선택) | `height: 30px; padding: 0 13px; border: 0; border-radius: 9px; background: transparent; font-size: 12.5px; font-weight: 600; color: #5A5A5A` |
| 항목 (**선택**) | 위와 같고 `background: #FFFFFF; color: #171717` |

> `Upload.dc.html`만 항목이 `height: 32px; padding: 0 15px; font-size: 13px`이다. 탭이 2개뿐이라 넓게 잡은 것으로 본다.
> **기본은 30px / `0 13px` / 12.5px**(4/5 화면)로 하고 `size` prop으로 `Upload` 값을 낸다.
>
> 시안 인라인에 `min-height: 36px`이 함께 붙어 있어 **렌더 높이는 36px**이다. 트랙의 실제 높이도 `36 + 3*2 = 42px`가 된다.
> `height: 30px`만 보고 옮기면 시안보다 6px 낮아진다. **`min-height: 36px`을 반드시 함께 옮긴다.**

| 상태 | 값 |
|---|---|
| hover (미선택) | **제안** 글자 `#171717` |
| pressed | **제안** 면 `#FAFAFA` |
| focus | 전역 링. **주의** — 트랙 `gap`이 3px이라 `outline-offset: 4px`가 이웃을 덮는다(§6-4) |
| 비활성 | **제안** 글자 `#C9C9C9`, 포인터 이벤트 없음 |

```ts
interface SegmentedProps {
  value: string
  onValueChange: (value: string) => void
  size?: 'sm' | 'md'   // sm = 30/0 13px/12.5 (기본), md = 32/0 15px/13
  'aria-label': string  // 필수. 문구는 호출자가 준다
  children: React.ReactNode
  className?: string
}

interface SegmentedItemProps {
  value: string
  disabled?: boolean
  children: React.ReactNode
}
```

구현: `@radix-ui/react-toggle-group`의 `Root type="single"` + `Item`.
`type="single"`은 빈 값을 허용하므로 `onValueChange`에서 빈 문자열을 무시해 항상 하나가 선택되게 한다.

> 시안에는 **밑줄형 필터 탭**도 따로 있다 (`Tasks.dc.html`의 `전체 / 확인 필요 / 진행 중 / 완료`):
> `height: 32px; min-height: 36px; padding-left/right: 3px; gap: 17px`, 활성만 `border-bottom: 2px solid #171717; color: #171717; background: #FFFFFF`.
> **`Segmented`와 다른 컴포넌트다.** 이슈 목록에 없으므로 M2에서 만들지 않는다.

---

### 7-8. `Modal`

**근거 아트보드**: `Main.dc.html` · `Tasks.dc.html` — `.modal-*` 클래스가 두 파일에 동일하게 정의돼 있다.

| 부위 | 값 (실측) |
|---|---|
| 오버레이 | `position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; z-index: 100` |
| 스크림 | `position: absolute; inset: 0; background: rgba(23, 23, 23, 0.32); cursor: pointer` |
| 카드 | `width: 380px; max-width: 100%; padding: 24px; border: 1px solid #E8E8E8; border-radius: 16px; background: #FFFFFF; display: flex; flex-direction: column; gap: 12px` |
| 제목 (h3) | `font-size: 17px; font-weight: 700; letter-spacing: -0.02em; color: #171717; margin: 0` |
| 본문 (p) | `font-size: 13.5px; line-height: 1.7; color: #5A5A5A; margin: 0` |
| 액션 행 | `display: flex; justify-content: flex-end; gap: 8px; padding-top: 6px` |
| 취소 버튼 | `height: 36px; padding: 0 14px; border-radius: 9px; font-size: 13px; font-weight: 600; color: #5A5A5A; background: transparent` · hover `background: #EDEDED` |
| 확인 버튼 | `height: 36px; padding: 0 16px; border: 0; border-radius: 9px; font-size: 13px; font-weight: 600; color: #FFFFFF; background: #171717` |

> 스크림 `rgba(23, 23, 23, 0.32)`는 `#171717`의 32% 알파다. **`#000000` 금지와 어긋나지 않는다** — 먹의 알파다.
> 토큰으로는 `--color-scrim: rgb(23 23 23 / 0.32)`를 두거나, 유틸에서 `bg-ink/32`로 쓴다(v4는 임의 알파를 지원한다).
>
> **닫기 X 버튼이 시안에 없다.** 닫기는 스크림 클릭과 `취소` 버튼으로만 한다. Esc는 Radix가 처리한다.
> X 버튼이 필요해지면 M4에서 추가한다. **확인 필요.**

| 상태 | 값 |
|---|---|
| 열림/닫힘 전환 | **제안** 없음(즉시). `prefers-reduced-motion`이 아니어도 시안에 전환이 없다 |
| focus | Radix가 카드 안 첫 포커서블로 옮긴다. 닫으면 트리거로 복귀 |
| 스크롤 락 | Radix `Dialog`가 처리 |

```ts
interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode          // 문구는 호출자가 준다
  description?: React.ReactNode
  children?: React.ReactNode      // 본문 커스텀
  actions?: React.ReactNode       // 보통 <Button variant="ghost"> + <Button variant="primary">
  width?: number                  // 기본 380
  closeLabel?: string             // 접근성 기본값. 구조에 속하므로 기본값을 둔다
}
```

구현: `@radix-ui/react-dialog` — `Root` `Portal` `Overlay` `Content` `Title` `Description` `Close`.
**`Title`은 반드시 넣는다.** 없으면 Radix가 콘솔 경고를 낸다.

---

### 7-9. `Toast` — **실측 근거 없음. 전부 제안이다.**

캔버스 25장에 **토스트가 한 곳도 없다.** 토큰에서 유도한 제안이다.

design-system.md §7-16의 규칙만 확실하다:

- 되돌릴 수 있는 동작에는 `되돌리기` 액션을 붙인다.
- **오류는 토스트로 처리하지 않는다** (§12: "사라지면 대체 경로를 놓친다"). 따라서 **`variant='error'`를 만들지 않는다.**

| 항목 | 제안 값 | 유래 |
|---|---|---|
| 위치 | 우측 하단, `bottom: 24px; right: 24px`, 항목 간 `gap: 8px` | — |
| 면 | `#FFFFFF` | 카드와 같다 |
| 테두리 | `1px solid #E8E8E8` | 카드와 같다 |
| 반경 | `12` | 칸반 카드와 같은 단. 16(카드)보다 작게 잡아 떠 있는 것으로 읽히게 |
| padding | `14px 16px` | — |
| 폭 | `min-width: 280px; max-width: 380px` | Modal 380과 맞춘다 |
| 제목 | 13.5 / 600 / `#171717` | 카드 제목 단 |
| 설명 | 12.5 / 400 / `#666666` | 캡션 단 |
| 액션 버튼 | `Button variant="ghost" size="md-compact"` | — |
| 그림자 | **없음** | §1-3 금지 |
| 지속 시간 | 6000ms (액션 있으면 10000ms) | — |
| 전환 | `prefers-reduced-motion`이면 즉시 표시·제거 | §11 체크리스트 |

```ts
interface ToastOptions {
  title: React.ReactNode          // 문구는 호출자가 준다
  description?: React.ReactNode
  action?: { label: string; onClick: () => void }
  duration?: number
}
```

구현: `@radix-ui/react-toast` — `Provider` `Root` `Title` `Description` `Action` `Close` `Viewport`.
`Provider`는 M3의 `app/providers`에 올린다. **M2에서는 컴포넌트와 스타일만 만들고 Provider 배선은 하지 않는다.**

> **그림자 없이 흰 배경 위에 흰 토스트를 띄우면 안 보인다.** `1px solid #E8E8E8`만으로 충분한지 M4에서 눈으로 확인한다.
> 부족하면 §3-④에 적어 둔 "팝오버 한정 그림자 예외"를 여기에도 적용할지 함께 논의한다. **확인 필요.**

---

### 7-10. `EmptyState`

**근거 아트보드**: `EmptyTasks.dc.html` · `EmptyMeetings.dc.html` · `EmptyMessages.dc.html` — **3장의 값이 완전히 같다.**

| 부위 | 값 (실측) |
|---|---|
| 컨테이너 | `display: flex; flex-direction: column; align-items: center; gap: 26px; max-width: 460px; text-align: center` |
| 바깥 `main` | `flex: 1; display: flex; align-items: center; justify-content: center; padding: 48px 48px 96px` |
| 마스코트 | `<Mascot size={96} />` — `viewBox 0 0 240 240` |
| 텍스트 블록 | `display: flex; flex-direction: column; gap: 10px` |
| 제목 (h1) | `font-size: 24px; line-height: 1.35; font-weight: 700; letter-spacing: -0.035em; color: #171717` |
| 설명 (p) | `font-size: 14px; line-height: 1.8; color: #5A5A5A` |
| 액션 행 | `display: flex; align-items: center; gap: 10px; padding-top: 2px` |
| 주 액션 | `Button variant="primary" size="lg"` — 40px / `0 20px` / r9 / 13.5·600 |
| 보조 액션 | `height: 40px; padding: 0 8px; font-size: 13px; font-weight: 600; color: #171717` + 13×13 화살표 svg |

> design-system.md §7-15는 "아이콘 32px"과 "주 액션 1개"라고 적지만 실물은 마스코트 96px에 액션 2개다. §3-⑨ 참고.
> `아이콘 32px + 미세 회색`은 §6의 규정이기도 한데, 3장 어디에도 32px 아이콘이 없다. **실측을 따른다.**

```ts
interface EmptyStateProps {
  pose?: MascotPose             // 기본 'idle'
  mascotSize?: number           // 기본 96
  title: React.ReactNode        // 문구는 호출자가 준다
  description?: React.ReactNode
  action?: React.ReactNode      // <Button variant="primary" size="lg">
  secondaryAction?: React.ReactNode
  className?: string
}
```

**실측 포즈** — `EmptyTasks`는 `squint`(완료), `EmptyMeetings`·`EmptyMessages`는 `idle`이다.
`character.md` §5의 상태 매핑(완료 → 눈 가늘게)과 일치한다. 기본값은 `idle`, 호출자가 정한다.

---

### 7-11. `Skeleton` — **실측 근거 없음. 전부 제안이다.**

캔버스에 스켈레톤이 없다. design-system.md §8의 규칙만 확실하다:

> 로딩 = **스켈레톤(형태 유지)**. **스피너 전면 표시 금지.**

| 항목 | 제안 값 | 유래 |
|---|---|---|
| 면 | `#F0F0F0` (선택 면) | 회색은 컨트롤·상태에만. `#EDEDED`는 실제 컨트롤이 쓰므로 한 단 위를 쓴다 |
| 반경 | `text` → `6` / `block` → `12` / `circle` → `999` | 배지·칸반·알약 단 |
| 애니메이션 | 1.6s `ease-in-out` 무한, `opacity: 1 → 0.55 → 1` | 위치 이동(shimmer)보다 조용하다 |
| `prefers-reduced-motion` | **애니메이션 정지.** 면만 남긴다 | §11 체크리스트 |
| 접근성 | 컨테이너에 `aria-busy="true"`, 스켈레톤 자체는 `aria-hidden="true"` | 스크린리더가 빈 박스를 읽지 않게 |

```ts
interface SkeletonProps extends React.ComponentPropsWithoutRef<'div'> {
  variant?: 'text' | 'block' | 'circle'   // 기본 'text'
  width?: number | string
  height?: number | string
  lines?: number   // variant='text' 일 때 줄 수. 마지막 줄은 60% 폭
}
```

> **반짝임 색을 `#FAFAFA↔#F0F0F0` 그라데이션으로 만들지 않는다.** 그라데이션은 시각 톤과 어긋난다.
> 불투명도만 움직인다.

---

## 8. 마스코트 — `mascot.js` → `Mascot.tsx`

**근거**: `frontend/docs/mascot/mascot.js` · `frontend/docs/design/character.md` · `frontend/docs/mascot/mascot.md` ·
아트보드의 정적 SVG(`Login` `Signup` `SetupTeam` `EmptyTasks` `Processing` `Messages` `Landing` 등 **제품 화면 12장**)

**SVG/PNG 파일이 저장소에 없다. 인라인 생성이 유일한 방법이다.**

### 8-1. 원본에서 그대로 쓰는 것

| 항목 | 값 |
|---|---|
| `viewBox` | `0 0 240 240` |
| 중심 | `(120, 120)` |
| `R` (Outer 반지름) | `84` |
| 정규화 기준 | `R = 1`, 원점 = 몸 중심, **위가 −Y** |
| Inner (얼굴) | `rx 0.782` · `ry 0.762` — 포즈와 무관하게 고정 |
| Cap (타이머 버튼) | `capW 0.41451` · `capH 0.21762` · `capRx 0.06218` (Figma 40×21, rx 6) |
| Dial 줄무늬 | `STRIPE_W 0.03109` · `STRIPE_PITCH 0.1153` · `STRIPE_COUNT 13` · `STRIPE_ORIGIN -6` · `DIAL_HZ 1.1` |
| 팔레트 | `ink` {body·eye·cap `#171717`} / `coral` {전부 `#FF6969`} / `coralCap` {body·eye `#171717`, cap `#FF6969`} |
| 얼굴 · 줄무늬 | 항상 `#FFFFFF` (포즈·팔레트와 무관) |
| 레이어 순서 | Outer(원) → Inner(타원) → Cap(g>rect) → Dial stripes(cap clip) → Eyes(face clip) |
| 눈 캡슐 반경 | `min(w, h) / 2` |
| 눈 회전 | 눈 **중심** 기준. 바운딩 박스가 아니라 **회전 전 w×h**를 쓴다 |
| 전환 | 지수 ease-out, `λ = 8`. 오버슈트 없음 |
| 깜빡임 | 2.1–4.4초 간격, 0.14초 길이, 16% 확률로 더블 블링크(0.09초 뒤 재실행) |
| 버튼 눌림 | 4.6–8.4초 간격, 0.26초. **아랫변 고정**, 윗면만 `scaleY 1 → 0.58` |
| talking bounce | `sin(t * 14) * 0.018`, `puppet`에 `scale(1, 1+b)` |

### 8-2. 포즈 8개 — 정규화 좌표 전부

`character.md`와 `mascot.js`가 일치한다. 아래 값이 유일한 원본이다.

| 포즈 | innerX | innerY | Eye L (x, y, w, h, rot) | Eye R (x, y, w, h, rot) | Cap (x, y, rot) |
|---|---|---|---|---|---|
| `idle` | 0 | −0.0725 | −0.2485, −0.15, 0.176, 0.456, 0° | +0.2485, −0.15, 0.176, 0.456, 0° | −0.46691, −1.06198, **−22°** |
| `left` | −0.155 | −0.031 | −0.674, −0.088, **0.155, 0.394**, 0° | −0.29, −0.088, 0.176, 0.456, 0° | −0.26128, −1.122, **−13°** |
| `right` | +0.155 | −0.031 | +0.29, −0.088, 0.176, 0.456, 0° | +0.674, −0.088, **0.155, 0.394**, 0° | −0.38736, −1.08592, **−19°** |
| `squint` | 0 | −0.0725 | −0.3264, −0.122, **0.456, 0.1244**, 0° | +0.3264, −0.122, **0.456, 0.1244**, 0° | −0.46691, −1.06198, −22° |
| `upLeft` | −0.1036 | −0.1347 | −0.5832, −0.4381, 0.1554, 0.3678, **+12.918°** | −0.2178, −0.3786, 0.1762, 0.456, **+8.008°** | −0.1211, −1.14896, **−6°** |
| `upRight` | +0.1036 | −0.1347 | +0.2178, −0.3786, 0.1762, 0.456, **−8.008°** | +0.5832, −0.4381, 0.1554, 0.3678, **−12.918°** | −0.68347, −0.94451, **−34°** |
| `talking` | `idle`과 동일 | | | | `idle`과 동일 · `bounce: 1` |
| `dial` | `idle`과 동일 | | | | `idle`과 동일 · `dial: 1` (줄무늬 불투명도 1) |

**원본의 별칭 3개** — `thinking`→`left`, `curious`→`right`, `happy`→`squint`.
`EXPRESSIONS`에는 11개 키가 있지만 **실제 포즈는 8개다.** 이슈가 요구하는 8개와 정확히 일치한다.
별칭은 TSX에서 타입으로만 남긴다:

```ts
export type MascotPose = 'idle' | 'left' | 'right' | 'squint' | 'upLeft' | 'upRight' | 'talking' | 'dial'
```

별칭이 필요하면 호출부에서 `pose={isThinking ? 'left' : 'idle'}`처럼 쓴다. 컴포넌트에 별칭을 넣지 않는다 —
`happy`·`thinking`은 **기능 의미가 붙은 이름**이라 §1-7의 정신에 어긋나고, 포즈가 8개라는 사실을 흐린다.

### 8-3. 아트보드의 정적 SVG와 일치하는지 검산

아트보드의 마스코트는 `mascot.js`의 정지 프레임을 그대로 펼친 것이다. `idle`을 손으로 계산하면:

| 계산 | 결과 | `Login.dc.html` 실물 |
|---|---|---|
| inner cx `120 + 0×84` | 120 | `cx="120"` ✔ |
| inner cy `120 + (−0.0725×84)` | 113.91 | `cy="113.91"` ✔ |
| inner rx `0.782×84` | 65.69 | `rx="65.69"` ✔ |
| inner ry `0.762×84` | 64.01 | `ry="64.01"` ✔ |
| cap translate `120 + (−0.46691×84), 120 + (−1.06198×84)` | 80.78, 30.79 | `translate(80.78 30.79) rotate(-22)` ✔ |
| cap w/h/rx `0.41451×84`, `0.21762×84`, `0.06218×84` | 34.82, 18.28, 5.22 | `width="34.82" height="18.28" rx="5.22"` ✔ |
| eyeL x `120 − 0.2485×84 − (0.176×84)/2` | 91.73 | `x="91.73"` ✔ |
| eyeL y `120 − 0.15×84 − (0.456×84)/2` | 88.25 | `y="88.25"` ✔ |
| eyeL rx `min(14.78, 38.30)/2` | 7.39 | `rx="7.39"` ✔ |

`squint`도 맞는다 — `Signup.dc.html`의 `x="73.43" y="104.53" width="38.3" height="10.45" rx="5.22"`가
`0.3264`·`0.122`·`0.456`·`0.1244`에서 그대로 나온다.

**따라서 포팅이 맞는지 확인하는 방법은 명확하다: `idle`을 렌더해서 위 9개 숫자가 나오는지 본다.**

### 8-4. 바꾸는 것

| 원본 (`mascot.js`) | TSX |
|---|---|
| IIFE + `global.PebbleMascot` | named export `Mascot` |
| `document.createElementNS`로 DOM 조립 | JSX. React가 SVG 네임스페이스를 처리한다 |
| 전역 `instances[]` + 하나의 `requestAnimationFrame` 루프 | **컴포넌트 안 `useEffect` + 자체 rAF.** 인스턴스가 보통 1개뿐이고, 전역 배열은 언마운트 누수를 만든다 |
| `clipPath id = "pb-face-" + (++uid)` | **`useId()`** — SSR·StrictMode 이중 마운트에서도 충돌하지 않는다. 전역 카운터를 쓰면 StrictMode에서 id가 어긋난다 |
| `this.reduced`를 생성자에서 한 번 읽음 | `window.matchMedia(...).addEventListener('change', …)`로 **구독**한다. 사용자가 OS 설정을 바꾸면 즉시 반영돼야 한다 |
| `svg.addEventListener('click', …)` + `cursor: pointer` | **기본값 없음.** `onClick`을 받으면 그때만 `cursor: pointer`와 `pressNow()`를 붙인다. 아무 데나 놓인 마스코트가 커서를 바꾸면 클릭 가능해 보인다 |
| `aria-hidden="true"` 고정 | `label`을 주면 `role="img" aria-label={label}`, 없으면 `aria-hidden="true"`. 아트보드는 `aria-label="매스"`를 쓰지만 **장식일 때가 많다** |
| `setExpression` / `setTalking` / `setPalette` 메서드 | `pose` / `palette` props. React 방식으로 뒤집는다 |
| `size` 기본 320 | **기본 96.** 빈 상태 3장이 96px이고 제품에서 가장 흔하다 |
| `svg.style.overflow = 'visible'` | 유지 — **타이머 버튼이 viewBox 밖으로 나간다.** 빼면 버튼이 잘린다 |

### 8-5. `prefers-reduced-motion` 처리

`character.md` §3 · design-system.md §11:

- **정지 프레임.** 깜빡임 없음, 버튼 눌림 없음, bounce 없음.
- **`dial` 줄무늬는 보이되 움직이지 않는다.** (`mascot.js`는 `dial > 0.02`일 때만 `dialPhase`를 올린다 — `reduced`면 올리지 않는다.)
- 포즈 전환 자체도 애니메이션하지 않고 **바로 목표 포즈를 그린다.**

구현 요령: `reduced === true`면 rAF 루프를 아예 돌리지 않고, `pose`가 바뀔 때 목표 포즈를 한 번 렌더한다.
`blinkT`·`pressT`를 `-1`로 고정하고 `motion = 0`으로 둔다(원본 `_render()`의 `const motion = this.reduced ? 0 : 1`과 같다).

### 8-6. props

```ts
export type MascotPose = 'idle' | 'left' | 'right' | 'squint' | 'upLeft' | 'upRight' | 'talking' | 'dial'
export type MascotPalette = 'ink' | 'coral' | 'coralCap'

interface MascotProps {
  pose?: MascotPose        // 기본 'idle'
  palette?: MascotPalette  // 기본 'ink'
  size?: number            // 기본 96
  label?: string           // 주면 role="img" aria-label, 없으면 aria-hidden
  onClick?: () => void     // 주면 버튼 눌림 1회 + cursor: pointer
  className?: string
}
```

### 8-7. 마스코트 금지 사항

`character.md` §6에서 그대로 옮긴다:

- 그라데이션 · 광택 · 그림자 · 입 · 눈썹 · 볼 없음. **2D만.**
- 구면 투영 · 원근 스케일 · 몸 회전(yaw) 없음.
- **커서 추적 없음.** 포즈는 상태 머신으로만 바꾼다.
- **`coral`(`#FF6969`)은 컬러 스터디다. 제품 화면은 `ink`만 쓴다.** `palette` prop은 두되 기본값은 `ink`.
- 타이머 버튼과 몸은 **맞닿지 않는다.** 같은 `#171717`이라 간격이 없으면 한 덩어리가 된다. 버튼을 더 밀지 않는다.
- **버튼은 얼굴 clip에 넣지 않는다.** 눈만 clip한다.
- `dial`은 **버튼 안 줄무늬만** 스크롤한다. 몸을 돌리지 않는다.
- 새 포즈를 Frame 1–6 보간으로 만들지 않는다.
- **승인 워크벤치 본문에 마스코트를 넣지 않는다.** 랜딩·인증·온보딩·빈 상태·정리 중·메시지 미리보기에만 쓴다(실측 12장).

---

## 9. 범위 밖

| 항목 | 언제 | 이유 |
|---|---|---|
| **Storybook** | **M4 종료 시점** | 컴포넌트 API가 굳기 전에 설정 비용을 치르지 않는다. 그때 CI에 `build-storybook`을 추가한다 (D-141, D-143) |
| **화면 · 페이지** | **M4부터** | M2는 토큰과 컴포넌트만이다. `src/pages/`를 건드리지 않는다 |
| **이슈 목록에 없는 컴포넌트** | 각 슬라이스에서 증분 | `Badge` `Chip` `Avatar` `Table` `Tabs`(밑줄형) `Toggle` `DropdownMenu` `ProgressBar` `Calendar` `Tooltip` 등. 값은 이 문서와 아트보드에 있으니 필요할 때 옮긴다 |
| **다크 모드** | **하지 않는다** | design-system.md §2 "라이트 모드 한 벌", §13-5 "현재 원안에 없음". 다크 램프 토큰을 만들지 않는다. `@media (prefers-color-scheme: dark)` 블록을 쓰지 않는다 |
| **1024px 미만 레이아웃** | **열린 항목** | design-system.md §10 "`<1024`: 범위 미결. 결정될 때까지 폰 화면을 그리지 않는다", §13-2. **1024–1279 구간도 M2에서 다루지 않는다** — 컴포넌트에 반응형 분기를 넣지 않는다 |
| **그림자 토큰** | — | §1-3 · §3-④ |
| **의미색 토큰** | — | §1-4 |
| **Toast Provider 배선** | **M3** | `app/providers`에 올린다. M2는 컴포넌트와 스타일만 |
| **`FormErrorPanel`(폼 상단 비필드 오류)** | **M4** | §7-3 참고 |
| **아이콘 세트** | 각 슬라이스 | design-system.md §6: 단일 세트, 1.5–1.9px 스트로크, 13–17px, 색은 인접 텍스트와 같은 잉크. **어느 라이브러리를 쓸지 아직 정하지 않았다 — 확인 필요.** 시안은 전부 인라인 SVG다 |

---

## 10. 검증

### 10-1. 명령

```bash
cd frontend
npm ci

npm run typecheck      # 오류 0
npm run lint           # 오류 0
npm run format:check   # 전부 포맷됨
npm run test           # 테스트가 0개여도 통과 (passWithNoTests)
npm run build          # dist/ 생성
```

PR을 열면 `.github/workflows/frontend-ci.yml`의 `check`와 `build`가 모두 초록이어야 한다.

### 10-2. 산출물 확인

```bash
# 폰트 4개가 나왔고 크기가 맞는가
ls -l src/shared/styles/fonts/
#   NanumSquare-Light.woff2       161888
#   NanumSquare-Regular.woff2     161356
#   NanumSquare-Bold.woff2        162996
#   NanumSquare-ExtraBold.woff2   165040

# 빌드 산출물에 woff2 가 들어갔는가
ls dist/assets/*.woff2

# preload 링크가 해시 경로로 다시 쓰였는가 (§4-5)
grep -o 'rel="preload"[^>]*' dist/index.html

# 849KB CSS 를 실수로 import 하지 않았는가 — 0건이어야 한다
grep -rn '_fonts.css' src/

# site-runtime 을 참조하지 않는가 — 0건이어야 한다
grep -rn 'site-runtime' src/

# weight 500 이 없는가 — 0건이어야 한다
grep -rn 'font-medium\|font-weight: *500\|fontWeight: *500' src/

# #000000 이 없는가 — 0건이어야 한다
grep -rni '#000000\|#000\b\|\bblack\b' src/ --include=*.tsx --include=*.css

# 토큰 밖 하드코딩 색이 없는가 — 마스코트 SVG 말고는 0건이어야 한다
grep -rn '#[0-9A-Fa-f]\{6\}' src/ --include=*.tsx

# 그림자 토큰을 만들지 않았는가 — 0건이어야 한다
grep -rn 'box-shadow\|shadow-' src/ --include=*.tsx --include=*.css

# Radix 를 배럴로 import 하지 않았는가 — 0건이어야 한다 (lint 도 잡지만 먼저 본다)
grep -rn "from 'radix-ui'" src/

# 토큰이 실제로 :root 에 나왔는가
npm run build && grep -o '\-\-color-ink:[^;]*' dist/assets/*.css
```

### 10-3. 시안과 육안 비교하는 법

캔버스 파일은 **그냥 브라우저로 열리는 정적 HTML**이다. 별도 서버가 필요 없다.

```bash
# 1) 시안을 연다 (Windows)
start frontend/docs/design/canvas/Tasks.dc.html
start frontend/docs/design/canvas/Login.dc.html
start frontend/docs/design/canvas/SetupTeam.dc.html
start frontend/docs/design/canvas/EmptyTasks.dc.html

# 2) 구현을 연다
cd frontend && npm run dev   # http://localhost:5173
```

**M2에는 페이지가 없으므로 비교용 진입점을 임시로 만든다.** `src/App.tsx`에 컴포넌트 12종을 상태별로 늘어놓은
**갤러리**를 그린다. 이건 M4의 페이지가 아니라 **M2 검증용 임시 화면**이고, M3에서 라우터를 넣을 때 지운다.
(Storybook을 M4로 미뤘기 때문에 이 자리를 대신할 것이 필요하다.)

**비교 절차**

1. 브라우저를 **1440px 폭**으로 맞춘다. 캔버스 아트보드가 그 근처로 그려져 있다.
2. 두 창을 나란히 놓고 **같은 배율(100%)** 로 본다. 캔버스 HTML은 배율 조정이 없다.
3. DevTools **Computed** 탭으로 대응되는 요소를 찍어 아래 6개를 확인한다:
   `height` · `padding` · `border-radius` · `border-color` · `background-color` · `font-size` / `font-weight`
4. **색은 눈으로 판정하지 않는다.** DevTools의 컬러 피커로 hex를 읽어 §5-1 표와 대조한다.
   `#EDEDED`와 `#EFEFEF`, `#E8E8E8`은 눈으로 구분되지 않는다.
5. **폰트가 실제로 나눔스퀘어인지** DevTools → Computed → 맨 아래 **Rendered Fonts**에서 확인한다.
   `NanumSquare`가 아니라 `Malgun Gothic`으로 나오면 `@font-face`나 preload가 틀린 것이다.
6. **weight 600이 Bold로 렌더되는지** 확인한다. 600과 700을 나란히 그렸을 때 **똑같이 보여야 정상이다.**
   600이 400처럼 보이면 `@font-face`의 `font-weight: 600 700` 범위가 빠진 것이다.

**체크 대상 (근거 파일 → 컴포넌트)**

| 아트보드 | 확인할 것 |
|---|---|
| `Foundations.dc.html` | 색 16개 스와치, 버튼 4종, 입력 2종 — 토큰이 전부 맞는지 |
| `Tasks.dc.html` | `Card variant="attention"` / `variant="pending"` / `Panel` / `Segmented` / 오류 상태 `TextField` / `Button` md |
| `Login.dc.html` | `TextField tone="auth"` / `Button size="auth"` 알약 / `Button variant="outline"` |
| `SetupTeam.dc.html` | `TextField tone="onboarding"` / `Card variant="onboarding"` / `Button size="lg-onboarding"` / 비활성 ghost |
| `SetupNotion.dc.html` | **비활성 primary 버튼** (`#F0F0F0` 면 + `#999999` 글자) |
| `Signup.dc.html` | `Checkbox` checked |
| `Settings.dc.html` | `SelectCard` 3상태 |
| `Main.dc.html` | `Modal` (카드 380px / 제목 17·700 / 스크림 0.32) |
| `EmptyTasks.dc.html` | `EmptyState` + `Mascot size={96} pose="squint"` |

**마스코트 검산**: `Mascot pose="idle" size={148}`을 렌더하고 DevTools에서 SVG 속성이
§8-3 표의 9개 숫자(`cx=120` `cy=113.91` `rx=65.69` `ry=64.01` `translate(80.78 30.79) rotate(-22)`
`width=34.82` `height=18.28` `rx=5.22` / eyeL `x=91.73 y=88.25 rx=7.39`)와 일치하는지 본다.
`Login.dc.html`의 SVG를 그대로 복사해 비교하면 확실하다.

**`prefers-reduced-motion` 확인**: DevTools → **Rendering** 패널 → `Emulate CSS media feature prefers-reduced-motion: reduce`.
마스코트가 깜빡임·버튼 눌림·bounce를 멈추고, `dial` 줄무늬가 보이되 정지해야 한다.

---

## 11. 남은 확인 필요 항목 정리

구현 중에 판단이 필요한 자리를 한 곳에 모았다. **추측으로 확정하지 말고 근거를 확인한다.**

| # | 항목 | 왜 미확정인가 | 어떻게 판정하나 |
|---|---|---|---|
| 1 | Tailwind v4 `@theme` 문법 (`--namespace-*: initial`, `--spacing: initial`, `--text-*--line-height`) | 설치할 버전의 실제 API를 확인하지 않았다 | 설치 후 문서 확인. **값은 유지하고 문법만 맞춘다** |
| 2 | Vite가 `index.html`의 `link[rel=preload][href]`를 해시 경로로 다시 쓰는가 | 빌드해 보지 않았다 | `npm run build && grep preload dist/index.html`. 안 되면 `public/fonts/`로 전환 (§4-5) |
| 3 | `Checkbox`의 unchecked · indeterminate · hover · disabled 시각 | 캔버스에 checked 한 곳뿐 | §7-5의 제안을 M4 첫 사용처에서 눈으로 확정 |
| 4 | `ErrorText` 전체 | 캔버스에 오류 메시지가 0건 | §7-3의 제안을 M4 폼에서 확정 |
| 5 | `Toast` 전체 (특히 그림자 없이 보이는가) | 캔버스에 토스트가 0건 | §7-9. M4에서 실물 확인 후 §3-④의 팝오버 예외를 적용할지 결정 |
| 6 | `Skeleton` 전체 | 캔버스에 스켈레톤이 0건 | §7-11의 제안을 M3 라우트 스켈레톤에서 확정 |
| 7 | 모든 컴포넌트의 pressed(`:active`) | 캔버스에 `:active` 0건 | M4에서 일괄 확정 |
| 8 | ~~`Button variant="primary"`의 hover~~ | **채택.** `#666666` / 흰 글자. 기본 버튼은 `#C9C9C9` / 먹 글자 | design-system.md §7-6 |
| 9 | **키보드 포커스 표시가 없다 — 최우선** | `outline` 배제만 정하고 대체 표현을 안 정했다. 탭 이동 시 화면 변화 0 (§6-4) | **M4 화면 작업 전 필수.** `WCAG 2.2 AA` SC 2.4.7 미충족. 후보는 `docs/impl-decision/2026-09-16-focus-ring-not-ink.md` |
| 10 | 필수 미입력칸의 **먹 경계** | design-system.md §7-7이 "먹 또는 `#FF6969`"라 하는데 먹 사례가 캔버스에 없다 | M4 첫 사례에서 정한다 |
| 11 | `Tasks` 카드 안 입력의 12px/13px vs 표준 13px/13.5px | Foundations 샘플과 `Tasks` 실물이 1px씩 다르다 (§3-⑩) | M4에서 3열 그리드를 실제로 짜고 결정 |
| 12 | `Modal`에 닫기 X 버튼을 넣을지 | 시안에 X가 없다 | M4에서 결정 |
| 13 | 아이콘 라이브러리 | 아직 고르지 않았다. 시안은 전부 인라인 SVG | design-system.md §6 조건(1.5–1.9px 스트로크, 13–17px, 단일 세트)에 맞는 것을 M4 전에 고른다 |
| 14 | ~~포커스 링 문서 갱신~~ | **반영함.** design-system.md v0.4 §3-3 · §7-6 · §7-12 · §13-1 | — |

---

## 12. 다음

M3 — 앱 셸 · 라우팅 · 데이터 계층. 별도 이슈로 진행한다.
M2가 만든 토큰과 컴포넌트 위에 `app/providers` · `app/router`가 올라간다.
