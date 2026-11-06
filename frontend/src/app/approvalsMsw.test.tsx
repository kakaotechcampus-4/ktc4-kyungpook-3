import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db, replaceDb } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { handlers } from '@/shared/mock/handlers'
import { createScenarioDb } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
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

const settle = (ms = 80) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

function approvalOf(id: string) {
  const found = db.approvals.find(({ approval_id }) => approval_id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found
}
function itemOf(id: string) {
  const found = db.extractions.flatMap(({ items }) => items).find(({ item_id }) => item_id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found
}
const CREATE = '이 태스크, 승인할까요?'
const approveButton = () => screen.getByRole('button', { name: '승인' })
const rejectButton = () => screen.getByRole('button', { name: '반려' })
const titleInput = () => screen.getByRole('textbox', { name: '태스크명' })
const assigneeSelect = () => screen.getByRole('combobox', { name: /^담당자/ })
const dueInput = () => screen.getByRole('textbox', { name: /^마감/ })
const card = () => screen.getByRole('region', { name: 'Notion 에 올라갈 태스크' })
const evidence = () => within(card()).getByRole('figure', { name: '근거' })
const reasons = () => screen.queryByRole('region', { name: '확인이 필요한 이유' })
/** 제목 아래 한 줄. 회의 이름이 굵은 글자로 나뉘어 있다 */
const lead = () => screen.getByRole('heading', { level: 1 }).nextElementSibling
const patches = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method, path }) => method === 'PATCH' && path.startsWith('/approvals/'))

async function openApproval(id: string) {
  const app = renderApp(paths.approval('ws_01', id))
  await screen.findByRole('heading', { level: 1, name: CREATE })
  // 팀원 목록까지 받아야 담당자를 고를 수 있다
  await waitFor(() => expect(assigneeSelect()).toBeEnabled())
  return app
}
function fill(values: { title?: string; due?: string }) {
  if (values.title !== undefined)
    fireEvent.change(titleInput(), { target: { value: values.title } })
  if (values.due !== undefined) fireEvent.change(dueInput(), { target: { value: values.due } })
}
async function pickAssignee(name: string) {
  assigneeSelect().focus()
  await userEvent.keyboard('{Enter}')
  await userEvent.click(await screen.findByRole('option', { name }))
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}
const snapshot = () =>
  structuredClone({
    tasks: db.tasks,
    history: db.taskHistory,
    approvals: db.approvals,
    extractions: db.extractions,
  })

describe('승인 확인은 한 카드에서 바로 고친다 (E-6 · AC-05)', () => {
  it('처음부터 칸이 열려 있고, 빠진 담당자·마감은 레드 R2 로 알리며 미정이어도 승인할 수 있다', async () => {
    await openApproval('ap_01')
    await waitFor(() =>
      expect(lead()).toHaveTextContent(
        /^3주차 정기회의에서 나온 일이에요\. 담당자와 마감이 아직 정해지지 않았어요\.$/,
      ),
    )
    expect(titleInput()).toHaveValue('알림 문구 검토')
    expect(assigneeSelect()).toHaveAccessibleName('담당자 · 미정')
    expect(assigneeSelect()).toHaveTextContent('담당자 고르기')
    expect(assigneeSelect()).toHaveClass('border-accent', 'focus-visible:outline-accent-point')
    expect(dueInput()).toHaveAccessibleName('마감 · 미정')
    expect(dueInput()).toHaveValue('')
    expect(dueInput()).toHaveClass('placeholder:text-accent-solid')
    expect(dueInput().parentElement).toHaveClass('border-accent')
    for (const raw of ['민수', '다음 주 월요일'])
      expect(within(evidence()).getByText(raw)).toHaveClass('text-accent')

    expect(screen.getByText('마감을 비워 두면 미정으로 올라가요')).toBeVisible()
    expect(approveButton()).toBeEnabled()
    expect(approveButton()).not.toHaveAccessibleDescription()
    expect(rejectButton()).toBeEnabled()
    expect(screen.queryByRole('button', { name: '보완하기' })).toBeNull()
  })

  it('담당자·마감을 채우면 빠진 값 표시가 사라지고 원문 담당자·마감과 인용·시각은 그대로다', async () => {
    await openApproval('ap_01')
    await pickAssignee('박민수')
    fill({ due: '2026-10-15' })

    expect(assigneeSelect()).toHaveAccessibleName('담당자')
    expect(assigneeSelect()).toHaveTextContent('박민수')
    expect(assigneeSelect()).not.toHaveClass('border-accent')
    expect(dueInput()).toHaveAccessibleName('마감')
    expect(lead()).toHaveTextContent(/^3주차 정기회의에서 나온 일이에요\.$/)
    expect(reasons()).toBeNull()
    expect(evidence()).toHaveTextContent('원문 담당자 민수 · 원문 마감 다음 주 월요일')
    expect(within(evidence()).getByText('민수')).not.toHaveClass('text-accent')
    expect(within(evidence()).getByText('“민수님이 알림 문구 검토을 맡기로 했어요.”')).toBeVisible()
    expect(evidence()).toHaveTextContent('전사문 02:35 · 김서연')
    expect(approveButton()).toBeEnabled()
  })
})

