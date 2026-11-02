import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { taskListQueryOptions } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { handlers } from '@/shared/mock/handlers'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * M8 A — 보드·캘린더·간트의 조회 상태와 역할·공간·상세 링크 (AC-A-05 · AC-A-06). 실제 경로 표·MSW handler 를 그대로 탄다.
 * 픽스처의 ws_01: 태스크 10건, 대기 생성 승인 3건(ap_03 만 마감 9/25), 서울 오늘 2026-09-18. 태스크 조회만 보기 전체 오류이고
 * 확인 필요·팀원·회의를 받지 못하면 받은 데이터로 그린 보기 위에서 알린다 (코디네이터 확인 2026-10-30, 제안 A).
 */

vi.setConfig({ testTimeout: 15_000 })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => vi.useRealTimers())

type View = 'board' | 'calendar' | 'gantt'
const VIEWS: readonly View[] = ['board', 'calendar', 'gantt']
/** 그 보기가 다 그려졌다는 표식 */
const shown: Record<View, () => HTMLElement | null> = {
  board: () => screen.queryByRole('region', { name: '시작 전' }),
  calendar: () => screen.queryByRole('table', { name: '2026년 9월' }),
  gantt: () => screen.queryByRole('table', { name: '일정' }),
}
/** 파일의 첫 화면은 lazy 보기 모듈 변환이 겹쳐 기본 1초를 넘길 때가 있다 */
const FIRST_PAINT = { timeout: 5_000 }

async function openView(view: View, search = '') {
  const app = renderApp(`${paths.tasks('ws_01')}?view=${view}${search}`)
  await waitFor(() => expect(shown[view]()).toBeVisible(), FIRST_PAINT)
  return app
}
const notice = () => screen.queryByRole('alert')
const approvalRequests = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ path }) => path.startsWith('/approvals'))

describe.each(VIEWS)('%s 보기의 조회 상태 (AC-A-05)', (view) => {
  it('태스크를 받는 동안 `태스크를 불러오는 중` 이고, 받으면 보기를 그린다', async () => {
    const gate = deferred()
    server.use(
      http.get('/api/v1/tasks', async ({ request }) => {
        await gate.promise
        return getResponse(handlers, request)
      }),
    )
    renderApp(`${paths.tasks('ws_01')}?view=${view}`)
    expect(
      await screen.findByRole('status', { name: '태스크를 불러오는 중' }, FIRST_PAINT),
    ).toBeVisible()
    expect(shown[view]()).toBeNull()

    act(() => gate.resolve())
    await waitFor(() => expect(shown[view]()).toBeVisible(), FIRST_PAINT)
    expect(screen.queryByRole('status', { name: '태스크를 불러오는 중' })).toBeNull()
  })

  it('태스크도 확인 필요도 회의도 없으면 빈 보기 대신 `아직 태스크가 없어요` 다', async () => {
    db.tasks = db.tasks.filter(({ workspace_id }) => workspace_id !== 'ws_01')
    db.approvals = db.approvals.filter(({ workspace_id }) => workspace_id !== 'ws_01')
    db.meetings = db.meetings.filter(({ workspace_id }) => workspace_id !== 'ws_01')
    renderApp(`${paths.tasks('ws_01')}?view=${view}`)
    expect(
      await screen.findByRole('heading', { name: '아직 태스크가 없어요' }, FIRST_PAINT),
    ).toBeVisible()
    expect(shown[view]()).toBeNull()
    expect(notice()).toBeNull()
  })

  it('태스크를 처음부터 받지 못하면 보기 전체 오류이고, 다시 시도하면 그린다', async () => {
    const user = userEvent.setup()
    server.use(http.get('/api/v1/tasks', () => fail('INVALID_REQUEST', 'x', 400), { once: true }))
    renderApp(`${paths.tasks('ws_01')}?view=${view}`)
    expect(
      await screen.findByText('태스크 목록을 불러오지 못했어요', undefined, FIRST_PAINT),
    ).toBeVisible()
    expect(shown[view]()).toBeNull()

    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(shown[view]()).toBeVisible(), FIRST_PAINT)
    expect(notice()).toBeNull()
  })

  it('확인 필요를 받지 못하면 태스크로 보기를 그리고 알린다. 비었다고 하지 않는다', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/v1/approvals', () => fail('INVALID_REQUEST', 'x', 400), { once: true }),
    )
    await openView(view)
    expect(notice()).toHaveTextContent('확인 필요 정보를 불러오지 못했어요')
    expect(screen.queryByRole('heading', { name: '아직 태스크가 없어요' })).toBeNull()
    expect(screen.getAllByRole('link', { name: /로그인 API 연동/ }).length).toBeGreaterThan(0)

    await user.click(within(notice()!).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(notice()).toBeNull())
  })

  it('팀원을 받지 못하면 담당자를 `담당자 없음` 이 아니라 `알 수 없는 담당자` 로 그리고 알린다', async () => {
    const user = userEvent.setup()
    server.use(http.get('/api/v1/members', () => fail('INVALID_REQUEST', 'x', 400), { once: true }))
    await openView(view)
    expect(notice()).toHaveTextContent('팀원 정보를 불러오지 못했어요')
    expect(screen.getAllByText(/알 수 없는 담당자/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/김서연/)).toBeNull()

    await user.click(within(notice()!).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(notice()).toBeNull())
    expect(screen.getAllByText(/김서연/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/알 수 없는 담당자/)).toBeNull()
  })

  it('받아 둔 태스크의 재조회가 실패하면 보기는 그대로 두고 알린다. 다시 시도해 받으면 사라진다', async () => {
    const user = userEvent.setup()
    const app = await openView(view)
    server.use(http.get('/api/v1/tasks', () => fail('INVALID_REQUEST', 'x', 400), { once: true }))
    await act(() =>
      app.queryClient.refetchQueries({ queryKey: taskListQueryOptions('ws_01').queryKey }),
    )
    await waitFor(() => expect(notice()).toHaveTextContent('태스크 정보를 불러오지 못했어요'))
    expect(shown[view]()).toBeVisible()
    expect(screen.getAllByRole('link', { name: /로그인 API 연동/ }).length).toBeGreaterThan(0)

    await user.click(within(notice()!).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(notice()).toBeNull())
  })
})

