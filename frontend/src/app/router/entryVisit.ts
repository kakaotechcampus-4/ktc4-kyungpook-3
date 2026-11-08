import { createContext, use } from 'react'

/**
 * 이 문서가 처음 그린 주소 (#510). 주소 입력·북마크·외부 링크·새로고침으로 들어온 자리다 — 앱 안 이동은 새 key 를 받는다.
 * returning 은 그때 전체 스플래시 기록이 있었는지다(서비스를 써 본 브라우저). 들어온 뒤에 생긴 기록은 보지 않는다 —
 * 처음 온 사람이 랜딩 `시작하기` 로 기록을 남기고 뒤로 가기로 랜딩에 돌아와도 랜딩이 그대로다
 */
export interface EntryVisit {
  key: string
  returning: boolean
}

export const EntryVisitContext = createContext<EntryVisit | null>(null)

export function useEntryVisit(): EntryVisit | null {
  return use(EntryVisitContext)
}
