import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { BrowserRouter, Routes } from 'react-router'
import { clearTrackedMeetings } from '@/entities/meeting'
import { WORKSPACE_LIST_QUERY_KEY } from '@/entities/workspace'
import { TASK_STATUS_FAILED_TITLE } from '@/features/task-status'
import { workspaceKey } from '@/shared/api/queryKeys'
import { paths } from '@/shared/config/routes'
import { db, replaceDb } from '@/shared/mock/db'
import { fail, list } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { handlers } from '@/shared/mock/handlers'
import { createScenarioDb } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { onTestFinished } from 'vitest'
import { App } from './App'
import { createApp } from './createApp'
import { appRoutes } from './router/routes'
import { renderApp } from './test/renderApp'

/*
 * M6 S3 — 태스크 목록·상세 (계획 §3, AC-02 · AC-03 · AC-04). 실제 경로 표·MSW handler·request() 를 그대로 탄다.
 * 픽스처의 ws_01: 태스크 10건(미완료 7 · 완료 3), 대기 승인 3건(ap_01 → ap_02 → ap_03 순으로 오래됨), 서울 오늘 2026-09-18.
 * 날짜만 고정한다 — 타이머는 진짜다. 판정 자체(경계·시간대)는 widgets/task-board/lib/taskBoard.test.ts 가 본다.
 */

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
})

type Log = ReturnType<typeof recordRequests>
const approvalRequests = (log: Log) =>
  log.started.filter(({ path }) => path.startsWith('/approvals'))
const settle = (ms = 80) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

const PM_ALL = [
  // 대기 승인 — 대기 시작 오래된 순
  '알림 문구 검토',
  '테스트 계획 정리',
  '배포 문서 보완',
  // 태스크 — 마감 오름차순, 마감 없는 회의록 요약 검수(tk_05)는 마지막
  '온보딩 문구 수정',
  '랜딩 카피',
  '폰트 적용',
  '회원가입 화면',
  '토큰 정리',
  'STT 정확도 측정',
  '로그인 API 연동',
  'DB 스키마 정리',
  '배포 스크립트',
  '회의록 요약 검수',
]

function tabTexts(): string[] {
  return within(screen.getByRole('tablist', { name: '태스크 구분' }))
    .getAllByRole('tab')
    .map((tab) => (tab.textContent ?? '').replace(/\s+/g, ' ').trim())
}
function tab(name: string) {
  return screen.getByRole('tab', { name: new RegExp(`^${name}`) })
}
function rows(): string[] {
  // 확인 필요 카드(제목 h2)가 먼저, 다음이 태스크 행(제목 링크)이다
  const cards = screen.queryByRole('list', { name: '확인 필요 목록' })
  const tasks = screen.queryByRole('list', { name: '태스크 목록' })
  return [
    ...(cards === null
      ? []
      : within(cards)
          .getAllByRole('article')
          .map((card) => card.querySelector('h2')?.textContent ?? '')),
    ...(tasks === null
      ? []
      : within(tasks)
          .getAllByRole('link')
          .map((link) => link.textContent ?? '')),
  ]
}
/** 목록 행의 상태 배지. 태스크 행의 첫 글자 칸이다 */
function rowStatus(title: string): string {
  const row = within(screen.getByRole('list', { name: '태스크 목록' }))
    .getByRole('link', { name: title })
    .closest('li')
  return row?.querySelector('span')?.textContent ?? ''
}
async function openList(path = paths.tasks('ws_01')) {
  const app = renderApp(path)
  // 목록은 로딩 자리의 최소 표시(400ms, #508)가 끝난 뒤 그려진다 — 기본 1초는 부하에서 빠듯하다
  await waitFor(() => expect(rows().length).toBeGreaterThan(0), { timeout: 3000 })
  return app
}

