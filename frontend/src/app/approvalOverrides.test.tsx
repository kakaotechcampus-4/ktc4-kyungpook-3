import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { clearTrackedMeetings } from '@/entities/meeting'
import { taskDetailQueryOptions } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequestBodies } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

vi.setConfig({ testTimeout: 20_000 })
afterEach(() => clearTrackedMeetings())

const approve = () => screen.getByRole('button', { name: /^승인$/ })
const reapprove = () => screen.getByRole('button', { name: '지금 값을 확인했어요, 다시 승인' })
function updateProposal(
  payload: Record<string, unknown> = { status: 'done', base_values: { status: 'todo' } },
) {
  Object.assign(db.approvals[0], { type: 'task_update', related_task_id: 'tk_01', payload })
}
const CREATE = '이 태스크, 승인할까요?'
async function open(kind = '이 변경, 승인할까요?') {
  const app = renderApp(paths.approval('ws_01', 'ap_01'))
  await screen.findByRole('heading', { level: 1, name: kind })
  await waitFor(() => expect(approve()).toBeEnabled())
  return app
}
const dueInput = () => screen.getByRole('textbox', { name: '마감' })
const undecideDue = () => screen.getByRole('button', { name: '마감 미정' })
function edit(values: { due?: string; status?: string }) {
  if (values.due !== undefined) fireEvent.change(dueInput(), { target: { value: values.due } })
  if (values.status !== undefined)
    fireEvent.change(screen.getByRole('combobox', { name: '상태' }), {
      target: { value: values.status },
    })
}
function values(label: string) {
  return screen.getByLabelText(label).textContent
}

it('creates with undecided assignee/deadline through the live path and shows saved partial values beside the original proposal', async () => {
  db.approvals[0].payload.due_date = '2026-10-12'
  const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
  await open(CREATE)
  fireEvent.change(screen.getByRole('textbox', { name: '태스크명' }), {
    target: { value: '보완한 제목' },
  })
  // 마감을 비우면 미정으로 올라간다
  fireEvent.change(dueInput(), { target: { value: '' } })
  await waitFor(() => expect(approve()).toBeEnabled())
  await userEvent.click(approve())
  await screen.findByTestId('approval-result')
  expect(bodies).toEqual([
    { status: 'approved', task_overrides: { task_title: '보완한 제목', due_date: null } },
  ])
  expect(values('반영한 값')).toContain('보완한 제목')
  expect(values('반영한 값')).toContain('미정')
  expect(values('요청한 값')).toContain('알림 문구 검토')
  expect(values('요청한 값')).toContain('2026-10-12')
  expect(db.tasks.at(-1)).toMatchObject({
    title: '보완한 제목',
    assignee_member_id: null,
    due_date: null,
    status: 'todo',
  })
})

it('a deadline absent from proposal goes back to keeping the current task due once cleared, despite a current task refetch', async () => {
  updateProposal({ blocker: '제안 막힘 사유' })
  const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
  const app = await open()
  expect(screen.getByRole('combobox', { name: '상태' })).toHaveValue('')
  expect(dueInput()).toHaveValue('')
  fireEvent.change(screen.getByRole('combobox', { name: '상태' }), { target: { value: 'done' } })
  fireEvent.change(screen.getByRole('combobox', { name: '상태' }), { target: { value: '' } })
  expect(screen.getByRole('combobox', { name: '상태' })).toHaveValue('')
  Object.assign(db.tasks[0], { status: 'blocked', due_date: '2026-11-10', version: 2 })
  await act(() =>
    app.queryClient.invalidateQueries({
      queryKey: taskDetailQueryOptions('ws_01', 'tk_01').queryKey,
    }),
  )
  expect(screen.getByRole('combobox', { name: '상태' })).toHaveValue('')
  expect(dueInput()).toHaveValue('')
  // 미정으로 바꿨다가 날짜를 적으면 그 날짜이고, 칸을 비우면 원래 제안 유지로 돌아간다
  await userEvent.click(undecideDue())
  expect(dueInput()).toHaveAttribute('placeholder', '미정')
  edit({ due: '2026-10-01' })
  edit({ due: '' })
  expect(dueInput()).toHaveAttribute('placeholder', '원래 제안 유지 · YYYY-MM-DD')
  await userEvent.click(approve())
  await screen.findByTestId('approval-result')
  expect(bodies).toEqual([{ status: 'approved' }])
  expect(db.tasks[0]).toMatchObject({
    status: 'blocked',
    due_date: '2026-11-10',
    blocker: '제안 막힘 사유',
  })
})

