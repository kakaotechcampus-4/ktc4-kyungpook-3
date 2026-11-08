import type { Member } from '@/entities/member'
import { objectParticle } from '@/shared/lib/korean'
import { Checkbox } from '@/shared/ui/checkbox'

export interface AliasSaveFieldProps {
  /** 별칭으로 등록할 글자 (`aliasToLearn`). null 이면 그리지 않는다 */
  aliasText: string | null
  members: readonly Member[] | undefined
  assigneeMemberId: string | null
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled: boolean
}

/**
 * 회의에서 부른 이름을 고른 담당자의 별칭으로 함께 등록한다 (#523). 담당자 이름을 알 때만 보인다 —
 * 미정이거나 팀원 목록에 없으면 누구에게 등록하는지 말할 수 없다
 */
export function AliasSaveField({
  aliasText,
  members,
  assigneeMemberId,
  checked,
  onCheckedChange,
  disabled,
}: AliasSaveFieldProps) {
  const assignee = members?.find(({ id }) => id === assigneeMemberId)
  if (aliasText === null || assignee === undefined) return null
  return (
    <Checkbox
      className="mt-8"
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
    >
      &apos;{aliasText}&apos;{objectParticle(aliasText)} {assignee.displayName}의 별칭에도 등록
    </Checkbox>
  )
}
