import type { ReactNode } from 'react'
import { SECTION, SECTION_HEAD, SECTION_LEAD, SECTION_TITLE } from './settingsStyles'

export interface SettingsSectionProps {
  /** 왼쪽 목차가 옮겨 가는 곳. 제목에 포커스를 둔다 */
  id: string
  title: string
  description?: string
  children: ReactNode
}

/** 설정의 절 하나 — 제목·설명 머리와 본문 (Settings 캔버스) */
export function SettingsSection({ id, title, description, children }: SettingsSectionProps) {
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} className={SECTION}>
      <div className={SECTION_HEAD}>
        <h2 id={headingId} tabIndex={-1} className={SECTION_TITLE}>
          {title}
        </h2>
        {description === undefined ? null : <p className={SECTION_LEAD}>{description}</p>}
      </div>
      {children}
    </section>
  )
}
