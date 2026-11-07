import { SelectInitial, SelectNoneMark } from '@/shared/ui/select'
import type { SelectOption } from '@/shared/ui/select'
import type { Member } from '../model/types'

/** 담당자 칸 맨 위 「미정」 줄 — 점선 원 ?. 고르면 담당자가 없다(null) */
export const ASSIGNEE_NONE_OPTION = { label: '미정', leading: <SelectNoneMark /> }

/**
 * 담당자 칸의 줄 — 팀원 이름과 이니셜 원. 승인 카드·승인 확인(E-6)·태스크 상세(E-5)가 같은 줄을 쓴다.
 * 지금 담당자가 팀원 목록에 없으면(나간 팀원 등) 그 값을 「알 수 없는 담당자」 줄로 맨 위에 둔다 — 트리거가 빈 칸으로 보이지 않는다.
 * 팀원 목록을 받기 전(undefined)에는 어떤 담당자든 목록에 없으므로 그 줄을 만들지 않는다
 */
export function assigneeOptions(
  members: readonly Member[] | undefined,
  current: string | null,
): SelectOption<string>[] {
  const options = (members ?? []).map(({ id, displayName }) => ({
    value: id,
    label: displayName,
    leading: <SelectInitial name={displayName} />,
  }))
  const unknown =
    members !== undefined && current !== null && !members.some(({ id }) => id === current)
  return unknown
    ? [
        { value: current, label: '알 수 없는 담당자', leading: <SelectInitial name="?" /> },
        ...options,
      ]
    : options
}
