import { useLayoutEffect } from 'react'

/*
 * 스플래시와 앱 사이의 신호 (#430). 스플래시는 app 층에만 있고, 앱은 이 두 가지만 알린다.
 * - 잡기(hold): 첫 화면이 아직 아니다. 라우트 뼈대가 그려져 있는 동안 잡는다. 0이 되면 첫 화면이 준비된 것이다.
 * - 띄우기(show): 이 탭에서 방금 로그인했다, 또는 랜딩 `시작하기` 를 눌렀다(#510). 스플래시가 없는 곳(테스트의 renderApp)에서는
 *   듣는 쪽이 없어 아무 일도 없다.
 */

/** session: 로그인·가입 직후 공간 확인. start: 랜딩 `시작하기` → 로그인 (#510) */
export type SplashShowKind = 'session' | 'start'

type HoldListener = () => void
type ShowListener = (startedAt: number, kind: SplashShowKind) => void

let holds = 0
const holdListeners = new Set<HoldListener>()
const showListeners = new Set<ShowListener>()

function setHolds(next: number): void {
  holds = next
  for (const listener of holdListeners) listener()
}

/** 첫 화면이 아니라고 잡는다. 돌려받은 함수로 놓는다. 여러 번 불러도 한 번만 놓는다 */
export function holdSplash(): () => void {
  setHolds(holds + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    setHolds(holds - 1)
  }
}

/** 그려져 있는 동안 잡는다. layout effect 라 같은 커밋 안에서 놓고 잡아 0을 거치는 순간이 화면에 나오지 않는다 */
export function useSplashHold(): void {
  useLayoutEffect(() => holdSplash(), [])
}

export function getSplashHoldCount(): number {
  return holds
}

export function subscribeSplashHolds(listener: HoldListener): () => void {
  holdListeners.add(listener)
  return () => {
    holdListeners.delete(listener)
  }
}

/** 스플래시를 띄우고 놓을 때까지 잡는다. 로그인·가입 직후 세션·공간 확인을 덮는다 */
export function showSplash(): () => void {
  const release = holdSplash()
  const startedAt = performance.now()
  for (const listener of showListeners) listener(startedAt, 'session')
  return release
}

/**
 * 랜딩 `시작하기` 로 로그인에 가는 동안 스플래시를 띄운다 (#510). 기다릴 로딩이 거의 없어 짧게 돌고 누르면 건너뛴다.
 * 잡지 않는다 — 로그인 화면 코드를 기다리는 동안은 그 화면의 뼈대가 잡는다
 */
export function showStartSplash(): void {
  const startedAt = performance.now()
  for (const listener of showListeners) listener(startedAt, 'start')
}

export function onSplashShow(listener: ShowListener): () => void {
  showListeners.add(listener)
  return () => {
    showListeners.delete(listener)
  }
}
