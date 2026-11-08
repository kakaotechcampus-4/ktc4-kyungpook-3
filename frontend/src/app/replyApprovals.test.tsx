import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db, replaceDb } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { createScenarioDb } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequestBodies } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
  replaceDb(createScenarioDb('reply-judgment'))
})
afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
})

describe('리마인드 답장에서 온 변경 승인 (#344)', () => {
  it('회의 대신 팀원 답장을 근거로 보이고, 회의 링크·회의 시각을 만들지 않는다', async () => {
    renderApp(paths.approval('ws_01', 'ap_31'))
    const heading = await screen.findByRole('heading', { level: 1, name: '이 변경, 승인할까요?' })
    await waitFor(() =>
      expect(heading.nextElementSibling).toHaveTextContent(
        '이재환의 리마인드 답장에서 나온 변경이에요.',
      ),
    )

    const reply = screen.getByRole('region', { name: '팀원 답장' })
    expect(within(reply).getByText('마감을 26일로 미루자고 했어요')).toBeVisible()
    const evidence = within(reply).getByRole('figure', { name: '근거' })
    expect(evidence).toHaveTextContent('마감은 26일까지 미뤄도 될까요?')
    await waitFor(() => expect(evidence).toHaveTextContent('리마인드 답장 · 이재환'))
    expect(evidence).not.toHaveTextContent('시각')
    expect(within(evidence).queryByRole('link')).toBeNull()
    expect(
      within(screen.getByRole('region', { name: 'Notion 에 올라갈 변경' })).queryByRole('link', {
        name: /회의/,
      }),
    ).toBeNull()

    const table = screen.getByRole('table', { name: '현재값과 제안값' })
    expect(within(table).getByText('2026-09-26')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '승인' })).toBeEnabled()
  })

  it('회의에서 온 변경 승인에는 답장 근거 칸이 없다', async () => {
    replaceDb(createScenarioDb('approval-conflict'))
    renderApp(paths.approval('ws_01', 'ap_04'))
    await screen.findByRole('heading', { level: 1, name: '이 변경, 승인할까요?' })
    expect(screen.queryByRole('region', { name: '팀원 답장' })).toBeNull()
  })
})

