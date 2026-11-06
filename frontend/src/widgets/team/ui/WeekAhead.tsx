import type { Task } from '@/entities/task'
import { monthDayOf } from '@/shared/lib/date'
import { isWeekend, nextSevenDays, openTasksDueOn, weekdayOf } from '../lib/team'

const CELL = 'flex min-h-[138px] min-w-[0px] flex-col gap-9 rounded-16 border bg-surface p-12'
const CHIP = 'flex flex-col gap-3 rounded-7 bg-surface-selected px-9 py-8 max-md:wrap-anywhere'

export interface WeekAheadProps {
  tasks: readonly Task[]
  /** 담당자 id → 이름 */
  names: ReadonlyMap<string, string>
  today: string
}

/** 앞으로 7일 (Team 캔버스). 오늘부터 이레 동안 마감하는 끝나지 않은 일이다. 오늘 칸만 강조 테두리 한 겹이다 */
export function WeekAhead({ tasks, names, today }: WeekAheadProps) {
  const days = nextSevenDays(today)
  return (
    <section aria-labelledby="team-week" className="flex flex-col gap-12">
      <div className="flex items-baseline justify-between">
        <h2 id="team-week" className="text-[14px] font-semibold text-ink">
          앞으로 7일
        </h2>
        <span className="text-[12px] text-dim tabular-nums">
          {monthDayOf(days[0])} — {monthDayOf(days[6])}
        </span>
      </div>
      {/* 휴대폰 폭에서는 칸이 글자 하나 폭으로 줄어든다. 칸 폭을 지키고 이 줄 안에서만 가로로 민다 (D-180) */}
      <ol className="grid grid-cols-7 gap-8 max-md:grid-cols-[repeat(7,minmax(112px,1fr))] max-md:overflow-x-auto">
        {days.map((date) => {
          const isToday = date === today
          const weekend = isWeekend(date)
          const due = openTasksDueOn(tasks, date)
          return (
            <li key={date} className={`${CELL} ${isToday ? 'border-line-strong' : 'border-line'}`}>
              <div className="flex items-baseline justify-between">
                <span
                  className={`text-meta ${isToday ? 'font-semibold text-ink' : weekend ? 'text-dim' : 'text-sub'}`}
                >
                  {weekdayOf(date)}
                </span>
                <time
                  dateTime={date}
                  className={`text-caption tabular-nums ${weekend && !isToday ? 'text-dim' : 'text-ink'}`}
                >
                  {Number(date.slice(8, 10))}
                </time>
              </div>
              {isToday ? <span className="text-[11px] text-dim">오늘</span> : null}
              {due.map((task) => {
                const assignee =
                  task.assigneeMemberId === null ? null : names.get(task.assigneeMemberId)
                return (
                  <div key={task.id} className={CHIP}>
                    <span className="text-meta leading-[1.45] text-ink">{task.title}</span>
                    <span className="text-[10.5px] text-dim tabular-nums">
                      {assignee ?? '담당자 없음'}
                    </span>
                  </div>
                )
              })}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
