import { useId } from 'react'
import { Label } from '@/shared/ui/label'
import { assigneePickNotice } from '../model/assigneePick'

const SELECT =
  'h-[42px] w-full max-w-[320px] rounded-9 border border-input-border bg-surface px-13 text-body text-ink disabled:bg-surface-sunken disabled:text-faint'
const UNPICKED = ''
const UNASSIGNED = '__unassigned'

export interface AssigneePickFieldProps {
  raw: string | null
  members: readonly { id: string; displayName: string }[]
  /** undefined 는 아직 고르지 않음, null 은 미정이다 */
  value: string | null | undefined
  disabled: boolean
  onChange: (assigneeMemberId: string | null) => void
}

/**
 * 담당자를 찾지 못한 답장 카드에서 PM 이 담당자를 고른다(미정 포함). 고르기 전에는 승인이 막힌다 — 막는 것은
 * 승인 계획(`planApprovalResolution`)이고, 이 칸은 값만 올린다
 */
export function AssigneePickField({
  raw,
  members,
  value,
  disabled,
  onChange,
}: AssigneePickFieldProps) {
  const selectId = useId()
  const noticeId = useId()
  return (
    <div className="flex flex-col gap-8">
      <p id={noticeId} className="text-body text-ink">
        {assigneePickNotice(raw)}
      </p>
      <Label htmlFor={selectId}>담당자</Label>
      <select
        id={selectId}
        className={SELECT}
        aria-describedby={noticeId}
        disabled={disabled}
        value={value === undefined ? UNPICKED : value === null ? UNASSIGNED : value}
        onChange={(event) => {
          const next = event.target.value
          if (next !== UNPICKED) onChange(next === UNASSIGNED ? null : next)
        }}
      >
        <option value={UNPICKED} disabled>
          골라 주세요
        </option>
        <option value={UNASSIGNED}>미정</option>
        {members.map(({ id, displayName }) => (
          <option key={id} value={id}>
            {displayName}
          </option>
        ))}
      </select>
    </div>
  )
}