describe('캘린더·간트의 표시 기간 (AC-A-05)', () => {
  it.each(['pm', 'member'] as const)(
    '캘린더 — 태스크·확인 필요가 없어도 받은 회의가 있으면 격자와 회의를 그리고 달을 옮긴다 (%s)',
    async (role) => {
      setMockRole(role)
      db.tasks = db.tasks.filter(({ workspace_id }) => workspace_id !== 'ws_01')
      db.approvals = db.approvals.filter(({ workspace_id }) => workspace_id !== 'ws_01')
      const user = userEvent.setup()
      await openView('calendar')
      expect(screen.queryByRole('heading', { name: '아직 태스크가 없어요' })).toBeNull()
      expect(screen.getByRole('link', { name: '2주차 정기회의' })).toHaveAttribute(
        'href',
        paths.meetings('ws_01', 'mt_07'),
      )

      await user.click(screen.getByRole('button', { name: '다음 달' }))
      expect(await screen.findByRole('table', { name: '2026년 10월' })).toBeVisible()
      expect(screen.queryByRole('link', { name: '2주차 정기회의' })).toBeNull()
      await user.click(screen.getByRole('button', { name: '이전 달' }))
      expect(await screen.findByRole('link', { name: '2주차 정기회의' })).toBeVisible()
    },
  )

  it('캘린더 — 회의를 받지 못하면 알리고, 마감이 없는 달은 격자와 함께 그렇다고 알린다', async () => {
    server.use(
      http.get(
        '/api/v1/workspaces/:workspaceId/meetings',
        () => fail('INVALID_REQUEST', 'x', 400),
        {
          once: true,
        },
      ),
    )
    await openView('calendar')
    expect(notice()).toHaveTextContent('회의 정보를 불러오지 못했어요')
    expect(screen.queryByText('이 달에는 마감인 일이 없어요.')).toBeNull()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '다음 달' }))
    expect(await screen.findByRole('table', { name: '2026년 10월' })).toBeVisible()
    expect(screen.getByText('이 달에는 마감인 일이 없어요.')).toBeVisible()
    // 마감 없는 일은 그대로 아래에 모여 있다
    expect(screen.getByRole('region', { name: '마감일 없음' })).toHaveTextContent(
      '회의록 요약 검수',
    )
  })

  it('간트 — 일정이 없는 3주로 옮기면 표와 함께 그렇다고 알린다', async () => {
    const user = userEvent.setup()
    await openView('gantt')
    expect(screen.queryByText('이 3주에는 일정이 있는 일이 없어요.')).toBeNull()
    await user.click(screen.getByRole('button', { name: '다음 3주' }))
    expect(await screen.findByText('이 3주에는 일정이 있는 일이 없어요.')).toBeVisible()
    expect(screen.getByRole('table', { name: '일정' })).toBeVisible()
  })
})

