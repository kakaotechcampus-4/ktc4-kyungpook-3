export interface ApprovalDto {
  approval_id: string
  workspace_id: string
  type: string
  payload: Record<string, unknown>
  related_task_id: string | null
  requested_by: string | null
  status: string
  resolved_by: string | null
  created_at: string
  resolved_at: string | null
  /** task_create 카드 payload 의 지문 (#547). 같은지만 비교하고 형식에 기대지 않는다. 그 밖의 종류는 null, #547 이전 서버는 없다 */
  payload_version?: string | null
  /** 담당자를 못 찾은 이름 지목의 pending 생성 승인이고 아직 누구의 별칭도 아니면 true (#523). 처리 뒤에는 늘 false */
  alias_candidate: boolean
  /** 별칭으로 저장될 글자. `alias_candidate` 가 false 면 null */
  alias_text: string | null
}

export type TaskOverridesDto =
  | Partial<{ task_title: string; assignee_member_id: string | null; due_date: string | null }>
  | Partial<{
      status: 'todo' | 'in_progress' | 'blocked' | 'done'
      due_date: string | null
      assignee_member_id: string | null
    }>

export interface ApprovalResolveRequestDto {
  status: 'approved' | 'rejected'
  confirm_task_version?: number
  task_overrides?: TaskOverridesDto
  /** 생성 승인에서 고른 담당자에게 `alias_text` 를 별칭으로 저장한다. 서버는 후보가 아니거나 미정이면 무시한다 */
  save_alias?: boolean
  /** PM 이 본 카드의 `payload_version`. 처리할 때 값이 다르면 409 APPROVAL_CHANGED 다 */
  payload_version?: string
}

export interface ApprovalConflictItemDto {
  field: string
  base: unknown
  current: unknown
  proposed: unknown
}

/** 409 APPROVAL_CONFLICT 의 `details` */
export interface ApprovalConflictDetailsDto {
  approval_id: string
  task_id: string
  task_version: number
  conflicts: ApprovalConflictItemDto[]
}

/** 409 APPROVAL_CHANGED 의 `details`. `payload_version` 은 지금 값이다 */
export interface ApprovalChangedDetailsDto {
  approval_id: string
  payload_version: string
}

/** 409 APPROVAL_ALREADY_RESOLVED 의 `details` */
export interface ApprovalAlreadyResolvedDetailsDto {
  approval_id: string
  current_status: string
}
