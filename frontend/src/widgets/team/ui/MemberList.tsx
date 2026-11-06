import type { ReactNode } from 'react'
import type { Member } from '@/entities/member'
import type { Task } from '@/entities/task'
import { TASK_STATUS_LABEL, isOverdue } from '@/entities/task'
import { monthDayOf, seoulDateOf } from '@/shared/lib/date'
import { Icon } from '@/shared/ui/icon'
import { avatarText, memberRisk } from '../lib/team'
import type { MemberRisk } from '../lib/team'
import { BADGE, BADGE_DOT } from './teamStyles'

const HEAD = 'flex items-center gap-12 border-b border-line py-14'
const AVATAR =
  'inline-flex h-30 w-30 shrink-0 items-center justify-center rounded-999 bg-divider text-meta leading-none font-semibold text-ink'
const NAME = 'text-[14.5px] leading-[1.75] font-semibold text-ink'
const ROLE = 'text-[12px] text-dim'
const ROW = 'flex items-center gap-16 border-b border-line py-13 last:border-b-0'
const TASK_TITLE = 'text-[13px] leading-[1.75] text-ink'
const TASK_META = 'text-[11px] tabular-nums'
const DUE = 'inline-flex w-56 shrink-0 items-center justify-end gap-3 text-caption tabular-nums'
const STATUS =
  'inline-flex h-[21px] w-[58px] shrink-0 items-center justify-center rounded-6 border border-line text-[11px] leading-none text-sub'

const RISK_LABEL: Record<MemberRisk, string> = { danger: '위험', warn: '주의', normal: '정상' }
const RISK_CLASS: Record<MemberRisk, string> = {
  danger: 'bg-accent-badge text-accent',
  warn: 'bg-ink text-surface',
  normal: 'bg-control text-sub',
}

interface TaskRowProps {
  task: Task
  today: string
}

/**
 * 맡은 일 한 줄 — 제목, 기준 날짜·진행률, 마감, 상태. 진행률은 팀원이 말한 값이라 그 값이 바뀐 날(태스크 수정일)을 함께 적는다.
 * 마감이 없으면 `마감 미정 — 확인 필요` 다. 기한이 지난 마감은 먹 글자에 캘린더 `마감 임박` 과 같은 경고 표식을 붙여
 * 흑백에서도 갈리게 한다
 */
function TaskRow({ task, today }: TaskRowProps) {
  const updated = seoulDateOf(task.updatedAt)
  const overdue = isOverdue(task, today)
  return (
    <li className={ROW}>
      <div className="min-w-[0px] flex-1">
        <div className={TASK_TITLE}>{task.title}</div>
        {task.dueDate === null && task.status !== 'done' ? (
          <div className={`${TASK_META} text-ink`}>마감 미정 — 확인 필요</div>
        ) : (
          <div className={`${TASK_META} text-dim`}>
            {updated === null ? '' : `${monthDayOf(updated)} 기준`}
          </div>
        )}
      </div>
      <span className={`${DUE} ${overdue ? 'text-ink' : 'text-dim'}`}>
        {overdue ? <Icon name="alert" size={12} /> : null}
        {task.dueDate === null ? '— —' : monthDayOf(task.dueDate)}
        {overdue ? <span className="sr-only"> 기한 지남</span> : null}
      </span>
      <span className={STATUS}>{TASK_STATUS_LABEL[task.status]}</span>
    </li>
  )
}

export interface MemberSectionProps {
  member: Member
  tasks: readonly Task[]
  today: string
  /** Discord 서버를 떠난 팀원이다 (D-031) */
  inactive: boolean
  /** 역할 줄 아래의 초대 상태·조작. 이름 칸 안이라 길면 줄을 바꾸고 줄 폭을 늘리지 않는다 */
  invite?: ReactNode
}

/** 팀원 한 명 — 이름·역할·상태 배지와 맡은 일 (Team 캔버스). 상태는 색만이 아니라 글자로도 구분한다 (D-128) */
export function MemberSection({ member, tasks, today, inactive, invite }: MemberSectionProps) {
  const risk = memberRisk(tasks, today)
  const headingId = `team-member-${member.id}`
  return (
    <section aria-labelledby={headingId}>
      <div className={HEAD}>
        <span aria-hidden="true" className={AVATAR}>
          {avatarText(member.displayName)}
        </span>
        <div className="min-w-[0px] flex-1">
          <h2 id={headingId} className={NAME}>
            {member.displayName}
          </h2>
          <div className={ROLE}>
            {member.role === 'pm' ? 'PM' : '팀원'}
            {inactive ? ' · Discord 서버를 나갔어요' : null}
          </div>
          {invite}
        </div>
        <span className={`${BADGE} ${RISK_CLASS[risk]}`}>
          {risk === 'normal' ? null : <span aria-hidden="true" className={BADGE_DOT} />}
          {RISK_LABEL[risk]}
        </span>
      </div>
      {tasks.length === 0 ? (
        <p className="py-13 text-[13px] text-dim">맡은 일이 없어요.</p>
      ) : (
        <ul aria-label={`${member.displayName}의 일`}>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} today={today} />
          ))}
        </ul>
      )}
    </section>
  )
}