describe('확인이 필요한 이유와 마감 채우기 (#471)', () => {
  it('「다음 주 월요일」은 회의 날(9/15) 기준 9/21(월)로 채울 수 있다. 누르면 마감 칸만 채우고 서버에는 승인할 때 보낸다', async () => {
    const log = recordRequests()
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
    await openApproval('ap_01')
    const panel = await screen.findByRole('region', { name: '확인이 필요한 이유' })
    expect(panel).toHaveTextContent('담당자회의에서는 「민수」라고만 해서 담당자를 정하지 못했어요')
    expect(panel).toHaveTextContent(
      '마감회의에서는 「다음 주 월요일」이라고만 해서 날짜를 정하지 못했어요',
    )
    await userEvent.click(await within(panel).findByRole('button', { name: '9/21(월)로 채우기' }))

    expect(dueInput()).toHaveValue('2026-09-21')
    expect(dueInput()).toHaveFocus()
    expect(dueInput()).toHaveAccessibleName('마감')
    expect(within(panel).queryByRole('button', { name: /채우기$/ })).toBeNull()
    expect(panel).not.toHaveTextContent('다음 주 월요일')
    expect(panel).toHaveTextContent('「민수」')
    await settle()
    expect(patches(log)).toEqual([])

    await userEvent.click(approveButton())
    await screen.findByTestId('approval-result')
    expect(bodies).toEqual([{ status: 'approved', task_overrides: { due_date: '2026-09-21' } }])
  })

  it('「배포 전」처럼 날짜 하나로 정해지지 않는 말은 안내만 두고 채우기가 없다', async () => {
    replaceDb(createScenarioDb('approval-chat'))
    await openApproval('ap_07')
    // 회의 날짜를 받은 뒤에도 버튼이 없다
    await waitFor(() => expect(evidence()).toHaveTextContent('전사문 09/11 18:40'))
    const panel = screen.getByRole('region', { name: '확인이 필요한 이유' })
    expect(panel).toHaveTextContent('회의에서는 「배포 전」이라고만 해서 날짜를 정하지 못했어요')
    expect(within(panel).queryByRole('button')).toBeNull()
  })

  it('회의를 모르면 오늘로 짐작하지 않고 채우기를 두지 않는다', async () => {
    approvalOf('ap_01').payload.meeting_id = 'mt_99'
    const log = recordRequests()
    await openApproval('ap_01')
    await waitFor(() =>
      expect(log.answered).toContainEqual({ method: 'GET', path: '/workspaces/ws_01/meetings' }),
    )
    await settle()
    const panel = screen.getByRole('region', { name: '확인이 필요한 이유' })
    expect(panel).toHaveTextContent('「다음 주 월요일」이라고만 해서 날짜를 정하지 못했어요')
    expect(within(panel).queryByRole('button')).toBeNull()
  })
})

