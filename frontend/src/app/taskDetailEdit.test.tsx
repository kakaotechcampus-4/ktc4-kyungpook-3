import { onTestFinished } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { toTaskResponse } from '@/shared/mock/task-state'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #471 태스크 상세(E-5) — 머리의 담당·마감과 기한 지남, PM 의 상태 트랙과 담당자·마감 고치기.
 * 픽스처 tk_01 은 김서연 담당·마감 2026-09-20·진행 중, tk_02 는 마감 2026-09-16·할 일, tk_03 은 막힘이다. 서울 오늘 2026-09-18.
 */

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

const settle = (ms = 80) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const mockTask = (taskId: string) => db.tasks.find(({ task_id }) => task_id === taskId)!
const info = () => screen.getByLabelText('태스크 정보')
const field = (term: string) =>
  within(info()).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement
const patches = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method }) => method === 'PATCH')

async function openDetail(taskId: string, title: string) {
  const app = renderApp(paths.tasks('ws_01', taskId))
  await screen.findByRole('heading', { level: 1, name: title })
  return app
}

async function editDue(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(await screen.findByRole('button', { name: '마감 수정' }))
  const due = screen.getByRole('textbox', { name: '마감' })
  expect(due).toHaveFocus()
  await user.clear(due)
  if (text !== '') await user.type(due, text)
}

describe('태스크 상세의 머리와 권한 (#471)', () => {
  it('제목 아래에 담당·마감을 보이고, 마감이 지났으면 기한 지남 배지를 붙인다', async () => {
    await openDetail('tk_02', '회원가입 화면')
    const title = screen.getByRole('heading', { level: 1, name: '회원가입 화면' })
    const subline = title.nextElementSibling as HTMLElement
    await waitFor(() => expect(subline).toHaveTextContent('박민수 담당 · 09/16 마감'))
    expect(within(subline).getByText('기한 지남')).toBeVisible()
    expect(await screen.findByText(/^마감이 지났어요\./)).toBeVisible()
  })

  it('마감 전이면 기한 지남이 없다', async () => {
    await openDetail('tk_01', '로그인 API 연동')
    await waitFor(() => expect(field('담당자')).toHaveTextContent('김서연'))
    expect(screen.queryByText('기한 지남')).toBeNull()
  })

  it('PM 은 상태 트랙과 담당자·마감 연필을 본다', async () => {
    await openDetail('tk_01', '로그인 API 연동')
    const track = screen.getByRole('radiogroup', { name: '상태 바꾸기' })
    expect(
      within(track)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['할 일', '진행 중', '막힘', '완료'])
    expect(within(track).getByRole('radio', { name: '진행 중' })).toBeChecked()
    expect(screen.getByRole('button', { name: '담당자 수정' })).toBeVisible()
    expect(screen.getByRole('button', { name: '마감 수정' })).toBeVisible()
  })

  it('일반 팀원은 상태 배지만 보고 연필이 없다', async () => {
    setMockRole('member')
    await openDetail('tk_01', '로그인 API 연동')
    expect(screen.getByTestId('task-status')).toHaveTextContent('진행 중')
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByRole('button', { name: '담당자 수정' })).toBeNull()
    expect(screen.queryByRole('button', { name: '마감 수정' })).toBeNull()
  })

  it('막힌 사유는 막혔을 때만 보인다', async () => {
    await openDetail('tk_01', '로그인 API 연동')
    expect(within(info()).queryByText('막힌 사유')).toBeNull()
  })

  it('막혔는데 사유가 비었으면 적힌 사유가 없다고 알린다', async () => {
    mockTask('tk_03').blocker = '  '
    await openDetail('tk_03', 'DB 스키마 정리')
    expect(field('막힌 사유')).toHaveTextContent('적힌 사유가 없어요')
  })
})

