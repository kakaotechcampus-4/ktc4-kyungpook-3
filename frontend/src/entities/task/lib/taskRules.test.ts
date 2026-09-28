import { taskFixtures } from '@/shared/mock/fixtures/task'
import { MOCK_TODAY, MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { toTask } from '../model/mapper'
import { filterByTab } from './taskFilter'
import { isOverdue, isDueSoon } from './taskDate'
import { withAssigneeName } from './assignee'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => vi.useRealTimers())

it('counts every non-done status as in progress without mutating the task list', () => {
  const tasks = taskFixtures.map(toTask)
  expect(filterByTab(tasks, 'in_progress').map(({ id }) => id)).toEqual([
    'tk_01',
    'tk_02',
    'tk_03',
    'tk_04',
    'tk_05',
    'tk_06',
    'tk_07',
  ])
  expect(filterByTab(tasks, 'done').map(({ id }) => id)).toEqual(['tk_08', 'tk_09', 'tk_10'])
  expect(tasks).toHaveLength(10)
})

it('reproduces the fixed overdue and inclusive seven-day counts without overlap', () => {
  const tasks = taskFixtures.map(toTask)
  expect(tasks.filter((task) => isOverdue(task, MOCK_TODAY)).map(({ id }) => id)).toEqual([
    'tk_02',
    'tk_07',
  ])
  expect(
    tasks.filter((task) => isDueSoon(task, MOCK_TODAY, '2026-09-24')).map(({ id }) => id),
  ).toEqual(['tk_01', 'tk_03', 'tk_04', 'tk_06'])
  expect(isOverdue(tasks[7], MOCK_TODAY)).toBe(false)
  expect(isDueSoon({ ...tasks[0], dueDate: MOCK_TODAY }, MOCK_TODAY, '2026-09-24')).toBe(true)
  expect(isDueSoon({ ...tasks[0], dueDate: '2026-09-25' }, MOCK_TODAY, '2026-09-24')).toBe(false)
  expect(
    tasks
      .filter((task) => task.status !== 'done' && task.dueDate !== null)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
      .slice(0, 5)
      .map(({ id }) => id),
  ).toEqual(['tk_07', 'tk_02', 'tk_06', 'tk_01', 'tk_03'])
  expect(tasks.filter((task) => task.status === 'blocked')).toHaveLength(1)
})

it('joins an injected name map and preserves missing names without changing the task', () => {
  const tasks = taskFixtures.map(toTask)
  const names = new Map([['mb_01', '김서연']])
  expect(withAssigneeName(tasks[0], names)).toMatchObject({ id: 'tk_01', assigneeName: '김서연' })
  expect(withAssigneeName(tasks[1], names).assigneeName).toBeNull()
  expect(withAssigneeName(tasks[6], names).assigneeName).toBeNull()
  expect(tasks[0]).not.toHaveProperty('assigneeName')
})
