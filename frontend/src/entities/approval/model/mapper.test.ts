import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { toApproval } from './mapper'

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
    evidence: { quote: null, speaker: null, atMs: null },
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
