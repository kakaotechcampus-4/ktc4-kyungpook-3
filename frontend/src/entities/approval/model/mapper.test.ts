import { ApiError } from '@/shared/api/errors'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { toApproval, toApprovalResolveFailure } from './mapper'

it('maps task-create payload and derives each missing-field combination', () => {
  expect(approvalFixtures.map(toApproval)).toMatchObject([
    {
      id: 'ap_01',
      kind: 'task_create',
      title: '알림 문구 검토',
      missing: ['assignee', 'due'],
      gate: 'hold',
      relatedTaskId: null,
      assigneeRaw: '민수',
      evidence: { speaker: '1123', speakerMemberId: 'mb_01' },
    },
    { id: 'ap_02', missing: ['due'], assigneeMemberId: 'mb_02', gate: 'review' },
    { id: 'ap_03', missing: ['assignee'], dueDate: '2026-09-25', gate: 'review' },
  ])
})

it('tolerates missing payload leaves and follows the backend title fallback order', () => {
  expect(
    toApproval({ ...approvalFixtures[0], payload: { task_title: '', title: '대체 제목' } }),
  ).toMatchObject({
    title: '대체 제목',
    meetingId: null,
    extractionItemId: null,
    gate: null,
    evidence: { quote: null, speaker: null, speakerMemberId: null, atMs: null },
    missing: ['assignee', 'due'],
  })
  expect(toApproval({ ...approvalFixtures[0], payload: {} })).toMatchObject({ title: '' })
})

it('narrows task-update changes to the contract fields present in payload including null', () => {
  expect(
    toApproval({
      ...approvalFixtures[0],
      type: 'task_update',
      payload: { status: 'done', due_date: null, extra: 'ignored' },
    }),
  ).toMatchObject({
    kind: 'task_update',
    title: null,
    changes: [
      { field: 'status', value: 'done' },
      { field: 'due_date', value: null },
    ],
  })
})

it('names a task_update by the target task, not by the proposed title', () => {
  const update = (payload: Record<string, unknown>) =>
    toApproval({ ...approvalFixtures[0], type: 'task_update', payload })

  expect(
    update({ task_title: '로그인 API 연동', base_title: '로그인 연동', title: '새 제목' }),
  ).toMatchObject({
    title: '로그인 API 연동',
    changes: [{ field: 'title', value: '새 제목' }],
  })
  expect(update({ base_title: '로그인 연동', status: 'done' })).toMatchObject({
    title: '로그인 연동',
  })
  expect(update({ title: '새 제목' })).toMatchObject({ title: null })
})

it('marks reminder and unknown types unsupported and defaults unknown statuses', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(toApproval({ ...approvalFixtures[0], type: 'reminder_dm' })).toMatchObject({
      kind: 'unsupported',
      type: 'reminder_dm',
    })
    expect(toApproval({ ...approvalFixtures[0], type: 'future', status: 'future' })).toMatchObject({
      kind: 'unsupported',
      type: 'future',
      status: 'pending',
    })
    expect(warning).toHaveBeenCalled()
  } finally {
    warning.mockRestore()
  }
})