describe('역할별 탭·개수·병합·정렬 (AC-02)', () => {
  it('PM 은 네 탭을 보고, 전체는 대기 승인 다음 태스크다. 승인 목록은 한 번 받는다', async () => {
    const log = recordRequests()
    await openList()

    expect(screen.getByRole('heading', { level: 1, name: '태스크' })).toBeInTheDocument()
    await waitFor(() =>
      expect(tabTexts()).toEqual(['전체 13', '확인 필요 3', '진행 중 7', '완료 3']),
    )
    expect(tab('전체')).toHaveAttribute('aria-selected', 'true')
    expect(rows()).toEqual(PM_ALL)
    // 승인 항목은 목록 안 카드에서 바로 처리하고, 태스크는 태스크 상세로 간다
    expect(screen.getByRole('heading', { level: 2, name: '알림 문구 검토' })).toBeVisible()
    expect(screen.getByRole('link', { name: '알림 문구 검토' })).toHaveAttribute(
      'href',
      paths.approval('ws_01', 'ap_01'),
    )
    expect(screen.getByRole('link', { name: '로그인 API 연동' })).toHaveAttribute(
      'href',
      paths.tasks('ws_01', 'tk_01'),
    )
    expect(approvalRequests(log)).toEqual([
      { method: 'GET', path: '/approvals?workspace_id=ws_01&status=pending' },
    ])
  })

  it('탭마다 목록 수가 탭 개수와 같다', async () => {
    const user = userEvent.setup()
    await openList()
    await waitFor(() => expect(tabTexts()).toHaveLength(4))
    for (const [name, expected] of [
      ['확인 필요', ['알림 문구 검토', '테스트 계획 정리', '배포 문서 보완']],
      [
        '진행 중',
        [
          '온보딩 문구 수정',
          '회원가입 화면',
          'STT 정확도 측정',
          '로그인 API 연동',
          'DB 스키마 정리',
          '배포 스크립트',
          '회의록 요약 검수',
        ],
      ],
      ['완료', ['랜딩 카피', '폰트 적용', '토큰 정리']],
      ['전체', PM_ALL],
    ] as const) {
      await user.click(tab(name))
      // 탭은 URL 이동이라 transition 으로 그린다 — 그려질 때까지 기다린다
      await waitFor(() => {
        expect(tab(name)).toHaveAttribute('aria-selected', 'true')
        expect(rows()).toEqual(expected)
      })
      expect(tab(name)).toHaveTextContent(String(expected.length))
    }
  })

  it('서버 순서와 무관하게 승인은 대기 오래된 순, 같은 마감은 생성 최신순, 마감 없음은 마지막이다', async () => {
    // 승인을 최신부터 준다
    server.use(
      http.get('/api/v1/approvals', () =>
        list(db.approvals.filter(({ status }) => status === 'pending').reverse()),
      ),
    )
    // tk_01 과 마감이 같고 더 늦게 만든 태스크
    db.tasks.push({
      ...db.tasks.find(({ task_id }) => task_id === 'tk_01')!,
      task_id: 'tk_11',
      title: '같은 마감 새 태스크',
      created_at: '2026-09-17T04:00:00Z',
    })
    await openList()
    await waitFor(() => expect(rows()).toHaveLength(14))
    const shown = rows()
    expect(shown.slice(0, 3)).toEqual(['알림 문구 검토', '테스트 계획 정리', '배포 문서 보완'])
    expect(shown.indexOf('같은 마감 새 태스크')).toBe(shown.indexOf('로그인 API 연동') - 1)
    // MSW 는 마감 없는 태스크를 맨 앞에 준다 — 화면은 맨 뒤다
    expect(shown.at(-1)).toBe('회의록 요약 검수')
  })

  it('일반 팀원은 확인 필요 탭이 없고 승인 API 를 한 번도 부르지 않는다 — URL 로 확인 필요를 골라도 전체다', async () => {
    setMockRole('member')
    const log = recordRequests()
    await openList(`${paths.tasks('ws_01')}?tab=needs_review`)

    await waitFor(() => expect(tabTexts()).toEqual(['전체 10', '진행 중 7', '완료 3']))
    expect(tab('전체')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: /확인 필요/ })).toBeNull()
    expect(rows()).toEqual(PM_ALL.slice(3))
    expect(document.querySelector('a[href*="/approvals/"]')).toBeNull()
    await settle(200)
    expect(approvalRequests(log)).toHaveLength(0)
    // 상세도 승인 API 를 부르지 않는다
    await userEvent.click(screen.getByRole('link', { name: '로그인 API 연동' }))
    expect(await screen.findByRole('heading', { level: 1, name: '로그인 API 연동' })).toBeVisible()
    await settle(200)
    expect(approvalRequests(log)).toHaveLength(0)
  })
})

/*
 * MemoryRouter 는 window.history 를 쓰지 않는다. URL 복원은 jsdom 의 실제 기록 위에서 BrowserRouter 로 본다 —
 * 새로고침은 앱을 내리고 같은 주소로 처음부터 다시 띄우는 것이다.
 */
describe('목록 안 확인 필요 카드 (시안)', () => {
  it('실 API에서도 보완과 미정 승인을 허용하고 반려하면 카드가 빠진다', async () => {
    const user = userEvent.setup()
    await openList(`${paths.tasks('ws_01')}?tab=needs_review`)
    const cards = within(screen.getByRole('list', { name: '확인 필요 목록' })).getAllByRole(
      'article',
    )
    expect(cards).toHaveLength(3)
    const target = cards.find((each) => each.textContent?.includes('테스트 계획 정리'))!
    await waitFor(() => expect(within(target).getByRole('button', { name: '승인' })).toBeEnabled())
    expect(within(target).getByRole('textbox', { name: '태스크명' })).not.toHaveAttribute(
      'readonly',
    )
    expect(within(target).getByRole('button', { name: '반려' })).toBeEnabled()
    const held = cards.find((each) => each.textContent?.includes('알림 문구 검토'))!
    expect(within(held).getByRole('button', { name: '직접 채우기' })).toBeEnabled()
    expect(within(held).getByRole('button', { name: '반려' })).toBeEnabled()
    expect(within(held).queryByRole('button', { name: '제외' })).toBeNull()

    await user.click(within(target).getByRole('button', { name: '반려' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: '확인 필요 목록' })).getAllByRole('article'),
      ).toHaveLength(2),
    )
    expect(tab('확인 필요')).toHaveTextContent('2')
  })

  it('팀원이 아닌 담당자로 승인이 막힌 칸은 포커스 선도 포인트 빨강이다 (#423)', async () => {
    const user = userEvent.setup()
    const outsider = db.approvals.find(
      ({ status, workspace_id, type }) =>
        status === 'pending' && workspace_id === 'ws_01' && type === 'task_create',
    )!
    Object.assign(outsider.payload, { assignee_member_id: 'mb_99' })
    await openList(`${paths.tasks('ws_01')}?tab=needs_review`)
    const list = screen.getByRole('list', { name: '확인 필요 목록' })
    for (const fill of within(list).queryAllByRole('button', { name: '직접 채우기' }))
      await user.click(fill)
    const selects = await within(list).findAllByRole('combobox', { name: /담당자/ })
    const blocked = selects.filter((each) => each.getAttribute('aria-invalid') === 'true')
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toHaveClass('border-accent', 'focus-visible:outline-accent-point')
    for (const select of selects.filter((each) => !blocked.includes(each)))
      expect(select).not.toHaveClass('focus-visible:outline-accent-point')
  })

  describe('근거 시각 (#397)', () => {
    const NEEDS_REVIEW = `${paths.tasks('ws_01')}?tab=needs_review`
    const card = (title: string) => {
      const found = within(screen.getByRole('list', { name: '확인 필요 목록' }))
        .getAllByRole('article')
        .find((each) => each.textContent?.includes(title))
      if (!found) throw new Error(`approval card ${title} is missing`)
      return found
    }
    const meetingLink = (title: string) =>
      within(card(title)).getByRole('link', { name: /회의|채팅/ })

    it('채팅 회의에서 나온 카드는 실제 작성 시각, 녹음 회의에서 나온 카드는 녹음 안 위치다', async () => {
      replaceDb(createScenarioDb('approval-chat'))
      await openList(NEEDS_REVIEW)
      await waitFor(() =>
        expect(meetingLink('배포 체크리스트 정리')).toHaveTextContent('채팅 2026-09-1109/11 18:40'),
      )
      expect(meetingLink('배포 체크리스트 정리')).not.toHaveTextContent('9:28:00')
      expect(meetingLink('테스트 계획 정리')).toHaveTextContent('3주차 정기회의02:45')
    })

    it('회의 목록을 받지 못하면 시각을 녹음 위치로 짐작하지 않고 숨긴다', async () => {
      replaceDb(createScenarioDb('approval-chat'))
      server.use(
        http.get('/api/v1/workspaces/:workspaceId/meetings', () =>
          fail('INTERNAL_ERROR', 'x', 500),
        ),
      )
      const log = recordRequests()
      await openList(NEEDS_REVIEW)
      await waitFor(() =>
        expect(log.answered).toContainEqual({ method: 'GET', path: '/workspaces/ws_01/meetings' }),
      )
      await settle()
      expect(meetingLink('배포 체크리스트 정리').textContent).toBe('연결된 회의')
      expect(meetingLink('테스트 계획 정리').textContent).toBe('연결된 회의')
    })
  })
})

