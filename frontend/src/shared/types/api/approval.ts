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
}

/**
 * 미합의 요청안. 현재 서버 ApprovalResolveRequest 에 없는 입력이다 — 개발 MSW 에서만 보낸다.
 * `approved` 이고 `task_create` 인 승인에만 쓴다
 */
export interface TaskOverridesDto {
  task_title: string
  assignee_member_id: string
  due_date: string
}

/**
 * `PATCH /approvals/{approval_id}` 본문. 서버 ApprovalResolveRequest 의 `status`·`confirm_task_version` 과
 * 미합의 `task_overrides` 다. 처리자(`resolved_by`)는 보내지 않는다 — 서버가 세션의 팀원으로 정한다
 */
export interface ApprovalResolveRequestDto {
  status: 'approved' | 'rejected'
  /** task_update 재승인에서만. 409 APPROVAL_CONFLICT 의 `details.task_version` 이다 */
  confirm_task_version?: number
  /** 미합의. MSW 의 approved task_create 에서만 */
  task_overrides?: TaskOverridesDto
}

/** 서버 `_find_conflicts` 의 항목. 값은 payload 에 저장된 모양(날짜는 ISO 문자열)이다 */
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

/** 409 APPROVAL_ALREADY_RESOLVED 의 `details` */
export interface ApprovalAlreadyResolvedDetailsDto {
  approval_id: string
  current_status: string
}
