import { toApprovalResolveRequestDto } from './mapper'
import { planApprovalResolution, toApprovalTransport, validateTaskCreateFields } from './resolution'
import type { ApprovalResolveContext, TaskCreateFields } from './resolution'
import type { Approval, TaskCreateApproval, TaskUpdateApproval } from './types'

const MEMBERS = ['mb_01', 'mb_02']

const base = {
  id: 'ap_01',
  workspaceId: 'ws_01',
  status: 'pending',
  relatedTaskId: null,
  requestedBy: null,
  resolvedBy: null,
  createdAt: '2026-09-15T06:00:00Z',
  resolvedAt: null,
} as const

function createApproval(overrides: Partial<TaskCreateApproval> = {}): TaskCreateApproval {
  return {
    ...base,
    kind: 'task_create',
    title: '로그인 API 연동',
    assigneeMemberId: 'mb_01',
    assigneeRaw: '민수',
    dueDate: '2026-10-15',
    dueRaw: '다음 주 목요일',
    missing: [],
    evidence: { quote: null, speaker: null, atMs: null },
    meetingId: 'mt_09',
    extractionItemId: 'ei_04',
    gate: 'review',
    ...overrides,
  }
}

function updateApproval(overrides: Partial<TaskUpdateApproval> = {}): TaskUpdateApproval {
  return {
    ...base,
    kind: 'task_update',
    relatedTaskId: 'tk_01',
    title: null,
    changes: [{ field: 'due_date', value: '2026-10-20' }],
    ...overrides,
  }
}

const OVERRIDES: TaskCreateFields = {
  taskTitle: '  확정 제목  ',
  assigneeMemberId: 'mb_02',
  dueDate: '2026-10-31',
}

/** 판정을 통과했으면 실제로 나갈 본문, 아니면 null */
function body(
  approval: Approval,
  decision: 'approved' | 'rejected',
  context: ApprovalResolveContext,
) {
  const plan = planApprovalResolution(approval, decision, context)
  return plan.ok ? toApprovalResolveRequestDto(plan.resolution, context.transport) : null
}

describe('transport', () => {
  it.each([
    ['msw', 'msw'],
    ['live', 'live'],
    [undefined, 'live'],
    [null, 'live'],
    ['MSW', 'live'],
    ['mock', 'live'],
    [true, 'live'],
  ])('%s 는 %s 로 본다', (raw, expected) => {
    expect(toApprovalTransport(raw)).toBe(expected)
  })
})

describe('생성 승인 필수값', () => {
  it('세 값이 유효하면 이슈가 없다', () => {
    expect(
      validateTaskCreateFields(
        { taskTitle: '제목', assigneeMemberId: 'mb_01', dueDate: '2026-10-15' },
        MEMBERS,
      ),
    ).toEqual([])
  })

  it.each([
    ['빈 제목', ''],
    ['공백뿐인 제목', '   '],
    ['301자 제목', '가'.repeat(301)],
  ])('%s 은 title 이슈다', (_label, taskTitle) => {
    expect(
      validateTaskCreateFields(
        { taskTitle, assigneeMemberId: 'mb_01', dueDate: '2026-10-15' },
        MEMBERS,
      ),
    ).toEqual(['title'])
  })

  it('제목 길이는 앞뒤 공백을 뺀 글자(코드 포인트) 수다', () => {
    const fields = (taskTitle: string) => ({
      taskTitle,
      assigneeMemberId: 'mb_01',
      dueDate: '2026-10-15',
    })
    expect(validateTaskCreateFields(fields(`  ${'가'.repeat(300)}  `), MEMBERS)).toEqual([])
    // 이모지는 UTF-16 으로 두 칸이지만 서버(Python)는 한 글자로 센다
    expect(validateTaskCreateFields(fields('😀'.repeat(300)), MEMBERS)).toEqual([])
    expect(validateTaskCreateFields(fields('😀'.repeat(301)), MEMBERS)).toEqual(['title'])
  })

  it.each([
    ['담당자 없음', null],
    ['현재 공간 팀원이 아님', 'mb_99'],
  ])('%s 은 assignee 이슈다', (_label, assigneeMemberId) => {
    expect(
      validateTaskCreateFields(
        { taskTitle: '제목', assigneeMemberId, dueDate: '2026-10-15' },
        MEMBERS,
      ),
    ).toEqual(['assignee'])
  })

  it.each([null, '', '2026-02-30', '2026/10/15', '2026-10-15T00:00:00Z', '26-10-15'])(
    '마감 %s 은 due 이슈다',
    (dueDate) => {
      expect(
        validateTaskCreateFields(
          { taskTitle: '제목', assigneeMemberId: 'mb_01', dueDate },
          MEMBERS,
        ),
      ).toEqual(['due'])
    },
  )
})

