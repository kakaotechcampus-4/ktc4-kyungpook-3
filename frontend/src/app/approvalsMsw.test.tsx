import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { handlers } from '@/shared/mock/handlers'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * M6 S4 — 개발 MSW 의 생성 승인 보완 (계획 §4-1, §4-2, §4-5, AC-05 MSW 분기).
 * 개발 서버 + VITE_ENABLE_MSW=true 를 흉내낸다. 이 파일 안에서만 설정을 바꾼다 — 화면은 `msw` 로 동작해
 * `보완하기` 가 있고, 확정한 보완값을 승인 본문의 미합의 `task_overrides` 로 싣는다. 실 API 분기는 approvals.test.tsx 가 본다.
 */
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
function field(listName: string, term: string): HTMLElement {
  const dt = within(screen.getByLabelText(listName)).getByText(term, { selector: 'dt' })
  return dt.nextElementSibling as HTMLElement
}
const approveButton = () => screen.getByRole('button', { name: '승인' })
const rejectButton = () => screen.getByRole('button', { name: '반려' })
const titleInput = () => screen.getByRole('textbox', { name: '제목' })
const assigneeSelect = () => screen.getByRole('combobox', { name: '담당자' })
const dueInput = () => screen.getByLabelText('마감')
const patches = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method, path }) => method === 'PATCH' && path.startsWith('/approvals/'))

async function openApproval(id: string) {
  const app = renderApp(paths.approval('ws_01', id))
  await screen.findByRole('heading', { level: 2, name: '새 태스크 확인' })
  // 팀원 목록까지 받아야 보완할 수 있다
  await waitFor(() => expect(screen.getByRole('button', { name: '보완하기' })).toBeEnabled())
  return app
}
async function openForm() {
  fireEvent.click(screen.getByRole('button', { name: '보완하기' }))
  await screen.findByRole('group', { name: '확정할 값 보완' })
}
function fill(values: { title?: string; assignee?: string; due?: string }) {
  if (values.title !== undefined)
    fireEvent.change(titleInput(), { target: { value: values.title } })
  if (values.assignee !== undefined)
    fireEvent.change(assigneeSelect(), { target: { value: values.assignee } })
  if (values.due !== undefined) fireEvent.change(dueInput(), { target: { value: values.due } })
}
async function confirmForm() {
  fireEvent.click(screen.getByRole('button', { name: '보완 완료' }))
  await settle()
}
const snapshot = () =>
  structuredClone({
    tasks: db.tasks,
    history: db.taskHistory,
    approvals: db.approvals,
    extractions: db.extractions,
  })

describe('보완하기는 PM 이 열고, 확정값은 원문·근거와 나뉜다 (AC-05)', () => {
  it('최초 진입은 읽기다 — 편집이 자동으로 열리지 않고, 필수값이 없으면 승인이 꺼져 있다', async () => {
    await openApproval('ap_01')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    const reason = '승인하려면 담당자·마감 정보를 올바르게 채워야 해요.'
    expect(approveButton()).toBeDisabled()
    expect(approveButton()).toHaveAccessibleDescription(reason)
    expect(screen.getByText(reason)).toBeVisible()
    // MSW 에서는 실 API 의 미지원 사유를 붙이지 않는다
    expect(screen.queryByText(/지금 서버는 승인 전 보완을 지원하지 않아요/)).toBeNull()
    expect(rejectButton()).toBeEnabled()
  })

  it('보완하기를 누르면 지금 값으로 채운 폼이 열리고, 보완 중에는 승인할 수 없다. 취소하면 바꾼 값을 버린다', async () => {
    await openApproval('ap_01')
    await openForm()
    expect(titleInput()).toHaveValue('알림 문구 검토')
    expect(assigneeSelect()).toHaveValue('')
    expect(dueInput()).toHaveValue('')
    expect(approveButton()).toBeDisabled()
    expect(approveButton()).toHaveAccessibleDescription(
      '보완을 끝내거나 취소하면 승인할 수 있어요.',
    )
    expect(rejectButton()).toBeEnabled()

    fill({ title: '바꾼 제목' })
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    expect(field('확정할 값', '제목')).toHaveTextContent('알림 문구 검토')
    expect(screen.queryByText('보완한 값이에요. 승인해야 저장돼요.')).toBeNull()
  })

  it('보완 완료하면 확정값만 바뀌고 원문 담당자·마감과 인용·화자·시각은 그대로 따로 보인다', async () => {
    await openApproval('ap_01')
    await openForm()
    fill({ title: '  알림 문구 최종 검토  ', assignee: 'mb_02', due: '2026-10-15' })
    await confirmForm()

    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    expect(screen.getByText('보완한 값이에요. 승인해야 저장돼요.')).toBeVisible()
    expect(field('확정할 값', '제목')).toHaveTextContent('알림 문구 최종 검토')
    expect(field('확정할 값', '제목').textContent).toBe('알림 문구 최종 검토')
    expect(field('확정할 값', '담당자')).toHaveTextContent('박민수')
    expect(field('확정할 값', '마감')).toHaveTextContent('2026-10-15')
    expect(field('회의 원문', '원문 담당자')).toHaveTextContent('민수')
    expect(field('회의 원문', '원문 마감')).toHaveTextContent('다음 주 월요일')
    const evidence = screen.getByRole('figure', { name: '근거' })
    expect(within(evidence).getByText('민수님이 알림 문구 검토을 맡기로 했어요.')).toBeVisible()
    expect(evidence).toHaveTextContent('화자 김서연 · 시각 02:35')
    expect(approveButton()).toBeEnabled()
    expect(approveButton()).not.toHaveAccessibleDescription()
  })
})

