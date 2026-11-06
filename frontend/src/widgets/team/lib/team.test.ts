import { toDiscordUser, toMember } from '@/entities/member'
import { toTask } from '@/entities/task'
import type { Task } from '@/entities/task'
import { MOCK_TODAY } from '@/shared/mock/fixtures/constants'
import { discordUserFixtures, memberFixtures } from '@/shared/mock/fixtures/member'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import { toTaskResponse } from '@/shared/mock/task-state'
import {
  avatarText,
  firstAttention,
  inactiveMemberIds,
  isWeekend,
  memberRisk,
  nextSevenDays,
  openTasksDueOn,
  tasksByMember,
  unlinkedDiscordUsers,
  weekdayOf,
} from './team'

/*
 * 팀 화면(Team 캔버스)의 순수 판정. 화면 통합은 app/team.test.tsx 가 본다.
 * 픽스처: ws_01 팀원 넷(mb_01 PM), 태스크 10건, 서울 오늘 2026-09-18.
 */

const tasks = taskFixtures.map((row) => toTask(toTaskResponse(row)))
const members = memberFixtures.map(toMember)
const discordUsers = discordUserFixtures.map(toDiscordUser)
const base = tasks[0]

function task(id: string, patch: Partial<Task> = {}): Task {
  return { ...base, id, title: id, ...patch }
}

describe('memberRisk', () => {
  it('막혔거나 기한이 지난 일이 있으면 위험, 7일 안 마감이면 주의, 아니면 정상이다', () => {
    expect(memberRisk([task('a', { status: 'blocked', dueDate: null })], MOCK_TODAY)).toBe('danger')
    expect(memberRisk([task('a', { dueDate: '2026-09-17' })], MOCK_TODAY)).toBe('danger')
    expect(memberRisk([task('a', { dueDate: '2026-09-24' })], MOCK_TODAY)).toBe('warn')
    expect(memberRisk([task('a', { dueDate: '2026-09-25' })], MOCK_TODAY)).toBe('normal')
    // 끝난 일은 기한이 지나도 보지 않는다
    expect(memberRisk([task('a', { status: 'done', dueDate: '2026-09-01' })], MOCK_TODAY)).toBe(
      'normal',
    )
    expect(memberRisk([], MOCK_TODAY)).toBe('normal')
  })
})

describe('tasksByMember', () => {
  it('담당자별로 묶고 끝나지 않은 일을 마감 순으로 먼저, 끝난 일은 뒤에 둔다. 담당자 없는 일은 뺀다', () => {
    const grouped = tasksByMember(tasks)
    expect(grouped.get('mb_01')?.map(({ id }) => id)).toEqual(['tk_01', 'tk_04', 'tk_09'])
    expect(grouped.get('mb_02')?.map(({ id }) => id)).toEqual(['tk_02', 'tk_05', 'tk_10'])
    expect([...grouped.values()].flat().some(({ id }) => id === 'tk_07')).toBe(false)
  })
})

describe('firstAttention', () => {
  it('기한 지남을 가장 먼저, 그중 마감이 빠른 일을 고르고 마지막 소식 날짜를 단다', () => {
    expect(firstAttention(members, tasks, MOCK_TODAY)).toMatchObject({
      kind: 'overdue',
      member: { id: 'mb_02' },
      task: { id: 'tk_02' },
      quietSince: '2026-09-17',
    })
  })

  it('기한 지남이 없으면 막힘, 그다음 곧 마감이다. 담당자 없는 일은 보지 않는다', () => {
    const blocked = task('b', { assigneeMemberId: 'mb_03', status: 'blocked', dueDate: null })
    const soon = task('s', { assigneeMemberId: 'mb_01', dueDate: '2026-09-20' })
    const nobody = task('n', { assigneeMemberId: null, dueDate: '2026-09-01' })
    expect(firstAttention(members, [soon, blocked, nobody], MOCK_TODAY)).toMatchObject({
      kind: 'blocked',
      task: { id: 'b' },
    })
    expect(firstAttention(members, [soon, nobody], MOCK_TODAY)).toMatchObject({
      kind: 'soon',
      task: { id: 's' },
    })
    expect(firstAttention(members, [nobody], MOCK_TODAY)).toBeNull()
  })

  it('오늘 바뀐 일은 소식이 없다고 하지 않는다', () => {
    const fresh = task('f', { dueDate: '2026-09-19', updatedAt: '2026-09-18T01:00:00Z' })
    expect(firstAttention(members, [fresh], MOCK_TODAY)?.quietSince).toBeNull()
  })
})

describe('앞으로 7일', () => {
  it('오늘부터 7일과 요일·주말을 낸다', () => {
    const days = nextSevenDays(MOCK_TODAY)
    expect(days).toEqual([
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
    ])
    expect(days.map(weekdayOf).join('')).toBe('금토일월화수목')
    expect(days.map(isWeekend)).toEqual([false, true, true, false, false, false, false])
  })

  it('그날 마감인 끝나지 않은 일만 고른다', () => {
    expect(openTasksDueOn(tasks, '2026-09-20').map(({ id }) => id)).toEqual(['tk_01'])
    expect(openTasksDueOn(tasks, '2026-09-14')).toEqual([])
  })
})

describe('Discord 계정 연결', () => {
  it('연결되지 않은 계정은 팀원과 잇지 않은 사람이고 봇은 뺀다 (D-076)', () => {
    expect(unlinkedDiscordUsers(discordUsers, members).map(({ username }) => username)).toEqual([
      'jihun_dev',
    ])
  })

  it('서버를 떠난 팀원은 비활성이다 (D-031)', () => {
    expect([...inactiveMemberIds(discordUsers, members)]).toEqual(['mb_04'])
  })
})

describe('avatarText', () => {
  it('세 글자 한글 이름은 성을 뺀 두 글자, 그 밖에는 앞 두 글자다', () => {
    expect(avatarText('김서연')).toBe('서연')
    expect(avatarText('지훈')).toBe('지훈')
    expect(avatarText('Alex')).toBe('Al')
    expect(avatarText(' 남궁민수 ')).toBe('남궁')
  })
})