/** 기간 이동과 빈 기간 문구, 확인 필요가 들어가는 합계 */
const PERIOD = {
  calendar: {
    next: '다음 달',
    empty: '이 달에는 마감인 일이 없어요.',
    loadedEmpty: '불러온 태스크에는 이 달에 마감인 일이 없어요.',
    total: () => screen.getByRole('heading', { name: '마감일 없음' }).parentElement!.textContent,
    title: '마감일 없음',
  },
  gantt: {
    next: '다음 3주',
    empty: '이 3주에는 일정이 있는 일이 없어요.',
    loadedEmpty: '불러온 태스크에는 이 3주에 일정이 있는 일이 없어요.',
    total: () => screen.getByRole('heading', { name: /^일정이 없는 일/ }).textContent,
    title: '일정이 없는 일',
  },
} as const

describe.each(['calendar', 'gantt'] as const)(
  '%s — 확인 필요를 받지 못하면 빈 기간과 합계를 단정하지 않는다 (AC-A-05)',
  (view) => {
    const period = PERIOD[view]
    const failApprovals = () =>
      server.use(
        http.get('/api/v1/approvals', () => fail('INVALID_REQUEST', 'x', 400), { once: true }),
      )

    it('일이 없는 기간은 불러온 태스크 범위로만 말하고 합계를 숨긴다. 다시 받으면 합계가 돌아온다', async () => {
      const user = userEvent.setup()
      failApprovals()
      await openView(view)
      expect(notice()).toHaveTextContent('확인 필요 정보를 불러오지 못했어요')
      expect(period.total()).toBe(period.title)
      // 간트 담당자 줄의 건수도 확인 필요가 빠진 수라 보이지 않는다
      if (view === 'gantt') expect(screen.queryAllByText(/^\d+건$/)).toEqual([])

      await user.click(screen.getByRole('button', { name: period.next }))
      expect(await screen.findByText(period.loadedEmpty)).toBeVisible()
      expect(screen.queryByText(period.empty)).toBeNull()

      await user.click(within(notice()!).getByRole('button', { name: '다시 시도' }))
      await waitFor(() => expect(notice()).toBeNull())
      expect(screen.getByText(period.empty)).toBeVisible()
      expect(period.total()).toMatch(new RegExp(`^${period.title} ?\\d+$`))
      if (view === 'gantt') expect(screen.getAllByText(/^\d+건$/).length).toBeGreaterThan(0)
    })

    it('태스크가 없어도 빈 화면 대신 보기를 그리고 불러온 태스크 범위로 말한다', async () => {
      db.tasks = db.tasks.filter(({ workspace_id }) => workspace_id !== 'ws_01')
      failApprovals()
      await openView(view)
      expect(notice()).toHaveTextContent('확인 필요 정보를 불러오지 못했어요')
      expect(screen.queryByRole('heading', { name: '아직 태스크가 없어요' })).toBeNull()
      expect(screen.getByText(period.loadedEmpty)).toBeVisible()
      expect(screen.queryByText(period.empty)).toBeNull()
      expect(period.total()).toBe(period.title)
    })
  },
)

describe('역할·공간·상세 링크 (AC-A-06)', () => {
  it('PM 은 세 보기에서 확인 필요를 함께 보고, 승인 목록은 보기를 옮겨도 한 번만 받는다', async () => {
    const user = userEvent.setup()
    const log = recordRequests()
    await openView('board')
    expect(screen.getByText(/리스트 뷰에서 승인하면 이 보드로 넘어옵니다/)).toBeVisible()

    await user.click(
      within(screen.getByLabelText('보기 방식')).getByRole('radio', { name: '캘린더' }),
    )
    await waitFor(() => expect(shown.calendar()).toBeVisible(), FIRST_PAINT)
    expect(screen.getByRole('link', { name: /배포 문서 보완/ })).toHaveAttribute(
      'href',
      `${paths.tasks('ws_01')}?tab=needs_review`,
    )

    await user.click(
      within(screen.getByLabelText('보기 방식')).getByRole('radio', { name: '간트' }),
    )
    await waitFor(() => expect(shown.gantt()).toBeVisible(), FIRST_PAINT)
    expect(screen.getByRole('row', { name: /배포 문서 보완/ })).toBeVisible()
    expect(approvalRequests(log)).toEqual([
      { method: 'GET', path: '/approvals?workspace_id=ws_01&status=pending' },
    ])
  })

  it.each(VIEWS)(
    '일반 팀원은 %s 보기에서 확인 필요가 없고 승인 API 를 부르지 않는다',
    async (view) => {
      setMockRole('member')
      const log = recordRequests()
      await openView(view)
      expect(screen.queryByText(/배포 문서 보완|알림 문구 검토|테스트 계획 정리/)).toBeNull()
      expect(screen.queryByText(/리스트 뷰에서 승인하면/)).toBeNull()
      expect(notice()).toBeNull()
      expect(approvalRequests(log)).toEqual([])
    },
  )

  it.each(VIEWS)('%s 보기의 태스크는 그 태스크 상세로 간다', async (view) => {
    const user = userEvent.setup()
    const app = await openView(view)
    const link = screen.getAllByRole('link', { name: /로그인 API 연동/ })[0]
    expect(link).toHaveAttribute('href', paths.tasks('ws_01', 'tk_01'))
    await user.click(link)
    await app.expectPath(paths.tasks('ws_01', 'tk_01'))
  })

  it.each(VIEWS)(
    '다른 공간의 %s 보기로 옮기면 이전 공간의 태스크가 섞이지 않는다',
    async (view) => {
      db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_02')!.onboarding.completed =
        true
      const app = await openView(view)
      act(() => app.navigate(`${paths.tasks('ws_02')}?view=${view}`))
      await app.expectPath(paths.tasks('ws_02'))
      expect(
        await screen.findByRole('heading', { name: '아직 태스크가 없어요' }, FIRST_PAINT),
      ).toBeVisible()
      expect(screen.queryByText(/로그인 API 연동/)).toBeNull()
    },
  )
})