describe('보기 전환 (Tasks 시안 4장)', () => {
  it('리스트·보드·캘린더·간트를 오른쪽 위에서 고르고, 확인 필요 아래에 이미 반영된 일이 있다', async () => {
    const user = userEvent.setup()
    await openList(`${paths.tasks('ws_01')}?tab=needs_review`)
    const switcher = screen.getByLabelText('보기 방식')
    expect(
      within(switcher)
        .getAllByRole('radio')
        .map((each) => each.textContent),
    ).toEqual(['리스트', '보드', '캘린더', '간트'])
    // 픽스처에서 Notion 에 반영된 태스크는 둘이다
    const reflected = await screen.findByRole('list', { name: '이미 반영된 일 목록' })
    expect(within(reflected).getAllByRole('listitem')).toHaveLength(2)

    await user.click(within(switcher).getByRole('radio', { name: '보드' }))
    expect(await screen.findByRole('region', { name: '시작 전' })).toBeVisible()
    expect(screen.getByRole('region', { name: '진행 중' })).toBeVisible()
    expect(screen.getByRole('region', { name: '완료' })).toBeVisible()

    await user.click(within(switcher).getByRole('radio', { name: '캘린더' }))
    expect(await screen.findByRole('table', { name: /^\d{4}년 \d{1,2}월$/ })).toBeVisible()
    expect(screen.getByRole('region', { name: '마감일 없음' })).toBeVisible()

    await user.click(within(switcher).getByRole('radio', { name: '간트' }))
    expect(await screen.findByRole('table', { name: '일정' })).toBeVisible()
    expect(screen.getByRole('region', { name: '일정이 없는 일' })).toBeVisible()
  })

  it('담당자 콤보박스로 목록을 거른다', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: /^담당자:/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: '박민수' }))
    await waitFor(() =>
      expect(rows().slice(3)).toEqual(['회원가입 화면', '토큰 정리', '회의록 요약 검수']),
    )
  })
})

describe('키보드 Tab 순서 (#337)', () => {
  async function tabIntoPanel(user: ReturnType<typeof userEvent.setup>) {
    const panel = screen.getByRole('tabpanel')
    act(() => screen.getByRole('tab', { selected: true }).focus())
    for (let press = 0; press < 10 && !panel.contains(document.activeElement); press++) {
      await user.tab()
    }
    return document.activeElement
  }

  it('항목이 있는 목록 패널은 Tab 이 패널을 건너 첫 항목 링크로 간다', async () => {
    const user = userEvent.setup()
    renderApp(paths.tasks('ws_01'))
    const first = await screen.findByRole('link', { name: '알림 문구 검토' }, { timeout: 5_000 })
    expect(await tabIntoPanel(user)).toBe(first)
  })

  it('누를 것이 없는 빈 패널은 패널 자신이 Tab 으로 닿아 안내를 읽는다', async () => {
    const user = userEvent.setup()
    db.tasks = db.tasks.filter(({ workspace_id }) => workspace_id !== 'ws_01')
    db.approvals = db.approvals.filter(({ workspace_id }) => workspace_id !== 'ws_01')
    renderApp(`${paths.tasks('ws_01')}?tab=in_progress`)
    expect(
      await screen.findByRole('heading', { name: '이 구분에는 항목이 없어요' }, { timeout: 5_000 }),
    ).toBeVisible()
    expect(await tabIntoPanel(user)).toBe(screen.getByRole('tabpanel'))
  })
})

describe('목록 탭 키보드', () => {
  it('화살표·End·Home 으로 탭을 옮기면 그 탭에 포커스가 가고 골라진다', async () => {
    const user = userEvent.setup()
    await openList()
    await waitFor(() => expect(tabTexts()).toHaveLength(4))
    act(() => tab('전체').focus())

    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(tab('확인 필요')).toHaveAttribute('aria-selected', 'true'))
    expect(tab('확인 필요')).toHaveFocus()
    expect(
      within(screen.getByRole('list', { name: '확인 필요 목록' })).getAllByRole('article'),
    ).toHaveLength(3)

    await user.keyboard('{End}')
    await waitFor(() => expect(tab('완료')).toHaveAttribute('aria-selected', 'true'))
    expect(tab('완료')).toHaveFocus()

    await user.keyboard('{Home}')
    await waitFor(() => expect(tab('전체')).toHaveAttribute('aria-selected', 'true'))
    expect(tab('전체')).toHaveFocus()
  })
})

