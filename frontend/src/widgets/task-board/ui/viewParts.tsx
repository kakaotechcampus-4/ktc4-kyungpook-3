import type { ReactNode } from 'react'
import { Icon } from '@/shared/ui/icon'

/** 담당자 이니셜 원 — 시안의 20/21px 원. 이름이 없으면 `?` */
export function Avatar({
  name,
  size = 20,
  muted = false,
}: {
  name: string | null
  size?: 20 | 21
  muted?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-999 bg-divider text-[9.5px] leading-none font-semibold ${
        size === 21 ? 'h-[21px] w-[21px]' : 'h-20 w-20'
      } ${muted ? 'text-dim' : 'text-ink'}`}
    >
      {name === null ? '?' : [...name][0]}
    </span>
  )
}

const NAV_BUTTON =
  'inline-flex h-30 w-30 items-center justify-center rounded-9 bg-control text-ink hover:bg-line-strong'

/** 캘린더·간트 머리 — 제목과 이전·다음 버튼, 오른쪽에 범례 */
export function RangeHeader({
  title,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  legend,
}: {
  title: string
  prevLabel: string
  nextLabel: string
  onPrev: () => void
  onNext: () => void
  legend: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-16">
      <div className="flex items-center gap-12">
        <h2 className="text-[19px] leading-[1.55] font-bold tracking-h2 text-ink">{title}</h2>
        <div className="flex items-center gap-4">
          <button type="button" aria-label={prevLabel} className={NAV_BUTTON} onClick={onPrev}>
            <Icon name="chevron-left" size={14} />
          </button>
          <button type="button" aria-label={nextLabel} className={NAV_BUTTON} onClick={onNext}>
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-16" aria-label="범례">
        {legend}
      </ul>
    </div>
  )
}

/** 범례 한 칸 — 20×12 색 칩과 이름 */
export function LegendItem({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-7 text-[12px] text-sub">
      <span aria-hidden="true" className={`h-12 w-20 rounded-4 ${swatch}`} />
      {children}
    </li>
  )
}