describe('live 생성 승인', () => {
  it('필수값이 채워져 있으면 보완값 없이 승인 본문을 만든다', () => {
    const result = body(createApproval(), 'approved', { transport: 'live', memberIds: MEMBERS })
    expect(result).toEqual({ status: 'approved' })
    expect(result).not.toHaveProperty('task_overrides')
    expect(result).not.toHaveProperty('resolved_by')
  })

  it('호출자가 보완값을 넘겨도 본문에 싣지 않는다', () => {
    const result = body(createApproval(), 'approved', {
      transport: 'live',
      memberIds: MEMBERS,
      overrides: OVERRIDES,
    })
    expect(result).toEqual({ status: 'approved' })
  })

  it('transport 가 빠지거나 모르는 값이면 live 로 처리해 보완값을 싣지 않는다', () => {
    for (const transport of [undefined, 'staging']) {
      expect(
        body(createApproval(), 'approved', { transport, memberIds: MEMBERS, overrides: OVERRIDES }),
      ).toEqual({ status: 'approved' })
    }
  })

  it('필수값이 빠지면 승인 본문을 만들지 않고 이유를 돌려준다. 반려는 가능하다', () => {
    const approval = createApproval({
      assigneeMemberId: null,
      dueDate: null,
      missing: ['assignee', 'due'],
    })
    const plan = planApprovalResolution(approval, 'approved', {
      transport: 'live',
      memberIds: MEMBERS,
    })
    expect(plan).toEqual({
      ok: false,
      issues: ['assignee', 'due'],
      reason:
        '승인하려면 담당자·마감 정보를 올바르게 채워야 해요. 지금 서버는 승인 전 보완을 지원하지 않아요.',
    })
    expect(body(approval, 'rejected', { transport: 'live', memberIds: MEMBERS })).toEqual({
      status: 'rejected',
    })
  })

  // live 는 보완을 받지 않으므로 넘어온 보완값이 유효해도 기존 값으로만 판정한다
  it('기존 값이 비어 있으면 유효한 보완값을 넘겨도 승인할 수 없다', () => {
    const plan = planApprovalResolution(createApproval({ dueDate: null }), 'approved', {
      transport: 'live',
      memberIds: MEMBERS,
      overrides: OVERRIDES,
    })
    expect(plan).toMatchObject({ ok: false, issues: ['due'] })
  })

  it('담당자가 현재 공간 팀원 목록에 없으면 승인할 수 없다', () => {
    expect(
      planApprovalResolution(createApproval(), 'approved', {
        transport: 'live',
        memberIds: ['mb_02'],
      }),
    ).toMatchObject({ ok: false, issues: ['assignee'] })
    expect(
      planApprovalResolution(createApproval(), 'approved', { transport: 'live' }),
    ).toMatchObject({
      ok: false,
      issues: ['assignee'],
    })
  })
})

