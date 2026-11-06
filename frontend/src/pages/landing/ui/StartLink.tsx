import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { isDeviceIntroSeen, markDeviceIntroSeen } from '@/entities/user'
import { GuardedLink, useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { FirstVisitIntro } from '@/widgets/first-visit-intro'

/**
 * 로그인·가입으로 가는 랜딩 링크. 이 기기에서 처음 누르면 매스 인트로를 먼저 보이고, 닫으면 원래 가던 곳으로 간다 (#430).
 * 랜딩을 열 때는 아무것도 덮지 않는다 — 저장소가 없는 검색 크롤러에게는 매번 첫 방문이라, 열자마자 덮으면 전면 가림막이 된다.
 * 새 탭 열기(보조 키·가운데 버튼)는 가로채지 않는다
 */
export function StartLink({
  to,
  className,
  children,
}: {
  to: string
  className: string
  children: ReactNode
}) {
  const navigate = useGuardedNavigate()
  const [introOpen, setIntroOpen] = useState(false)

  const interceptFirstClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event) || isDeviceIntroSeen()) return
    event.preventDefault()
    setIntroOpen(true)
  }

  return (
    <>
      <GuardedLink to={to} className={className} onClick={interceptFirstClick}>
        {children}
      </GuardedLink>
      <FirstVisitIntro
        open={introOpen}
        onClose={() => {
          markDeviceIntroSeen()
          setIntroOpen(false)
          navigate(to)
        }}
      />
    </>
  )
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
}
