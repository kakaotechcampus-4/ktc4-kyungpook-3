import { useId, useState } from 'react'
import { ASSIGNEE_NONE_OPTION, assigneeOptions } from '@/entities/member'
import type { Member } from '@/entities/member'
import { TASK_STATUS_OPTIONS } from '@/entities/task'
import { isDateOnly } from '@/shared/lib/date'
import { Button } from '@/shared/ui/button'
import { DateField } from '@/shared/ui/date-field'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { assigneePickNotice } from '../model/assigneePick'
import type { TaskUpdateOverrides } from '../model/useTaskUpdateOverrides'

const ROW = 'grid grid-cols-1 items-start gap-12 sm:grid-cols-2'

export interface TaskUpdateOverrideFieldsProps {
  overrides: TaskUpdateOverrides
  /** 지금 공간의 팀원. 받기 전에는 담당자를 고를 수 없다 */
  members: readonly Member[] | undefined
  retainedNames?: ReadonlyMap<string, string>
  onInputChange: () => void
  disabled: boolean
}

/**
 * 변경 승인의 상태·마감을 바로 고친다 (E-6). 만지지 않은 칸은 원래 제안을 유지한다.
 * 상태 줄은 보드 칸 머리와 같은 표식을 앞에 둔다.
 * 답장이 말한 담당자를 팀원에서 찾지 못한 카드는 담당자 칸이 위에 있다. 고르기 전에는 승인이 막힌다
 */
export function TaskUpdateOverrideFields({
  overrides,
  members,
  retainedNames,
  onInputChange,
  disabled,
}: TaskUpdateOverrideFieldsProps) {
  const statusId = useId()
  const assigneeId = useId()
  const noticeId = useId()
  const { status, dueDate, edits, assigneePick, assignee } = overrides
  // 처음 입력하는 동안에는 오류를 보이지 않고 칸을 떠날 때 검사한다 (D-142)
  const [dueLeft, setDueLeft] = useState(false)
  const dueInvalid = dueLeft && dueDate !== '' && !isDateOnly(dueDate)
  const unpicked = assignee === undefined
  return (
    <>
      {assigneePick === null ? null : (
        <div className="flex flex-col">
          <p id={noticeId} className="mb-12 text-body text-ink">
            {assigneePickNotice(assigneePick.raw)}
          </p>
          <Label htmlFor={assigneeId} blocking={unpicked} className="mb-6">
            담당자
          </Label>
          <Select
            id={assigneeId}
            label="담당자"
            // 고르기 전에는 플레이스홀더, 미정을 고르면 null 이고 플레이스홀더가 없어 「미정」 줄이 보인다
            value={assignee ?? null}
            onValueChange={(value) => {
              onInputChange()
              overrides.setAssignee(value)
            }}
            options={assigneeOptions(members, assignee ?? null, retainedNames)}
            noneOption={ASSIGNEE_NONE_OPTION}
            placeholder={unpicked ? '담당자 고르기' : undefined}
            tone={unpicked ? 'blocking' : 'normal'}
            disabled={disabled || members === undefined}
            aria-describedby={noticeId}
          />
        </div>
      )}
      <div className={ROW}>
        <div className="flex flex-col">
          <Label htmlFor={statusId} className="mb-6">
            상태
          </Label>
          <Select
            id={statusId}
            label="상태"
            value={status === '' ? null : status}
            onValueChange={(value) => {
              onInputChange()
              overrides.setStatus(value ?? '')
            }}
            options={TASK_STATUS_OPTIONS}
            noneOption={overrides.statusKeepsProposal ? { label: '원래 제안 유지' } : undefined}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col">
          <DateField
            size="lg"
            label="마감"
            // 비운 칸은 원래 제안 유지다. 미정은 「마감 미정」으로만 바꾼다
            placeholder={
              edits.dueDate === undefined
                ? `원래 제안 유지 · ${overrides.proposedDue === null ? '미정' : (overrides.proposedDue ?? 'YYYY-MM-DD')}`
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
    </>
  )
}
