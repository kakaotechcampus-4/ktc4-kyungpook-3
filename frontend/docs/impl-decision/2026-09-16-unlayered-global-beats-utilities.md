# global.css 가 레이어 밖이라 유틸리티를 이긴다 — 줄 높이·자간이 조용히 전역값으로 돌아간다

- 날짜: 2026-09-16
- 상태: 결정 — `global.css` 를 `@layer base` 로 감쌌다

## 고민

`EmptyState` 제목은 §7-10 실측이 `line-height: 1.35` · `letter-spacing: -0.035em` 이다.
유틸리티를 붙였는데 **전역 `h1` 값(1.4 · -0.045em)이 그대로 나온다.**

`index.css` 의 import 순서를 보면 `global.css` 가 나중이다.

```
@import 'tailwindcss';
@import './fonts.css';
@import './tokens.css';
@import './global.css';
```

그래서 "나중에 온 쪽이 이겼나" 싶었는데 **순서 문제가 아니다.**

## 원인 — 레이어 밖 선언은 레이어 안 선언을 무조건 이긴다

`@import 'tailwindcss'` 는 `theme` · `base` · `components` · `utilities` 네 개의 캐스케이드 레이어를 깐다.
모든 유틸리티는 `@layer utilities` 안에 들어간다.

`global.css` 에는 `@layer` 가 한 줄도 없다. 그래서 그 규칙들은 **레이어 밖**이다.
캐스케이드 규칙상 레이어 밖의 일반 선언은 **어떤 레이어의 일반 선언보다도 우선한다.** 특이도와 무관하다.

산출 CSS 로 확인한다. 중괄호 깊이가 0 이면 레이어 밖이다.

```bash
npm run build
node -e "const c=require('fs').readFileSync(process.argv[1],'utf8');const i=c.indexOf('h1{letter-spacing');let d=0;for(let k=0;k<i;k++){const ch=c[k];if(ch==='{')d++;else if(ch==='}')d--;}console.log('depth',d)" dist/assets/*.css
# depth 0
```

문제를 내는 전역 규칙은 셋이다.

```
h1      letter-spacing -0.045em · font-weight 700 · line-height 1.4
h2, h3  letter-spacing -0.025em · font-weight 700 · line-height 1.55
p       line-height 1.85
```

**빌드도 타입도 린트도 통과한다. 화면의 숫자만 틀린다.** `2026-09-16-values-outside-token-scale.md` 의
"클래스가 CSS 에 없을 뿐이다"와 증상이 똑같아서, 한 번 더 속기 쉽다. 이쪽은 클래스가 **있는데도** 진다.

## 고른 길

**`global.css` 전체를 `@layer base` 로 감쌌다.** 유틸이 전역 `button`/`h1`/`p` 를 이긴다.
주 버튼 `text-surface` 가 `color: inherit` 에 지지 않는다. EmptyState 의 `!` 는 제거했다.

이전 우회(기록):

```
text-[24px] leading-[1.35]! font-bold tracking-[-0.035em]! text-ink
text-[14px] leading-[1.8]! font-normal text-sub
```

`!` 가 붙은 선언은 레이어 안에 있어도 레이어 밖의 일반 선언을 이긴다. 확인한 산출 CSS 는 이렇다.

```
.leading-\[1\.35\]\!{--tw-leading:1.35!important;line-height:1.35!important}
.tracking-\[-0\.035em\]\!{--tw-tracking:-.035em!important;letter-spacing:-.035em!important}
.leading-\[1\.8\]\!{--tw-leading:1.8!important;line-height:1.8!important}
```

**`!` 는 전역이 실제로 거는 속성에만 붙인다.** 크기·색·굵기에는 안 붙였다.
전역에 경쟁 선언이 없어서 그냥 이기고, 안 붙이면 어디가 충돌 지점인지 코드에 남는다.

> 위 세 클래스는 **글에 적기 전에** 산출 CSS 에서 확인했다.
> `2026-09-16-tailwind-scans-docs-markdown.md` 가 경고한 순서를 지켰다 — 글이 근거를 만들면 안 된다.

## 왜 다른 길을 안 골랐나

**`global.css` 를 `@layer base` 로 감싸는 길** — 이게 진짜 고침이다. 감싸면 유틸리티가 자연히 이기고
`!` 가 전부 사라진다. **T0 소유 파일이라 이번 조각에서 손대지 않는다.** 아래 "다시 고민할 때"로 넘긴다.

**인라인 스타일** — 레이어 밖도 이긴다. 하지만 이 저장소의 모든 컴포넌트가 클래스 배열로 스타일을 낸다.
한 컴포넌트만 `style` 로 빠지면 테스트도 다음 사람도 그 자리만 다르게 봐야 한다.

**실측을 포기하고 전역값(1.4 · -0.045em)을 받는 길** — 1.35 와 1.4 는 24px 에서 1.2px 차이다.
작지만 §10-3 의 육안 비교가 그 차이를 보라고 만든 절차다. 실측을 적어 놓고 안 내보내면 표가 거짓말이 된다.

## 이미 걸려 있는 자리 — 고치지 않았다

같은 이유로 **T1–T5 컴포넌트 중 이미 값이 덮이고 있는 곳**이 있다. 이번 조각은 그 파일들을 import 만 한다.

| 자리 | 스펙 값 | 실제로 나가는 값 | 이유 |
|---|---|---|---|
| `Modal` 제목 (`tracking-h3`) | -0.02em | -0.025em | 전역 `h2, h3` |
| `Modal` 설명 (`text-body`) | 1.7 | 1.85 | 전역 `p` |
| `ErrorText` (`text-[12px]`) | — | 1.85 | 전역 `p` |
| `TextField` 보조 문구 (`text-[12px]`) | — | 1.85 | 전역 `p` |

`Modal` 제목의 자간은 `2026-09-16-modal-title-17px.md` 가 "실측 -0.02em 이 `--tracking-h3` 과 정확히 같다"며
**스케일 밖인 부분이 크기 하나뿐**이라고 적었다. 그 문장은 토큰 값에 대해서는 맞다.
**화면에 나가는 값에 대해서는 틀렸다** — 전역 `h2, h3` 가 -0.025em 으로 덮는다.

`ErrorText` · `TextField` 보조 문구는 스펙에 줄 높이가 없어서 "틀렸다"고 말할 수 없다.
다만 **크기 토큰이 물고 오는 줄 높이가 아니라 전역 1.85 가 나간다**는 사실은 같다.

## 다시 고민할 때

`global.css` 를 `@layer base { ... }` 로 감쌀지 정한다. 감싸면:

- `EmptyState` 의 `!` 두 개가 필요 없어진다.
- 위 표의 네 자리가 스펙 값으로 돌아온다.
- **전역을 믿고 있던 자리가 같이 움직인다.** 지금 `h1` 한 줄에 기대어 굵기 700 을 안 적은 곳이 있다면 거기가 풀린다.

그래서 감싸는 작업은 **감싼 뒤 전체 화면을 한 번 훑는 것까지가 한 덩어리**다.
T0 담당이 M3 에서 `app/providers` 와 라우터를 올릴 때 같이 보는 편이 맞다.
