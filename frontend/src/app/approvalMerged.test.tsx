import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { payloadVersionOf } from '@/shared/mock/approvalMerge'
import { db, replaceDb } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { createScenarioDb } from '@/shared/mock/scenarios'
import { recordRequestBodies } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

vi.mock('@/shared/config/env', () => ({
  config: { apiBaseUrl: '/api/v1', mswEnabled: true },
}))

vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
})

const CREATE = '이 태스크, 승인할까요?'
const titleInput = () => screen.getByRole('textbox', { name: '태스크명' })
const assigneeSelect = () => screen.getByRole('combobox', { name: /^담당자/ })
const dueInput = () => screen.getByRole('textbox', { name: /^마감/ })
const card = () => screen.getByRole('region', { name: 'Notion 에 올라갈 태스크' })

function versionOf(id: string) {
  const approval = db.approvals.find(({ approval_id }) => approval_id === id)
  if (!approval) throw new Error(`fixture ${id} is missing`)
  return payloadVersionOf(approval)
}

async function openDeployDoc() {
  const app = renderApp(paths.approval('ws_01', 'ap_03'))
  await screen.findByRole('heading', { level: 1, name: CREATE })
  await waitFor(() => expect(assigneeSelect()).toBeEnabled())
  return app
}

function rowOf(table: HTMLElement, field: string) {
  const header = within(table).getByRole('rowheader', { name: field })
  const row = header.closest('tr')
  if (!row) throw new Error(`row ${field} missing`)
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
}

describe('본 시점의 payload_version 을 승인·반려에 싣는다 (#547)', () => {
  it('상세에서 승인하면 화면을 그린 응답의 payload_version 을 보낸다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_03')
    const seen = versionOf('ap_03')
    await openDeployDoc()
    await userEvent.click(screen.getByRole('button', { name: '승인' }))
    await screen.findByTestId('approval-result')
    expect(seen).toMatch(/^[0-9a-f]{16}$/)
    expect(bodies).toEqual([{ status: 'approved', payload_version: seen }])
  })

  it('반려에도 본 시점의 payload_version 을 보낸다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_03')
    const seen = versionOf('ap_03')
    await openDeployDoc()
    await userEvent.click(screen.getByRole('button', { name: '반려' }))
    await screen.findByTestId('approval-result')
    expect(bodies).toEqual([{ status: 'rejected', payload_version: seen }])
  })

  it('목록 카드에서 바로 승인하면 그 카드를 그린 목록 응답의 값을 보낸다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_02')
    const seen = versionOf('ap_02')
    renderApp(`${paths.tasks('ws_01')}?tab=needs_review`)
    const list = await screen.findByRole('list', { name: '확인 필요 목록' })
    const item = within(list)
      .getAllByRole('article')
      .find((each) => each.textContent?.includes('테스트 계획 정리'))
    if (!item) throw new Error('approval card missing')
    const approve = within(item).getByRole('button', { name: /^승인$/ })
    await waitFor(() => expect(approve).toBeEnabled())
    await userEvent.click(approve)
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies).toEqual([{ status: 'approved', payload_version: seen }])
  })
})

describe('지문 밖에서 정해지는 별칭 후보는 최신 응답을 따른다 (#512 리뷰)', () => {
  it('같은 지문으로 다시 받은 카드가 별칭 후보가 되면, 켜진 등록 체크대로 save_alias 를 보낸다', async () => {
    db.aliases.push({
      alias_id: 'al_taken',
      member_id: 'mb_03',
      workspace_id: 'ws_01',
      alias_text: '지훈',
      alias_type: 'nickname',
      source: 'manual',
      confidence: 1,
      verified: true,
      created_at: MOCK_NOW,
    })
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_03')
    const seen = versionOf('ap_03')
    const app = await openDeployDoc()
    assigneeSelect().focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(await screen.findByRole('option', { name: '박민수' }))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(screen.queryByRole('checkbox')).toBeNull()

    db.aliases = db.aliases.filter(({ alias_id }) => alias_id !== 'al_taken')
    await act(() => app.queryClient.invalidateQueries({ queryKey: ['workspace', 'ws_01'] }))
    const register = await screen.findByRole('checkbox', {
      name: "'지훈'을 박민수의 별칭에도 등록",
    })
    expect(register).toBeChecked()
    expect(versionOf('ap_03')).toBe(seen)
    expect(screen.queryByRole('alert', { name: '바뀐 내용' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '승인' }))
    await screen.findByTestId('approval-result')
    expect(bodies).toEqual([
      {
        status: 'approved',
        payload_version: seen,
        save_alias: true,
        task_overrides: { assignee_member_id: 'mb_02' },
      },
    ])
  })
})

