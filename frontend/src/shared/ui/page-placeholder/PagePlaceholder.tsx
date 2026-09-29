import type { ReactNode } from 'react'

export interface PagePlaceholderProps {
  title: string
  description?: string
  children?: ReactNode
}

const PAGE = 'mx-auto flex max-w-column flex-col gap-14 px-24 py-48'

/* 제목은 EmptyState 제목과 같은 단이다 — docs/impl-decision/2026-09-16-empty-state-title-24px.md */
const TITLE = 'text-[24px] leading-[1.35] font-bold tracking-[-0.035em] text-ink'

const DESCRIPTION = 'text-body text-sub'

/**
 * M3 최소 화면의 틀. 제목·설명·본문 칸만 그린다. 실제 화면은 M4 이후에 이 틀을 걷어 낸다.
 * 문구는 호출자가 준다.
 */
export function PagePlaceholder({ title, description, children }: PagePlaceholderProps) {
  return (
    <main className={PAGE}>
      <h1 className={TITLE}>{title}</h1>
      {description === undefined ? null : <p className={DESCRIPTION}>{description}</p>}
      {children}
    </main>
  )
}