describe('담당자 선택 상자 (#471)', () => {
  it('맨 위 「미정」과 지금 공간 팀원만 고를 수 있다. 정해진 담당자를 미정으로 바꾸면 null 을 보낸다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_02')
    await openApproval('ap_02')
    expect(assigneeSelect()).toHaveAccessibleName('담당자')
    expect(assigneeSelect()).toHaveTextContent('박민수')
    assigneeSelect().focus()
    await userEvent.keyboard('{Enter}')
    const list = await screen.findByRole('listbox')
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['?미정', '김김서연', '박박민수', '이이재환', '정정하늘'])
    await userEvent.click(within(list).getByRole('option', { name: '미정' }))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(assigneeSelect()).toHaveTextContent('미정')
    // 원래 정해져 있던 값이라 빠진 값이 아니다
    expect(assigneeSelect()).toHaveAccessibleName('담당자')

    await userEvent.click(approveButton())
    await screen.findByTestId('approval-result')
    expect(bodies).toEqual([{ status: 'approved', task_overrides: { assignee_member_id: null } }])
  })

  it('현재 공간 팀원이 아닌 담당자가 오면 그 칸이 레드 R2 이고 승인할 수 없다. 팀원을 고르면 풀린다', async () => {
    approvalOf('ap_02').payload.assignee_member_id = 'mb_99'
    renderApp(paths.approval('ws_01', 'ap_02'))
    await screen.findByRole('heading', { level: 1, name: CREATE })
    await waitFor(() =>
      expect(approveButton()).toHaveAccessibleDescription(
        '승인하려면 담당자 정보를 올바르게 채워야 해요.',
      ),
    )
    expect(approveButton()).toBeDisabled()
    expect(assigneeSelect()).toHaveClass('border-accent')
    await pickAssignee('김서연')
    expect(approveButton()).toBeEnabled()
    expect(assigneeSelect()).not.toHaveClass('border-accent')
  })
})

describe('입력 검증 — 칸에 연결된 오류 (AC-05)', () => {
  async function expectFieldError(input: HTMLElement, message: string) {
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    expect(input).toHaveAccessibleDescription(message)
  }

  it('공백뿐인 제목은 칸을 떠나면 오류이고 승인을 막는다. 요청을 보내지 않는다', async () => {
    const log = recordRequests()
    await openApproval('ap_01')
    fill({ title: '   ' })
    fireEvent.blur(titleInput())
    await expectFieldError(titleInput(), '제목을 입력해 주세요.')
    expect(dueInput()).not.toHaveAttribute('aria-invalid')
    expect(approveButton()).toBeDisabled()
    expect(approveButton()).toHaveAccessibleDescription(
      '승인하려면 제목 정보를 올바르게 채워야 해요.',
    )
    expect(rejectButton()).toBeEnabled()
    expect(patches(log)).toEqual([])
  })

  it('제목은 trim 뒤 코드 포인트로 1~300자다 — 301자는 오류, 이모지 300자는 받고 앞뒤 공백을 지워 보낸다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
    await openApproval('ap_01')
    fill({ title: '가'.repeat(301) })
    fireEvent.blur(titleInput())
    await expectFieldError(titleInput(), '제목은 300자 이하로 입력해 주세요.')
    expect(approveButton()).toBeDisabled()

    // UTF-16 으로는 600 단위지만 코드 포인트로 300자다. 앞뒤 공백은 세지 않는다
    fill({ title: ` ${'😀'.repeat(300)} ` })
    await waitFor(() => expect(titleInput()).not.toHaveAttribute('aria-invalid'))
    expect(approveButton()).toBeEnabled()
    await userEvent.click(approveButton())
    await screen.findByTestId('approval-result')
    expect(bodies).toEqual([
      { status: 'approved', task_overrides: { task_title: '😀'.repeat(300) } },
    ])
  })

  it('마감은 유효한 YYYY-MM-DD 다 — 0000-01-01 은 거절하고 0001-01-01 · 9999-12-31 은 받는다', async () => {
    await openApproval('ap_01')
    fill({ due: '0000-01-01' })
    fireEvent.blur(dueInput())
    await waitFor(() => expect(dueInput()).toHaveAttribute('aria-invalid', 'true'))
    expect(approveButton()).toBeDisabled()

    fill({ due: '0001-01-01' })
    await waitFor(() => expect(dueInput()).not.toHaveAttribute('aria-invalid'))
    expect(approveButton()).toBeEnabled()
    fill({ due: '9999-12-31' })
    expect(approveButton()).toBeEnabled()
  })
})