describe('본 뒤 합쳐진 카드는 바뀐 칸을 보이고 다시 확인하게 한다 (#512)', () => {
  beforeEach(() => replaceDb(createScenarioDb('approval-merged-after-view')))

  it('409 뒤 새 카드를 받아 바뀐 칸을 보이고, 고치지 않은 칸은 새 값·고친 칸은 PM 값으로 다시 승인한다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_03')
    const seen = versionOf('ap_03')
    await openDeployDoc()
    expect(dueInput()).toHaveValue('2026-09-25')
    fireEvent.change(titleInput(), { target: { value: '배포 문서 최종본' } })
    await userEvent.click(screen.getByRole('button', { name: '승인' }))

    const notice = await screen.findByRole('alert', { name: '바뀐 내용' })
    expect(notice).toHaveTextContent('보신 뒤에 내용이 바뀌었어요')
    expect(notice).toHaveTextContent('다른 회의의 항목 1개가 합쳐졌어요')
    const table = within(notice).getByRole('table', { name: '바뀐 칸' })
    expect(rowOf(table, '담당자')).toEqual(['미정', '이재환', '이재환'])
    expect(rowOf(table, '마감')).toEqual(['2026-09-25', '2026-09-26', '2026-09-26'])
    expect(within(table).queryByRole('rowheader', { name: '제목' })).toBeNull()
    expect(screen.queryByRole('region', { name: '변경 충돌' })).toBeNull()

    expect(titleInput()).toHaveValue('배포 문서 최종본')
    expect(dueInput()).toHaveValue('2026-09-26')
    expect(assigneeSelect()).toHaveTextContent('이재환')
    expect(db.approvals.find(({ approval_id }) => approval_id === 'ap_03')?.status).toBe('pending')

    const current = versionOf('ap_03')
    expect(current).not.toBe(seen)
    await userEvent.click(screen.getByRole('button', { name: '새 내용을 확인했어요, 승인' }))
    await screen.findByTestId('approval-result')
    expect(bodies).toEqual([
      {
        status: 'approved',
        payload_version: seen,
        task_overrides: { task_title: '배포 문서 최종본' },
      },
      {
        status: 'approved',
        payload_version: current,
        task_overrides: { task_title: '배포 문서 최종본' },
      },
    ])
    expect(db.tasks.at(-1)).toMatchObject({
      title: '배포 문서 최종본',
      assignee_member_id: 'mb_03',
      due_date: '2026-09-26',
    })
  })

  it('PM 이 고른 담당자는 새 제안이 와도 그대로 승인할 값으로 남는다', async () => {
    await openDeployDoc()
    assigneeSelect().focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(await screen.findByRole('option', { name: '박민수' }))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: '승인' }))

    const notice = await screen.findByRole('alert', { name: '바뀐 내용' })
    const table = within(notice).getByRole('table', { name: '바뀐 칸' })
    expect(rowOf(table, '담당자')).toEqual(['미정', '이재환', '박민수'])
    expect(assigneeSelect()).toHaveTextContent('박민수')
    expect(dueInput()).toHaveValue('2026-09-26')
  })

  it('반려도 409 면 반려하지 않고 새 내용을 보인다. 확인한 뒤 다시 반려할 수 있다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_03')
    await openDeployDoc()
    await userEvent.click(screen.getByRole('button', { name: '반려' }))
    await screen.findByRole('alert', { name: '바뀐 내용' })
    expect(db.approvals.find(({ approval_id }) => approval_id === 'ap_03')?.status).toBe('pending')
    expect(screen.getByText('반려하면 합쳐진 항목 2개가 모두 반려돼요.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '반려' }))
    await screen.findByTestId('approval-result')
    expect(bodies).toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' }),
    ])
  })

  it('409 없이 다시 받은 응답이 새 카드여도 같은 방식으로 바뀐 칸을 보인다', async () => {
    const app = await openDeployDoc()
    const approval = db.approvals.find(({ approval_id }) => approval_id === 'ap_03')
    if (!approval) throw new Error('fixture ap_03 is missing')
    const { mergePendingItems } = await import('@/shared/mock/approvalMerge')
    mergePendingItems(db, approval, MOCK_NOW)
    await act(() => app.queryClient.invalidateQueries({ queryKey: ['workspace', 'ws_01'] }))
    const notice = await screen.findByRole('alert', { name: '바뀐 내용' })
    expect(within(notice).getByRole('table', { name: '바뀐 칸' })).toBeInTheDocument()
    expect(dueInput()).toHaveValue('2026-09-26')
  })
})