describe('담당자를 찾지 못한 답장 카드 (#344, BE #460)', () => {
  const NOTICE = '답장에서 말한 담당자 민지를 팀원에서 찾지 못했어요. 담당자를 골라 주세요.'
  const approve = () => screen.getByRole('button', { name: '승인' })
  const assigneeField = () => screen.getByRole('combobox', { name: '담당자' })
  const approval = (id: string) => db.approvals.find(({ approval_id }) => approval_id === id)!

  async function openCard(approvalId = 'ap_32') {
    renderApp(paths.approval('ws_01', approvalId))
    await screen.findByRole('heading', { level: 1, name: '이 변경, 승인할까요?' })
    expect(await screen.findByText(NOTICE)).toBeVisible()
    await waitFor(() => expect(assigneeField()).toBeEnabled())
  }
  async function chooseAssignee(name: string) {
    await userEvent.click(assigneeField())
    await userEvent.click(await screen.findByRole('option', { name }))
  }

  it('담당자를 고르기 전에는 승인이 막히고 반려는 된다', async () => {
    await openCard()
    expect(assigneeField()).toHaveAccessibleDescription(NOTICE)
    expect(assigneeField()).toHaveTextContent('담당자 고르기')
    expect(approve()).toBeDisabled()
    expect(screen.getByText('담당자를 골라 주세요.')).toBeVisible()
    expect(screen.getByRole('button', { name: '반려' })).toBeEnabled()
  })

  it('고른 팀원을 task_overrides.assignee_member_id 로 보내고 태스크 담당자가 바뀐다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_32')
    await openCard()
    expect(screen.queryByRole('table', { name: '현재값과 제안값' })).toBeNull()
    await chooseAssignee('박민수')
    const row = within(screen.getByRole('table', { name: '현재값과 제안값' })).getByRole('row', {
      name: /담당자/,
    })
    expect(row).toHaveTextContent('박민수')
    await waitFor(() => expect(approve()).toBeEnabled())
    await userEvent.click(approve())

    await waitFor(() =>
      expect(bodies).toEqual([
        { status: 'approved', task_overrides: { assignee_member_id: 'mb_02' } },
      ]),
    )
    await waitFor(() =>
      expect(db.tasks.find(({ task_id }) => task_id === 'tk_08')?.assignee_member_id).toBe('mb_02'),
    )
    const resolved = await screen.findByRole('table', { name: '현재값과 제안값' })
    await waitFor(() => expect(resolved).toHaveTextContent('반영한 값'))
    expect(within(resolved).getByRole('row', { name: /담당자/ })).toHaveTextContent('박민수')
    expect(screen.queryByText('원래 제안')).toBeNull()
  })

  it('미정을 고르면 null 을 보낸다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_32')
    await openCard()
    await chooseAssignee('미정')
    expect(assigneeField()).toHaveTextContent('미정')
    await waitFor(() => expect(approve()).toBeEnabled())
    await userEvent.click(approve())

    await waitFor(() =>
      expect(bodies).toEqual([
        { status: 'approved', task_overrides: { assignee_member_id: null } },
      ]),
    )
  })

  it('담당자를 찾은 답장 카드와 상태·마감만 있는 답장 카드에는 담당자 칸이 없다', async () => {
    approval('ap_32').payload.assignee_member_id = 'mb_04'
    const { unmount } = renderApp(paths.approval('ws_01', 'ap_32'))
    await screen.findByRole('heading', { level: 1, name: '이 변경, 승인할까요?' })
    await waitFor(() => expect(approve()).toBeEnabled())
    expect(screen.queryByRole('combobox', { name: '담당자' })).toBeNull()
    expect(screen.queryByText(NOTICE)).toBeNull()
    unmount()

    renderApp(paths.approval('ws_01', 'ap_31'))
    await screen.findByRole('heading', { level: 1, name: '이 변경, 승인할까요?' })
    await waitFor(() => expect(approve()).toBeEnabled())
    expect(screen.queryByRole('combobox', { name: '담당자' })).toBeNull()
  })

  it('상태와 담당자가 섞인 카드도 분류와 상관없이 담당자를 고르기 전에는 승인이 막힌다', async () => {
    const mixed = structuredClone(approval('ap_32'))
    mixed.approval_id = 'ap_33'
    mixed.payload = { ...mixed.payload, category: 'status', status: 'in_progress' }
    db.approvals.push(mixed)
    await openCard('ap_33')
    expect(approve()).toBeDisabled()

    await chooseAssignee('박민수')
    await waitFor(() => expect(approve()).toBeEnabled())
  })

  it.each([
    [400, 'INVALID_REQUEST', '요청 내용을 다시 확인해 주세요.'],
    [404, 'MEMBER_NOT_FOUND', '팀원을 찾을 수 없어요.'],
  ])(
    '승인이 %i %s 로 실패하면 카드는 대기로 남고 고른 칸과 오류가 보인다',
    async (status, code, message) => {
      server.use(http.patch('/api/v1/approvals/:approvalId', () => fail(code, 'x', status)))
      await openCard()
      await chooseAssignee('박민수')
      await waitFor(() => expect(approve()).toBeEnabled())
      await userEvent.click(approve())

      expect(await screen.findByText(message)).toBeVisible()
      expect(screen.queryByTestId('approval-result')).toBeNull()
      expect(screen.getByText(NOTICE)).toBeVisible()
      expect(assigneeField()).toHaveTextContent('박민수')
      expect(approval('ap_32').status).toBe('pending')
    },
  )

  it('대시보드 확인 필요 줄은 담당자를 골라야 한다고 알린다', async () => {
    renderApp(paths.dashboard('ws_01'))
    const list = await screen.findByRole('list', { name: '확인이 필요한 일 목록' })
    await waitFor(() =>
      expect(within(list).getByText('담당자를 골라야 하는 답장이에요')).toBeVisible(),
    )
  })
})