describe('리스트 보기의 대기·실패·빈 목록', () => {
  it('태스크를 받는 동안 탭은 개수 없이 이름만이고, 목록 자리는 기다림 표시이며 태스크 목록이 없다', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.get('/api/v1/tasks', async () => {
        await gate.promise
        return undefined
      }),
    )
    renderApp(paths.tasks('ws_01'))
    expect(await screen.findByRole('tab', { name: '전체' })).toBeInTheDocument()
    expect(tabTexts()).toEqual(['전체', '확인 필요', '진행 중', '완료'])
    expect(screen.getByRole('tabpanel').querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('list', { name: '태스크 목록' })).toBeNull()
  })

  it('태스크 목록을 받지 못하면 목록 자리에 오류와 다시 시도를 보인다', async () => {
    server.use(http.get('/api/v1/tasks', () => fail('INVALID_REQUEST', 'x', 400)))
    renderApp(paths.tasks('ws_01'))
    expect(
      await within(await screen.findByRole('tabpanel')).findByText(
        '태스크 목록을 불러오지 못했어요',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('tabpanel')).getByRole('button', { name: '다시 시도' }),
    ).toBeInTheDocument()
  })

  it('태스크도 확인 필요도 없으면 `아직 태스크가 없어요` 이고 탭 개수는 모두 0 이다', async () => {
    replaceDb(createScenarioDb('tasks-empty'))
    renderApp(paths.tasks('ws_01'))
    expect(await screen.findByText('아직 태스크가 없어요')).toBeInTheDocument()
    expect(tabTexts()).toEqual(['전체 0', '확인 필요 0', '진행 중 0', '완료 0'])
  })
})

describe('URL 탭·날짜 조건 (AC-03)', () => {
  function renderInBrowser(url: string) {
    window.history.replaceState(null, '', url)
    const app = createApp()
    const view = render(
      <App queryClient={app.queryClient}>
        <BrowserRouter>
          <Routes>{appRoutes}</Routes>
        </BrowserRouter>
      </App>,
    )
    return {
      ...app,
      ...view,
      dispose: () => {
        view.unmount()
        app.dispose()
      },
    }
  }
  let opened: ReturnType<typeof renderInBrowser>[] = []
  function open(url: string) {
    const app = renderInBrowser(url)
    opened.push(app)
    return app
  }
  afterEach(() => {
    for (const app of opened) app.dispose()
    opened = []
    window.history.replaceState(null, '', '/')
  })

  const search = () => window.location.search
  /** 마감 조건 콤보박스의 현재 값에 그 조건이 들어 있는가 */
  const pressed = (name: string) =>
    String(
      (
        screen.getByRole('button', { name: /^마감 조건:/ }).getAttribute('aria-label') ?? ''
      ).includes(name),
    )
  /** 콤보박스를 열어 조건 하나를 켜거나 끈다. 여러 개를 고르는 메뉴라 Esc 로 닫는다 */
  async function toggleDue(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole('button', { name: /^마감 조건:/ }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name }))
    await user.keyboard('{Escape}')
  }

  const OVERDUE_IN_PROGRESS = ['온보딩 문구 수정', '회원가입 화면']
  const DUE_IN_PROGRESS = [
    '온보딩 문구 수정',
    '회원가입 화면',
    'STT 정확도 측정',
    '로그인 API 연동',
    'DB 스키마 정리',
    '배포 스크립트',
  ]
  const DONE = ['랜딩 카피', '폰트 적용', '토큰 정리']

  /**
   * 주소와 그려진 화면이 함께 그 조건인지 기다린다. 기록 이동은 주소를 먼저 바꾸고 화면은 transition 으로 그린다 —
   * 주소만 보고 화면을 곧바로 읽으면 부하 때 이전 화면을 읽는다
   */
  async function expectView(expected: {
    search: string
    tab: string
    overdue: boolean
    soon: boolean
    rows: readonly string[]
  }) {
    await waitFor(() => {
      expect(search()).toBe(expected.search)
      expect(tab(expected.tab)).toHaveAttribute('aria-selected', 'true')
      expect(pressed('기한 지남')).toBe(String(expected.overdue))
      expect(pressed('7일 안에 마감')).toBe(String(expected.soon))
      expect(rows()).toEqual(expected.rows)
    })
  }

  it('최초 탭은 전체다. 탭·날짜 조건은 새 기록으로 쓰이고 뒤로가기로 하나씩 되살아난다', async () => {
    const user = userEvent.setup()
    open(paths.tasks('ws_01'))
    await waitFor(() =>
      expect(tabTexts()).toEqual(['전체 13', '확인 필요 3', '진행 중 7', '완료 3']),
    )
    await expectView({ search: '', tab: '전체', overdue: false, soon: false, rows: PM_ALL })

    await user.click(tab('완료'))
    await expectView({ search: '?tab=done', tab: '완료', overdue: false, soon: false, rows: DONE })
    await toggleDue(user, '기한 지남')
    const doneOverdue = {
      search: '?tab=done&due=overdue',
      tab: '완료',
      overdue: true,
      soon: false,
      rows: [],
    }
    await expectView(doneOverdue)
    expect(screen.getByRole('heading', { name: '조건에 맞는 항목이 없어요' })).toBeInTheDocument()
    await user.click(tab('진행 중'))
    const progressOverdue = {
      search: '?tab=in_progress&due=overdue',
      tab: '진행 중',
      overdue: true,
      soon: false,
      rows: OVERDUE_IN_PROGRESS,
    }
    await expectView(progressOverdue)
    await toggleDue(user, '7일 안에 마감')
    await expectView({
      search: '?tab=in_progress&due=overdue,soon',
      tab: '진행 중',
      overdue: true,
      soon: true,
      rows: DUE_IN_PROGRESS,
    })
    // 날짜 조건은 승인에 걸지 않는다 — 전체·확인 필요의 승인 수는 그대로다
    expect(tabTexts()).toEqual(['전체 9', '확인 필요 3', '진행 중 6', '완료 0'])

    act(() => window.history.back())
    await expectView(progressOverdue)
    act(() => window.history.back())
    await expectView(doneOverdue)
    act(() => window.history.back())
    await expectView({ search: '?tab=done', tab: '완료', overdue: false, soon: false, rows: DONE })
    act(() => window.history.back())
    await expectView({ search: '', tab: '전체', overdue: false, soon: false, rows: PM_ALL })
  })

  it('새로고침하면 같은 탭·날짜 조건으로 다시 그린다. 쉼표가 인코딩돼 와도 같다', async () => {
    const url = `${paths.tasks('ws_01')}?tab=in_progress&due=overdue,soon`
    const first = open(url)
    await waitFor(() => expect(rows()).toHaveLength(6))
    first.dispose()

    open(url)
    await waitFor(() =>
      expect(tabTexts()).toEqual(['전체 9', '확인 필요 3', '진행 중 6', '완료 0']),
    )
    await expectView({
      search: '?tab=in_progress&due=overdue,soon',
      tab: '진행 중',
      overdue: true,
      soon: true,
      rows: DUE_IN_PROGRESS,
    })
    opened.pop()?.dispose()

    open(`${paths.tasks('ws_01')}?due=soon%2Coverdue`)
    await waitFor(() =>
      expect(tabTexts()).toEqual(['전체 9', '확인 필요 3', '진행 중 6', '완료 0']),
    )
    await expectView({
      search: '?due=soon%2Coverdue',
      tab: '전체',
      overdue: true,
      soon: true,
      rows: ['알림 문구 검토', '테스트 계획 정리', '배포 문서 보완', ...DUE_IN_PROGRESS],
    })
  })

  it('해제하면 날짜 조건이 빠지고, 전체로 돌아오면 파라미터가 남지 않는다', async () => {
    const user = userEvent.setup()
    open(`${paths.tasks('ws_01')}?tab=done&due=overdue`)
    expect(await screen.findByRole('heading', { name: '조건에 맞는 항목이 없어요' })).toBeVisible()

    // 빈 상태의 해제와 조건 줄의 해제가 같은 동작이다. 조건 줄의 것을 누른다
    const clear = screen.getAllByRole('button', { name: '마감 조건 해제' })[0]
    await user.click(clear)
    await expectView({ search: '?tab=done', tab: '완료', overdue: false, soon: false, rows: DONE })
    expect(screen.queryByRole('button', { name: '마감 조건 해제' })).toBeNull()

    await user.click(tab('전체'))
    await expectView({ search: '', tab: '전체', overdue: false, soon: false, rows: PM_ALL })

    // 해제도 기록이다 — 뒤로가면 조건이 돌아온다
    act(() => window.history.back())
    await expectView({ search: '?tab=done', tab: '완료', overdue: false, soon: false, rows: DONE })
    act(() => window.history.back())
    await expectView({
      search: '?tab=done&due=overdue',
      tab: '완료',
      overdue: true,
      soon: false,
      rows: [],
    })
  })

  it('막힘 조건으로 들어오면 막힌 태스크만 보이고, 메뉴에서 켜고 끄면 주소에 남는다 (D-176)', async () => {
    const user = userEvent.setup()
    open(`${paths.tasks('ws_01')}?tab=in_progress&due=blocked`)
    await waitFor(() => {
      expect(rows()).toEqual(['DB 스키마 정리'])
      expect(tab('진행 중')).toHaveAttribute('aria-selected', 'true')
    })
    expect(screen.getByRole('button', { name: '마감 조건: 막힘' })).toBeVisible()
    expect(tabTexts()).toEqual(['전체 4', '확인 필요 3', '진행 중 1', '완료 0'])

    await toggleDue(user, '7일 안에 마감')
    await waitFor(() => {
      expect(search()).toBe('?tab=in_progress&due=soon,blocked')
      expect(rows()).toEqual([
        'STT 정확도 측정',
        '로그인 API 연동',
        'DB 스키마 정리',
        '배포 스크립트',
      ])
    })
    expect(
      screen.getByRole('button', { name: '마감 조건: 7일 안에 마감 · 막힘' }),
    ).toBeInTheDocument()

    await toggleDue(user, '막힘')
    await waitFor(() => expect(search()).toBe('?tab=in_progress&due=soon'))
    act(() => window.history.back())
    await waitFor(() => expect(search()).toBe('?tab=in_progress&due=soon,blocked'))
  })

  it('막힘으로 비면 마감 조건 해제로 조건을 푼다', async () => {
    const user = userEvent.setup()
    open(`${paths.tasks('ws_01')}?tab=done&due=blocked`)
    expect(await screen.findByRole('heading', { name: '조건에 맞는 항목이 없어요' })).toBeVisible()
    expect(screen.getByText('마감 조건을 풀면 다른 항목을 볼 수 있어요.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '마감 조건 해제' }))
    await expectView({ search: '?tab=done', tab: '완료', overdue: false, soon: false, rows: DONE })
  })
})

