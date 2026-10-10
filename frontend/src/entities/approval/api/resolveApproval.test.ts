import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { toApproval, toApprovalResolveFailure } from '../model/mapper'
import type { Approval } from '../model/types'
import { ApprovalNotResolvableError, resolveApproval } from './resolveApproval'

const MEMBERS = ['mb_01', 'mb_02', 'mb_03', 'mb_04']
const OVERRIDES = { taskTitle: '보완한 제목', assigneeMemberId: 'mb_02', dueDate: '2026-10-31' }

/** 이 테스트 동안 PATCH /approvals/:id 본문을 적고, 처리된 승인으로 답한다 */
function captureResolve(): unknown[] {
  const bodies: unknown[] = []
  server.use(
    http.patch('/api/v1/approvals/:approvalId', async ({ request, params }) => {
      const body = (await request.json()) as { status: string }
      bodies.push(body)
      const approval = db.approvals.find(({ approval_id }) => approval_id === params.approvalId)
      return ok({ ...approval, status: body.status, resolved_by: 'mb_01' })
    }),
  )
  return bodies
}

function pendingCreate(overrides: Partial<Approval> = {}): Approval {
  return { ...toApproval(db.approvals[0]), ...overrides } as Approval
}

function pendingUpdate(): Approval {
  return toApproval({
    ...db.approvals[0],
    approval_id: 'ap_up',
    type: 'task_update',
    related_task_id: 'tk_01',
    payload: { due_date: '2026-10-20', base_values: { due_date: '2026-09-20' } },
  })
}

beforeEach(() => {
  // 첫 승인의 담당자·마감을 확실히 채워 둔다 — 픽스처 변경과 무관하게 필수값 판정을 본다
  Object.assign(db.approvals[0].payload, { assignee_member_id: 'mb_01', due_date: '2026-10-15' })
})

describe('live 승인 요청', () => {
  it('필수값이 채워진 생성 승인은 status 만 보낸다. 보완값·처리자를 넣지 않는다', async () => {
    const bodies = captureResolve()
    const approval = await resolveApproval('ws_01', pendingCreate(), 'approved', {
      transport: 'live',
      memberIds: MEMBERS,
      overrides: OVERRIDES,
    })
    expect(bodies).toEqual([{ status: 'approved' }])
    expect(bodies[0]).not.toHaveProperty('task_overrides')
    expect(bodies[0]).not.toHaveProperty('resolved_by')
    expect(approval).toMatchObject({ id: 'ap_01', status: 'approved', resolvedBy: 'mb_01' })
  })

  it('필수값이 빠진 생성 승인은 요청하지 않고 이유와 함께 던진다. 반려는 보낸다', async () => {
    const bodies = captureResolve()
    const requests = recordRequests()
    const approval = pendingCreate({ dueDate: null })
    await expect(
      resolveApproval('ws_01', approval, 'approved', { transport: 'live', memberIds: MEMBERS }),
    ).rejects.toMatchObject({
      name: 'ApprovalNotResolvableError',
      issues: ['due'],
      reason: expect.stringContaining('지금 서버는 승인 전 보완을 지원하지 않아요') as string,
    })
    expect(requests.started).toEqual([])
    await resolveApproval('ws_01', approval, 'rejected', { transport: 'live', memberIds: MEMBERS })
    expect(bodies).toEqual([{ status: 'rejected' }])
  })

  it('다른 공간의 승인은 요청하지 않는다', async () => {
    const requests = recordRequests()
    await expect(
      resolveApproval('ws_02', pendingCreate(), 'rejected', { transport: 'live' }),
    ).rejects.toBeInstanceOf(ApprovalNotResolvableError)
    expect(requests.started).toEqual([])
  })
})

describe('msw 승인 요청', () => {
  it('approved task_create 에만 task_overrides 를 보낸다', async () => {
    const bodies = captureResolve()
    await resolveApproval('ws_01', pendingCreate({ dueDate: null }), 'approved', {
      transport: 'msw',
      memberIds: MEMBERS,
      overrides: OVERRIDES,
    })
    await resolveApproval('ws_01', pendingCreate(), 'rejected', {
      transport: 'msw',
      memberIds: MEMBERS,
      overrides: OVERRIDES,
    })
    expect(bodies).toEqual([
      {
        status: 'approved',
        task_overrides: {
          task_title: '보완한 제목',
          assignee_member_id: 'mb_02',
          due_date: '2026-10-31',
        },
      },
      { status: 'rejected' },
    ])
  })
})

describe('변경 승인', () => {
  it('서버 버전을 줄 때만 confirm_task_version 을 보낸다', async () => {
    const bodies = captureResolve()
    db.approvals.push({ ...db.approvals[0], approval_id: 'ap_up', type: 'task_update' })
    await resolveApproval('ws_01', pendingUpdate(), 'approved', {})
    await resolveApproval('ws_01', pendingUpdate(), 'approved', { confirmTaskVersion: 3 })
    expect(bodies).toEqual([
      { status: 'approved' },
      { status: 'approved', confirm_task_version: 3 },
    ])
  })

  it('409 APPROVAL_CONFLICT 본문을 task_version 과 conflicts 로 해석한다', async () => {
    server.use(
      http.patch('/api/v1/approvals/:approvalId', () =>
        fail('APPROVAL_CONFLICT', '제안 이후 task가 바뀌었습니다.', 409, {
          approval_id: 'ap_up',
          task_id: 'tk_01',
          task_version: 5,
          conflicts: [
            {
              field: 'due_date',
              base: '2026-09-20',
              current: '2026-09-25',
              proposed: '2026-10-20',
            },
            { field: 'assignee_member_id', base: 'mb_01', current: null, proposed: 'mb_02' },
          ],
        }),
      ),
    )
    const error: unknown = await resolveApproval('ws_01', pendingUpdate(), 'approved').catch(
      (caught: unknown) => caught,
    )
    expect(toApprovalResolveFailure(error)).toEqual({
      kind: 'conflict',
      approvalId: 'ap_up',
      taskId: 'tk_01',
      taskVersion: 5,
      conflicts: [
        { field: 'due_date', base: '2026-09-20', current: '2026-09-25', proposed: '2026-10-20' },
        { field: 'assignee_member_id', base: 'mb_01', current: null, proposed: 'mb_02' },
      ],
    })
  })

  it('409 APPROVAL_ALREADY_RESOLVED 를 현재 상태와 함께 구분한다', async () => {
    server.use(
      http.patch('/api/v1/approvals/:approvalId', () =>
        fail('APPROVAL_ALREADY_RESOLVED', '이미 처리된 승인 요청입니다.', 409, {
          approval_id: 'ap_up',
          current_status: 'rejected',
        }),
      ),
    )
    const error: unknown = await resolveApproval('ws_01', pendingUpdate(), 'approved').catch(
      (caught: unknown) => caught,
    )
    expect(toApprovalResolveFailure(error)).toEqual({
      kind: 'already_resolved',
      approvalId: 'ap_up',
      currentStatus: 'rejected',
    })
  })
})
