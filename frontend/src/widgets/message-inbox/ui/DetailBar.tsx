import type { ReactNode } from 'react'

/* PwaThreadMember 머리 — 셸 헤더를 걷은 자리라 위 안전 영역 아래에 56, 좌우 8, 44 칸 셋(뒤로 · 제목 · 빈 칸), 아래 선.
   제목·부제는 한 줄 말줄임이다 */
const BAR =
  'grid h-[calc(56px+env(safe-area-inset-top))] shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center border-b border-divider bg-surface pt-[env(safe-area-inset-top)] pr-[max(8px,env(safe-area-inset-right))] pl-[max(8px,env(safe-area-inset-left))]'
const TITLE = 'truncate text-[16px] leading-[1.4] font-semibold text-ink'
const SUBTITLE = 'truncate text-[12px] leading-[1.4] text-dim'

/** 휴대폰에서 화면 전체로 연 상세의 머리 (H-5). 뒤로 가기는 부르는 쪽이 정한다 — 목록으로 돌아가는 방법이 화면마다 같다 */
export function DetailBar({
  back,
  title,
  subtitle,
  titleAs: Title,
  titleRef,
}: {
  back: ReactNode
  title: string
  subtitle: string | null
  /** 대화는 이 제목이 대화의 제목(h2)이다. 다른 상세는 본문에 자기 제목이 있어 글자로만 둔다 */
  titleAs: 'h2' | 'p'
  /** 목록에서 상세로 들어올 때 화면이 포커스를 둘 자리 */
  titleRef: (element: HTMLElement | null) => void
}) {
  return (
    <div className={BAR}>
      {back}
      <div className="flex min-w-[0px] flex-col items-center text-center">
        <Title ref={titleRef} tabIndex={-1} className={TITLE}>
          {title}
        </Title>
        {subtitle === null ? null : <p className={SUBTITLE}>{subtitle}</p>}
      </div>
    </div>
  )
}
