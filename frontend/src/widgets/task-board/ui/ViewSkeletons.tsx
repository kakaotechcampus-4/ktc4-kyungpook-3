import { Skeleton } from '@/shared/ui/skeleton'

/*
 * 태스크 보기마다 실제 화면과 같은 틀의 뼈대 (#508). 정해진 글자(칸 이름·요일·칸 고르기)는 막대가 아니라 글자로 그린다 —
 * 자리표시라 스크린리더에서 뺀다. 기다림은 바깥 컨테이너(DeferredSkeleton)의 aria-busy 와 이름이 알린다.
 * 치수는 BoardView · CalendarView · GanttView 의 칸과 같다. 그쪽 틀이 바뀌면 여기도 맞춘다.
 */

export type TaskViewKind = 'list' | 'board' | 'calendar' | 'gantt'

const BOARD_COLUMNS = ['시작 전', '진행 중', '완료'] as const
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/** 리스트 — 태스크 행. 제목 한 줄과 담당·마감 한 줄, 행 사이 선 */
function ListSkeleton() {
  return (
    <ul aria-hidden="true" className="flex flex-col">
      {[56, 44, 64, 38, 52].map((width) => (
        <li key={width} className="flex flex-col gap-6 border-b border-line py-14 last:border-b-0">
          <div className="flex h-lh items-center text-body">
            <Skeleton width={`${width}%`} />
          </div>
          <div className="flex h-lh items-center text-meta">
            <Skeleton width={120} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** 보드 — 넓은 화면은 세 칸, 휴대폰은 칸 고르기 아래 첫 칸. 칸 이름은 글자다 */
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
              index === 0 ? 'bg-surface font-bold text-ink' : 'text-sub'
            }`}
          >
            {title}
          </span>
        ))}
      </div>
      {BOARD_COLUMNS.map((title, index) => (
        <div
          key={title}
          className={`flex flex-col gap-10 max-md:gap-12 ${index === 0 ? '' : 'max-md:hidden'}`}
        >
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

/** 캘린더 — 달 제목 줄과 요일 머리(글자), 다섯 주의 날짜 칸 */
function CalendarSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-16">
      <div className="flex h-[30px] items-center">
        <Skeleton variant="block" width={120} height={22} className="rounded-6" />
      </div>
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
          {Array.from({ length: 35 }, (_cell, index) => (
            <div key={index} className="min-h-[116px] bg-surface p-9">
              <Skeleton width={14} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 간트 — 왼쪽 이름 칸(252)과 막대 줄 */
function GanttSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-x-auto">
      <div className="flex min-w-[600px] flex-col rounded-16 border border-line">
        <div className="h-44 border-b border-line bg-surface-sunken" />
        {[40, 28, 52, 34, 46].map((offset, index) => (
          <div key={offset} className="flex h-44 items-center border-b border-line last:border-b-0">
            <div className="flex w-[252px] shrink-0 items-center px-14 text-control">
              <Skeleton width={`${[64, 52, 72, 44, 58][index]}%`} />
            </div>
            <div className="flex flex-1 items-center" style={{ paddingLeft: `${offset}%` }}>
              <Skeleton variant="block" width="22%" height={26} className="rounded-7" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 보기에 맞는 뼈대. 바깥 컨테이너는 부르는 쪽(DeferredSkeleton)이 준다 */
export function TaskViewSkeleton({ view }: { view: TaskViewKind }) {
  switch (view) {
    case 'list':
      return <ListSkeleton />
    case 'board':
      return <BoardSkeleton />
    case 'calendar':
      return <CalendarSkeleton />
    case 'gantt':
      return <GanttSkeleton />
  }
}
