import { Skeleton } from '@/shared/ui/skeleton'
import { HEAD, ROW } from './teamStyles'

/**
 * 팀원 목록을 기다리는 뼈대 (#508). 팀원 영역과 같은 틀이다 — 머리 줄(이름 원 · 이름 · 역할), 맡은 일 줄(제목 · 기준 날짜 · 마감 · 상태).
 * 치수는 HEAD · AVATAR · NAME · ROW · TASK_TITLE · STATUS 와 같다
 */
export function MemberListSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-[38px]">
      {[2, 3].map((tasks, member) => (
        <div key={member}>
          <div className={HEAD}>
            <span className="h-30 w-30 shrink-0 rounded-999 bg-divider" />
            <div className="flex min-w-[0px] flex-1 flex-col">
              <div className="flex h-lh items-center text-[14.5px] leading-[1.75]">
                <Skeleton width={64} />
              </div>
              <div className="flex h-lh items-center text-[12px]">
                <Skeleton width={32} />
              </div>
            </div>
          </div>
          {Array.from({ length: tasks }, (_task, index) => (
            <div key={index} className={ROW}>
              <div className="flex min-w-[0px] flex-1 flex-col">
                <div className="flex h-lh items-center text-[13px] leading-[1.75]">
                  <Skeleton width={`${[48, 36, 56][index]}%`} />
                </div>
                <div className="flex h-lh items-center text-[11px]">
                  <Skeleton width={56} />
                </div>
              </div>
              <span className="h-[21px] w-[58px] shrink-0 rounded-6 border border-line" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
