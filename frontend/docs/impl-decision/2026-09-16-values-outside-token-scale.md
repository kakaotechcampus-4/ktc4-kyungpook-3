# 스펙 실측값이 토큰 스케일 밖일 때 — 토큰을 늘릴 것인가 임의값을 쓸 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

`m2-design-tokens.md` §7-1·7-2·7-3 의 표는 실측값을 **그대로** 적는다. 그런데 그중 몇 개가 `tokens.css` 에 없다.

| 스펙이 요구하는 값 | 쓰는 곳 | 스케일에 있는 이웃 |
|---|---|---|
| 글자 12px | `Label` product·onboarding, `ErrorText`, `TextField` 의 description | 11.5(`text-meta`) · 12.5(`text-caption`) |
| 글자 13px | `Label` auth | 12.5(`text-caption`) · 13(`text-control`) |
| 글자 14.5px | `Button` `xl` (`Upload` 의 `정리 시작하기`) | 13.5(`text-body`) · 16(`text-landing`) |
| 글자 15px | `Button` `auth`·`landing-nav`, `TextField` auth | 13.5(`text-body`) · 16(`text-landing`) |
| 높이 38px | `Button` `landing-nav` | 36(`--spacing-36`) · 40(`--spacing-40`) |
| 높이 42px | `TextField` product·onboarding | 40(`--spacing-40`) · 44(`--spacing-44`) |

세 갈래가 있었다.

1. 토큰을 늘린다 — `--text-xl: 14.5px`, `--spacing-38: 38px` …
2. 가장 가까운 토큰으로 반올림한다 — 14.5 → `text-body`(13.5), 38 → `h-40`
3. 그 자리에만 임의값을 쓴다 — `text-[14.5px]`, `h-[38px]`

## 고른 길

**3번.** 토큰은 건드리지 않고, 표에 적힌 px 를 임의값으로 그 자리에 쓴다.

`text-[12px]` · `text-[13px]` · `text-[14.5px]` · `text-[15px]` · `h-[38px]` · `h-[42px]`

## 왜

**1번을 안 하는 이유** — 토큰 표는 "아트보드 22장에서 3회 이상"이라는 기준으로 추린 것이다.
`14.5px` 는 `Upload` 한 화면의 버튼 하나, `38px` 는 `Landing` 헤더 하나다. 한 번 쓰이는 값을 토큰에 올리면
"토큰 = 여러 곳에서 되풀이되는 값"이라는 기준이 무너지고, 다음 사람이 `text-xl` 을 일반적인 큰 글자로 착각해 가져다 쓴다.
`m2-design-tokens.md` §1 도 토큰 추가를 이번 범위에서 막는다.

**2번을 안 하는 이유** — 그 표는 실측이다. 반올림하면 시안과 육안 비교(§10-3)가 의미를 잃는다.
`12px` 는 특히 `Label` 4개 화면군 전부와 `ErrorText` 가 쓰는 값이라 반올림 오차가 화면 전체에 퍼진다.

**임의값이 토큰 체계를 깨지 않는 이유** — 임의값은 유틸 이름에 px 를 그대로 드러낸다.
`text-[14.5px]` 를 본 사람은 "여기는 스케일 밖이다"를 바로 안다. `text-xl` 은 그걸 숨긴다.
§5-7 이 제품 입력을 이미 `h-[42px]` 로 적어 둔 것도 같은 판단이다.

## 딸린 함정 — `--spacing` 이 비어 있어서 없는 유틸

`tokens.css` 가 `--spacing: initial` 로 **동적 간격 스케일을 껐다**. 이름 있는 `--spacing-N` 만 유틸이 된다.
그래서 이런 것들이 **생성되지 않는다**:

- `p-0` · `m-0` · `min-w-0` · `gap-0` — `--spacing-0` 이 없다
- 표에 없는 값 전부 — `px-17`, `h-38` …

빌드해도 오류가 나지 않고 타입·린트·테스트도 통과한다. **그 클래스가 CSS 에 없을 뿐이다.**

- `min-width: 0` 이 필요하면 `min-w-[0px]` 을 쓴다 (`TextField` 의 adornment 래퍼 안 입력).
- `padding: 0` 은 유틸이 필요 없다. preflight 의 `*{padding:0}` 이 이미 지운다.

확인하는 법 — `npm run build` 후 산출 CSS 에 그 선택자가 실제로 있는지 본다.

```bash
npm run build
grep -o 'min-w-\\\[0px\\\]' dist/assets/*.css
```

## 다시 고민할 때

같은 px 가 **다른 화면군 3곳 이상**에서 나오면 그때 토큰으로 올린다.
지금 후보는 `15px` 하나다 — 인증 입력 · 인증 버튼 · 랜딩 내비 버튼에서 이미 3회 쓰인다.
M4 에서 인증·랜딩을 실제로 그릴 때 `--text-input-lg: 15px` 로 올릴지 정한다.