describe('정렬 (D-175)', () => {
  const sortButton = () => screen.getByRole('button', { name: /^정렬:/ })
  async function chooseSort(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(sortButton())
    await user.click(await screen.findByRole('menuitemradio', { name }))
  }
  const taskRequests = (log: Log) => log.started.filter(({ path }) => path.startsWith('/tasks'))

  it('기본은 마감 빠른 순이다. 최근 생성순을 고르면 URL 에 남고 승인·태스크가 각각 생성 최신순이 된다. 탭 개수는 그대로다', async () => {
    const user = userEvent.setup()
    const app = await openList()
    await waitFor(() => expect(rows()).toEqual(PM_ALL))
    expect(sortButton()).toHaveAccessibleName('정렬: 마감 빠른 순')
    const log = recordRequests()

    await chooseSort(user, '최근 생성순')
    await app.expectSearch('?sort=created')
    expect(sortButton()).toHaveAccessibleName('정렬: 최근 생성순')
    await waitFor(() =>
      expect(rows().slice(0, 4)).toEqual([
        '배포 문서 보완',
        '테스트 계획 정리',
        '알림 문구 검토',
        '배포 스크립트',
      ]),
    )
    const createdAt = new Map(db.tasks.map(({ title, created_at }) => [title, created_at]))
    const taskCreated = rows()
      .slice(3)
      .map((title) => createdAt.get(title))
    expect(taskCreated).toEqual([...taskCreated].sort().reverse())
    expect(tabTexts()).toEqual(['전체 13', '확인 필요 3', '진행 중 7', '완료 3'])

    await user.click(tab('완료'))
    await app.expectSearch('?sort=created&tab=done')
    await waitFor(() => expect(rows()).toEqual(['토큰 정리', '폰트 적용', '랜딩 카피']))

    await chooseSort(user, '마감 빠른 순')
    await app.expectSearch('?tab=done')
    await waitFor(() => expect(rows()).toEqual(['랜딩 카피', '폰트 적용', '토큰 정리']))
    // 정렬은 받은 목록 안에서만 한다 — 다시 부르지 않는다
    expect(taskRequests(log)).toEqual([])
  })

  it('주소로 최근 변경순을 열면 가장 최근에 바뀐 태스크가 태스크 중 맨 앞이다', async () => {
    db.tasks.find(({ task_id }) => task_id === 'tk_06')!.updated_at = '2026-09-18T01:00:00Z'
    await openList(`${paths.tasks('ws_01')}?sort=updated`)
    expect(sortButton()).toHaveAccessibleName('정렬: 최근 변경순')
    // 승인은 변경 시각이 없어 생성 최신순이다. 나머지 태스크는 변경 시각이 같아 생성 최신순이다
    await waitFor(() =>
      expect(rows().slice(0, 5)).toEqual([
        '배포 문서 보완',
        '테스트 계획 정리',
        '알림 문구 검토',
        'STT 정확도 측정',
        '배포 스크립트',
      ]),
    )
  })

  it('모르는 정렬 값은 마감 빠른 순이다', async () => {
    await openList(`${paths.tasks('ws_01')}?sort=priority`)
    expect(sortButton()).toHaveAccessibleName('정렬: 마감 빠른 순')
    await waitFor(() => expect(rows()).toEqual(PM_ALL))
  })
})

