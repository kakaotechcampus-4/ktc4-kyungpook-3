import { useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface MinutesTab<Id extends string> {
  id: Id
  label: string
  /** 탭 뒤 개수. 모르면 그리지 않는다 */
  count?: number | null
  panel: ReactNode
}

/* Meetings 캔버스 실측 — 탭 줄 좌우 36 · 아래 선, 탭 38px · 13.5px 600 · 간격 18, 선택은 먹 밑줄 2px */
const LIST = 'flex items-center gap-18 border-b border-line px-36'
const TAB =
  'inline-flex h-[38px] items-center gap-7 border-b-2 border-transparent px-3 text-body font-semibold text-sub hover:text-ink aria-selected:border-ink aria-selected:text-ink'
const COUNT =
  'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-6 bg-control px-5 text-[10.5px] font-semibold text-sub tabular-nums'

/**
 * 회의록 본문의 탭 (요약 · 전사문 · 추출된 일). WAI-ARIA 탭 패턴 — 화살표·Home·End 로 옮기고 옮긴 탭을 바로 고른다.
 * 고른 탭만 Tab 순서에 들어간다. 패널은 고른 것 하나만 그린다.
 */
export function MinutesTabs<Id extends string>({
  label,
  tabs,
  selected,
  onSelect,
}: {
  label: string
  tabs: readonly MinutesTab<Id>[]
  selected: Id
  onSelect: (id: Id) => void
}) {
  const prefix = useId()
  const buttons = useRef(new Map<Id, HTMLButtonElement>())
  const current = tabs.find(({ id }) => id === selected) ?? tabs[0]

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    const target = tabs[next]
    onSelect(target.id)
    buttons.current.get(target.id)?.focus()
  }

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label={label} className={LIST}>
        {tabs.map((tab, index) => {
          const active = tab.id === current.id
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node === null) buttons.current.delete(tab.id)
                else buttons.current.set(tab.id, node)
              }}
              type="button"
              role="tab"
              id={`${prefix}-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`${prefix}-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              className={TAB}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => move(event, index)}
            >
              {tab.label}
              {/* 읽는 이름이 `추출된 일 6` 이 되게 띄운다 */}
              {tab.count === undefined || tab.count === null ? null : (
                <>
                  {' '}
                  <span className={COUNT}>{tab.count}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel-${current.id}`}
        aria-labelledby={`${prefix}-tab-${current.id}`}
        tabIndex={0}
        className="flex flex-col gap-30 px-36 pt-28 pb-56"
      >
        {current.panel}
      </div>
    </div>
  )
}