describe('표 구조 — 줄·머리·칸 (VR-08)', () => {
  it('캘린더는 요일 머리 한 줄과 주마다 날짜 일곱 칸인 표다', async () => {
    await openView('calendar')
    const rows = within(screen.getByRole('table', { name: '2026년 9월' })).getAllByRole('row')
    // 요일 머리 + 9월의 다섯 주
    expect(rows).toHaveLength(6)
    expect(
      within(rows[0])
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual(['일', '월', '화', '수', '목', '금', '토'])
    expect(within(rows[0]).queryAllByRole('cell')).toEqual([])
    const days = rows.slice(1).map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.getAttribute('aria-label')),
    )
    expect(days.map((week) => week.length)).toEqual([7, 7, 7, 7, 7])
    expect(days[0][0]).toBe('2026-08-30')
    expect(days[3]).toContain('2026-09-25')
    expect(days[4][6]).toBe('2026-10-03')
  })

  it('간트는 열 머리 한 줄과, 줄마다 줄 머리 하나·주 셋에 걸친 날짜 칸 하나인 표다', async () => {
    await openView('gantt', '&from=2026-09-14')
    const [head, ...rows] = within(screen.getByRole('table', { name: '일정' })).getAllByRole('row')
    const columns = within(head).getAllByRole('columnheader')
    expect(columns.map((column) => column.textContent)).toEqual([
      '담당자 · 태스크',
      '9월 3주',
      '9월 4주',
      '9월 5주',
    ])
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(within(row).getAllByRole('rowheader')).toHaveLength(1)
      const cells = within(row).getAllByRole('cell')
      expect(cells).toHaveLength(1)
      expect(cells[0]).toHaveAttribute('aria-colspan', '3')
    }
    const task = screen.getByRole('row', { name: /로그인 API 연동/ })
    expect(
      within(within(task).getByRole('rowheader')).getByRole('link', { name: '로그인 API 연동' }),
    ).toHaveAttribute('href', paths.tasks('ws_01', 'tk_01'))
  })
})

describe('간트 「일정이 없는 일」의 날짜 넣기 (VR-04 · VR-12)', () => {
  it('확인 필요는 그 승인 상세로, 태스크는 그 태스크 상세로 가고 링크 이름이 일마다 다르다', async () => {
    const user = userEvent.setup()
    const app = await openView('gantt')
    const list = screen.getByRole('region', { name: '일정이 없는 일' })
    const links = within(list).getAllByRole('link', { name: /날짜 넣기$/ })
    expect(
      links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]),
    ).toEqual([
      ['테스트 계획 정리 날짜 넣기', paths.approval('ws_01', 'ap_02')],
      ['알림 문구 검토 날짜 넣기', paths.approval('ws_01', 'ap_01')],
      ['회의록 요약 검수 날짜 넣기', paths.tasks('ws_01', 'tk_05')],
    ])
    // 보이는 문구는 시안 그대로다
    for (const link of links) expect(link).toHaveTextContent(/^날짜 넣기$/)

    await user.click(links[1])
    await app.expectPath(paths.approval('ws_01', 'ap_01'))
  })
})
