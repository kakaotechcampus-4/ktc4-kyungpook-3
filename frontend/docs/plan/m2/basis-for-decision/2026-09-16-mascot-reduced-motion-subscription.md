# 마스코트의 `prefers-reduced-motion` 구독을 어디에 둘 것인가

- 날짜: 2026-09-16
- 상태: 결정

## 고민

§8-4 는 "생성자에서 한 번 읽음"을 **구독**으로 바꾸라고 한다. 곧이곧대로 쓰면 이렇게 된다.

```tsx
const [reduced, setReduced] = useState(prefersReducedMotion)

useEffect(() => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  setReduced(query.matches) // ← 마운트 시점에 한 번 맞춘다
  query.addEventListener('change', handleChange)
  return () => query.removeEventListener('change', handleChange)
}, [])
```

이 모양이 `react-hooks/set-state-in-effect` 에 걸린다. 규칙이 옳다 — 이펙트 본문의 `setState` 는
첫 마운트마다 렌더를 한 번 더 부른다. 그런데 그 줄을 지우면 **렌더와 이펙트 사이에 설정이 바뀐 경우를 놓친다.**

§8-5 가 요구하는 "줄이기면 목표 포즈를 한 번 렌더" 도 같은 벽에 부딪힌다.
이펙트에서 `setFrame(stillFrame(target))` 을 부르는 게 가장 짧은 길인데, 같은 규칙에 걸린다.

## 고른 길

**둘 다 상태에서 뺀다.**

1. 줄이기 여부는 `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` 로 읽는다.
   구독·해제·첫 스냅샷이 한 자리에 모이고, 렌더 시점에 스냅샷을 직접 읽으니 어긋날 틈이 없다.
2. 줄이기일 때 그리는 프레임은 **렌더에서 유도한다.** 상태에 넣지 않는다.

```tsx
const frame = reduced ? stillFrame(POSES[pose]) : animated
```

rAF 루프는 그대로 `useEffect` 안에 있고, 정리에서 `cancelAnimationFrame` 한다.
matchMedia 리스너 해제는 `subscribe` 가 돌려주는 함수가 한다 — 언마운트에서 React 가 부른다.

## 왜

- `reduced` 는 React 가 소유한 상태가 아니라 **바깥 스토어**다. 스토어를 상태로 베껴 두면
  베낀 값을 언제 맞출지가 늘 문제가 된다. `useSyncExternalStore` 가 정확히 그 문제를 없애려고 있는 훅이다.
- 줄이기 화면의 프레임은 `pose` 만의 함수다. 함수인 값을 상태에 넣으면 두 출처가 생긴다.

## 남은 틈

OS 설정을 **켰다가 다시 끄면**, 루프가 다시 돌기 전 한 프레임(≤16ms) 동안 이전 보간 프레임이 보인다.
루프 첫 프레임이 곧바로 목표 포즈를 덮으므로 눈에 띄지 않는다.
없애려면 이펙트에서 `setState` 를 해야 해서 그대로 둔다.

## 테스트가 이걸 어떻게 보나

`jsdom` 에는 `matchMedia` 가 **아예 없다**(`typeof window.matchMedia === 'undefined'`).
그래서 컴포넌트가 `typeof` 로 막고, `Mascot.test.tsx` 가 자기 안에서만 대역을 세운다.
`src/shared/test/setup.ts` 는 T0 소유라 손대지 않았다.

## 다시 고민할 때

줄이기를 읽는 컴포넌트가 **둘 이상**이 되면 `subscribe`/`getSnapshot` 을 `shared/lib` 의 훅으로 옮긴다.
지금은 마스코트 하나다.