it('「마감 미정」 sends an explicit null deadline absent from proposal', async () => {
  updateProposal({ blocker: '제안 막힘 사유' })
  db.tasks[0].due_date = '2026-11-10'
  const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
  await open()
  await userEvent.click(undecideDue())
  expect(dueInput()).toHaveValue('')
  expect(dueInput()).toHaveAttribute('placeholder', '미정')
  await userEvent.click(approve())
  await screen.findByTestId('approval-result')
  expect(bodies).toEqual([{ status: 'approved', task_overrides: { due_date: null } }])
  expect(db.tasks[0]).toMatchObject({ due_date: null, blocker: '제안 막힘 사유' })
})

it('clearing a proposed deadline keeps the field empty and approves the original proposal', async () => {
  updateProposal({ due_date: '2026-10-10', base_values: { due_date: '2026-09-13' } })
  db.tasks[0].due_date = '2026-09-13'
  const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
  await open()
  expect(dueInput()).toHaveValue('2026-10-10')
  await userEvent.clear(dueInput())
  expect(dueInput()).toHaveValue('')
  expect(dueInput()).toHaveAttribute('placeholder', '원래 제안 유지 · 2026-10-10')
  await userEvent.type(dueInput(), '2026-10-12')
  expect(dueInput()).toHaveValue('2026-10-12')
  await userEvent.clear(dueInput())
  await userEvent.click(approve())
  await screen.findByTestId('approval-result')
  expect(bodies).toEqual([{ status: 'approved' }])
  expect(db.tasks[0]).toMatchObject({ due_date: '2026-10-10' })
})

it('replays exact saved edits with each explicit conflict version, retaining drafts across repeated conflicts', async () => {
  updateProposal({
    status: 'done',
    due_date: '2026-10-10',
    base_values: { status: 'todo', due_date: '2026-09-13' },
  })
  const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
  await open()
  await userEvent.click(undecideDue())
  await userEvent.click(approve())
  const alert = await screen.findByRole('alert', { name: '변경 충돌' })
  expect(within(alert).getByRole('columnheader', { name: '확정할 값' })).toBeVisible()
  expect(within(alert).getByText('없음')).toBeVisible()
  Object.assign(db.tasks[0], { status: 'blocked', version: 2 })
  await userEvent.click(reapprove())
  await waitFor(() =>
    expect(
      within(screen.getByRole('alert', { name: '변경 충돌' })).getByText('막힘'),
    ).toBeVisible(),
  )
  expect(bodies).toEqual([
    { status: 'approved', task_overrides: { due_date: null } },
    { status: 'approved', task_overrides: { due_date: null }, confirm_task_version: 1 },
  ])
  await userEvent.click(reapprove())
  await screen.findByTestId('approval-result')
  expect(bodies.at(-1)).toEqual({
    status: 'approved',
    task_overrides: { due_date: null },
    confirm_task_version: 2,
  })
})

it('change then revert discards the old conflict confirmation without discarding the edited value', async () => {
  updateProposal()
  const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
  await open()
  edit({ due: '2026-10-22' })
  await userEvent.click(approve())
  await screen.findByRole('alert', { name: '변경 충돌' })
  edit({ due: '2026-10-23' })
  edit({ due: '2026-10-22' })
  await waitFor(() => expect(screen.queryByRole('alert', { name: '변경 충돌' })).toBeNull())
  expect(screen.queryByRole('button', { name: '지금 값을 확인했어요, 다시 승인' })).toBeNull()
  await userEvent.click(approve())
  await screen.findByRole('alert', { name: '변경 충돌' })
  expect(bodies).toEqual([
    { status: 'approved', task_overrides: { due_date: '2026-10-22' } },
    { status: 'approved', task_overrides: { due_date: '2026-10-22' } },
  ])
})

