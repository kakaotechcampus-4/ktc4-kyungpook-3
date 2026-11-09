import { onTestFinished } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { handlers } from '@/shared/mock/handlers'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { toTaskResponse } from '@/shared/mock/task-state'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * M8 A 보완 — 보드 칸 아래 `직접 추가` (TasksBoard 시안). 계약 §2.6 의 `POST /tasks` 를 MSW handler 로 탄다 — 실제 서버는 확인하지 않았다.
 * 서버가 만든 뒤에만 카드가 생기고(낙관적 반영 없음), 칸마다 기본 상태로 만든다. 빈 제목·중복 제출·실패를 본다.
 */

vi.setConfig({ testTimeout: 15_000 })
// 보드 모듈은 lazy 다. 첫 테스트의 첫 화면이 모듈 변환을 기다리다 시간을 넘기지 않게 미리 불러 둔다
beforeAll(() => import('@/widgets/task-board/ui/BoardView'), 60_000)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => vi.useRealTimers())

const FIRST_PAINT = { timeout: 5_000 }

/** `POST /tasks` 본문을 적고 handler 로 넘긴다. `gate` 를 주면 그 약속이 풀릴 때까지 응답을 미룬다 */
function recordCreates(gate?: Promise<void>) {
  const bodies: Record<string, unknown>[] = []
  server.use(
    http.post('/api/v1/tasks', async ({ request }) => {
      bodies.push((await request.clone().json()) as Record<string, unknown>)
      await gate
      return getResponse(handlers, request)
    }),
  )
  return bodies
}

async function openBoard(search = '') {
  const app = renderApp(`${paths.tasks('ws_01')}?view=board${search}`)
  await screen.findByRole('region', { name: '시작 전' }, FIRST_PAINT)
  return app
}

const column = (name: string) => screen.getByRole('region', { name })
const addButton = (name: string) =>
  within(column(name)).getByRole('button', { name: `${name}에 직접 추가` })
/** 칸마다 이름이 다르다 — 두 칸을 함께 펼쳐도 입력 목록에서 구별된다 */
const titleInput = (name: string) =>
  within(column(name)).getByRole('textbox', { name: `${name} 새 태스크 제목` })

