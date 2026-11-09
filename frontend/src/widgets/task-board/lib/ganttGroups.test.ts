import { describe, expect, it } from 'vitest'
import { toApproval } from '@/entities/approval'
import type { TaskCreateApproval } from '@/entities/approval'
import type { Member } from '@/entities/member'
import type { Task } from '@/entities/task'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { groupRows } from './ganttGroups'

const member = (id: string, displayName: string, role: Member['role'] = 'member'): Member => ({
  id,
  workspaceId: 'ws_01',
  displayName,
  discordUserId: null,
  notionName: null,
  role,
  hasLoginAccount: false,
  createdAt: '2026-09-01T00:00:00Z',
})

const task = (
  id: string,
  assigneeMemberId: string | null,
  dueDate: string | null = '2026-11-10',
): Task => ({
  id,
  workspaceId: 'ws_01',
  meetingId: null,
  meetingDeleted: false,
  title: id,
  assigneeMemberId,
  status: 'todo',
  blocker: null,
  dueDate,
  startDate: '2026-11-02',
  notionPageId: null,
  version: 1,
  notionSyncStatus: null,
  autoBlocked: false,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
})

const createBase = approvalFixtures
  .map(toApproval)
  .find((approval): approval is TaskCreateApproval => approval.kind === 'task_create')
if (createBase === undefined) throw new Error('생성 승인 fixture 가 없다')

const approval = (
  id: string,
  assigneeMemberId: string | null,
  dueDate: string | null = '2026-11-12',
): TaskCreateApproval => ({ ...createBase, id, title: id, assigneeMemberId, dueDate })

const SEOYEON = member('mb_01', '김서연', 'pm')
const MINSU = member('mb_02', '박민수')
const JAEHWAN = member('mb_03', '이재환')

const ids = (items: readonly { id: string }[]) => items.map(({ id }) => id)
const shape = (result: ReturnType<typeof groupRows>) =>
  result.groups.map((group) => [group.key, ids(group.approvals), ids(group.tasks)])