it.each([400, 404, 0])(
  'keeps confirmed edits after request failure %s and never shows success',
  async (status) => {
    updateProposal({ status: 'done' })
    server.use(
      http.patch('/api/v1/approvals/:id', () =>
        status === 0
          ? HttpResponse.error()
          : fail(status === 404 ? 'TASK_NOT_FOUND' : 'INVALID_REQUEST', 'x', status),
      ),
    )
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
    await open()
    edit({ due: '2026-10-22' })
    await userEvent.click(approve())
    await screen.findByRole('alert')
    expect(screen.queryByTestId('approval-result')).toBeNull()
    expect(dueInput()).toHaveValue('2026-10-22')
    expect(bodies).toEqual([{ status: 'approved', task_overrides: { due_date: '2026-10-22' } }])
  },
)

it('approved update values use partial saved overrides including null, rather than latest task values', async () => {
  updateProposal({ status: 'done', due_date: '2026-10-22', task_overrides: { due_date: null } })
  Object.assign(db.approvals[0], {
    status: 'approved',
    resolved_by: 'mb_01',
    resolved_at: '2026-09-18T00:00:00Z',
  })
  renderApp(paths.approval('ws_01', 'ap_01'))
  await screen.findByTestId('approval-result')
  const table = screen.getByRole('table', { name: '현재값과 제안값' })
  expect(within(table).getByText('완료')).toBeVisible()
  expect(within(table).getByText('없음')).toBeVisible()
  expect(values('원래 제안')).toContain('2026-10-22')
  expect(table).not.toHaveTextContent('2026-09-20')
})

it('inline approval card sends partial real API edits and leaves original evidence intact', async () => {
  const bodies = recordRequestBodies('PATCH', '/approvals/ap_02')
  renderApp(`${paths.tasks('ws_01')}?tab=needs_review`)
  const list = await screen.findByRole('list', { name: '확인 필요 목록' })
  const card = within(list)
    .getAllByRole('article')
    .find((each) => each.textContent?.includes('테스트 계획 정리'))
  if (!card) throw new Error('approval card missing')
  const title = within(card).getByRole('textbox', { name: '태스크명' })
  const original = card.textContent
  fireEvent.change(title, { target: { value: '목록에서 고친 제목' } })
  await userEvent.click(within(card).getByRole('button', { name: /^승인$/ }))
  await waitFor(() => expect(bodies).toHaveLength(1))
  expect(bodies).toEqual([
    { status: 'approved', task_overrides: { task_title: '목록에서 고친 제목' } },
  ])
  expect(original).toContain('원문 담당자')
  expect(db.approvals[1].payload.task_title).toBe('테스트 계획 정리')
})

it('an unchanged create form sends no overrides and does not warn when leaving', async () => {
  const app = await open(CREATE)
  act(() => app.navigate(paths.tasks('ws_01')))
  await app.expectPath(paths.tasks('ws_01'))
  expect(screen.queryByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })).toBeNull()
})

it('legacy progress appears only in read-only history with no rollback action', async () => {
  db.taskHistory.push({
    ...db.taskHistory[0],
    history_id: 'hs_legacy',
    changed_field: 'progress',
    old_value: '20',
    new_value: '40',
  })
  renderApp(paths.tasks('ws_01', 'tk_01'))
  expect(await screen.findByText('진행률: 20% → 40%')).toBeVisible()
  expect(within(screen.getByLabelText('태스크 정보')).queryByText('진행률')).toBeNull()
  expect(screen.queryByRole('button', { name: /되돌리기/ })).toBeNull()
})