describe('상세·이력과 PM 의 상태 변경 (AC-04)', () => {
  function info() {
    return screen.getByLabelText('태스크 정보')
  }
  function field(term: string): HTMLElement {
    const dt = within(info()).getByText(term, { selector: 'dt' })
    return dt.nextElementSibling as HTMLElement
  }
  function history(): string[] {
    return within(screen.getByRole('list', { name: '변경 이력' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent ?? '')
  }
  async function openDetail(taskId: string, title: string) {
    const app = renderApp(paths.tasks('ws_01', taskId))
    await screen.findByRole('heading', { level: 1, name: title })
    return app
  }
  const shownStatus = () => screen.getByTestId('task-status').textContent
  const statusOption = (label: string) => screen.getByRole('radio', { name: label })

  /** 태스크마다 PATCH 응답 시점을 쥔다. fail 이면 500, 아니면 원래 handler 가 처리한다 */
  function holdPatches(plan: Record<string, { fail: boolean }>) {
    const gates = new Map(Object.keys(plan).map((taskId) => [taskId, deferred()]))
    server.use(
      http.patch('/api/v1/tasks/:taskId', async ({ params, request }) => {
        const taskId = String(params.taskId)
        const copy = request.clone()
        await gates.get(taskId)?.promise
        if (plan[taskId]?.fail) return fail('INTERNAL_ERROR', 'boom', 500)
        return getResponse(handlers, copy)
      }),
    )
    return gates
  }
  const toastFor = (taskId: string) =>
    document.querySelectorAll(`[data-toast-key="task-status-${taskId}"]`)

  it('담당자·상태·마감·출처 회의·이력을 읽고, 막히지 않았으면 막힌 사유 줄이 없다', async () => {
    await openDetail('tk_01', '로그인 API 연동')
    await waitFor(() => expect(field('담당자')).toHaveTextContent('김서연'))
    expect(shownStatus()).toBe('진행 중')
    expect(field('마감')).toHaveTextContent('2026-09-20')
    expect(screen.queryByText('진행률')).toBeNull()
    expect(within(info()).queryByText('막힌 사유')).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: '3주차 정기회의에서 나온 일' })).toHaveAttribute(
        'href',
        paths.meetings('ws_01', 'mt_09'),
      ),
    )
    await waitFor(() =>
      expect(history()).toEqual(['상태: 할 일 → 진행 중', '마감: 2026-09-13 → 2026-09-20']),
    )
  })

  it('담당자·마감이 없는 기존 태스크도 읽는다', async () => {
    const tk05 = db.tasks.find(({ task_id }) => task_id === 'tk_05')!
    tk05.assignee_member_id = null
    await openDetail('tk_05', '회의록 요약 검수')
    expect(field('담당자')).toHaveTextContent('담당자 없음')
    expect(field('마감')).toHaveTextContent('마감 없음')
    expect(await screen.findByText('아직 변경 이력이 없어요.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /에서 나온 일$/ })).toBeNull()
  })

  it('막힌 태스크는 막힌 사유를 보여 준다', async () => {
    await openDetail('tk_03', 'DB 스키마 정리')
    expect(shownStatus()).toBe('막힘')
    expect(field('막힌 사유')).toHaveTextContent('Notion 권한 대기')
  })

  it('상세를 받는 동안 `태스크 목록` 링크와 기다림 표시가 있고 태스크 제목은 없다', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.get('/api/v1/tasks/:taskId', async () => {
        await gate.promise
        return undefined
      }),
    )
    renderApp(paths.tasks('ws_01', 'tk_01'))
    expect(await screen.findByRole('link', { name: '태스크 목록' })).toHaveAttribute(
      'href',
      paths.tasks('ws_01'),
    )
    expect(screen.getByRole('main').querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: '로그인 API 연동' })).toBeNull()
  })

  it('없는 태스크는 볼 수 없다고 알리고 목록으로 돌려보낸다', async () => {
    renderApp(paths.tasks('ws_01', 'tk_99'))
    expect(await screen.findByRole('heading', { name: '이 태스크를 볼 수 없어요' })).toBeVisible()
    expect(screen.getByRole('link', { name: '태스크 목록으로' })).toHaveAttribute(
      'href',
      paths.tasks('ws_01'),
    )
  })

  it('처음부터 조회가 실패하면 일반 팀원도 다시 시도 버튼으로 복구한다 (#236)', async () => {
    setMockRole('member')
    server.use(http.get('/api/v1/tasks/:taskId', () => fail('INTERNAL_ERROR', 'boom', 500)))
    renderApp(paths.tasks('ws_01', 'tk_01'))
    expect(
      await screen.findByText('태스크를 불러오지 못했어요', {}, { timeout: 5_000 }),
    ).toBeVisible()
    expect(screen.queryByText('최신 상태를 받지 못했어요')).toBeNull()
    server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { level: 1, name: '로그인 API 연동' })).toBeVisible()
    expect(screen.queryByText('태스크를 불러오지 못했어요')).toBeNull()
  })

  it('일반 팀원은 상태를 바꿀 수 없다 — 고르는 칸이 없고 PATCH 도 없다', async () => {
    setMockRole('member')
    const log = recordRequests()
    await openDetail('tk_01', '로그인 API 연동')
    expect(shownStatus()).toBe('진행 중')
    expect(screen.queryByLabelText('상태 바꾸기')).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    await settle(200)
    expect(log.started.filter(({ method }) => method === 'PATCH')).toEqual([])
  })

  it('PM 이 바꾸면 응답 전에 상세에 먼저 보이고, 같은 태스크의 두 번째 변경은 막힌다. 성공 뒤 상세·이력·목록이 서버와 맞다', async () => {
    const gates = holdPatches({ tk_01: { fail: false } })
    const bodies = recordRequestBodies('PATCH', '/tasks/tk_01')
    const log = recordRequests()
    const app = await openDetail('tk_01', '로그인 API 연동')
    await screen.findByRole('radiogroup', { name: '상태 바꾸기' })

    // 같은 틱의 두 입력 — 두 번째는 진행 중인 요청 때문에 보내지 않는다
    act(() => {
      fireEvent.click(statusOption('완료'))
      fireEvent.click(statusOption('막힘'))
    })
    // mutation 캐시 알림은 다음 틱에 묶여 온다 — 응답(쥐고 있음)보다 먼저 보이는지를 본다
    await waitFor(() => expect(shownStatus()).toBe('완료'))
    for (const label of ['할 일', '진행 중', '막힘', '완료'])
      expect(statusOption(label)).toBeDisabled()
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(
      '바꾸는 중이에요',
    )
    // 잠긴 뒤의 입력도 보내지 않는다
    fireEvent.click(statusOption('할 일'))
    await settle()
    expect(log.started.filter(({ method }) => method === 'PATCH')).toHaveLength(1)
    expect(bodies).toEqual([{ status: 'done' }])

    act(() => gates.get('tk_01')!.resolve())
    await waitFor(() => expect(statusOption('완료')).toBeEnabled())
    expect(shownStatus()).toBe('완료')
    expect(db.tasks.find(({ task_id }) => task_id === 'tk_01')?.status).toBe('done')
    // 이력을 다시 받아 새 변경이 맨 위에 있다
    await waitFor(() => expect(history()[0]).toBe('상태: 진행 중 → 완료'))
    const answered = log.timeline.indexOf('answer PATCH /tasks/tk_01')
    const after = log.timeline.slice(answered + 1)
    expect(after).toContain('start GET /tasks/tk_01/history')
    expect(after).toContain('start GET /tasks/tk_01')
    // 목록은 지금 그리지 않아 낡음 표시만 하고, 목록으로 가면 서버에서 받는다
    expect(toastFor('tk_01')).toHaveLength(0)

    // 목록도 서버 값이다
    act(() => app.navigate(`${paths.tasks('ws_01')}?tab=done`))
    await waitFor(() => expect(rows()).toContain('로그인 API 연동'))
    expect(tab('완료')).toHaveTextContent('4')
    expect(rowStatus('로그인 API 연동')).toBe('완료')
  })

  it('실패하면 그 태스크만 이전 상태로 돌아오고 알린 뒤 다시 조회한다', async () => {
    const gates = holdPatches({ tk_01: { fail: true } })
    const log = recordRequests()
    await openDetail('tk_01', '로그인 API 연동')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: '완료' }))
    await waitFor(() => expect(shownStatus()).toBe('완료'))

    act(() => gates.get('tk_01')!.resolve())
    await waitFor(() => expect(shownStatus()).toBe('진행 중'))
    await waitFor(() => expect(toastFor('tk_01')).toHaveLength(1))
    expect(toastFor('tk_01')[0]).toHaveTextContent(TASK_STATUS_FAILED_TITLE)
    expect(toastFor('tk_01')[0]).toHaveTextContent('서버에 문제가 생겼어요')
    expect(statusOption('진행 중')).toBeChecked()
    expect(statusOption('완료')).toBeEnabled()
    // 실패 뒤 그 태스크의 상세·이력·목록을 다시 묻는다
    const answered = log.timeline.indexOf('answer PATCH /tasks/tk_01')
    await waitFor(() =>
      expect(log.timeline.slice(answered + 1)).toEqual(
        expect.arrayContaining(['start GET /tasks/tk_01', 'start GET /tasks/tk_01/history']),
      ),
    )
    expect(db.tasks.find(({ task_id }) => task_id === 'tk_01')?.status).toBe('in_progress')
  })

  it('다른 두 태스크를 동시에 바꾸다 하나가 실패해도 다른 하나의 변경은 유지된다 — 진행 중 목록 재조회도 덮지 않는다', async () => {
    const gates = holdPatches({ tk_01: { fail: false }, tk_02: { fail: true } })
    const user = userEvent.setup()
    const log = recordRequests()
    const app = await openDetail('tk_01', '로그인 API 연동')
    await user.click(await screen.findByRole('radio', { name: '완료' }))

    act(() => app.navigate(paths.tasks('ws_01', 'tk_02')))
    await screen.findByRole('heading', { level: 1, name: '회원가입 화면' })
    await user.click(await screen.findByRole('radio', { name: '진행 중' }))
    await waitFor(() => expect(shownStatus()).toBe('진행 중'))

    act(() => app.navigate(paths.tasks('ws_01')))
    await waitFor(() => expect(rows()).toHaveLength(13))
    expect(rowStatus('로그인 API 연동')).toBe('완료')
    expect(rowStatus('회원가입 화면')).toBe('진행 중')
    expect(tabTexts()).toEqual(['전체 13', '확인 필요 3', '진행 중 6', '완료 4'])

    // 둘 다 진행 중일 때 목록을 다시 받는다 — 서버는 아직 이전 값이지만 진행 중 변경이 그 위에 보인다
    const before = log.answered.length
    await act(() =>
      app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01', 'tasks', 'list') }),
    )
    await waitFor(() =>
      expect(
        log.answered.slice(before).some(({ path }) => path === '/tasks?workspace_id=ws_01'),
      ).toBe(true),
    )
    expect(rowStatus('로그인 API 연동')).toBe('완료')
    expect(rowStatus('회원가입 화면')).toBe('진행 중')

    // tk_02 실패 — tk_02 만 돌아오고 tk_01 의 진행 중 변경은 그대로다
    act(() => gates.get('tk_02')!.resolve())
    await waitFor(() => expect(rowStatus('회원가입 화면')).toBe('할 일'))
    expect(rowStatus('로그인 API 연동')).toBe('완료')
    await waitFor(() => expect(toastFor('tk_02')).toHaveLength(1))
    expect(tabTexts()).toEqual(['전체 13', '확인 필요 3', '진행 중 6', '완료 4'])

    // tk_01 성공 — 서버 값으로 남는다
    act(() => gates.get('tk_01')!.resolve())
    await waitFor(() =>
      expect(db.tasks.find(({ task_id }) => task_id === 'tk_01')?.status).toBe('done'),
    )
    await settle(200)
    expect(rowStatus('로그인 API 연동')).toBe('완료')
    expect(rowStatus('회원가입 화면')).toBe('할 일')
    expect(db.tasks.find(({ task_id }) => task_id === 'tk_02')?.status).toBe('todo')
    expect(toastFor('tk_01')).toHaveLength(0)
  })

  describe('늦은 응답은 세션·공간·권한 경계를 넘지 않는다', () => {
    it('로그아웃 뒤 도착한 실패는 알림·캐시를 남기지 않고 다시 조회하지 않는다', async () => {
      const gates = holdPatches({ tk_01: { fail: true } })
      const log = recordRequests()
      const app = await openDetail('tk_01', '로그인 API 연동')
      await userEvent.click(await screen.findByRole('radio', { name: '완료' }))

      await userEvent.click(screen.getByRole('button', { name: /^내 계정/ }))
      await userEvent.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
      expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
      await waitFor(() =>
        expect(app.queryClient.getQueryData(WORKSPACE_LIST_QUERY_KEY)).toBeUndefined(),
      )

      act(() => gates.get('tk_01')!.resolve())
      await waitFor(() => expect(log.answered.some(({ method }) => method === 'PATCH')).toBe(true))
      await settle(200)
      expect(toastFor('tk_01')).toHaveLength(0)
      expect(
        app.queryClient.getQueryData(workspaceKey('ws_01', 'tasks', 'detail', 'tk_01')),
      ).toBeUndefined()
      expect(app.queryClient.getQueryData(workspaceKey('ws_01', 'tasks', 'list'))).toBeUndefined()
      const answered = log.timeline.indexOf('answer PATCH /tasks/tk_01')
      expect(log.timeline.slice(answered + 1).filter((line) => line.startsWith('start'))).toEqual(
        [],
      )
    })

    it('로그아웃 뒤 도착한 목록 응답은 캐시에 남지 않는다', async () => {
      const gate = deferred()
      server.use(
        http.get('/api/v1/tasks', async ({ request }) => {
          const snapshot = await getResponse(handlers, request.clone())
          await gate.promise
          return snapshot
        }),
      )
      const app = renderApp(paths.tasks('ws_01'))
      expect(await screen.findByRole('heading', { level: 1, name: '태스크' })).toBeVisible()
      await userEvent.click(screen.getByRole('button', { name: /^내 계정/ }))
      await userEvent.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
      expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()

      act(() => gate.resolve())
      await settle(200)
      expect(app.queryClient.getQueryData(workspaceKey('ws_01', 'tasks', 'list'))).toBeUndefined()
      expect(screen.queryByRole('list', { name: '태스크 목록' })).toBeNull()
    })

    it('다른 공간으로 옮긴 뒤 도착한 실패는 새 공간 화면에 알리지 않는다', async () => {
      const ws02 = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_02')!
      ws02.onboarding.completed = true
      const gates = holdPatches({ tk_01: { fail: true } })
      const app = await openDetail('tk_01', '로그인 API 연동')
      await userEvent.click(await screen.findByRole('radio', { name: '완료' }))

      act(() => app.navigate(paths.tasks('ws_02')))
      await app.expectPath(paths.tasks('ws_02'))
      expect(await screen.findByRole('heading', { name: '아직 태스크가 없어요' })).toBeVisible()

      act(() => gates.get('tk_01')!.resolve())
      await waitFor(() =>
        expect(
          app.queryClient.getQueryState(workspaceKey('ws_01', 'tasks', 'detail', 'tk_01'))
            ?.isInvalidated,
        ).toBe(true),
      )
      await settle(200)
      expect(toastFor('tk_01')).toHaveLength(0)
      // 새 공간 목록에 이전 공간의 태스크가 섞이지 않는다
      expect(rows()).toEqual([])
    })

    it('PM 이 아니게 된 뒤 도착한 실패는 알리지 않고, 고르는 칸도 사라진다', async () => {
      const gates = holdPatches({ tk_01: { fail: true } })
      const app = await openDetail('tk_01', '로그인 API 연동')
      await userEvent.click(await screen.findByRole('radio', { name: '완료' }))

      setMockRole('member')
      await act(() => app.queryClient.refetchQueries({ queryKey: WORKSPACE_LIST_QUERY_KEY }))
      await waitFor(() => expect(screen.queryByLabelText('상태 바꾸기')).toBeNull())

      act(() => gates.get('tk_01')!.resolve())
      await waitFor(() => expect(shownStatus()).toBe('진행 중'))
      await settle(200)
      expect(toastFor('tk_01')).toHaveLength(0)
    })
  })
})
