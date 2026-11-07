import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '@/shared/ui/icon'
import type { IconName } from '@/shared/ui/icon'

/* 이름을 모르면 채우지 않은 점선 원에 `?` 다 — 시안의 `미지정` 원 (TasksGantt: 1px 점선 #BDBDBD, 10px #666) */
const AVATAR_KNOWN = 'bg-divider text-[9.5px] font-semibold'
const AVATAR_UNKNOWN = 'border border-dashed bg-transparent text-[10px] text-dim'

/** 담당자 이니셜 원 — 시안의 20/21px 원. 이름이 없으면 점선 원에 `?` */
export function Avatar({
  name,
  size = 20,
  muted = false,
}: {
  name: string | null
  size?: 20 | 21
  muted?: boolean
}) {
  const tone = name === null ? AVATAR_UNKNOWN : `${AVATAR_KNOWN} ${muted ? 'text-dim' : 'text-ink'}`
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-999 leading-none ${
        size === 21 ? 'h-[21px] w-[21px]' : 'h-20 w-20'
      } ${tone}`}
    >
      {name === null ? '?' : [...name][0]}
    </span>
  )
}

/* 날짜 이동 — 시안 `width 30; height 30; min-height 36` 이라 30×36 으로 그려지고 15px 꺾쇠는 보조색(#5A5A5A)이다 */
const NAV_BUTTON =
  'inline-flex h-30 min-h-36 w-30 items-center justify-center rounded-9 bg-control text-sub hover:bg-line-strong'

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
            <Icon name="chevron-left" size={15} />
          </button>
          <button type="button" aria-label={nextLabel} className={NAV_BUTTON} onClick={onNext}>
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-16" aria-label="범례">
        {legend}
      </ul>
    </div>
  )
}

/**
 * 보기 영역의 가로 스크롤 (D-124). 내용이 영역보다 넓으면 페이지가 아니라 이 안에서 가로로 민다.
 * 넘칠 때만 Tab 자리가 되어 키보드(←·→)로도 민다 — 넘치지 않으면 Tab 자리를 늘리지 않는다.
 * 넘쳤는지는 그린 뒤 재고, 폭이 바뀌면 ResizeObserver 로 다시 잰다 (MinutesTitle 과 같은 방식)
 */
export function HorizontalScroll({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const area = ref.current
    if (area === null) return
    const measure = () => setOverflowing(area.scrollWidth > area.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      // 넘칠 때만 Tab 자리다 — 안에 포커스 받을 것이 없는 칸(막대·날짜)까지 키보드로 밀려면 영역이 포커스를 받아야 한다
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={overflowing ? 0 : undefined}
      className="overflow-x-auto rounded-16"
    >
      {children}
    </div>
  )
}

/** 범례 한 칸 — 20×12 색 칩과 이름. 칩에 표식이 붙는 상태면 견본에도 같은 아이콘을 넣는다 */
export function LegendItem({
  swatch,
  icon,
  children,
}: {
  swatch: string
  icon?: IconName
  children: ReactNode
}) {
  return (
    <li className="inline-flex items-center gap-7 text-[12px] text-sub">
      <span
        aria-hidden="true"
        className={`inline-flex h-12 w-20 items-center justify-center rounded-4 ${swatch}`}
      >
        {icon === undefined ? null : <Icon name={icon} size={10} strokeWidth={2.4} />}
      </span>
      {children}
    </li>
  )
}

/** 캘린더 범례 — CalendarView 와 그 뼈대가 같이 쓴다. 표식(확인 필요 · 마감 임박)은 캘린더 칩의 표식과 같다 */
export function CalendarLegend() {
  return (
    <>
      <LegendItem swatch="bg-ink text-surface" icon="eye">
        확인 필요
      </LegendItem>
      <LegendItem swatch="bg-accent-chip text-ink" icon="alert">
        마감 임박
      </LegendItem>
      <LegendItem swatch="bg-surface-selected">진행 중</LegendItem>
      <LegendItem swatch="border-2 border-dashed bg-surface">회의</LegendItem>
    </>
  )
}

/** 간트 범례 — GanttView 와 그 뼈대가 같이 쓴다 */
export function GanttLegend() {
  return (
    <>
      <LegendItem swatch="bg-ink">진행 중</LegendItem>
      <LegendItem swatch="border border-line-strong bg-surface">시작 전</LegendItem>
      <LegendItem swatch="bg-surface-sunken">완료</LegendItem>
      <LegendItem swatch="border-2 border-dashed bg-surface">확인 필요</LegendItem>
    </>
  )
}

/**
 * RangeHeader 와 같은 틀의 자리표시 (#508) — 제목은 글자, 이전·다음은 누를 수 없는 같은 크기의 칸, 범례는 그대로다.
 * 데이터를 기다리는 뼈대 안에 둔다(누를 것도 heading 도 없다). 스크린리더에서 뺀다
 */
export function RangeHeaderFrame({ title, legend }: { title: string; legend: ReactNode }) {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-16">
      <div className="flex items-center gap-12">
        <p className="text-[19px] leading-[1.55] font-bold tracking-h2 text-ink">{title}</p>
        <div className="flex items-center gap-4">
          {(['chevron-left', 'chevron-right'] as const).map((icon) => (
            <span
              key={icon}
              className="inline-flex h-30 min-h-36 w-30 items-center justify-center rounded-9 bg-control text-sub"
            >
              <Icon name={icon} size={15} />
            </span>
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-16">{legend}</ul>
    </div>
  )
}
