import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'
import { memberListQueryOptions } from '@/entities/member'
import type { Member } from '@/entities/member'
import { errorMessage } from '@/shared/api/errorMessages'
import { useAppForm } from '@/shared/lib/form'
import type { AppForm } from '@/shared/lib/form'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { MappingSaveError, findMappingIssues, saveMemberMappings } from './memberMapping'
import type { MappingIssue, MappingRow } from './memberMapping'

const ISSUE_MESSAGES: Record<MappingIssue, string> = {
  duplicated: '같은 팀원 이름을 두 줄에 쓸 수 없어요.',
  taken: '이미 다른 Discord 계정과 연결된 팀원이에요.',
  pmDuplicated: '같은 PM을 두 줄에서 체크할 수 없어요.',
  pmClaimed: '다른 줄에서 PM으로 체크한 팀원 이름이에요.',
}

/** PM 체크에 다는 사유. 나머지는 이름 칸에 단다 */
const PM_ISSUES: ReadonlySet<MappingIssue> = new Set(['pmDuplicated'])

const PARTIAL_FAILURE = '일부 팀원을 저장하지 못했어요. 남은 줄만 다시 저장해요.'

/** `requirePm` 저장은 PM 을 체크해야 한다 (#228, 2026-10-14 사용자 결정) */
const PM_REQUIRED = 'PM의 디스코드 계정을 체크해야 완료할 수 있어요.'

const schema = z.object({
  rows: z.array(
    z.object({
      discordUserId: z.string(),
      username: z.string(),
      name: z.string(),
      pmMemberId: z.string().nullable(),
    }),
  ),
})

export type MappingFormValues = z.infer<typeof schema>

type FormRow = MappingFormValues['rows'][number]

/** 체크한 PM 이 있거나 이름을 적은 줄. 저장할 줄이다 */
const isFilled = ({ name, pmMemberId }: FormRow) => pmMemberId !== null || name.trim() !== ''

export interface MemberMappingForm extends AppForm<MappingFormValues> {
  initialRows: MappingRow[]
  /** PM 팀원. 먼저 만들어진 순서다 — 첫째가 워크스페이스를 만든 PM 이고 체크박스가 그 PM 을 가리킨다 (#228) */
  pms: Member[]
  /** 지금 팀원 목록. 이름 칸 제안에 쓴다 */
  members: Member[]
  /** 지금 입력한 줄 */
  rows: FormRow[]
  /** 저장할 줄 수 */
  filled: number
  formError: string | null
  setFormError: (message: string | null) => void
  /**
   * 입력한 매핑을 저장한다. 성공하면 true — 저장한 값이 새 기준이라 이탈 확인도 더 묻지 않는다.
   * `requirePm` 이면 줄 오류가 없을 때 PM 체크를 확인한다. 없으면 저장하지 않고 첫 체크박스로 포커스를 옮긴다
   */
  save: (values: MappingFormValues, requirePm?: boolean) => Promise<boolean>
  /** 저장하지 않고 이탈 확인 등록을 푼다 */
  release: () => void
}

/**
 * 팀원 연결 입력. 한 줄이 Discord 사용자 한 명이고 옆에 실제 팀원 이름을 적는다 (D-026).
 * 빈 줄은 저장하지 않는다 — 일부만 적어도 저장할 수 있다 (D-029). 같은 이름은 두 줄에 못 쓴다 (D-027).
 * 줄 맨 앞에서 PM 인지 체크한다 — 체크하면 이름 대신 기존 PM 에 잇는다 (#228).
 * 저장은 줄마다 순서대로다. 일부가 실패하면 실패한 줄에 오류를 두고 입력은 그대로 남긴다 — 다시 저장하면 남은 줄만 보낸다.
 * 저장한 뒤 할 일(단계 완료 등)은 부르는 화면이 정한다.
 */
export function useMemberMappingForm(
  workspaceId: string,
  initialRows: MappingRow[],
  pms: Member[],
): MemberMappingForm {
  const queryClient = useQueryClient()
  const memberList = useQuery(memberListQueryOptions(workspaceId))
  const { form, submit } = useAppForm(schema, {
    rows: initialRows.map((row) => ({ ...row, pmMemberId: row.pmMemberId ?? null })),
  })
  const {
    setError,
    clearErrors,
    setFocus,
    reset,
    watch,
    formState: { isDirty },
  } = form
  const unsaved = useUnsavedChanges(isDirty)
  const [formError, setFormError] = useState<string | null>(null)
  const rows = watch('rows')
  const creator = pms[0]

  const members = (): Member[] =>
    queryClient.getQueryData<Member[]>(memberListQueryOptions(workspaceId).queryKey) ?? []

  const save = async (values: MappingFormValues, requirePm = false): Promise<boolean> => {
    setFormError(null)
    clearErrors()
    const issues = findMappingIssues(values.rows, members())
    if (issues.size > 0) {
      let first = true
      for (const [index, issue] of issues) {
        setError(
          PM_ISSUES.has(issue) ? `rows.${index}.pmMemberId` : `rows.${index}.name`,
          { type: 'mapping', message: ISSUE_MESSAGES[issue] },
          { shouldFocus: first },
        )
        first = false
      }
      return false
    }
    if (requirePm && creator && values.rows.every(({ pmMemberId }) => pmMemberId === null)) {
      setFormError(PM_REQUIRED)
      setFocus('rows.0.pmMemberId')
      return false
    }
    try {
      await saveMemberMappings(queryClient, workspaceId, values.rows)
    } catch (error) {
      if (error instanceof MappingSaveError) {
        setError(
          values.rows[error.rowIndex].pmMemberId === null
            ? `rows.${error.rowIndex}.name`
            : `rows.${error.rowIndex}.pmMemberId`,
          { type: 'server', message: errorMessage(error.cause) },
          { shouldFocus: true },
        )
        setFormError(PARTIAL_FAILURE)
      } else {
        setFormError(errorMessage(error))
      }
      return false
    }
    reset(values)
    unsaved.release()
    return true
  }

  return {
    form,
    submit,
    initialRows,
    pms,
    members: memberList.data ?? [],
    rows,
    filled: rows.filter(isFilled).length,
    formError,
    setFormError,
    save,
    release: unsaved.release,
  }
}