describe('PM 의 담당자·마감 고치기 (#471)', () => {
  it('마감을 고치면 저장 줄에 바뀐 내용이 보이고, 취소하면 원래 값으로 돌아오며 아무것도 보내지 않는다', async () => {
    const user = userEvent.setup()
    const log = recordRequests()
    await openDetail('tk_01', '로그인 API 연동')
    await editDue(user, '2026-09-27')

    expect(screen.getByText('바뀐 내용 1개 · 마감 09/20 → 09/27')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '취소' }))

    expect(field('마감')).toHaveTextContent('2026-09-20')
    expect(screen.queryByText(/^바뀐 내용/)).toBeNull()
    expect(screen.getByRole('button', { name: '마감 수정' })).toHaveFocus()
    await settle(200)
    expect(patches(log)).toEqual([])
  })

  it('저장하면 바뀐 마감만 보내고 저장 줄이 사라진다', async () => {
    const user = userEvent.setup()
    const bodies = recordRequestBodies('PATCH', '/tasks/tk_01')
    await openDetail('tk_01', '로그인 API 연동')
    await editDue(user, '2026-09-27')

    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.queryByText(/^바뀐 내용/)).toBeNull())
    expect(bodies).toEqual([{ due_date: '2026-09-27' }])
    expect(field('마감')).toHaveTextContent('2026-09-27')
    expect(mockTask('tk_01').due_date).toBe('2026-09-27')
    expect(screen.getByRole('button', { name: '마감 수정' })).toHaveFocus()
  })

  it('담당자와 마감을 함께 고쳐 한 번에 저장한다', async () => {
    const user = userEvent.setup()
    const bodies = recordRequestBodies('PATCH', '/tasks/tk_01')
    await openDetail('tk_01', '로그인 API 연동')
    await user.click(screen.getByRole('button', { name: '담당자 수정' }))
    const assignee = screen.getByRole('combobox', { name: '담당자' })
    expect(assignee).toHaveFocus()
    // 팀원 목록이 오면 지금 담당자가 트리거에 보인다
    await waitFor(() => expect(assignee).toHaveTextContent('김서연'))
    await user.click(assignee)
    await user.click(await screen.findByRole('option', { name: '이재환' }))
    await editDue(user, '')

    expect(
      screen.getByText('바뀐 내용 2개 · 담당자 김서연 → 이재환 · 마감 09/20 → 미정'),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(field('담당자')).toHaveTextContent('이재환'))
    expect(bodies).toEqual([{ assignee_member_id: 'mb_03', due_date: null }])
    expect(field('마감')).toHaveTextContent('마감 없음')
  })

  it('저장이 실패하면 저장 줄에 알리고 고친 값을 그대로 둔다', async () => {
    const user = userEvent.setup()
    server.use(http.patch('/api/v1/tasks/:taskId', () => fail('INTERNAL_ERROR', 'boom', 500)))
    await openDetail('tk_01', '로그인 API 연동')
    await editDue(user, '2026-09-27')

    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 문제가 생겼어요')
    expect(screen.getByRole('textbox', { name: '마감' })).toHaveValue('2026-09-27')
    expect(screen.getByText('바뀐 내용 1개 · 마감 09/20 → 09/27')).toBeVisible()
    expect(mockTask('tk_01').due_date).toBe('2026-09-20')
  })

  it('저장 응답을 읽지 못하면 저장 줄에 실패라 하지 않고 결과를 확인하지 못했다고 알린다. 새로고침은 태스크를 다시 받는다 (#348)', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warning.mockRestore())
    const user = userEvent.setup()
    server.use(
      http.patch('/api/v1/tasks/:taskId', () =>
        ok({
          ...toTaskResponse(db.tasks.find(({ task_id }) => task_id === 'tk_01')!),
          status: 'archived',
        }),
      ),
    )
    const log = recordRequests()
    await openDetail('tk_01', '로그인 API 연동')
    await editDue(user, '2026-09-27')
    await user.click(screen.getByRole('button', { name: '저장' }))
    const notice = (
      await screen.findByText('변경 결과를 확인하지 못했어요', {}, { timeout: 5_000 })
    ).closest('li') as HTMLElement
    expect(within(notice).getByText(/서버에는 반영됐을 수 있어요/)).toBeInTheDocument()
    expect(within(info()).queryByRole('alert')).toBeNull()
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    const before = log.started.length
    fireEvent.click(within(notice).getByRole('button', { name: '새로고침' }))
    await waitFor(() =>
      expect(log.started.slice(before)).toContainEqual({ method: 'GET', path: '/tasks/tk_01' }),
    )
  })

  it('날짜 모양이 틀리면 저장을 막고 고쳐 적게 한다', async () => {
    const user = userEvent.setup()
    await openDetail('tk_01', '로그인 API 연동')
    await editDue(user, '2026-09')

    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '마감' })).toHaveAccessibleDescription(
      '날짜는 2026-09-27 처럼 적어 주세요.',
    )
  })

  it('고친 값이 남아 있으면 떠날 때 이탈 확인을 묻는다', async () => {
    const user = userEvent.setup()
    await openDetail('tk_01', '로그인 API 연동')
    await editDue(user, '2026-09-27')

    await user.click(screen.getByRole('link', { name: '태스크 목록' }))

    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeVisible()
  })

  it('상태는 저장 줄과 따로 누르는 즉시 바뀐다', async () => {
    const user = userEvent.setup()
    const bodies = recordRequestBodies('PATCH', '/tasks/tk_01')
    await openDetail('tk_01', '로그인 API 연동')
    await editDue(user, '2026-09-27')

    await user.click(screen.getByRole('radio', { name: '완료' }))

    await waitFor(() => expect(mockTask('tk_01').status).toBe('done'))
    expect(bodies).toEqual([{ status: 'done' }])
    expect(screen.getByText('바뀐 내용 1개 · 마감 09/20 → 09/27')).toBeVisible()
  })
})