describe('간트 담당자별 묶음', () => {
  it('팀원 목록 순서대로 묶고, 알 수 없는 담당자·미지정이 그 뒤에 온다. 묶음 안은 받은 순서다', () => {
    const result = groupRows(
      [SEOYEON, MINSU, JAEHWAN],
      [
        task('t1', null),
        task('t2', 'mb_02'),
        task('t3', 'mb_gone'),
        task('t4', 'mb_01'),
        task('t5', 'mb_02'),
      ],
      [],
    )
    expect(shape(result)).toEqual([
      ['mb_01', [], ['t4']],
      ['mb_02', [], ['t2', 't5']],
      ['unknown', [], ['t3']],
      ['unassigned', [], ['t1']],
    ])
  })

  it('팀원 묶음은 이름과 역할을, 알 수 없는 담당자·미지정은 이름 없이 고정 문구를 쓴다', () => {
    const result = groupRows(
      [SEOYEON, MINSU],
      [task('t1', 'mb_01'), task('t2', 'mb_02'), task('t3', 'mb_gone'), task('t4', null)],
      [],
    )
    expect(result.groups.map(({ key, name, label, note }) => ({ key, name, label, note }))).toEqual(
      [
        { key: 'mb_01', name: '김서연', label: '김서연', note: 'PM' },
        { key: 'mb_02', name: '박민수', label: '박민수', note: '팀원' },
        {
          key: 'unknown',
          name: null,
          label: '알 수 없는 담당자',
          note: '팀원 정보를 찾지 못했어요',
        },
        { key: 'unassigned', name: null, label: '미지정', note: '승인하면 담당자가 붙습니다' },
      ],
    )
  })

  it('알 수 없는 담당자가 여럿이면 담당자별로 모으지 않고 받은 순서 그대로 한 묶음에 둔다', () => {
    const result = groupRows(
      [MINSU],
      [task('t1', 'mb_x'), task('t2', 'mb_y'), task('t3', 'mb_x'), task('t4', 'mb_02')],
      [approval('a1', 'mb_y'), approval('a2', 'mb_x')],
    )
    expect(shape(result)).toEqual([
      ['mb_02', [], ['t4']],
      ['unknown', ['a1', 'a2'], ['t1', 't2', 't3']],
    ])
  })

  it('일이 없는 팀원은 줄을 그리지 않는다. 팀원 조회에 실패하면 담당자 있는 일은 모두 알 수 없는 담당자다', () => {
    expect(shape(groupRows([SEOYEON, MINSU, JAEHWAN], [task('t1', 'mb_03')], []))).toEqual([
      ['mb_03', [], ['t1']],
    ])
    expect(shape(groupRows([], [task('t1', 'mb_01'), task('t2', null)], []))).toEqual([
      ['unknown', [], ['t1']],
      ['unassigned', [], ['t2']],
    ])
  })

  it('빈 목록이면 묶음도 일정이 없는 일도 없다', () => {
    expect(groupRows([], [], [])).toEqual({
      groups: [],
      unscheduledTasks: [],
      unscheduledApprovals: [],
    })
    expect(groupRows([SEOYEON, MINSU], [], [])).toEqual({
      groups: [],
      unscheduledTasks: [],
      unscheduledApprovals: [],
    })
  })

  it('확인 필요 생성 승인은 태스크와 같은 규칙으로 따로 모이고, 승인만 있는 팀원도 줄을 그린다', () => {
    const result = groupRows(
      [SEOYEON, MINSU],
      [task('t1', 'mb_01')],
      [
        approval('a1', 'mb_02'),
        approval('a2', null),
        approval('a3', 'mb_01'),
        approval('a4', 'mb_gone'),
      ],
    )
    expect(shape(result)).toEqual([
      ['mb_01', ['a3'], ['t1']],
      ['mb_02', ['a1'], []],
      ['unknown', ['a4'], []],
      ['unassigned', ['a2'], []],
    ])
  })

  it('마감이 없는 일은 담당자와 관계없이 묶음에 넣지 않고 받은 순서대로 일정이 없는 일로 보낸다', () => {
    const result = groupRows(
      [SEOYEON],
      [
        task('t1', 'mb_01', null),
        task('t2', 'mb_01'),
        task('t3', null, null),
        task('t4', 'mb_gone', null),
      ],
      [approval('a1', null, null), approval('a2', 'mb_01', null), approval('a3', 'mb_01')],
    )
    expect(shape(result)).toEqual([['mb_01', ['a3'], ['t2']]])
    expect(ids(result.unscheduledTasks)).toEqual(['t1', 't3', 't4'])
    expect(ids(result.unscheduledApprovals)).toEqual(['a1', 'a2'])
  })

  it('담당자가 바뀐 태스크는 새 담당자 묶음으로 옮기고, 비게 된 묶음은 사라진다', () => {
    const before = [task('t1', 'mb_01'), task('t2', 'mb_02')]
    expect(shape(groupRows([SEOYEON, MINSU], before, []))).toEqual([
      ['mb_01', [], ['t1']],
      ['mb_02', [], ['t2']],
    ])
    const after = [{ ...before[0], assigneeMemberId: 'mb_02' }, before[1]]
    expect(shape(groupRows([SEOYEON, MINSU], after, []))).toEqual([['mb_02', [], ['t1', 't2']]])
    const unassigned = [{ ...before[0], assigneeMemberId: null }, before[1]]
    expect(shape(groupRows([SEOYEON, MINSU], unassigned, []))).toEqual([
      ['mb_02', [], ['t2']],
      ['unassigned', [], ['t1']],
    ])
  })

  it('묶음과 일정이 없는 일은 받은 태스크·승인 객체를 그대로 담는다', () => {
    const scheduled = task('t1', 'mb_01')
    const unscheduled = task('t2', 'mb_01', null)
    const pending = approval('a1', 'mb_01')
    const result = groupRows([SEOYEON], [scheduled, unscheduled], [pending])
    expect(result.groups[0].tasks[0]).toBe(scheduled)
    expect(result.groups[0].approvals[0]).toBe(pending)
    expect(result.unscheduledTasks[0]).toBe(unscheduled)
  })
})