describe('보완 값 검증 — 필드에 연결된 오류 (AC-05)', () => {
  async function expectFieldError(input: HTMLElement, message: string) {
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    expect(input).toHaveAccessibleDescription(message)
  }

  it('비어 있는 담당자·마감과 공백뿐인 제목은 각 칸의 오류다. 요청을 보내지 않는다', async () => {
    const log = recordRequests()
    await openApproval('ap_01')
    await openForm()
    fill({ title: '   ' })
    await confirmForm()
    await expectFieldError(titleInput(), '제목을 입력해 주세요.')
    await expectFieldError(assigneeSelect(), '이 워크스페이스의 팀원 중에서 담당자를 골라 주세요.')
    await expectFieldError(dueInput(), '마감 날짜를 입력해 주세요.')
    // 폼은 열린 채이고 승인은 여전히 꺼져 있다
    expect(titleInput()).toBeVisible()
    expect(approveButton()).toBeDisabled()
    expect(patches(log)).toEqual([])
  })

  it('제목은 trim 뒤 코드 포인트로 1~300자다 — 301자는 오류, 이모지 300자는 받는다', async () => {
    await openApproval('ap_01')
    await openForm()
    fill({ title: '가'.repeat(301), assignee: 'mb_02', due: '2026-10-15' })
    await confirmForm()
    await expectFieldError(titleInput(), '제목은 300자 이하로 입력해 주세요.')

    // UTF-16 으로는 600 단위지만 코드 포인트로 300자다. 앞뒤 공백은 세지 않는다
    fill({ title: ` ${'😀'.repeat(300)} ` })
    await waitFor(() => expect(titleInput()).not.toHaveAttribute('aria-invalid'))
    await confirmForm()
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    expect(field('확정할 값', '제목').textContent).toBe('😀'.repeat(300))
  })

  it('현재 공간 팀원이 아닌 담당자는 담당자 칸의 오류다', async () => {
    await openApproval('ap_01')
    await openForm()
    // 고르는 칸에는 지금 공간 팀원만 있다. 목록 밖 값을 강제로 넣어도 거절한다
    const select = assigneeSelect() as HTMLSelectElement
    expect([...select.options].map(({ value }) => value)).toEqual([
      '',
      'mb_01',
      'mb_02',
      'mb_03',
      'mb_04',
    ])
    const outsider = document.createElement('option')
    outsider.value = 'mb_99'
    select.append(outsider)
    fill({ assignee: 'mb_99', due: '2026-10-15' })
    await confirmForm()
    await expectFieldError(select, '이 워크스페이스의 팀원 중에서 담당자를 골라 주세요.')
    expect(dueInput()).not.toHaveAttribute('aria-invalid')
  })

  it('마감은 유효한 YYYY-MM-DD 다 — 0000-01-01 은 거절하고 0001-01-01 · 9999-12-31 은 받는다', async () => {
    await openApproval('ap_01')
    await openForm()
    fill({ assignee: 'mb_02', due: '0000-01-01' })
    await confirmForm()
    await waitFor(() => expect(dueInput()).toHaveAttribute('aria-invalid', 'true'))
    expect(titleInput()).toBeVisible()

    fill({ due: '0001-01-01' })
    await waitFor(() => expect(dueInput()).not.toHaveAttribute('aria-invalid'))
    await confirmForm()
    await waitFor(() => expect(field('확정할 값', '마감')).toHaveTextContent('0001-01-01'))

    await openForm()
    expect(dueInput()).toHaveValue('0001-01-01')
    fill({ due: '9999-12-31' })
    await confirmForm()
    await waitFor(() => expect(field('확정할 값', '마감')).toHaveTextContent('9999-12-31'))
    expect(approveButton()).toBeEnabled()
  })
})