describe('보드 직접 추가', () => {
  it.each([
    ['시작 전', 'todo'],
    ['진행 중', 'in_progress'],
    ['완료', 'done'],
  ] as const)(
    '%s 칸에서 제목을 넣고 Enter 하면 %s 로 만들고, 서버가 만든 뒤에만 그 칸에 카드가 생긴다',
    async (name, status) => {
      const user = userEvent.setup()
      const gate = deferred()
      const bodies = recordCreates(gate.promise)
      await openBoard()

      await user.click(addButton(name))
      const input = titleInput(name)
      expect(input).toHaveFocus()
      await user.type(input, '  회고 정리  {Enter}')

      await waitFor(() => expect(bodies).toHaveLength(1))
      expect(bodies[0]).toEqual({ workspace_id: 'ws_01', title: '회고 정리', status })
      // 응답 전에는 카드를 그리지 않는다
      expect(within(column(name)).queryByRole('link', { name: '회고 정리' })).toBeNull()

      act(() => gate.resolve())
      expect(
        await within(column(name)).findByRole('link', { name: '회고 정리' }, FIRST_PAINT),
      ).toBeVisible()
      expect(db.tasks.find(({ title }) => title === '회고 정리')).toMatchObject({
        workspace_id: 'ws_01',
        status,
      })
      // 닫히고 `직접 추가` 로 포커스가 돌아온다
      expect(within(column(name)).queryByRole('textbox')).toBeNull()
      await waitFor(() => expect(addButton(name)).toHaveFocus())
    },
  )

  it('빈 제목·공백만 있는 제목은 보내지 않는다', async () => {
    const user = userEvent.setup()
    const bodies = recordCreates()
    await openBoard()
    await user.click(addButton('시작 전'))
    const form = within(column('시작 전')).getByRole('form', { name: '시작 전에 직접 추가' })
    const submit = within(form).getByRole('button', { name: '추가' })
    expect(submit).toBeDisabled()

    await user.type(within(form).getByRole('textbox'), '   {Enter}')
    expect(submit).toBeDisabled()
    expect(bodies).toEqual([])
    expect(form).toBeVisible()
  })

  it('보내는 동안 Enter·추가를 다시 눌러도 요청은 한 번이다', async () => {
    const user = userEvent.setup()
    const gate = deferred()
    const bodies = recordCreates(gate.promise)
    await openBoard()
    await user.click(addButton('진행 중'))
    const form = within(column('진행 중')).getByRole('form', { name: '진행 중에 직접 추가' })
    await user.type(within(form).getByRole('textbox'), '배포 체크리스트{Enter}{Enter}')
    expect(form).toHaveAttribute('aria-busy', 'true')
    // 보내는 동안의 Esc 는 닫지 않는다 — 응답이 닫거나 오류를 보인다
    await user.keyboard('{Escape}')
    expect(form).toBeVisible()
    await user.click(within(form).getByRole('button', { name: '추가' }))

    act(() => gate.resolve())
    expect(
      await within(column('진행 중')).findByRole('link', { name: '배포 체크리스트' }, FIRST_PAINT),
    ).toBeVisible()
    expect(bodies).toHaveLength(1)
    expect(db.tasks.filter(({ title }) => title === '배포 체크리스트')).toHaveLength(1)
  })

  it('실패하면 입력을 남긴 채 알리고 카드를 만들지 않는다. 다시 보내 성공하면 닫힌다', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/v1/tasks', () => fail('INTERNAL_ERROR', '서버 오류', 500), { once: true }),
    )
    await openBoard()
    await user.click(addButton('시작 전'))
    const input = titleInput('시작 전')
    await user.type(input, '회의실 예약{Enter}')

    const alert = await within(column('시작 전')).findByRole('alert')
    expect(alert).toHaveTextContent('태스크를 추가하지 못했어요.')
    expect(input).toHaveValue('회의실 예약')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(within(column('시작 전')).queryByRole('link', { name: '회의실 예약' })).toBeNull()
    expect(db.tasks.some(({ title }) => title === '회의실 예약')).toBe(false)

    await user.click(within(column('시작 전')).getByRole('button', { name: '추가' }))
    expect(
      await within(column('시작 전')).findByRole('link', { name: '회의실 예약' }, FIRST_PAINT),
    ).toBeVisible()
    expect(within(column('시작 전')).queryByRole('alert')).toBeNull()
  })

  it('추가 응답을 읽지 못하면 입력 칸에 실패라 하지 않고 결과를 확인하지 못했다고 알린다. 새로고침은 목록을 다시 받는다 (#348)', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warning.mockRestore())
    server.use(
      http.post(
        '/api/v1/tasks',
        () =>
          ok({
            ...toTaskResponse(db.tasks.find(({ task_id }) => task_id === 'tk_01')!),
            status: 'archived',
          }),
        { once: true },
      ),
    )
    const user = userEvent.setup()
    const log = recordRequests()
    await openBoard()
    await user.click(addButton('시작 전'))
    await user.type(titleInput('시작 전'), '회의실 예약{Enter}')
    const notice = (
      await screen.findByText('변경 결과를 확인하지 못했어요', {}, { timeout: 5_000 })
    ).closest('li') as HTMLElement
    expect(within(notice).getByText(/서버에는 반영됐을 수 있어요/)).toBeInTheDocument()
    expect(within(column('시작 전')).queryByRole('alert')).toBeNull()
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    const before = log.started.length
    fireEvent.click(within(notice).getByRole('button', { name: '새로고침' }))
    await waitFor(() =>
      expect(log.started.slice(before)).toContainEqual({
        method: 'GET',
        path: '/tasks?workspace_id=ws_01',
      }),
    )
  })

  it('Esc·취소는 보내지 않고 닫는다', async () => {
    const user = userEvent.setup()
    const bodies = recordCreates()
    await openBoard()
    await user.click(addButton('완료'))
    await user.type(within(column('완료')).getByRole('textbox'), '임시{Escape}')
    expect(within(column('완료')).queryByRole('textbox')).toBeNull()
    await waitFor(() => expect(addButton('완료')).toHaveFocus())

    await user.click(addButton('완료'))
    expect(within(column('완료')).getByRole('textbox')).toHaveValue('')
    await user.click(within(column('완료')).getByRole('button', { name: '취소' }))
    expect(within(column('완료')).queryByRole('textbox')).toBeNull()
    expect(bodies).toEqual([])
  })

  it('입력이 아니라 취소·추가에 포커스가 있어도 Esc 로 닫고 직접 추가로 돌아온다', async () => {
    const user = userEvent.setup()
    const bodies = recordCreates()
    await openBoard()
    await user.click(addButton('시작 전'))
    await user.type(titleInput('시작 전'), '임시')
    await user.tab()
    expect(within(column('시작 전')).getByRole('button', { name: '취소' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(within(column('시작 전')).queryByRole('form')).toBeNull()
    await waitFor(() => expect(addButton('시작 전')).toHaveFocus())

    await user.click(addButton('시작 전'))
    await user.type(titleInput('시작 전'), '임시')
    await user.tab()
    await user.tab()
    expect(within(column('시작 전')).getByRole('button', { name: '추가' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(within(column('시작 전')).queryByRole('form')).toBeNull()
    await waitFor(() => expect(addButton('시작 전')).toHaveFocus())
    expect(bodies).toEqual([])
  })

  it('두 칸을 함께 펼쳐도 입력 이름이 칸마다 다르다', async () => {
    const user = userEvent.setup()
    await openBoard()
    await user.click(addButton('시작 전'))
    await user.click(addButton('진행 중'))
    expect(titleInput('시작 전')).not.toBe(titleInput('진행 중'))
    expect(screen.queryAllByRole('textbox', { name: '새 태스크 제목' })).toEqual([])
  })

  it('담당자로 걸러 보는 중이면 그 팀원을 담당자로 넣어 보드에 남긴다', async () => {
    const user = userEvent.setup()
    const bodies = recordCreates()
    await openBoard('&assignee=mb_02')
    await user.click(addButton('시작 전'))
    await user.type(within(column('시작 전')).getByRole('textbox'), '접근성 점검{Enter}')
    expect(
      await within(column('시작 전')).findByRole('link', { name: '접근성 점검' }, FIRST_PAINT),
    ).toBeVisible()
    expect(bodies[0]).toMatchObject({ assignee_member_id: 'mb_02', status: 'todo' })
  })

  it('일반 팀원에게는 직접 추가가 없다 — 서버의 태스크 생성은 PM 전용이다', async () => {
    setMockRole('member')
    await openBoard()
    expect(screen.queryByRole('button', { name: /직접 추가/ })).toBeNull()
  })

  it('일반 팀원이 직접 POST 해도 MSW 가 403 으로 막고 태스크를 만들지 않는다', async () => {
    setMockRole('member')
    const before = structuredClone(db.tasks)
    await expect(
      fetchDto('/tasks', jsonRequest('POST', { workspace_id: 'ws_01', title: '몰래 추가' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(db.tasks).toEqual(before)
  })
})