describe('toApprovalResolveFailure', () => {
  const conflictDetails = {
    approval_id: 'ap_01',
    task_id: 'tk_01',
    task_version: 2,
    conflicts: [{ field: 'status', base: 'todo', current: 'blocked', proposed: 'done' }],
  }
  const httpError = (code: string, details: Record<string, unknown> | null, status = 409) =>
    new ApiError({ code, message: code, details }, status)

  it('충돌 details 를 서버 필드 그대로 읽는다', () => {
    expect(toApprovalResolveFailure(httpError('APPROVAL_CONFLICT', conflictDetails))).toEqual({
      kind: 'conflict',
      approvalId: 'ap_01',
      taskId: 'tk_01',
      taskVersion: 2,
      conflicts: [{ field: 'status', base: 'todo', current: 'blocked', proposed: 'done' }],
    })
  })

  it.each([
    ['details 없음', null],
    ['정수가 아닌 버전', { ...conflictDetails, task_version: 2.5 }],
    ['문자열 버전', { ...conflictDetails, task_version: '2' }],
    ['0 버전', { ...conflictDetails, task_version: 0 }],
    ['conflicts 없음', { ...conflictDetails, conflicts: undefined }],
    ['field 없는 항목', { ...conflictDetails, conflicts: [{ base: 1, current: 2, proposed: 3 }] }],
    [
      'current 없는 항목',
      { ...conflictDetails, conflicts: [{ field: 'status', base: 1, proposed: 3 }] },
    ],
    ['task_id 없음', { ...conflictDetails, task_id: undefined }],
  ])('충돌 details 가 %s 이면 재승인 기준이 없어 null 이다', (_label, details) => {
    expect(
      toApprovalResolveFailure(
        httpError('APPROVAL_CONFLICT', details as Record<string, unknown> | null),
      ),
    ).toBeNull()
  })

  it('이미 처리됨은 현재 상태와 함께 읽고, 모르는 상태는 null 로 둔다', () => {
    expect(
      toApprovalResolveFailure(
        httpError('APPROVAL_ALREADY_RESOLVED', {
          approval_id: 'ap_01',
          current_status: 'approved',
        }),
      ),
    ).toEqual({ kind: 'already_resolved', approvalId: 'ap_01', currentStatus: 'approved' })
    expect(
      toApprovalResolveFailure(
        httpError('APPROVAL_ALREADY_RESOLVED', { approval_id: 'ap_01', current_status: 'future' }),
      ),
    ).toEqual({ kind: 'already_resolved', approvalId: 'ap_01', currentStatus: null })
  })

  it('409 가 아니거나 다른 코드·다른 오류는 null 이다', () => {
    expect(
      toApprovalResolveFailure(httpError('APPROVAL_CONFLICT', conflictDetails, 400)),
    ).toBeNull()
    expect(toApprovalResolveFailure(httpError('FORBIDDEN', null, 403))).toBeNull()
    expect(toApprovalResolveFailure(httpError('INVALID_REQUEST', null))).toBeNull()
    expect(toApprovalResolveFailure(new Error('boom'))).toBeNull()
    expect(toApprovalResolveFailure(undefined)).toBeNull()
  })
})

describe('stored approval edits', () => {
  it('keeps the original proposal and evidence separate from partial nullable overrides', () => {
    const original = approvalFixtures[0]
    expect(
      toApproval({
        ...original,
        status: 'approved',
        payload: {
          ...original.payload,
          task_overrides: { task_title: '최종 제목', due_date: null, future: true },
        },
      }),
    ).toMatchObject({
      title: original.payload.task_title,
      evidence: { quote: original.payload.evidence_quote },
      storedOverrides: { taskTitle: '최종 제목', dueDate: null },
    })
    expect(
      toApproval({
        ...original,
        type: 'task_update',
        status: 'approved',
        payload: { status: 'done', due_date: '2026-10-22', task_overrides: { due_date: null } },
      }),
    ).toMatchObject({
      changes: [
        { field: 'status', value: 'done' },
        { field: 'due_date', value: '2026-10-22' },
      ],
      storedOverrides: { dueDate: null },
    })
  })
  it.each([
    ['task_create', { task_title: null }],
    ['task_create', { assignee_member_id: 1 }],
    ['task_create', { due_date: false }],
    ['task_update', { status: null }],
    ['task_update', { status: 'invalid' }],
    ['task_update', { due_date: 2 }],
    ['task_create', null],
  ])('rejects malformed known stored fields for %s', (type, task_overrides) => {
    expect(() => toApproval({ ...approvalFixtures[0], type, payload: { task_overrides } })).toThrow(
      expect.objectContaining({ kind: 'invalid_response', code: 'INVALID_RESPONSE' }),
    )
  })
})