describe('합쳐진 카드의 근거 (#512)', () => {
  beforeEach(() => replaceDb(createScenarioDb('approval-merged')))

  it('상세는 카드를 만든 회의의 대표 근거와 합쳐진 근거를 나누고, 담당자 근거와 전체 반려를 알린다', async () => {
    await openDeployDoc()
    const representative = within(card()).getByRole('region', {
      name: '대표 근거 · 카드를 만든 회의',
    })
    expect(within(representative).getByRole('figure', { name: '근거' })).toHaveTextContent(
      '지훈님이 배포 문서 보완을 맡기로 했어요.',
    )
    expect(within(representative).queryByText('담당자 근거')).toBeNull()
    const block = within(card()).getByRole('region', { name: '합친 내용' })
    expect(block).toHaveTextContent('회의 2곳의 항목 2개를 합친 확인 요청이에요.')
    expect(screen.getByText('반려하면 합쳐진 항목 2개가 모두 반려돼요.')).toBeInTheDocument()

    const toggle = within(block).getByRole('button', { name: '합쳐진 근거 1건 보기' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const merged = within(block).getByRole('list', { name: '합쳐진 근거' })
    const [item] = within(merged).getAllByRole('listitem')
    expect(item).toHaveTextContent('2주차 정기회의')
    expect(item).toHaveTextContent('배포 문서는 재환님이 26일까지 마무리해 주세요.')
    expect(item).toHaveTextContent('합친 시각')
    expect(within(item).getByText('담당자 근거')).toBeInTheDocument()
    // 합쳐진 근거도 그 회의의 근거 시각을 넘긴다 (#676)
    expect(within(item).getByRole('link', { name: /원문 듣기/ })).toHaveAttribute(
      'href',
      '/workspaces/ws_01/meetings/mt_07?t=1250000',
    )
    expect(within(block).getAllByText('담당자 근거')).toHaveLength(1)
  })

  it('대표 근거 아래에는 합친 뒤의 원문을 두지 않고, 합친 제안의 원문이라고 밝혀 따로 보인다', async () => {
    await openDeployDoc()
    const representative = within(card()).getByRole('region', {
      name: '대표 근거 · 카드를 만든 회의',
    })
    expect(representative).not.toHaveTextContent('원문 담당자')
    expect(representative).not.toHaveTextContent('26일')
    expect(within(card()).getByRole('region', { name: '합친 내용' })).toHaveTextContent(
      '합친 제안의 원문 담당자 재환 · 원문 마감 26일',
    )
  })

  it('목록 카드도 대표 인용 칸 밖에 합친 제안의 원문이라고 밝힌다', async () => {
    renderApp(`${paths.tasks('ws_01')}?tab=needs_review`)
    const list = await screen.findByRole('list', { name: '확인 필요 목록' })
    const merged = within(list).getAllByRole('article')[2]
    const quoteBox = within(merged).getByText('“지훈님이 배포 문서 보완을 맡기로 했어요.”')
      .parentElement as HTMLElement
    expect(quoteBox).not.toHaveTextContent('원문 담당자')
    expect(merged).toHaveTextContent('합친 제안의 원문 담당자 재환 · 원문 마감 26일')
  })

  it('목록 카드는 합쳐진 회의·항목 수를 보이고 처음 생긴 자리에 남는다', async () => {
    renderApp(`${paths.tasks('ws_01')}?tab=needs_review`)
    const list = await screen.findByRole('list', { name: '확인 필요 목록' })
    const titles = within(list)
      .getAllByRole('article')
      .map((each) => within(each).getByRole('heading', { level: 2 }).textContent)
    expect(titles).toEqual(['알림 문구 검토', '테스트 계획 정리', '배포 문서 보완'])
    const merged = within(list).getAllByRole('article')[2]
    expect(merged).toHaveTextContent('회의 2곳 · 항목 2개 합침')
    expect(within(list).getAllByRole('article')[1]).not.toHaveTextContent('합침')
  })

  it('회의록 항목은 그 항목의 제목을 두고 같은 승인 상세로 잇는다', async () => {
    const user = userEvent.setup()
    renderApp(paths.meetings('ws_01', 'mt_07'))
    await screen.findByRole('heading', { level: 2, name: '2주차 정기회의' })
    await user.click(screen.getByRole('tab', { name: /추출된 일/ }))
    const tasks = screen.getByRole('tabpanel')
    const link = await within(tasks).findByRole('link', { name: '배포 문서 마무리 확인하기' })
    expect(link).toHaveAttribute('href', paths.approval('ws_01', 'ap_03'))
    expect(within(tasks).queryByText('배포 문서 보완')).toBeNull()
  })
})
