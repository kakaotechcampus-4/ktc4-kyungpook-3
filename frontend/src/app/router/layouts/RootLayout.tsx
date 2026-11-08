import { useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { hasSplashRecord } from '@/shared/lib/splash'
import { UnsavedChangesPrompt } from '../UnsavedChangesPrompt'
import { EntryVisitContext } from '../entryVisit'
import type { EntryVisit } from '../entryVisit'

/** 앱 전체의 바깥 칸. 이탈 확인 모달은 여기 하나만 둔다. 처음 그린 주소(바깥에서 들어온 자리)를 기억한다 (#510) */
export function RootLayout() {
  const { key } = useLocation()
  const [entry] = useState<EntryVisit>(() => ({ key, returning: hasSplashRecord() }))
  return (
    <EntryVisitContext value={entry}>
      <Outlet />
      <UnsavedChangesPrompt />
    </EntryVisitContext>
  )
}
