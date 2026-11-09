import { useLayoutEffect, useState, useSyncExternalStore } from 'react'

/* Tailwind `md`(768px) 아래와 같은 경계다 (D-180) */
export const COMPACT_QUERY = '(max-width: 767.98px)'

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

/*
 * 가상 키보드가 가린 뒤 실제로 보이는 영역 (#478). Chrome 은 viewport 의 `interactive-widget=resizes-content` 로
 * 레이아웃 높이(`dvh`)가 함께 줄지만, iOS Safari 는 보이는 영역(visualViewport)만 줄이고 화면을 밀어 올린다.
 * 그 차이가 있을 때만 값을 준다 — 화면 전체를 쓰는 상세가 이 높이와 위치에 맞춰 답장 줄을 키보드 위에 둔다
 */
export interface VisibleViewport {
  height: number
  top: number
}

function readVisibleViewport(): VisibleViewport | null {
  const viewport = window.visualViewport
  if (viewport == null || viewport.height >= window.innerHeight - 1) return null
  return { height: Math.round(viewport.height), top: Math.round(viewport.offsetTop) }
}

/** active 인 동안 키보드가 줄인 보이는 영역을 따른다. 줄지 않았으면 null 이다 */
export function useVisibleViewport(active: boolean): VisibleViewport | null {
  const [box, setBox] = useState<VisibleViewport | null>(null)
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    if (!active || viewport == null) return
    const update = () =>
      setBox((current) => {
        const next = readVisibleViewport()
        if (current?.height === next?.height && current?.top === next?.top) return current
        return next
      })
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [active])
  return active ? box : null
}

/** 어느 화면이 셸의 헤더·탭 막대를 걷어 냈는가 */
export function useShellChromeHidden(): boolean {
  return useSyncExternalStore(
    subscribeChrome,
    () => chromeHolds > 0,
    () => false,
  )
}
