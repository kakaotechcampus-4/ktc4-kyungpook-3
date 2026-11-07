import { Skeleton } from '@/shared/ui/skeleton'
import { calendarGrid, ganttDays, ganttTitle, monthTitle } from '../lib/taskViews'
import { GANTT_GRID, GANTT_LABEL_WIDTH, GANTT_TABLE_MIN_WIDTH, weekLabel } from './ganttLayout'
import { CalendarLegend, GanttLegend, RangeHeaderFrame } from './viewParts'

/*
 * 태스크 보기마다 실제 화면과 같은 틀의 뼈대 (#508). 정해진 글자(칸 이름·요일·칸 고르기)는 막대가 아니라 글자로 그린다 —
 * 자리표시라 스크린리더에서 뺀다. 기다림은 바깥 컨테이너(DeferredSkeleton)의 aria-busy 와 이름이 알린다.
 * 치수는 BoardView · CalendarView · GanttView 의 칸과 같다. 그쪽 틀이 바뀌면 여기도 맞춘다.
 */

export type TaskViewKind = 'list' | 'board' | 'calendar' | 'gantt'

const BOARD_COLUMNS = ['시작 전', '진행 중', '완료'] as const
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/**
 * 리스트에서 확인 필요 카드가 먼저 오는지. 역할과 탭으로 미리 안다 — PM 의 전체 탭은 카드 다음 태스크, 확인 필요 탭은 카드뿐이다.
 * 카드 수와 높이(칸이 비었는지·근거가 몇 줄인지)는 받아야 알아 카드 둘로 둔다
 */
export type ListCards = 'none' | 'mixed' | 'only'

/** 확인 필요 카드의 틀 — 머리 줄(배지 · 제목 · 회의), 한 줄 안내, 근거 칸, 아래 줄 */
function ApprovalCardFrame() {
  return (
    <div className="flex flex-col gap-14 rounded-16 border border-line px-20 py-18">
      <div className="flex items-center gap-10">
        <Skeleton variant="block" width={64} height={21} className="rounded-6" />
        <div className="flex h-lh flex-1 items-center text-[17px]">
          <Skeleton width="36%" />
        </div>
      </div>
      <div className="flex h-lh items-center text-body">
        <Skeleton width="44%" />
      </div>
      <Skeleton variant="block" height={72} className="rounded-12" />
      <div className="flex h-36 items-center justify-end">
        <Skeleton variant="block" width={76} height={36} className="rounded-9" />
      </div>
    </div>
  )
}

/** 리스트 — 실제 태스크 행(TaskBoard 의 ROW)과 같은 가로 틀: 상태 배지 · 제목 · 담당자 · 마감 */
function ListSkeleton({ cards }: { cards: ListCards }) {
  const rows = (
    <ul className="flex flex-col">
      {[52, 40, 60, 34, 48].map((width) => (
        <li
          key={width}
          className="flex items-center gap-14 border-b border-line py-14 last:border-b-0"
        >
          <Skeleton variant="block" width={44} height={21} className="shrink-0 rounded-6" />
          <div className="flex h-lh min-w-[0px] flex-1 items-center text-[14px]">
            <Skeleton width={`${width}%`} />
          </div>
          <span className="inline-flex shrink-0 items-center gap-7">
            <Skeleton variant="circle" width={22} height={22} />
            <Skeleton width={36} />
          </span>
          <Skeleton width={40} className="shrink-0" />
        </li>
      ))}
    </ul>
  )
  if (cards === 'none') return <div aria-hidden="true">{rows}</div>
  return (
    <div aria-hidden="true" className="flex flex-col gap-28">
      <div className="flex flex-col gap-28">
        <ApprovalCardFrame />
        <ApprovalCardFrame />
      </div>
      {cards === 'mixed' ? (
        <div className="flex flex-col gap-12">
          <p className="pt-12 text-[14px] leading-[1.75] font-semibold text-ink">태스크</p>
          {rows}
        </div>
      ) : null}
    </div>
  )
}

