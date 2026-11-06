import { useState } from 'react'

/*
 * 진행 토스트를 접어 둔 기록 (#424). 이 기기에 하나 둔다 — 계정·공간과 상관없다.
 * 막힌 저장소(사생활 모드 등)에서는 기록이 없는 것으로 보고, 쓰기는 조용히 넘어간다 — 이 화면에서는 고른 대로 보인다
 */

const KEY = 'meeting-processing-toast-collapsed'

/** 휴대폰 폭. 기록이 없으면 접힌 알약으로 시작한다 */
const NARROW = '(max-width: 639px)'

function readCollapsed(): boolean | null {
  try {
    const stored = window.localStorage.getItem(KEY)
    return stored === null ? null : stored === 'true'
  } catch {
    return null
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, String(collapsed))
  } catch {
    // 기록하지 못해도 지금 토스트는 고른 대로 보인다
  }
}

function isNarrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches
}

export function useCollapsePreference(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => readCollapsed() ?? isNarrow())
  return [
    collapsed,
    (next) => {
      writeCollapsed(next)
      setCollapsed(next)
    },
  ]
}