describe('미저장 보완값과 이탈 확인 (AC-05)', () => {
  it('폼에서 바꾼 값과 보완 완료했지만 승인하지 않은 값은 떠날 때 기존 이탈 확인을 묻는다', async () => {
    const app = await openApproval('ap_01')
    await openForm()
    fill({ title: '바꾼 제목' })

    fireEvent.click(screen.getByRole('link', { name: '← 태스크 목록' }))
    let dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    await userEvent.click(within(dialog).getByRole('button', { name: '계속 작성하기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(titleInput()).toHaveValue('바꾼 제목')
    await app.expectPath(paths.approval('ws_01', 'ap_01'))

    fill({ assignee: 'mb_02', due: '2026-10-15' })
    await confirmForm()
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    act(() => app.navigate(paths.tasks('ws_01')))
    dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    await userEvent.click(within(dialog).getByRole('button', { name: '변경 내용 버리고 나가기' }))
    await app.expectPath(paths.tasks('ws_01'))
    expect(approvalOf('ap_01').status).toBe('pending')
  })

  it('바꾸지 않았으면 묻지 않고, 승인한 뒤에도 묻지 않는다', async () => {
    const app = await openApproval('ap_01')
    await openForm()
    fill({ assignee: 'mb_02', due: '2026-10-15' })
    await confirmForm()
    await waitFor(() => expect(approveButton()).toBeEnabled())
    await userEvent.click(approveButton())
    await screen.findByTestId('approval-result')
    act(() => app.navigate(paths.tasks('ws_01')))
    await app.expectPath(paths.tasks('ws_01'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('보완 승인은 한 번에, 실패는 흔적 없이 (AC-05)', () => {
  it('승인 한 번에 보완값 적용·승인·태스크 생성·추출 연결이 된다. 본문에는 확정한 세 값만 실린다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
    const log = recordRequests()
    await openApproval('ap_01')
    await openForm()
    fill({ title: ' 알림 문구 최종 검토 ', assignee: 'mb_02', due: '2026-10-15' })
    await confirmForm()
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
    // 처리된 승인에는 보완·처리 버튼이 없다
    expect(screen.queryByRole('button', { name: '보완하기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '승인' })).toBeNull()
  })

  it('요청 중 중복 누름은 한 번만 보낸다', async () => {
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
    await openForm()
    fill({ assignee: 'mb_02', due: '2026-10-15' })
    await confirmForm()
    act(() => {
      fireEvent.click(approveButton())
      fireEvent.click(approveButton())
    })
    await waitFor(() => expect(approveButton()).toBeDisabled())
    expect(screen.getByRole('button', { name: '보완하기' })).toBeDisabled()
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
      await openForm()
      fill({ assignee: 'mb_02', due: '2026-10-15' })
      await confirmForm()
      breakIt()
      const before = snapshot()
      await userEvent.click(approveButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(snapshot()).toEqual(before)
      expect(screen.queryByTestId('approval-result')).toBeNull()
      // 확정한 보완값은 남아 있어 다시 시도할 수 있다
      expect(field('확정할 값', '담당자')).toHaveTextContent('박민수')
      expect(approveButton()).toBeEnabled()
    },
  )

  it('반려는 보완값을 무시하고 태스크를 만들지 않는다', async () => {
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_01')
    const before = db.tasks.length
    await openApproval('ap_01')
    await openForm()
    fill({ title: '보완한 제목', assignee: 'mb_02', due: '2026-10-15' })
    await confirmForm()
    await userEvent.click(rejectButton())

    expect(await screen.findByTestId('approval-result')).toHaveTextContent('반려했어요')
    expect(bodies).toEqual([{ status: 'rejected' }])
    expect(db.tasks).toHaveLength(before)
    expect(itemOf('it_04')).toMatchObject({ task_id: null, approval_id: 'ap_01' })
    expect(approvalOf('ap_01').payload.task_title).toBe('알림 문구 검토')
  })

  it('필수값이 이미 있으면 보완 없이 승인한다 — task_overrides 없이 보낸다', async () => {
    approvalOf('ap_02').payload.due_date = '2026-09-30'
    const bodies = recordRequestBodies('PATCH', '/approvals/ap_02')
    await openApproval('ap_02')
    expect(approveButton()).toBeEnabled()
    await userEvent.click(approveButton())
    expect(await screen.findByTestId('approval-result')).toHaveTextContent('승인했어요')
    expect(bodies).toEqual([{ status: 'approved' }])
  })
})