/** 보드 — 넓은 화면은 세 칸, 휴대폰은 칸 고르기 아래 기본 칸(진행 중, taskViews 의 기본값)과 요약 줄. 칸 이름은 글자다 */
const MOBILE_COLUMN = 1
function BoardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-3 items-start gap-18 max-md:flex max-md:flex-col max-md:items-stretch max-md:gap-10"
    >
      <div className="hidden grid-cols-3 gap-2 rounded-12 bg-control p-4 max-md:grid">
        {BOARD_COLUMNS.map((title, index) => (
          <span
            key={title}
            className={`inline-flex min-h-40 items-center justify-center rounded-9 text-[14px] ${
              index === MOBILE_COLUMN ? 'bg-surface font-bold text-ink' : 'text-sub'
            }`}
          >
            {title}
          </span>
        ))}
      </div>
      {BOARD_COLUMNS.map((title, index) => (
        <div
          key={title}
          className={`flex flex-col gap-10 max-md:gap-12 ${index === MOBILE_COLUMN ? '' : 'max-md:hidden'}`}
        >
          <div className="hidden h-lh items-center text-[12.5px] leading-[1.5] max-md:flex">
            <Skeleton width={160} />
          </div>
          <div className="flex flex-col gap-4 border-b border-line px-2 pb-12 max-md:hidden">
            <div className="flex items-center gap-8">
              <span className="h-8 w-8 rounded-999 bg-line" />
              <span className="flex-1 text-body font-semibold text-ink">{title}</span>
            </div>
            <div className="flex h-lh items-center pl-16 text-meta">
              <Skeleton width={96} />
            </div>
          </div>
          {[0, 1, 2].map((card) => (
            <div
              key={card}
              className="flex flex-col gap-12 rounded-12 border border-line px-13 py-12 max-md:rounded-[14px] max-md:px-16 max-md:py-14"
            >
              <div className="flex h-lh items-center text-control">
                <Skeleton width={`${[64, 52, 72][card]}%`} />
              </div>
              <div className="flex h-lh items-center text-meta">
                <Skeleton width={88} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * 캘린더 — 실제 머리(달 제목 · 이전·다음 · 범례, RangeHeader 와 같은 틀), 요일 머리, 그 달의 주 수만큼 날짜 칸(116px), 마감일 없음 칸.
 * 달과 날짜는 주소로 이미 알아 글자로 그린다. 빈 달 안내 줄은 받아야 알아 넣지 않는다
 */
function CalendarSkeleton({ month }: { month: string }) {
  const cells = calendarGrid(month)
  return (
    <div aria-hidden="true" className="flex flex-col gap-20">
      <RangeHeaderFrame title={monthTitle(month)} legend={<CalendarLegend />} />
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-1 overflow-hidden rounded-16 border border-line bg-line max-md:min-w-[680px]">
          {WEEKDAYS.map((day, index) => (
            <div
              key={day}
              className={`bg-surface-sunken px-10 py-9 text-meta font-semibold ${
                index === 0 || index === 6 ? 'text-dim' : 'text-sub'
              }`}
            >
              {day}
            </div>
          ))}
          {cells.map(({ date, inMonth }) => (
            <div
              key={date}
              className={`min-h-[116px] bg-surface text-[12px] tabular-nums ${
                inMonth ? 'p-9 text-sub' : 'px-20 py-18 text-faint'
              }`}
            >
              {Number(date.slice(8, 10))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-16 rounded-16 border border-line bg-surface px-18 py-16">
        <span className="text-[13px] leading-none font-semibold text-ink">마감일 없음</span>
        <Skeleton variant="block" width={132} height={36} className="rounded-6" />
      </div>
    </div>
  )
}

/**
 * 간트 — 실제 머리(기간 제목 · 이전·다음 · 범례), 표(최소 1262px, 이름 칸 252)의 주 머리 · 날짜 눈금, 막대 줄.
 * 기간·날짜는 주소로 이미 알아 글자로 그린다. 줄의 이름·막대만 자리표시다
 */
function GanttSkeleton({ from }: { from: string }) {
  const days = ganttDays(from)
  const label = { flex: `0 0 ${GANTT_LABEL_WIDTH}px` }
  return (
    <div aria-hidden="true" className="flex flex-col gap-20">
      <RangeHeaderFrame title={ganttTitle(from)} legend={<GanttLegend />} />
      <div className="overflow-x-auto">
        <div
          className="overflow-hidden rounded-16 border border-line bg-surface"
          style={{ minWidth: GANTT_TABLE_MIN_WIDTH }}
        >
          <div className="flex items-stretch">
            <div
              className="flex items-center border-r border-line bg-surface-sunken px-14"
              style={label}
            >
              <span className="text-[10.5px] tracking-[0.08em] text-dim">담당자 · 태스크</span>
            </div>
            <div className="grid flex-1" style={GANTT_GRID}>
              {[0, 7, 14].map((offset) => (
                <span
                  key={offset}
                  className={`px-10 py-8 text-meta font-semibold text-sub ${offset > 0 ? 'border-l border-line' : ''}`}
                  style={{ gridColumn: `${offset + 1} / ${offset + 8}` }}
                >
                  {weekLabel(days[offset])}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-stretch border-t border-divider">
            <div className="border-r border-line bg-surface-sunken" style={label} />
            <div className="grid min-h-30 flex-1" style={GANTT_GRID}>
              {days.map((date) => (
                <span
                  key={date}
                  className="flex items-center justify-center text-[11px] text-sub tabular-nums"
                >
                  {Number(date.slice(8, 10))}
                </span>
              ))}
            </div>
          </div>
          {[30, 10, 45, 20].map((offset, index) => (
            <div key={offset} className="flex h-44 items-stretch border-t border-divider">
              <div
                className="flex items-center border-r border-line px-14 text-control"
                style={label}
              >
                <Skeleton width={`${[64, 52, 72, 44][index]}%`} />
              </div>
              <div className="flex flex-1 items-center" style={{ paddingLeft: `${offset}%` }}>
                <Skeleton variant="block" width="20%" height={26} className="rounded-7" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 보기에 맞는 뼈대. 바깥 컨테이너는 부르는 쪽(DeferredSkeleton)이 준다 */
export function TaskViewSkeleton({
  view,
  listCards = 'none',
  month,
  from,
}: {
  view: TaskViewKind
  /** 리스트에서 확인 필요 카드가 먼저 오는지 (ListCards) */
  listCards?: ListCards
  /** 캘린더가 보는 달(`YYYY-MM`) — 주 수와 제목이 달마다 다르다 */
  month: string
  /** 간트가 보는 3주의 첫 월요일 */
  from: string
}) {
  switch (view) {
    case 'list':
      return <ListSkeleton cards={listCards} />
    case 'board':
      return <BoardSkeleton />
    case 'calendar':
      return <CalendarSkeleton month={month} />
    case 'gantt':
      return <GanttSkeleton from={from} />
  }
}