describe('msw 생성 승인', () => {
  it('approved task_create 에만 보완값 세 필드를 싣는다', () => {
    expect(
      body(createApproval({ dueDate: null }), 'approved', {
        transport: 'msw',
        memberIds: MEMBERS,
        overrides: OVERRIDES,
      }),
    ).toEqual({
      status: 'approved',
      task_overrides: {
        task_title: '확정 제목',
        assignee_member_id: 'mb_02',
        due_date: '2026-10-31',
      },
    })
  })

  it('보완값이 없으면 기존 값으로 판정하고 보완값을 싣지 않는다', () => {
    expect(body(createApproval(), 'approved', { transport: 'msw', memberIds: MEMBERS })).toEqual({
      status: 'approved',
    })
  })

  it('보완값이 유효하지 않으면 승인 본문을 만들지 않는다', () => {
    const plan = planApprovalResolution(createApproval(), 'approved', {
      transport: 'msw',
      memberIds: MEMBERS,
      overrides: { taskTitle: ' ', assigneeMemberId: 'mb_99', dueDate: '2026-13-01' },
    })
    expect(plan).toEqual({
      ok: false,
      issues: ['title', 'assignee', 'due'],
      reason: '승인하려면 제목·담당자·마감 정보를 올바르게 채워야 해요.',
    })
  })

  it('반려 본문에는 보완값을 싣지 않는다', () => {
    expect(
      body(createApproval(), 'rejected', {
        transport: 'msw',
        memberIds: MEMBERS,
        overrides: OVERRIDES,
      }),
    ).toEqual({ status: 'rejected' })
  })

  it('task_update 에는 보완값을 싣지 않는다', () => {
    expect(body(updateApproval(), 'approved', { transport: 'msw', overrides: OVERRIDES })).toEqual({
      status: 'approved',
    })
  })
})

describe('변경 승인과 confirm_task_version', () => {
  it('서버 버전을 주지 않으면 싣지 않는다', () => {
    expect(body(updateApproval(), 'approved', {})).toEqual({ status: 'approved' })
  })

  it('호출자가 서버 버전을 주면 confirm_task_version 으로 싣는다', () => {
    expect(body(updateApproval(), 'approved', { confirmTaskVersion: 4 })).toEqual({
      status: 'approved',
      confirm_task_version: 4,
    })
  })

  it.each([0, -1, 1.5, Number.NaN, null])('버전이 %s 이면 싣지 않는다', (confirmTaskVersion) => {
    expect(body(updateApproval(), 'approved', { confirmTaskVersion })).toEqual({
      status: 'approved',
    })
  })

  it('반려와 생성 승인에는 싣지 않는다', () => {
    expect(body(updateApproval(), 'rejected', { confirmTaskVersion: 4 })).toEqual({
      status: 'rejected',
    })
    expect(
      body(createApproval(), 'approved', { memberIds: MEMBERS, confirmTaskVersion: 4 }),
    ).toEqual({ status: 'approved' })
  })
})

describe('처리할 수 없는 승인', () => {
  it('지원하지 않는 종류는 승인·반려 본문을 만들지 않는다', () => {
    const approval: Approval = { ...base, kind: 'unsupported', type: 'reminder_dm' }
    for (const decision of ['approved', 'rejected'] as const)
      expect(planApprovalResolution(approval, decision)).toMatchObject({
        ok: false,
        reason: '지원하지 않는 확인 요청이라 여기서 처리할 수 없어요.',
      })
  })

  it.each(['approved', 'rejected'] as const)('이미 %s 인 승인은 다시 처리하지 않는다', (status) => {
    for (const approval of [createApproval({ status }), updateApproval({ status })])
      for (const decision of ['approved', 'rejected'] as const)
        expect(planApprovalResolution(approval, decision, { memberIds: MEMBERS })).toMatchObject({
          ok: false,
          reason: '이미 처리된 확인 요청이에요.',
        })
  })
})

describe('본문 변환의 방어', () => {
  it('처리 내용에 보완값이 있어도 live 본문에는 싣지 않는다', () => {
    const resolution = {
      status: 'approved',
      taskOverrides: { taskTitle: '제목', assigneeMemberId: 'mb_01', dueDate: '2026-10-15' },
    } as const
    expect(toApprovalResolveRequestDto(resolution, 'live')).toEqual({ status: 'approved' })
    expect(toApprovalResolveRequestDto(resolution, undefined)).toEqual({ status: 'approved' })
    expect(toApprovalResolveRequestDto(resolution, 'msw')).toEqual({
      status: 'approved',
      task_overrides: { task_title: '제목', assignee_member_id: 'mb_01', due_date: '2026-10-15' },
    })
  })
})
