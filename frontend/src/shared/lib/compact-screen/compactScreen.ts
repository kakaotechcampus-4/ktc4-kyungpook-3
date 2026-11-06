import { useLayoutEffect, useSyncExternalStore } from 'react'

/* Tailwind `md`(768px) 아래와 같은 경계다 (D-180) */
const COMPACT_QUERY = '(max-width: 767.98px)'

function subscribeCompact(onChange: () => void): () => void {
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * 폭 768px 미만이면 휴대폰 배치다 — 셸은 줄인 헤더와 아래 탭 막대를, 화면은 한 열 배치를 그린다.
 * 첫 그림부터 맞는 배치를 그리고, 폭이 바뀌면 바로 바꾼다
 */
export function useCompactScreen(): boolean {
  return useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  )
}

/*
 * 화면이 셸의 위 헤더와 아래 탭 막대를 걷어 내는 신호 (#478). 휴대폰의 메시지 상세처럼 화면 전체를 쓰는 곳이
 * 맨 위에 자기 머리(뒤로 가기 · 제목)를 둔다(PwaThreadMember). 셸(WorkspaceLayout)만 듣는다.
 * 건 수를 세므로 같은 화면이 두 번 걸고 풀어도(StrictMode) 마지막 상태로 모인다
 */
let chromeHolds = 0
const chromeListeners = new Set<() => void>()

function setChromeHolds(next: number): void {
  chromeHolds = next
  for (const listener of chromeListeners) listener()
}

function subscribeChrome(onChange: () => void): () => void {
  chromeListeners.add(onChange)
  return () => chromeListeners.delete(onChange)
}

/** hidden 인 동안 셸의 위 헤더와 아래 탭 막대를 걷는다. 화면이 내려가면 돌려놓는다 */
export function useHideShellChrome(hidden: boolean): void {
  useLayoutEffect(() => {
    if (!hidden) return
    setChromeHolds(chromeHolds + 1)
    return () => setChromeHolds(chromeHolds - 1)
  }, [hidden])
}

/** 어느 화면이 셸의 헤더·탭 막대를 걷어 냈는가 */
export function useShellChromeHidden(): boolean {
  return useSyncExternalStore(
    subscribeChrome,
    () => chromeHolds > 0,
    () => false,
  )
}
