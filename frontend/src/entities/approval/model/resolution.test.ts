import { toApprovalResolveRequestDto } from './mapper'
import {
  aliasToLearn,
  planApprovalResolution,
  taskCreateValues,
  validateTaskCreateFields,
} from './resolution'
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
    evidence: { quote: null, speaker: null, speakerMemberId: null, atMs: null },
    meetingId: 'mt_09',
    extractionItemId: 'ei_04',
    gate: 'review',
    aliasCandidate: null,
    payloadVersion: null,
    mergedItems: [],
    assigneeItemId: 'ei_04',
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
    category: null,
    docText: null,
    evidence: { quote: null, speaker: null, speakerMemberId: null, atMs: null },
    meetingId: null,
    replyMessageId: null,
    assigneePick: null,
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
  return plan.ok ? toApprovalResolveRequestDto(plan.resolution) : null
}

describe('본 카드의 payload_version (#547)', () => {
  const seen = createApproval({ payloadVersion: 'c'.repeat(16) })

  it('생성 승인의 승인·반려 본문에 그 카드의 지문을 싣는다', () => {
    expect(body(seen, 'approved', { memberIds: MEMBERS })).toEqual({
      status: 'approved',
      payload_version: 'c'.repeat(16),
    })
    expect(body(seen, 'rejected', {})).toEqual({
      status: 'rejected',
      payload_version: 'c'.repeat(16),
    })
  })

  it('지문이 없는 카드와 변경 승인은 보내지 않는다', () => {
    expect(body(createApproval(), 'rejected', {})).toEqual({ status: 'rejected' })
    expect(body(updateApproval(), 'approved', {})).toEqual({ status: 'approved' })
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

  it.each([['현재 공간 팀원이 아님', 'mb_99']])(
    '%s 은 assignee 이슈다',
    (_label, assigneeMemberId) => {
      expect(
        validateTaskCreateFields(
          { taskTitle: '제목', assigneeMemberId, dueDate: '2026-10-15' },
          MEMBERS,
        ),
      ).toEqual(['assignee'])
    },
  )

  it.each(['', '2026-02-30', '2026/10/15', '2026-10-15T00:00:00Z', '26-10-15'])(
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

describe('생성 승인과 부분 보완', () => {
  it('담당자와 마감은 미정으로 승인할 수 있다', () => {
    expect(body(createApproval({ assigneeMemberId: null, dueDate: null }), 'approved', {})).toEqual(
      { status: 'approved' },
    )
  })
  it('보완 없이 승인하면 status만 보낸다', () => {
    expect(body(createApproval(), 'approved', { memberIds: MEMBERS })).toEqual({
      status: 'approved',
    })
  })
  it('실 API 본문에 보완한 값만 보내고 명시적 null은 보존한다', () => {
    expect(
      body(createApproval(), 'approved', {
        memberIds: MEMBERS,
        edits: { kind: 'task_create', values: { dueDate: null } },
      }),
    ).toEqual({ status: 'approved', task_overrides: { due_date: null } })
    expect(
      body(createApproval(), 'approved', {
        memberIds: MEMBERS,
        edits: { kind: 'task_create', values: OVERRIDES },
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
  it('undefined는 미정이 아닌 생략이다', () => {
    const approval = createApproval()
    expect(taskCreateValues(approval, { dueDate: undefined }).dueDate).toBe(approval.dueDate)
    expect(
      body(approval, 'approved', {
        memberIds: MEMBERS,
        edits: { kind: 'task_create', values: { dueDate: undefined } },
      }),
    ).toEqual({ status: 'approved' })
  })
  it('빈 보완은 생략하고 반려는 보완과 확인 버전을 보내지 않는다', () => {
    expect(
      body(createApproval(), 'approved', {
        memberIds: MEMBERS,
        edits: { kind: 'task_create', values: {} },
      }),
    ).toEqual({ status: 'approved' })
    expect(
      body(createApproval(), 'rejected', {
        edits: { kind: 'task_create', values: OVERRIDES },
        confirmTaskVersion: 5,
      }),
    ).toEqual({ status: 'rejected' })
  })
  it('잘못된 제목·담당자·날짜는 요청을 만들지 않는다', () => {
    expect(
      planApprovalResolution(createApproval(), 'approved', {
        memberIds: MEMBERS,
        edits: {
          kind: 'task_create',
          values: { taskTitle: ' ', assigneeMemberId: 'mb_99', dueDate: '2026-02-30' },
        },
      }),
    ).toMatchObject({ ok: false, issues: ['title', 'assignee', 'due'] })
  })
  it('수정 제안에는 상태와 마감만 보완하며 제안에 없던 필드도 명시적으로 정할 수 있다', () => {
    expect(
      body(updateApproval(), 'approved', {
        edits: { kind: 'task_update', values: { status: 'blocked', dueDate: null } },
      }),
    ).toEqual({ status: 'approved', task_overrides: { status: 'blocked', due_date: null } })
    expect(
      body(updateApproval(), 'approved', { edits: { kind: 'task_create', values: OVERRIDES } }),
    ).toBeNull()
  })
})

describe('담당자를 찾지 못한 답장 카드 (#344)', () => {
  const pickCard = () =>
    updateApproval({
      changes: [],
      category: 'assignee',
      replyMessageId: 'mg_31',
      assigneePick: { raw: '민지' },
    })
  const pick = (assigneeMemberId: string | null) => ({
    memberIds: MEMBERS,
    edits: { kind: 'task_update' as const, values: { assigneeMemberId } },
  })

  it('담당자를 고르기 전에는 승인할 수 없고 반려는 된다', () => {
    expect(planApprovalResolution(pickCard(), 'approved', { memberIds: MEMBERS })).toMatchObject({
      ok: false,
      reason: '담당자를 골라 주세요.',
    })
    expect(body(pickCard(), 'rejected', {})).toEqual({ status: 'rejected' })
  })

  it('고른 팀원이나 미정(null)을 task_overrides.assignee_member_id 로 보낸다', () => {
    expect(body(pickCard(), 'approved', pick('mb_02'))).toEqual({
      status: 'approved',
      task_overrides: { assignee_member_id: 'mb_02' },
    })
    expect(body(pickCard(), 'approved', pick(null))).toEqual({
      status: 'approved',
      task_overrides: { assignee_member_id: null },
    })
  })

  it('팀원이 아닌 값은 보내지 않는다', () => {
    expect(body(pickCard(), 'approved', pick('mb_99'))).toBeNull()
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

describe('별칭 등록 (save_alias, #523)', () => {
  const candidate = createApproval({ assigneeMemberId: null, aliasCandidate: '지훈' })
  const chosen = { kind: 'task_create', values: { assigneeMemberId: 'mb_02' } } as const

  it('후보에 담당자를 골라 등록을 켜고 승인하면 save_alias 를 보낸다', () => {
    expect(
      body(candidate, 'approved', { memberIds: MEMBERS, edits: { ...chosen, saveAlias: true } }),
    ).toEqual({
      status: 'approved',
      save_alias: true,
      task_overrides: { assignee_member_id: 'mb_02' },
    })
  })

  it('담당자가 처음부터 있는 후보도 등록을 켜면 보낸다', () => {
    expect(
      body(createApproval({ aliasCandidate: '지훈' }), 'approved', {
        memberIds: MEMBERS,
        edits: { kind: 'task_create', values: {}, saveAlias: true },
      }),
    ).toEqual({ status: 'approved', save_alias: true })
  })

  it.each([
    ['등록을 끔', candidate, { ...chosen, saveAlias: false }],
    ['등록을 고르지 않음', candidate, chosen],
    [
      '담당자가 미정',
      candidate,
      { kind: 'task_create', values: { assigneeMemberId: null }, saveAlias: true },
    ],
    ['후보가 아님', createApproval({ assigneeMemberId: null }), { ...chosen, saveAlias: true }],
  ] as const)('%s 이면 save_alias 를 싣지 않는다', (_, approval, edits) => {
    const sent = body(approval, 'approved', { memberIds: MEMBERS, edits })
    expect(sent).toMatchObject({ status: 'approved' })
    expect(sent).not.toHaveProperty('save_alias')
  })

  it('반려에는 싣지 않는다', () => {
    expect(
      body(candidate, 'rejected', { memberIds: MEMBERS, edits: { ...chosen, saveAlias: true } }),
    ).toEqual({ status: 'rejected' })
  })

  it('변경 승인은 등록을 실을 수 없다', () => {
    const sent = body(updateApproval(), 'approved', {
      edits: { kind: 'task_update', values: {} },
    })
    expect(sent).toEqual({ status: 'approved' })
  })

  it('등록할 별칭은 담당자가 있을 때만 있다', () => {
    const fields = { taskTitle: '배포 문서 보완', dueDate: null }
    expect(aliasToLearn(candidate, { ...fields, assigneeMemberId: 'mb_01' })).toBe('지훈')
    expect(aliasToLearn(candidate, { ...fields, assigneeMemberId: null })).toBeNull()
    expect(aliasToLearn(createApproval(), { ...fields, assigneeMemberId: 'mb_01' })).toBeNull()
  })
})

describe('처리할 수 없는 승인', () => {
  it('지원하지 않는 종류는 승인·반려 본문을 만들지 않는다', () => {
    const approval: Approval = { ...base, kind: 'unsupported', type: 'future_kind' }
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

describe('본문 변환', () => {
  it('각 종류에서 허용한 키만 직렬화한다', () => {
    expect(
      toApprovalResolveRequestDto({
        status: 'approved',
        kind: 'task_create',
        taskOverrides: { assigneeMemberId: null, dueDate: null },
      }),
    ).toEqual({ status: 'approved', task_overrides: { assignee_member_id: null, due_date: null } })
    expect(
      toApprovalResolveRequestDto({
        status: 'approved',
        kind: 'task_update',
        taskOverrides: { dueDate: null },
        confirmTaskVersion: 4,
      }),
    ).toEqual({ status: 'approved', task_overrides: { due_date: null }, confirm_task_version: 4 })
  })
})