describe('미저장 값과 이탈 확인 (AC-05)', () => {
  it('칸에서 바꾼 값이 있으면 떠날 때 기존 이탈 확인을 묻는다', async () => {
    const app = await openApproval('ap_01')
    fill({ title: '바꾼 제목' })

    fireEvent.click(screen.getByRole('link', { name: '태스크 목록' }))
    let dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    await userEvent.click(within(dialog).getByRole('button', { name: '계속 작성하기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(titleInput()).toHaveValue('바꾼 제목')
    await app.expectPath(paths.approval('ws_01', 'ap_01'))

    act(() => app.navigate(paths.tasks('ws_01')))
    dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    await userEvent.click(within(dialog).getByRole('button', { name: '변경 내용 버리고 나가기' }))
    await app.expectPath(paths.tasks('ws_01'))
    expect(approvalOf('ap_01').status).toBe('pending')
  })

  it('바꿨다가 원래 값으로 되돌렸거나 승인한 뒤에는 묻지 않는다', async () => {
    const app = await openApproval('ap_01')
    fill({ title: '바꾼 제목' })
    fill({ title: '알림 문구 검토' })
    fireEvent.click(screen.getByRole('link', { name: '태스크 목록' }))
    await app.expectPath(paths.tasks('ws_01'))
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => app.navigate(paths.approval('ws_01', 'ap_01')))
    await screen.findByRole('heading', { level: 1, name: CREATE })
    await waitFor(() => expect(assigneeSelect()).toBeEnabled())
    fill({ due: '2026-10-15' })
    await userEvent.click(approveButton())
    await screen.findByTestId('approval-result')
    act(() => app.navigate(paths.tasks('ws_01')))
    await app.expectPath(paths.tasks('ws_01'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('승인은 한 번에, 실패는 흔적 없이 (AC-05)', () => {
  it('승인 한 번에 고친 값 적용·승인·태스크 생성·추출 연결이 된다. 본문에는 고친 세 값만 실린다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
    const log = recordRequests()
    await openApproval('ap_01')
    fill({ title: ' 알림 문구 최종 검토 ', due: '2026-10-15' })
    await pickAssignee('박민수')
    await userEvent.click(approveButton())

    expect(await screen.findByTestId('approval-result')).toHaveTextContent('승인했어요')
    expect(bodies).toEqual([
      {
        status: 'approved',
        task_overrides: {
          task_title: '알림 문구 최종 검토',
          assignee_member_id: 'mb_02',
          due_date: '2026-10-15',
        },
      },
    ])
    expect(patches(log)).toHaveLength(1)
    expect(approvalOf('ap_01')).toMatchObject({
      status: 'approved',
      resolved_by: 'mb_01',
      related_task_id: 'tk_90',
    })
    expect(db.tasks.find(({ task_id }) => task_id === 'tk_90')).toMatchObject({
      title: '알림 문구 최종 검토',
      assignee_member_id: 'mb_02',
      due_date: '2026-10-15',
      meeting_id: 'mt_09',
    })
    expect(itemOf('it_04')).toMatchObject({ task_id: 'tk_90', approval_id: 'ap_01' })
    const link = await within(screen.getByLabelText('처리된 태스크')).findByRole('link', {
      name: '알림 문구 최종 검토',
    })
    expect(link).toHaveAttribute('href', paths.tasks('ws_01', 'tk_90'))
    // 처리된 승인에는 입력 칸·처리 버튼이 없다
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '승인' })).toBeNull()
  })

  it('요청 중 중복 누름은 한 번만 보내고, 그동안 칸이 잠긴다', async () => {
    const gate = deferred()
    server.use(
      http.patch('/api/v1/approvals/:approvalId', async ({ request }) => {
        const copy = request.clone()
        await gate.promise
        return getResponse(handlers, copy)
      }),
    )
    const log = recordRequests()
    await openApproval('ap_01')
    fill({ due: '2026-10-15' })
    act(() => {
      fireEvent.click(approveButton())
      fireEvent.click(approveButton())
    })
    await waitFor(() => expect(approveButton()).toBeDisabled())
    expect(titleInput()).toBeDisabled()
    expect(assigneeSelect()).toBeDisabled()
    expect(dueInput()).toBeDisabled()
    await settle()
    expect(patches(log)).toHaveLength(1)
    act(() => gate.resolve())
    await screen.findByTestId('approval-result')
    await settle()
    expect(patches(log)).toHaveLength(1)
    expect(db.tasks.filter(({ title }) => title === '알림 문구 검토')).toHaveLength(1)
  })

  it.each([
    [
      '담당자가 승인 전에 다른 공간으로 옮겨졌다',
      () => {
        db.members.find(({ member_id }) => member_id === 'mb_02')!.workspace_id = 'ws_02'
      },
      '다른 워크스페이스의 항목이에요.',
    ],
    [
      '추출 항목이 이 승인과 연결되어 있지 않다',
      () => {
        itemOf('it_04').approval_id = 'ap_99'
      },
      '요청 내용을 다시 확인해 주세요.',
    ],
  ] as const)(
    '서버가 거절하면(%s) 승인·태스크·이력·추출 어디에도 부분 변경이 없다',
    async (_label, breakIt, message) => {
      await openApproval('ap_01')
      await pickAssignee('박민수')
      fill({ due: '2026-10-15' })
      breakIt()
      const before = snapshot()
      await userEvent.click(approveButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(snapshot()).toEqual(before)
      expect(screen.queryByTestId('approval-result')).toBeNull()
      // 고친 값은 칸에 남아 있어 다시 시도할 수 있다
      expect(assigneeSelect()).toHaveTextContent('박민수')
      expect(dueInput()).toHaveValue('2026-10-15')
      expect(approveButton()).toBeEnabled()
    },
  )

  it('반려는 고친 값을 무시하고 태스크를 만들지 않는다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
    const before = db.tasks.length
    await openApproval('ap_01')
    fill({ title: '보완한 제목', due: '2026-10-15' })
    await pickAssignee('박민수')
    await userEvent.click(rejectButton())

    expect(await screen.findByTestId('approval-result')).toHaveTextContent('반려했어요')
    expect(bodies).toEqual([{ status: 'rejected' }])
    expect(db.tasks).toHaveLength(before)
    expect(itemOf('it_04')).toMatchObject({ task_id: null, approval_id: 'ap_01' })
    expect(approvalOf('ap_01').payload.task_title).toBe('알림 문구 검토')
  })

  it('필수값이 이미 있으면 고치지 않고 승인한다 — task_overrides 없이 보낸다', async () => {
    approvalOf('ap_02').payload.due_date = '2026-09-30'
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_02')
    await openApproval('ap_02')
    expect(reasons()).toBeNull()
    expect(approveButton()).toBeEnabled()
    await userEvent.click(approveButton())
    expect(await screen.findByTestId('approval-result')).toHaveTextContent('승인했어요')
    expect(bodies).toEqual([{ status: 'approved' }])
  })
})

describe('대시보드 채워 넣기로 오면 첫 빈 칸에 포커스가 있다 (D-176)', () => {
  const DASHBOARD = paths.dashboard('ws_01')

  async function arriveFromDashboard(name: string, options: { strict?: boolean } = {}) {
    const app = renderApp(DASHBOARD, options)
    await userEvent.click(await screen.findByRole('link', { name }))
    await app.expectPath(paths.approval('ws_01', 'ap_01'))
    await screen.findByRole('heading', { level: 1, name: CREATE })
    return app
  }

  it('첫 빈 칸(담당자)에 포커스가 있고 승인할 수 있다. 기록의 표시는 지워져 있다', async () => {
    const app = await arriveFromDashboard('채워 넣기 — 알림 문구 검토', { strict: true })
    await waitFor(() => expect(assigneeSelect()).toHaveFocus())
    expect(titleInput()).toHaveValue('알림 문구 검토')
    expect(approveButton()).toBeEnabled()

    // 같은 주소를 replace 해 표시를 지운다 — 새로고침·뒤로/앞으로 가기로 다시 오면 포커스를 옮기지 않는다
    await waitFor(() => expect(app.visited().at(-1)?.state ?? null).toBeNull())
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(app.visited().at(-1)?.pathname).toBe(paths.approval('ws_01', 'ap_01'))
  })

  it.each([
    ['제목이 공백뿐이면 제목', { task_title: '   ' }, () => titleInput()],
    [
      '빈 칸이 없으면 첫 칸(제목)',
      { assignee_member_id: 'mb_02', due_date: '2026-09-30' },
      () => titleInput(),
    ],
  ] as const)('%s 에 포커스가 간다', async (_, patch, expected) => {
    Object.assign(approvalOf('ap_01').payload, patch)
    renderApp(DASHBOARD)
    const links = await screen.findAllByRole('link', { name: /^채워 넣기/ })
    expect(links).toHaveLength(1)
    await userEvent.click(links[0])
    await waitFor(() => expect(expected()).toHaveFocus())
  })

  it('확인하기로 오면 포커스를 칸으로 옮기지 않는다', async () => {
    renderApp(DASHBOARD)
    await userEvent.click(await screen.findByRole('link', { name: '확인하기 — 테스트 계획 정리' }))
    await screen.findByRole('heading', { level: 1, name: CREATE })
    await waitFor(() => expect(assigneeSelect()).toBeEnabled())
    await settle()
    expect(card()).not.toContainElement(document.activeElement as HTMLElement)
  })
})
