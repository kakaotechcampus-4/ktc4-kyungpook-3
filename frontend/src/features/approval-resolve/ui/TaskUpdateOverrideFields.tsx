import { useId, useState } from 'react'
import { isDateOnly } from '@/shared/lib/date'
import type { TaskStatus } from '@/shared/types/common'
import { Button } from '@/shared/ui/button'
import { DateField } from '@/shared/ui/date-field'
import { Icon } from '@/shared/ui/icon'
import { Label } from '@/shared/ui/label'
import type { TaskUpdateOverrides } from '../model/useTaskUpdateOverrides'

const ROW = 'grid grid-cols-1 items-start gap-12 sm:grid-cols-2'
const SELECT =
  'h-44 w-full appearance-none rounded-9 border border-input-border bg-surface pr-40 pl-13 text-[15px] text-ink disabled:border-line disabled:bg-surface-sunken disabled:text-faint'

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: '할 일' },
  { value: 'in_progress', label: '진행 중' },
  { value: 'blocked', label: '막힘' },
  { value: 'done', label: '완료' },
]

function isStatus(value: string): value is TaskStatus {
  return STATUS_OPTIONS.some((option) => option.value === value)
}

export interface TaskUpdateOverrideFieldsProps {
  overrides: TaskUpdateOverrides
  onInputChange: () => void
  disabled: boolean
}

/**
 * 변경 승인의 상태·마감을 바로 고친다 (E-6). 만지지 않은 칸은 원래 제안을 유지한다.
 * 상태 선택 상자는 공용 선택 상자로 바꾸지 않는다 — 후속 #477 의 범위다
 */
export function TaskUpdateOverrideFields({
  overrides,
  onInputChange,
  disabled,
}: TaskUpdateOverrideFieldsProps) {
  const statusId = useId()
  const { status, dueDate, edits } = overrides
  // 처음 입력하는 동안에는 오류를 보이지 않고 칸을 떠날 때 검사한다 (D-142)
  const [dueLeft, setDueLeft] = useState(false)
  const dueInvalid = dueLeft && dueDate !== '' && !isDateOnly(dueDate)
  return (
    <div className={ROW}>
      <div className="flex flex-col">
        <Label htmlFor={statusId} className="mb-6">
          상태
        </Label>
        <div className="relative">
          <select
            id={statusId}
            className={SELECT}
            value={status}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value
              if (value !== '' && !isStatus(value)) return
              onInputChange()
              overrides.setStatus(value)
            }}
          >
            {overrides.statusKeepsProposal ? <option value="">원래 제안 유지</option> : null}
            {STATUS_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-down"
            size={14}
            className="pointer-events-none absolute top-1/2 right-13 -translate-y-1/2 text-dim"
          />
        </div>
      </div>
      <div className="flex flex-col">
        <DateField
          size="lg"
          label="마감"
          // 비운 칸은 원래 제안 유지다. 미정은 「마감 미정」으로만 바꾼다
          placeholder={
            edits.dueDate === undefined
              ? `원래 제안 유지 · ${overrides.proposedDue ?? 'YYYY-MM-DD'}`
              : '미정'
          }
          calendarLabel="마감 달력 열기"
          labelTone={dueInvalid ? 'required-blocking' : 'normal'}
          error={dueInvalid ? '마감은 YYYY-MM-DD 형식의 있는 날짜여야 해요.' : undefined}
          description="마감을 미정으로 바꾸려면 마감 미정을 누르세요."
          disabled={disabled}
          value={dueDate}
          onBlur={() => setDueLeft(true)}
          onChange={(value) => {
            onInputChange()
            overrides.setDueDate(value)
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-6 self-start"
          disabled={disabled}
          onClick={() => {
            onInputChange()
            overrides.setDueDate(null)
          }}
        >
          마감 미정
        </Button>
      </div>
    </div>
  )
}
