import { useLayoutEffect, useSyncExternalStore } from 'react'

/*
 * 스플래시와 앱 사이의 신호 (#430). 스플래시는 app 층에만 있고, 앱은 이 두 가지만 알린다.
 * - 잡기(hold): 첫 화면이 아직 아니다. 라우트 뼈대가 그려져 있는 동안 잡는다. 0이 되면 첫 화면이 준비된 것이다.
 * - 띄우기(show): 이 탭에서 방금 로그인했다. 스플래시가 없는 곳(테스트의 renderApp)에서는 듣는 쪽이 없어 아무 일도 없다.
 * 거꾸로 스플래시는 화면을 덮고 있는지(covering)만 알린다. 스플래시가 없는 곳에서는 늘 덮지 않는다.
 */

type HoldListener = () => void
type ShowListener = (startedAt: number) => void

let holds = 0
const holdListeners = new Set<HoldListener>()
const showListeners = new Set<ShowListener>()
let covering = false
const coveringListeners = new Set<() => void>()

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
  for (const listener of showListeners) listener(startedAt)
  return release
}

export function onSplashShow(listener: ShowListener): () => void {
  showListeners.add(listener)
  return () => {
    showListeners.delete(listener)
  }
}

/** 스플래시가 그려져 있는 동안(사라지는 중 포함) 켠다. 스플래시만 부른다 */
export function setSplashCovering(next: boolean): void {
  covering = next
  for (const listener of coveringListeners) listener()
}

function subscribeSplashCovering(listener: () => void): () => void {
  coveringListeners.add(listener)
  return () => {
    coveringListeners.delete(listener)
  }
}

/**
 * 스플래시가 화면을 덮고 있는가. 앱의 대화상자는 body 아래 Portal 이라 스플래시가 inert 로 막는 #root 밖이다.
 * 덮는 동안 열면 보이지 않는 대화상자에 포커스가 가고 Enter 로 닫혀 본 적 없는 것을 본 것으로 기록한다
 */
export function useSplashCovering(): boolean {
  return useSyncExternalStore(
    subscribeSplashCovering,
    () => covering,
    () => false,
  )
}
