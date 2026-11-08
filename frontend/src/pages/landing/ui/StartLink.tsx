import type { MouseEvent, ReactNode } from 'react'
import { paths } from '@/shared/config/routes'
import { isSplashDue, showStartSplash } from '@/shared/lib/splash'
import { GuardedLink } from '@/shared/lib/unsaved-changes'

/**
 * 랜딩의 `시작하기` → 로그인 (D-003). 전체 스플래시를 보일 차례면(12시간 규칙) 로그인으로 가며 스플래시를 띄운다 (#510).
 * 링크는 그대로 `<a href>` 이고 새 탭 열기(보조 키·가운데 버튼)는 가로채지 않는다 — 새 탭은 새로 접속이라 그쪽 규칙을 따른다
 */
export function StartLink({ className, children }: { className: string; children: ReactNode }) {
  const startSplash = (event: MouseEvent<HTMLAnchorElement>) => {
    if (isPlainClick(event) && isSplashDue()) showStartSplash()
  }
  return (
    <GuardedLink to={paths.login()} className={className} onClick={startSplash}>
      {children}
    </GuardedLink>
  )
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
}
