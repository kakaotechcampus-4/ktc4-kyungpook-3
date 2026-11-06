import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { clearTrackedMeetings, meetingDetailQueryOptions } from '@/entities/meeting'
import { workspaceKey } from '@/shared/api/queryKeys'
import { paths } from '@/shared/config/routes'
import { db, replaceDb } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import { createScenarioDb } from '@/shared/mock/scenarios'
import type { MockScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { toast } from '@/shared/ui/toast'
import { onTestFinished } from 'vitest'
import { renderApp } from './test/renderApp'

/*
 * M7 — 대시보드 (계획 §1~§5, AC-02 ~ AC-06). 실제 경로 표·MSW handler·request() 를 그대로 탄다.
 * 픽스처의 ws_01: 태스크 10건, 대기 승인 3건(ap_01 보류 → ap_02 → ap_03), 처리 중 mt_10, 최신 완료 회의 mt_09
 * (auto 항목 it_01~it_03 = tk_01 synced · tk_02 · tk_03 반영 상태 없음), Notion 연결됨, 서울 오늘 2026-09-18.
 * 날짜만 고정한다 — 타이머는 진짜다. polling 은 아래 묶음에서 간격만 가짜 시계로 민다.
 * 집계·날짜 경계 판정 자체는 widgets/dashboard/lib/dashboard.test.ts 가 본다.
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

const DASHBOARD = paths.dashboard('ws_01')
const settle = (ms = 80) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const requestsTo = (log: Log, method: string, path: string) =>
  log.started.filter((request) => request.method === method && request.path === path)
const approvalRequests = (log: Log) =>
  log.started.filter(({ path }) => path.startsWith('/approvals'))
const reverts = (log: Log) => log.started.filter(({ method }) => method === 'POST')
/** 토스트 호출을 센다. 테스트가 끝나면 원래대로 돌린다 — 남으면 다음 테스트에 호출 수가 쌓인다 */
function spyToast() {
  const spy = vi.spyOn(toast, 'show')
  onTestFinished(() => spy.mockRestore())
  return spy
}
/** 갱신 실패 토스트를 띄운 횟수. 같은 key 로 합쳐져 화면에는 하나라 호출을 센다 */
const refreshToasts = (shown: { mock: { calls: [{ key?: string }][] } }) =>
  shown.mock.calls.filter(([input]) => input.key === 'dashboard-refresh-failed')
/** 제목 근처 표시의 다시 시도. 토스트의 같은 이름 버튼과 구분한다 */
/** 화면 본문. 토스트는 본문 밖(전역 토스터)에 같은 문구로 뜨므로 남는 표시는 본문에서 찾는다 */
const inMain = () => within(screen.getByRole('main'))
const refreshButton = () =>
  within(
    inMain()
      .getByText(/최신 상태를 받지 못했어요$/)
      .closest('[role="alert"]') as HTMLElement,
  ).getByRole('button', { name: '다시 시도' })
const toastsWith = (title: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-toast-key]')).filter((node) =>
    node.textContent?.includes(title),
  )

function taskFixtureOf(id: string) {
  const found = taskFixtures.find(({ task_id }) => task_id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found
}

function useScenario(scenario: MockScenario) {
  replaceDb(createScenarioDb(scenario))
}

function summary(): Record<string, string> {
  const list = document.querySelector('dl[aria-label="현황 요약"]')
  if (list === null) throw new Error('summary is missing')
  return Object.fromEntries(
    Array.from(list.querySelectorAll('dt')).map((term) => [
      term.textContent ?? '',
      (term.nextElementSibling?.textContent ?? '').trim(),
    ]),
  )
}
/** 요약 안의 링크 — 이름과 주소 */
function summaryLinks(): [string | null, string | null][] {
  const list = document.querySelector<HTMLElement>('dl[aria-label="현황 요약"]')
  if (list === null) throw new Error('summary is missing')
  return within(list)
    .queryAllByRole('link')
    .map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')])
}
const TASKS = paths.tasks('ws_01')
function headline(): string {
  return (
    screen.getByText(/확인이 필요한 일이|워크스페이스 현황/, { selector: 'p' }).textContent ?? ''
  )
}
function reviewTitles(): string[] {
  const list = screen.queryByRole('list', { name: '확인이 필요한 일 목록' })
  if (list === null) return []
  // 행의 이동 링크 이름이 `확인하기 — 제목` 이다
  return within(list)
    .getAllByRole('link')
    .map((link) => (link.getAttribute('aria-label') ?? '').split('—')[1]?.trim() ?? '')
}
function dueTitles(): string[] {
  const list = screen.queryByRole('list', { name: '마감 임박 목록' })
  if (list === null) return []
  return within(list)
    .getAllByRole('link')
    .map((link) => link.querySelector('span')?.textContent ?? '')
}
function recentRows() {
  // 모달이 열리면 바깥은 보조기기에서 숨는다(aria-hidden). 숨은 상태에서도 행을 읽는다
  return within(screen.getByRole('list', { name: '최근 반영 목록', hidden: true })).getAllByTestId(
    'recent-row',
  )
}
function recentText(): string[] {
  return recentRows().map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim())
}
function rowOf(title: string): HTMLElement {
  const row = recentRows().find((each) => each.textContent?.includes(title))
  if (!row) throw new Error(`recent row ${title} is missing`)
  return row
}

async function openDashboard(path = DASHBOARD) {
  const app = renderApp(path)
  await screen.findByRole('heading', { name: '대시보드' })
  await screen.findByRole('list', { name: '최근 반영 목록' })
  await waitFor(() => expect(summary()['기한 지남']).toBe('2'))
  return app
}

describe('요약·제목·회의 안내 (AC-01 · AC-05)', () => {
  it('PM 은 요약 넷을 전체 데이터로 보고, 제목에는 개수가 없다. 네 숫자 모두 그 조건의 목록으로 간다', async () => {
    await openDashboard()
    await waitFor(() =>
      expect(summary()).toEqual({
        '확인 대기': '3',
        '기한 지남': '2',
        '7일 이내 마감': '4',
        '막힌 일': '1',
      }),
    )
    expect(headline()).toBe('확인이 필요한 일이 있어요')
    expect(screen.getByText(/정리했어요/).textContent?.replace(/\s+/g, ' ')).toBe(
      '9월 15일 3주차 정기회의를 정리했어요 · 46분 분량',
    )
    expect(screen.getByText('2026-09-18 금요일')).toBeInTheDocument()
    // 숫자마다 그 수만큼 보이는 태스크 목록 조건으로 간다 (D-178)
    expect(summaryLinks()).toEqual([
      ['확인 대기 3', `${TASKS}?tab=needs_review`],
      ['기한 지남 2', `${TASKS}?tab=in_progress&due=overdue`],
      ['7일 이내 마감 4', `${TASKS}?tab=in_progress&due=soon`],
      ['막힌 일 1', `${TASKS}?tab=in_progress&due=blocked`],
    ])
    const list = screen.getByText('확인 대기').closest('dl')!
    expect(within(list).queryAllByRole('button')).toEqual([])
    // 마감 임박은 5개만 보여도 집계는 6이다 (D-052)
    expect(dueTitles()).toHaveLength(5)
  })

  it('최근 회의가 채팅 회의면 기간을 분량으로 쓰지 않는다 (#379)', async () => {
    db.meetingSummaries.find(({ meeting_id }) => meeting_id === 'mt_09')!.source = 'chat'
    await openDashboard()
    expect(screen.getByText(/정리했어요/).textContent?.replace(/\s+/g, ' ')).toBe(
      '9월 15일 3주차 정기회의를 정리했어요',
    )
  })

  it('대기 승인이 없으면 `확인이 필요한 일이 없어요` 이고 확인 대기는 0 이다', async () => {
    for (const approval of db.approvals) approval.status = 'rejected'
    await openDashboard()
    await waitFor(() => expect(headline()).toBe('확인이 필요한 일이 없어요'))
    expect(summary()['확인 대기']).toBe('0')
    expect(screen.getByText('지금 확인할 일이 없어요.')).toBeInTheDocument()
  })

  /*
   * 요약 숫자를 누르면 그 수만큼 보이는 목록이다 (D-178). 수는 누르기 전 요약에서 읽는다.
   * 확인 대기는 확인 필요 카드, 나머지는 진행 중 탭의 태스크 행이다
   */
  it.each([
    {
      label: '확인 대기',
      search: '?tab=needs_review',
      tab: /^확인 필요/,
      due: '마감 조건: 마감 전체',
      rows: () =>
        within(screen.getByRole('list', { name: '확인 필요 목록' })).getAllByRole('article'),
    },
    {
      label: '기한 지남',
      search: '?tab=in_progress&due=overdue',
      tab: /^진행 중/,
      due: '마감 조건: 기한 지남',
      rows: () => within(screen.getByRole('list', { name: '태스크 목록' })).getAllByRole('link'),
    },
    {
      label: '7일 이내 마감',
      search: '?tab=in_progress&due=soon',
      tab: /^진행 중/,
      due: '마감 조건: 7일 안에 마감',
      rows: () => within(screen.getByRole('list', { name: '태스크 목록' })).getAllByRole('link'),
    },
    {
      label: '막힌 일',
      search: '?tab=in_progress&due=blocked',
      tab: /^진행 중/,
      due: '마감 조건: 막힘',
      rows: () => within(screen.getByRole('list', { name: '태스크 목록' })).getAllByRole('link'),
    },
  ])(
    '$label 숫자를 누르면 태스크 목록의 그 조건이고 같은 수가 보인다 (D-178)',
    async ({ label, search, tab, due, rows }) => {
      const user = userEvent.setup()
      const app = await openDashboard()
      await waitFor(() => expect(summary()['확인 대기']).toBe('3'))
      const count = Number(summary()[label])
      await user.click(screen.getByRole('link', { name: `${label} ${count}` }))
      await app.expectPath(TASKS)
      await app.expectSearch(search)
      await waitFor(() => expect(rows()).toHaveLength(count))
      expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('button', { name: due })).toBeInTheDocument()
    },
  )

  it('정리한 회의가 없으면 안내 문구만 있다 (D-065)', async () => {
    useScenario('dashboard-no-meeting')
    renderApp(DASHBOARD)
    await screen.findByRole('heading', { name: '대시보드' })
    expect(await screen.findAllByText('아직 정리한 회의가 없어요')).toHaveLength(2)
  })
})

describe('역할 (AC-05)', () => {
  it('일반 팀원은 확인 대기·확인 필요·되돌리기가 없고 승인 목록을 부르지 않는다', async () => {
    setMockRole('member')
    const log = recordRequests()
    renderApp(DASHBOARD)
    await screen.findByRole('heading', { name: '대시보드' })
    await screen.findByRole('list', { name: '최근 반영 목록' })
    await waitFor(() => expect(summary()['기한 지남']).toBe('2'))
    await settle()

    expect(headline()).toBe('워크스페이스 현황')
    expect(Object.keys(summary())).toEqual(['기한 지남', '7일 이내 마감', '막힌 일'])
    expect(summaryLinks()).toEqual([
      ['기한 지남 2', `${TASKS}?tab=in_progress&due=overdue`],
      ['7일 이내 마감 4', `${TASKS}?tab=in_progress&due=soon`],
      ['막힌 일 1', `${TASKS}?tab=in_progress&due=blocked`],
    ])
    expect(screen.queryByRole('heading', { name: '확인이 필요한 일' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /되돌리기$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '마감 임박' })).toBeInTheDocument()
    expect(approvalRequests(log)).toEqual([])
  })

  it('일반 팀원의 빈 상태에는 PM 전용 이동이 없다', async () => {
    useScenario('dashboard-notion-not-connected')
    setMockRole('member')
    renderApp(DASHBOARD)
    expect(await screen.findByText('Notion이 연결되지 않았어요')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Notion 설정' })).not.toBeInTheDocument()
  })

  it('일반 팀원에게 되돌린 행은 `되돌림` 배지만 있고 확인 필요 상세 링크가 없다 (E-01)', async () => {
    // PM 이 회원가입 화면(it_02)을 되돌린 뒤의 서버 상태 — 태스크는 지워졌고 새 생성 승인이 걸렸다
    const item = db.extractions[1].items[1]
    db.tasks = db.tasks.filter(({ task_id }) => task_id !== 'tk_02')
    Object.assign(item, { task_id: null, approval_id: 'ap_03', reverted_at: MOCK_NOW })
    setMockRole('member')
    renderApp(DASHBOARD)
    await screen.findByRole('list', { name: '최근 반영 목록' })
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('되돌림'))
    expect(within(rowOf('회원가입 화면')).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^확인 필요 보기/ })).not.toBeInTheDocument()
  })
})

describe('확인 필요 (AC-02)', () => {
  it('대기 시작 오래된 순이고, 보류는 `채워 넣기`, 나머지는 `확인하기` 로 확인 필요 상세에 간다', async () => {
    await openDashboard()
    await waitFor(() =>
      expect(reviewTitles()).toEqual(['알림 문구 검토', '테스트 계획 정리', '배포 문서 보완']),
    )
    expect(screen.getByRole('link', { name: /^채워 넣기 — 알림 문구 검토/ })).toHaveAttribute(
      'href',
      paths.approval('ws_01', 'ap_01'),
    )
    expect(screen.getByRole('link', { name: /^확인하기 — 테스트 계획 정리/ })).toHaveAttribute(
      'href',
      paths.approval('ws_01', 'ap_02'),
    )
    expect(screen.getByRole('link', { name: '태스크에서 전부 보기' })).toHaveAttribute(
      'href',
      `${paths.tasks('ws_01')}?tab=needs_review`,
    )
  })

  it('5개까지만 보이고 확인 대기는 전체 수다', async () => {
    const source = db.approvals[2]
    for (let index = 0; index < 4; index += 1)
      db.approvals.push({
        ...structuredClone(source),
        approval_id: `ap_8${index}`,
        payload: { ...source.payload, task_title: `추가 확인 ${index}` },
        created_at: `2026-09-17T0${3 + index}:00:00Z`,
      })
    await openDashboard()
    await waitFor(() => expect(reviewTitles()).toHaveLength(5))
    expect(reviewTitles()).toEqual([
      '알림 문구 검토',
      '테스트 계획 정리',
      '배포 문서 보완',
      '추가 확인 0',
      '추가 확인 1',
    ])
    expect(summary()['확인 대기']).toBe('7')
  })

  describe('근거 시각 (#397)', () => {
    const reviewRow = (title: string) => {
      const row = within(screen.getByRole('list', { name: '확인이 필요한 일 목록' }))
        .getAllByRole('listitem')
        .find((item) => item.textContent?.includes(title))
      if (!row) throw new Error(`review row ${title} is missing`)
      return row
    }

    it('채팅 회의에서 나온 일은 실제 작성 시각, 녹음 회의에서 나온 일은 녹음 안 위치다', async () => {
      useScenario('approval-chat')
      await openDashboard()
      await waitFor(() =>
        expect(reviewRow('배포 체크리스트 정리')).toHaveTextContent('09/11 18:40'),
      )
      expect(reviewRow('배포 체크리스트 정리')).not.toHaveTextContent('9:28:00')
      expect(reviewRow('테스트 계획 정리')).toHaveTextContent('02:45')
    })

    it('회의 목록을 받지 못하면 시각을 녹음 위치로 짐작하지 않고 숨긴다', async () => {
      useScenario('approval-chat')
      server.use(
        http.get('/api/v1/workspaces/:workspaceId/meetings', () =>
          fail('INTERNAL_ERROR', 'x', 500),
        ),
      )
      const log = recordRequests()
      renderApp(DASHBOARD)
      await waitFor(() => expect(reviewTitles()).toContain('배포 체크리스트 정리'))
      await waitFor(() =>
        expect(log.answered).toContainEqual({ method: 'GET', path: '/workspaces/ws_01/meetings' }),
      )
      await settle()
      expect(reviewRow('배포 체크리스트 정리')).not.toHaveTextContent(/\d+:\d{2}/)
      expect(reviewRow('테스트 계획 정리')).not.toHaveTextContent(/\d+:\d{2}/)
    })
  })

  it('`확인하기` 를 누르면 그 확인 필요 상세로 간다', async () => {
    const user = userEvent.setup()
    const app = await openDashboard()
    await user.click(await screen.findByRole('link', { name: /^확인하기 — 테스트 계획 정리/ }))
    await app.expectPath(paths.approval('ws_01', 'ap_02'))
  })
})

describe('마감 임박 (AC-02)', () => {
  it('기한 지남이 먼저이고 경고 상태다. 다음은 가까운 마감 순으로 5개, 넘치면 전체 보기다', async () => {
    await openDashboard()
    expect(dueTitles()).toEqual([
      '온보딩 문구 수정',
      '회원가입 화면',
      'STT 정확도 측정',
      '로그인 API 연동',
      'DB 스키마 정리',
    ])
    const rows = within(screen.getByRole('list', { name: '마감 임박 목록' })).getAllByRole('link')
    expect(rows.map((row) => row.hasAttribute('data-overdue'))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
    expect(within(rows[0]).getByText('기한 지남')).toBeInTheDocument()
    // 행 전체가 태스크 상세 링크다 (D-047)
    expect(rows[1]).toHaveAttribute('href', paths.tasks('ws_01', 'tk_02'))
    expect(screen.getByRole('link', { name: '전체 보기' })).toHaveAttribute(
      'href',
      `${paths.tasks('ws_01')}?tab=in_progress&due=overdue,soon`,
    )
  })

  it('전체 보기는 태스크 목록의 진행 중 + 기한 지남·7일 이내 조건이다 — 같은 6건이 보인다', async () => {
    const user = userEvent.setup()
    const app = await openDashboard()
    await user.click(screen.getByRole('link', { name: '전체 보기' }))
    await app.expectPath(paths.tasks('ws_01'))
    await app.expectSearch('?tab=in_progress&due=overdue,soon')
    const list = await screen.findByRole('list', { name: '태스크 목록' })
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      '온보딩 문구 수정',
      '회원가입 화면',
      'STT 정확도 측정',
      '로그인 API 연동',
      'DB 스키마 정리',
      '배포 스크립트',
    ])
    expect(screen.queryByRole('list', { name: '확인 필요 목록' })).not.toBeInTheDocument()
  })

  it('태스크를 받는 중에는 태스크 요약 숫자가 링크가 아니다', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.get('/api/v1/tasks', async () => {
        await gate.promise
        return undefined
      }),
    )
    renderApp(DASHBOARD)
    await waitFor(() => expect(summary()['막힌 일']).toBe('불러오는 중'))
    await waitFor(() => expect(summary()['확인 대기']).toBe('3'))
    expect(summaryLinks()).toEqual([['확인 대기 3', `${TASKS}?tab=needs_review`]])
    gate.resolve()
    expect(await screen.findByRole('link', { name: '막힌 일 1' })).toBeInTheDocument()
    expect(summaryLinks().map(([name]) => name)).toEqual([
      '확인 대기 3',
      '기한 지남 2',
      '7일 이내 마감 4',
      '막힌 일 1',
    ])
  })

  it('승인을 받는 중이거나 받지 못하면 확인 대기는 링크가 아니다', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.get('/api/v1/approvals', async () => {
        await gate.promise
        return fail('INTERNAL_ERROR', 'boom', 500)
      }),
    )
    renderApp(DASHBOARD)
    await waitFor(() => expect(summary()['기한 지남']).toBe('2'))
    expect(summary()['확인 대기']).toBe('불러오는 중')
    expect(screen.queryByRole('link', { name: /^확인 대기/ })).toBeNull()
    gate.resolve()
    await waitFor(() => expect(summary()['확인 대기']).toBe('–불러오지 못했어요'), {
      timeout: 8_000,
    })
    expect(summaryLinks().map(([name]) => name)).toEqual([
      '기한 지남 2',
      '7일 이내 마감 4',
      '막힌 일 1',
    ])
  })

  it('행을 누르면 태스크 상세로 간다', async () => {
    const user = userEvent.setup()
    const app = await openDashboard()
    await user.click(screen.getByRole('link', { name: /로그인 API 연동/ }))
    await app.expectPath(paths.tasks('ws_01', 'tk_01'))
  })

  it('대상이 없으면 빈 상태 문구이고 전체 보기가 없다', async () => {
    for (const task of db.tasks) task.status = 'done'
    renderApp(DASHBOARD)
    expect(await screen.findByText('마감이 임박한 태스크가 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '전체 보기' })).not.toBeInTheDocument()
  })
})

describe('최근 반영 (AC-03)', () => {
  it('최신 완료 회의의 gate=auto 항목만 응답 순서로 보이고 상태를 구분한다. 전체 로그는 비활성이다', async () => {
    db.tasks.find(({ task_id }) => task_id === 'tk_02')!.notion_sync_status = 'failed'
    await openDashboard()
    await waitFor(() =>
      expect(recentText()).toEqual([
        '자동 반영 — 로그인 API 연동반영 완료',
        '자동 반영 — 회원가입 화면반영 실패',
        '자동 반영 — DB 스키마 정리반영 상태 없음',
      ]),
    )
    expect(screen.getByRole('button', { name: '전체 로그' })).toBeDisabled()
  })

  it('화면 높이를 모르면 앞의 3개만 보이고, 나머지 수는 그 회의록으로 이어진다 (D-176)', async () => {
    const extraction = db.extractions.find(({ extraction_id }) => extraction_id === 'ex_01')!
    extraction.items.push({
      ...structuredClone(extraction.items[0]),
      item_id: 'it_90',
      task: { title: '네 번째 자동 항목', confidence: 0.9 },
      task_id: 'tk_09',
    })
    await openDashboard()
    expect(recentText()).toHaveLength(3)
    expect(screen.queryByText('네 번째 자동 항목')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '외 1건 · 회의록에서 보기' })).toHaveAttribute(
      'href',
      paths.meetings('ws_01', 'mt_09'),
    )
  })

  it('모두 보이면 외 N건 줄이 없다', async () => {
    await openDashboard()
    expect(recentText()).toHaveLength(3)
    expect(screen.queryByRole('link', { name: /^외 \d+건/ })).toBeNull()
  })

  describe('첫 화면에 들어가는 만큼 보인다 (D-176)', () => {
    /** 최근 반영 목록 위쪽과 행 높이만 정한다. 나머지 요소는 jsdom 처럼 크기가 없다 */
    function stubLayout(layout: { innerHeight: number; listTop: number; rowHeight: number }) {
      const rect = (top: number, height: number) =>
        ({
          x: 0,
          y: top,
          top,
          left: 0,
          right: 0,
          bottom: top + height,
          width: 0,
          height,
          toJSON: () => ({}),
        }) as DOMRect
      vi.stubGlobal('innerHeight', layout.innerHeight)
      const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
      ) {
        if (this.matches('ul[aria-label="최근 반영 목록"]')) return rect(layout.listTop, 0)
        if (this.matches('[data-testid="recent-row"]')) return rect(0, layout.rowHeight)
        return rect(0, 0)
      })
      onTestFinished(() => {
        spy.mockRestore()
        vi.unstubAllGlobals()
      })
    }

    it('남은 300px 에 50px 행 5개와 외 N건 줄이 들어간다. 창이 커지면 다시 잰다', async () => {
      useScenario('dashboard-recent-overflow')
      stubLayout({ innerHeight: 900, listTop: 600, rowHeight: 50 })
      await openDashboard()
      await waitFor(() => expect(recentText()).toHaveLength(5))
      expect(recentText()[3]).toContain('자동 반영 4')
      const more = screen.getByRole('link', { name: '외 7건 · 회의록에서 보기' })
      expect(more).toHaveAttribute('href', paths.meetings('ws_01', 'mt_09'))

      vi.stubGlobal('innerHeight', 1000)
      fireEvent(window, new Event('resize'))
      await waitFor(() => expect(recentText()).toHaveLength(7))
      expect(screen.getByRole('link', { name: '외 5건 · 회의록에서 보기' })).toBeInTheDocument()
    })

    it('아주 좁아도 3개, 아주 넓어도 8개다', async () => {
      useScenario('dashboard-recent-overflow')
      stubLayout({ innerHeight: 900, listTop: 880, rowHeight: 50 })
      await openDashboard()
      await waitFor(() => expect(recentText()).toHaveLength(3))
      expect(screen.getByRole('link', { name: '외 9건 · 회의록에서 보기' })).toBeInTheDocument()

      vi.stubGlobal('innerHeight', 3000)
      fireEvent(window, new Event('resize'))
      await waitFor(() => expect(recentText()).toHaveLength(8))
      expect(screen.getByRole('link', { name: '외 4건 · 회의록에서 보기' })).toBeInTheDocument()
    })
  })

  it.each([
    [
      'dashboard-no-meeting',
      '아직 정리한 회의가 없어요',
      '회의 업로드',
      paths.meetingUpload('ws_01'),
    ],
    [
      'dashboard-notion-not-connected',
      'Notion이 연결되지 않았어요',
      'Notion 설정',
      paths.settingsNotion('ws_01'),
    ],
    [
      'dashboard-no-auto',
      '최근 회의에서 자동으로 반영한 일이 없어요',
      '최근 회의록',
      paths.meetings('ws_01', 'mt_07'),
    ],
  ] as const)('빈 상태 %s', async (scenario, text, link, href) => {
    useScenario(scenario)
    renderApp(DASHBOARD)
    const region = (await screen.findByRole('heading', { name: '최근 반영' })).closest('section')!
    expect(await within(region).findByText(text)).toBeInTheDocument()
    expect(within(region).getByRole('link', { name: link })).toHaveAttribute('href', href)
  })
})

describe('반영 대기 polling (AC-03)', () => {
  const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  const listGets = (log: Log) => requestsTo(log, 'GET', '/tasks?workspace_id=ws_01').length

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(MOCK_NOW))
  })

  it('반영 대기 행이 있으면 3초마다 태스크 목록을 받고, 끝나면 멈춘다', async () => {
    useScenario('dashboard-sync-pending')
    const log = recordRequests()
    renderApp(DASHBOARD)
    await screen.findByRole('list', { name: '최근 반영 목록' })
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('반영 대기'))
    await pause(150)
    const first = listGets(log)

    await advance(3_000)
    await pause(100)
    expect(listGets(log)).toBe(first + 1)

    db.tasks.find(({ task_id }) => task_id === 'tk_02')!.notion_sync_status = 'synced'
    await advance(3_000)
    await pause(100)
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('반영 완료'))
    const settled = listGets(log)
    await advance(9_000)
    await pause(100)
    expect(listGets(log)).toBe(settled)
  })

  it('반영 실패·완료만 있으면 polling 하지 않고, 화면을 떠나면 멈춘다', async () => {
    useScenario('dashboard-sync-pending')
    const log = recordRequests()
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    const app = renderApp(DASHBOARD)
    await screen.findByRole('list', { name: '최근 반영 목록' })
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('반영 대기'))
    await user.click(screen.getByRole('link', { name: '회의록' }))
    await app.expectPath(paths.meetings('ws_01', 'mt_09'))
    await pause(150)
    const left = listGets(log)
    await advance(9_000)
    await pause(100)
    expect(listGets(log)).toBe(left)
  })

  it('반영 실패는 polling 대상이 아니다', async () => {
    useScenario('dashboard-sync-failed')
    const log = recordRequests()
    renderApp(DASHBOARD)
    await screen.findByRole('list', { name: '최근 반영 목록' })
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('반영 실패'))
    await pause(150)
    const first = listGets(log)
    await advance(9_000)
    await pause(100)
    expect(listGets(log)).toBe(first)
  })

  it('polling 재조회가 실패하면 이전 상태를 둔 채 제목 근처 표시 하나와 토스트 한 번으로 알리고 멈춘다. 다시 시도 실패는 토스트를 한 번 더, 성공하면 표시가 사라지고 다시 돈다 (E-02)', async () => {
    useScenario('dashboard-sync-pending')
    const shown = spyToast()
    const log = recordRequests()
    renderApp(DASHBOARD)
    await screen.findByRole('list', { name: '최근 반영 목록' })
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('반영 대기'))
    await waitFor(() => expect(summary()['기한 지남']).toBe('2'))
    await pause(150)

    // 다음 polling 부터 서버가 실패한다. Query 기본 재시도(1초 뒤 1회)까지 실패한 뒤에 오류가 된다
    server.use(http.get('/api/v1/tasks', () => fail('INTERNAL_ERROR', 'boom', 500)))
    await advance(3_000)
    const notices = await inMain().findAllByText(
      /최신 상태를 받지 못했어요$/,
      {},
      { timeout: 5_000 },
    )
    expect(notices.map((node) => node.textContent)).toEqual([
      '요약·최근 반영의 최신 상태를 받지 못했어요',
    ])
    expect(refreshToasts(shown)).toHaveLength(1)
    expect(rowOf('회원가입 화면')).toHaveTextContent('반영 대기')
    expect(summary()['기한 지남']).toBe('2')
    expect(screen.queryByText('태스크를 불러오지 못했어요')).not.toBeInTheDocument()

    // 실패하면 polling 은 멈추고, 실패가 이어지는 동안 토스트를 다시 띄우지 않는다
    await pause(150)
    const stopped = listGets(log)
    await advance(9_000)
    await pause(100)
    expect(listGets(log)).toBe(stopped)
    expect(refreshToasts(shown)).toHaveLength(1)

    // 다시 시도했는데 또 실패하면 한 번 더 알린다
    fireEvent.click(refreshButton())
    await waitFor(() => expect(refreshToasts(shown)).toHaveLength(2), { timeout: 5_000 })
    expect(inMain().getAllByText(/최신 상태를 받지 못했어요$/)).toHaveLength(1)

    // 서버가 회복했다. 다시 시도는 진행 중에 한 번만 나간다
    server.resetHandlers()
    await pause(150)
    const beforeRetry = listGets(log)
    fireEvent.click(refreshButton())
    fireEvent.click(refreshButton())
    await waitFor(() =>
      expect(inMain().queryByText(/최신 상태를 받지 못했어요$/)).not.toBeInTheDocument(),
    )
    expect(listGets(log)).toBe(beforeRetry + 1)
    expect(refreshToasts(shown)).toHaveLength(2)

    // 아직 반영 대기라 3초 polling 이 다시 돈다
    await pause(150)
    const resumed = listGets(log)
    await advance(3_000)
    await pause(100)
    expect(listGets(log)).toBe(resumed + 1)
  })
})

describe('갱신 실패 표시 — 대시보드에 하나 (E-02)', () => {
  const failing = (path: string) =>
    http.get(`/api/v1/${path}`, () => fail('INTERNAL_ERROR', 'boom', 500))
  /** 그 key 의 조회를 다시 받는다. Query 기본 재시도(1초 뒤 1회)까지 실패해야 오류가 된다 */
  const refetch = (app: ReturnType<typeof renderApp>, ...scope: string[]) =>
    act(() => app.queryClient.refetchQueries({ queryKey: ['workspace', 'ws_01', ...scope] }))
  const notice = (text: string) =>
    inMain()
      .findAllByText(text, {}, { timeout: 5_000 })
      .then((nodes) => nodes.length)

  it('승인 대기 재조회가 실패하면 요약·확인 필요 표시 하나이고 목록은 그대로다. 다시 시도로 회복한다', async () => {
    const shown = spyToast()
    const app = await openDashboard()
    await waitFor(() => expect(reviewTitles()).toHaveLength(3))
    server.use(failing('approvals'))
    await refetch(app, 'approvals')
    expect(await notice('요약·확인 필요의 최신 상태를 받지 못했어요')).toBe(1)
    expect(inMain().getAllByText(/최신 상태를 받지 못했어요$/)).toHaveLength(1)
    expect(refreshToasts(shown)).toHaveLength(1)
    expect(reviewTitles()).toEqual(['알림 문구 검토', '테스트 계획 정리', '배포 문서 보완'])
    expect(summary()['확인 대기']).toBe('3')

    server.resetHandlers()
    fireEvent.click(refreshButton())
    await waitFor(() =>
      expect(inMain().queryByText(/최신 상태를 받지 못했어요$/)).not.toBeInTheDocument(),
    )
    expect(reviewTitles()).toHaveLength(3)
  })

  it('회의 상세와 추출이 함께 실패하면 최근 반영 표시 하나다', async () => {
    const shown = spyToast()
    const app = await openDashboard()
    server.use(failing('meetings/:meetingId'), failing('extractions/:extractionId'))
    await refetch(app, 'meetings', 'detail')
    await refetch(app, 'extractions')
    expect(await notice('최근 반영의 최신 상태를 받지 못했어요')).toBe(1)
    expect(inMain().getAllByText(/최신 상태를 받지 못했어요$/)).toHaveLength(1)
    expect(refreshToasts(shown)).toHaveLength(1)
    expect(recentText()).toHaveLength(3)
  })

  it('태스크와 승인 대기가 함께 실패해도 표시 하나·토스트 한 번이고, 다시 시도는 둘 다 다시 받는다', async () => {
    const shown = spyToast()
    const app = await openDashboard()
    await waitFor(() => expect(reviewTitles()).toHaveLength(3))
    server.use(failing('tasks'), failing('approvals'))
    // 두 조회를 한 act 안에서 함께 다시 받는다 — act 를 겹쳐 부르면 React 의 act 상태가 깨져 뒤 테스트까지 번진다
    await act(() =>
      Promise.all(
        ['tasks', 'approvals'].map((scope) =>
          app.queryClient.refetchQueries({ queryKey: ['workspace', 'ws_01', scope] }),
        ),
      ),
    )
    expect(await notice('요약·확인 필요·최근 반영의 최신 상태를 받지 못했어요')).toBe(1)
    expect(inMain().getAllByText(/최신 상태를 받지 못했어요$/)).toHaveLength(1)
    expect(refreshToasts(shown)).toHaveLength(1)

    server.resetHandlers()
    const log = recordRequests()
    fireEvent.click(refreshButton())
    await waitFor(() =>
      expect(inMain().queryByText(/최신 상태를 받지 못했어요$/)).not.toBeInTheDocument(),
    )
    expect(requestsTo(log, 'GET', '/tasks?workspace_id=ws_01')).toHaveLength(1)
    expect(requestsTo(log, 'GET', '/approvals?workspace_id=ws_01&status=pending')).toHaveLength(1)
  })
})

describe('되돌린 뒤 승인·반려 (E-03)', () => {
  const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  const listGets = (log: Log) => requestsTo(log, 'GET', '/tasks?workspace_id=ws_01').length

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(MOCK_NOW))
  })

  /** 대시보드에서 회원가입 화면(it_02)을 되돌리고, 새 확인 필요 상세에서 승인·반려한 뒤 대시보드로 돌아온다 */
  async function revertThenResolve(decision: '승인' | '반려') {
    const log = recordRequests()
    const app = renderApp(DASHBOARD)
    await screen.findByRole('list', { name: '최근 반영 목록' })
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('반영 상태 없음'))
    fireEvent.click(screen.getByRole('button', { name: '회원가입 화면 되돌리기' }))
    const dialog = await screen.findByRole('dialog', { name: '자동 반영을 되돌릴까요?' })
    fireEvent.click(within(dialog).getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('되돌림'))

    fireEvent.click(within(rowOf('회원가입 화면')).getByRole('link', { name: /^확인 필요 보기/ }))
    await app.expectPath(paths.approval('ws_01', 'ap_90'))
    fireEvent.click(await screen.findByRole('button', { name: decision }))
    expect(await screen.findByTestId('approval-result')).toHaveTextContent(
      decision === '승인' ? '승인했어요' : '반려했어요',
    )
    // 대시보드의 태스크·추출 캐시는 30초 동안 최신이다. 돌아와 새 상태를 보는 것은 승인 처리(M6 syncAfterResolve)의 무효화 덕분이다
    act(() => app.navigate(DASHBOARD))
    await screen.findByRole('list', { name: '최근 반영 목록' })
    return { app, log }
  }

  it('승인하면 새 태스크의 반영 상태와 보조 문구를 보이고, 링크·되돌리기가 없다. 그 태스크만 반영 대기여도 polling 하고 synced 에서 멈춘다', async () => {
    const { log } = await revertThenResolve('승인')
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('반영 대기'))
    const row = rowOf('회원가입 화면')
    expect(row).toHaveTextContent('되돌린 뒤 승인돼 다시 만들었어요')
    expect(row).not.toHaveTextContent('되돌림')
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()

    await pause(150)
    const first = listGets(log)
    await advance(3_000)
    await pause(100)
    expect(listGets(log)).toBe(first + 1)

    db.tasks.find(({ task_id }) => task_id === 'tk_90')!.notion_sync_status = 'synced'
    await advance(3_000)
    await pause(100)
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('반영 완료'))
    const settled = listGets(log)
    await advance(9_000)
    await pause(100)
    expect(listGets(log)).toBe(settled)
  })

  it('반려하면 되돌림과 반려됨을 보이고 처리된 승인 링크가 없다', async () => {
    await revertThenResolve('반려')
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveTextContent('반려됨'))
    const row = rowOf('회원가입 화면')
    expect(row).toHaveTextContent('되돌림')
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('일반 팀원은 승인된 행에 반영 상태 배지만, 반려·대기 행에 되돌림 배지만 본다 — 승인 문구가 없다', async () => {
    // it_01 승인돼 다시 만듦(tk_90 반영 완료), it_02 반려, it_03 승인 대기 — 모두 되돌린 뒤의 서버 상태다
    const items = db.extractions[1].items
    const approval = (id: string, status: string) => ({
      ...structuredClone(db.approvals[0]),
      approval_id: id,
      status,
    })
    db.approvals.push(
      approval('ap_90', 'approved'),
      approval('ap_91', 'rejected'),
      approval('ap_92', 'pending'),
    )
    db.tasks = db.tasks.filter(({ task_id }) => !['tk_01', 'tk_02', 'tk_03'].includes(task_id))
    db.tasks.push({ ...structuredClone(taskFixtureOf('tk_09')), task_id: 'tk_90' })
    Object.assign(items[0], { task_id: 'tk_90', approval_id: 'ap_90', reverted_at: MOCK_NOW })
    Object.assign(items[1], { task_id: null, approval_id: 'ap_91', reverted_at: MOCK_NOW })
    Object.assign(items[2], { task_id: null, approval_id: 'ap_92', reverted_at: MOCK_NOW })
    setMockRole('member')
    renderApp(DASHBOARD)
    await screen.findByRole('list', { name: '최근 반영 목록' })
    await waitFor(() => expect(rowOf('로그인 API 연동')).toHaveTextContent('반영 완료'))
    expect(rowOf('회원가입 화면')).toHaveTextContent('되돌림')
    expect(rowOf('DB 스키마 정리')).toHaveTextContent('되돌림')
    for (const text of recentText()) {
      expect(text).not.toMatch(/승인|반려/)
    }
    expect(
      within(screen.getByRole('list', { name: '최근 반영 목록' })).queryAllByRole('link'),
    ).toEqual([])
  })
})

describe('부분 오류·공간 전환 (AC-05)', () => {
  it('태스크 조회가 실패해도 다른 영역은 그리고, 실패한 집계를 0 으로 쓰지 않는다', async () => {
    server.use(http.get('/api/v1/tasks', () => fail('INTERNAL_ERROR', 'boom', 500)))
    renderApp(DASHBOARD)
    await screen.findByRole('heading', { name: '대시보드' })
    expect(
      await screen.findByText('태스크를 불러오지 못했어요', {}, { timeout: 8_000 }),
    ).toBeInTheDocument()
    await waitFor(() => expect(reviewTitles()).toHaveLength(3))
    expect(summary()['확인 대기']).toBe('3')
    for (const label of ['기한 지남', '7일 이내 마감', '막힌 일'])
      expect(summary()[label]).toBe('–불러오지 못했어요')
    // 숫자를 모르면 링크가 아니다. 받은 확인 대기만 링크다 (D-178)
    expect(summaryLinks()).toEqual([['확인 대기 3', `${TASKS}?tab=needs_review`]])
    expect(await screen.findByText(/반영 상태를 알 수 없어요/)).toBeInTheDocument()
  })

  it('최근 반영의 추출만 실패하면 그 영역만 오류이고 다시 시도할 수 있다', async () => {
    useScenario('dashboard-partial-error')
    renderApp(DASHBOARD)
    expect(
      await screen.findByText('최근 반영을 불러오지 못했어요', {}, { timeout: 8_000 }),
    ).toBeInTheDocument()
    await waitFor(() => expect(summary()['기한 지남']).toBe('2'))
    expect(reviewTitles()).toHaveLength(3)
    expect(dueTitles()).toHaveLength(5)
  })

  it('최신 완료 회의의 상세가 다른 공간의 회의면 최근 반영을 오류로 그리고 추출을 부르지 않는다 (#349)', async () => {
    server.use(
      http.get('/api/v1/meetings/mt_09', () => {
        const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_09')!
        return ok({ ...meeting, workspace_id: 'ws_02' })
      }),
    )
    const log = recordRequests()
    renderApp(DASHBOARD)
    expect(
      await screen.findByText('최근 반영을 불러오지 못했어요', {}, { timeout: 8_000 }),
    ).toBeInTheDocument()
    await waitFor(() => expect(summary()['기한 지남']).toBe('2'))
    await settle(150)
    expect(log.started.filter(({ path }) => path.startsWith('/extractions'))).toEqual([])
    expect(screen.queryByRole('list', { name: '최근 반영 목록' })).toBeNull()
  })

  it('받아 둔 최근 반영이 있어도 다시 받은 상세가 다른 공간이면 최근 반영을 오류로 바꾸고 추출을 다시 묻지 않는다 (#349)', async () => {
    const app = await openDashboard()
    server.use(
      http.get('/api/v1/meetings/mt_09', () => {
        const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_09')!
        return ok({ ...meeting, workspace_id: 'ws_02' })
      }),
    )
    await act(() =>
      app.queryClient.invalidateQueries({
        queryKey: workspaceKey('ws_01', 'meetings', 'detail', 'mt_09'),
      }),
    )
    expect(await screen.findByText('최근 반영을 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '최근 반영 목록' })).toBeNull()
    const log = recordRequests()
    await act(() =>
      app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01', 'extractions') }),
    )
    await settle(150)
    expect(log.started.filter(({ path }) => path.startsWith('/extractions'))).toEqual([])
  })

  it('공간을 바꾸면 이전 공간의 데이터가 섞이지 않는다', async () => {
    db.workspaces.push({
      ...structuredClone(db.workspaces[0]),
      workspace_id: 'ws_04',
      name: '알고리즘 스터디',
    })
    db.accounts[0].workspaceIds.push('ws_04')
    db.integrations.ws_04 = structuredClone(db.integrations.ws_01)
    const log = recordRequests()
    const app = await openDashboard()
    act(() => app.navigate(paths.dashboard('ws_04')))
    await app.expectPath(paths.dashboard('ws_04'))
    await waitFor(() => expect(screen.getByText('마감이 임박한 태스크가 없습니다')).toBeVisible())
    expect(screen.queryByText('로그인 API 연동')).not.toBeInTheDocument()
    expect(reviewTitles()).toEqual([])
    expect(await screen.findAllByText('아직 정리한 회의가 없어요')).toHaveLength(2)
    expect(log.started.map(({ path }) => path)).toContain('/tasks?workspace_id=ws_04')
  })
})

describe('되돌리기 (AC-04)', () => {
  async function openRevert(title: string) {
    const user = userEvent.setup()
    const log = recordRequests()
    const app = await openDashboard()
    await user.click(within(rowOf(title)).getByRole('button', { name: `${title} 되돌리기` }))
    const dialog = await screen.findByRole('dialog', { name: '자동 반영을 되돌릴까요?' })
    return { user, log, app, dialog }
  }

  it('확인하면 한 번 보내고, 행은 자리를 지키며 `되돌림` 과 새 확인 필요 링크를 보인다. 관련 캐시를 다시 받는다', async () => {
    const { user, log, dialog } = await openRevert('회원가입 화면')
    expect(dialog).toHaveTextContent('회원가입 화면')
    expect(dialog).toHaveTextContent('확인 필요를 새로 만들어요')
    const extractionGets = requestsTo(log, 'GET', '/extractions/ex_01').length
    await user.click(within(dialog).getByRole('button', { name: '되돌리기' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: '자동 반영을 되돌릴까요?' }),
      ).not.toBeInTheDocument(),
    )
    expect(reverts(log)).toEqual([
      { method: 'POST', path: '/extractions/ex_01/items/it_02/revert' },
    ])
    expect(recentText()[1]).toContain('되돌림')
    expect(recentText().map((text) => text.split('—')[1].trim().slice(0, 4))).toEqual([
      '로그인 ',
      '회원가입',
      'DB 스',
    ])
    expect(
      within(rowOf('회원가입 화면')).getByRole('link', { name: /^확인 필요 보기/ }),
    ).toHaveAttribute('href', paths.approval('ws_01', 'ap_90'))
    await waitFor(() => expect(toastsWith('자동 반영을 되돌렸어요')).toHaveLength(1))
    // 새 확인 필요가 목록 끝에(대기 시작이 가장 늦다), 지운 태스크는 마감 임박에서 빠진다
    await waitFor(() => expect(reviewTitles()).toContain('회원가입 화면'))
    expect(summary()['확인 대기']).toBe('4')
    await waitFor(() => expect(dueTitles()).not.toContain('회원가입 화면'))
    expect(requestsTo(log, 'GET', '/extractions/ex_01').length).toBeGreaterThan(extractionGets)
  })

  it('취소하면 아무것도 보내지 않고 연 버튼으로 포커스가 돌아온다', async () => {
    const { user, log, dialog } = await openRevert('회원가입 화면')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(reverts(log)).toEqual([])
    expect(screen.getByRole('button', { name: '회원가입 화면 되돌리기' })).toHaveFocus()
    expect(recentText()[1]).toContain('반영 상태 없음')
  })

  it('처리 중에는 두 번 보내지 않고 닫히지 않는다. 응답 전에는 성공 표시가 없다', async () => {
    const gate = deferred()
    server.use(
      http.post('/api/v1/extractions/:extractionId/items/:itemId/revert', async () => {
        await gate.promise
        return undefined
      }),
    )
    const { log, dialog } = await openRevert('회원가입 화면')
    const confirm = within(dialog).getByRole('button', { name: '되돌리기' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(confirm).toBeDisabled())
    expect(within(dialog).getByRole('button', { name: '취소' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await settle()
    expect(screen.getByRole('dialog', { name: '자동 반영을 되돌릴까요?' })).toBeInTheDocument()
    expect(recentText()[1]).not.toContain('되돌림')
    expect(reverts(log)).toHaveLength(1)

    gate.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(recentText()[1]).toContain('되돌림'))
    expect(reverts(log)).toHaveLength(1)
  })

  it.each([
    [
      'task_changed',
      () => {
        db.tasks.find(({ task_id }) => task_id === 'tk_02')!.version = 2
      },
      '만든 뒤에 태스크가 바뀌어 되돌릴 수 없어요. 태스크에서 직접 고쳐 주세요.',
      ['태스크 보기', paths.tasks('ws_01', 'tk_02')],
    ],
    [
      'pending_approval',
      () => {
        useScenario('dashboard-revert-rejected')
      },
      '이 태스크에 처리를 기다리는 확인 요청이 있어 되돌릴 수 없어요.',
      ['확인 요청 보기', paths.approval('ws_01', 'ap_05')],
    ],
    [
      'task_missing',
      () => {
        server.use(
          http.post('/api/v1/extractions/:extractionId/items/:itemId/revert', () =>
            fail('AUTO_TASK_NOT_REVERTIBLE', 'x', 409, {
              item_id: 'it_02',
              reason: 'task_missing',
              task_id: 'tk_02',
            }),
          ),
        )
      },
      '태스크가 이미 지워져 되돌릴 수 없어요.',
      null,
    ],
    [
      'not_auto_created',
      () => {
        server.use(
          http.post('/api/v1/extractions/:extractionId/items/:itemId/revert', () =>
            fail('AUTO_TASK_NOT_REVERTIBLE', 'x', 409, {
              item_id: 'it_02',
              reason: 'not_auto_created',
            }),
          ),
        )
      },
      '자동으로 만든 태스크가 아니라 되돌릴 수 없어요.',
      null,
    ],
  ] as const)(
    '서버가 %s 로 거절하면 사유를 안내하고 성공 표시 없이 최신 상태를 다시 받는다',
    async (_, arrange, message, link) => {
      arrange()
      const { user, log, dialog } = await openRevert('회원가입 화면')
      const extractionGets = requestsTo(log, 'GET', '/extractions/ex_01').length
      await user.click(within(dialog).getByRole('button', { name: '되돌리기' }))
      const alert = await within(rowOf('회원가입 화면')).findByRole('alert')
      expect(alert).toHaveTextContent(message)
      if (link !== null)
        expect(within(alert).getByRole('link', { name: link[0] })).toHaveAttribute('href', link[1])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(recentText()[1]).not.toContain('되돌림')
      expect(toastsWith('자동 반영을 되돌렸어요')).toEqual([])
      await waitFor(() =>
        expect(requestsTo(log, 'GET', '/extractions/ex_01').length).toBeGreaterThan(extractionGets),
      )
    },
  )

  it('이미 되돌린 항목이면 따로 안내하지 않고, 다시 받은 상태로 `되돌림` 을 보인다', async () => {
    const { user, dialog } = await openRevert('회원가입 화면')
    // 다른 탭에서 먼저 되돌렸다
    const item = db.extractions[1].items[1]
    db.tasks = db.tasks.filter(({ task_id }) => task_id !== 'tk_02')
    Object.assign(item, { task_id: null, approval_id: 'ap_03', reverted_at: MOCK_NOW })
    await user.click(within(dialog).getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(recentText()[1]).toContain('되돌림'))
    expect(screen.queryByText('이미 되돌린 항목이에요.')).not.toBeInTheDocument()
    expect(toastsWith('자동 반영을 되돌렸어요')).toEqual([])
  })

  it.each([
    [
      '네트워크 실패',
      () => HttpResponse.error(),
      '네트워크에 연결할 수 없어요. 연결을 확인해 주세요.',
    ],
    ['권한 없음(403)', () => fail('FORBIDDEN', 'x', 403), '접근 권한이 없어요.'],
  ] as const)('%s 면 공통 오류 문구를 보이고 성공 표시가 없다', async (_, respond, message) => {
    server.use(http.post('/api/v1/extractions/:extractionId/items/:itemId/revert', respond))
    const { user, log, dialog } = await openRevert('회원가입 화면')
    const extractionGets = requestsTo(log, 'GET', '/extractions/ex_01').length
    await user.click(within(dialog).getByRole('button', { name: '되돌리기' }))
    expect(await within(rowOf('회원가입 화면')).findByRole('alert')).toHaveTextContent(message)
    expect(recentText()[1]).not.toContain('되돌림')
    expect(reverts(log)).toHaveLength(1)
    await waitFor(() =>
      expect(requestsTo(log, 'GET', '/extractions/ex_01').length).toBeGreaterThan(extractionGets),
    )
  })
})

describe('키보드·포커스 (AC-06)', () => {
  it('되돌리기 버튼을 키보드로 열고, Esc 로 닫으면 포커스가 돌아온다. 모달 안에서 포커스가 돈다', async () => {
    const user = userEvent.setup()
    await openDashboard()
    const button = within(rowOf('DB 스키마 정리')).getByRole('button', {
      name: 'DB 스키마 정리 되돌리기',
    })
    button.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '자동 반영을 되돌릴까요?' })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    for (let index = 0; index < 4; index += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(button).toHaveFocus()
  })

  /** 키보드로 그 행의 되돌리기를 열고 모달의 `되돌리기` 에서 Enter */
  async function revertByKeyboard(title: string) {
    const user = userEvent.setup()
    await openDashboard()
    within(rowOf(title))
      .getByRole('button', { name: `${title} 되돌리기` })
      .focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '자동 반영을 되돌릴까요?' })
    within(dialog).getByRole('button', { name: '되돌리기' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    return user
  }

  it('키보드로 되돌리기에 성공하면 포커스가 그 행의 새 확인 필요 보기 링크로 간다 (E-04)', async () => {
    await revertByKeyboard('회원가입 화면')
    await waitFor(() =>
      expect(
        within(rowOf('회원가입 화면')).getByRole('link', { name: /^확인 필요 보기/ }),
      ).toHaveFocus(),
    )
    // 재조회·재렌더로 다시 옮기지 않는다 — 사용자가 옮긴 뒤에도 그대로다
    const summaryButton = screen.getByRole('link', { name: '태스크에서 전부 보기' })
    summaryButton.focus()
    await settle(200)
    expect(summaryButton).toHaveFocus()
  })

  it('성공 응답에 승인 ID 가 없어 링크가 없으면 포커스가 그 행으로 간다 (E-04)', async () => {
    server.use(
      http.post('/api/v1/extractions/:extractionId/items/:itemId/revert', () =>
        HttpResponse.json({
          data: {
            item_id: 'it_02',
            reverted_task_id: 'tk_02',
            approval_id: null,
            reverted_at: MOCK_NOW,
          },
          error: null,
        }),
      ),
    )
    await revertByKeyboard('회원가입 화면')
    await waitFor(() => expect(rowOf('회원가입 화면')).toHaveFocus())
    expect(rowOf('회원가입 화면')).toHaveAccessibleName(/회원가입 화면/)
  })

  it('응답 전에 사용자가 다른 요소로 포커스를 옮겼으면 뺏지 않는다 (E-04)', async () => {
    const gate = deferred()
    server.use(
      http.post('/api/v1/extractions/:extractionId/items/:itemId/revert', async () => {
        await gate.promise
        return undefined
      }),
    )
    const user = userEvent.setup()
    await openDashboard()
    within(rowOf('회원가입 화면')).getByRole('button', { name: '회원가입 화면 되돌리기' }).focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '자동 반영을 되돌릴까요?' })
    within(dialog).getByRole('button', { name: '되돌리기' }).focus()
    await user.keyboard('{Enter}')
    // 응답을 기다리는 동안 모달 안의 다른 요소로 옮긴다 — 모달이 닫힌 뒤 Radix 복귀는 body 로 끝난다.
    // 그 뒤 사용자가 다시 다른 곳을 고르면 행으로 끌어오지 않는다
    gate.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const elsewhere = screen.getByRole('link', { name: '태스크에서 전부 보기' })
    elsewhere.focus()
    await settle(200)
    expect(elsewhere).toHaveFocus()
  })
})

describe('최신 완료 회의의 상세가 403·404 (#405)', () => {
  const notFound = (...ids: string[]) =>
    http.get('/api/v1/meetings/:meetingId', ({ params }) =>
      ids.includes(String(params.meetingId))
        ? fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
        : undefined,
    )
  const lead = () => screen.getByText(/정리했어요/).textContent?.replace(/\s+/g, ' ')
  const detailRequests = (log: Log, id: string) =>
    log.started.filter(({ method, path }) => method === 'GET' && path === `/meetings/${id}`)
  const listRequests = (log: Log) =>
    log.started.filter(
      ({ method, path }) => method === 'GET' && path === '/workspaces/ws_01/meetings',
    )
  function deleteMeeting(id: string) {
    db.meetings.splice(
      db.meetings.findIndex(({ meeting_id }) => meeting_id === id),
      1,
    )
    db.meetingSummaries.splice(
      db.meetingSummaries.findIndex(({ meeting_id }) => meeting_id === id),
      1,
    )
  }

  it('받아 둔 최근 반영의 회의가 지워져 404 가 오면 회의 목록을 다시 받아 다음 완료 회의를 보인다', async () => {
    const app = await openDashboard()
    deleteMeeting('mt_09')
    const log = recordRequests()
    await act(() =>
      app.queryClient.invalidateQueries({
        queryKey: workspaceKey('ws_01', 'meetings', 'detail', 'mt_09'),
      }),
    )
    await waitFor(() => expect(lead()).toContain('채팅 2026-09-11'))
    await waitFor(() => expect(recentText().join(' ')).toContain('배포 스크립트'))
    expect(listRequests(log).length).toBeGreaterThan(0)
    expect(screen.queryByText('최근 반영을 불러오지 못했어요')).toBeNull()
  })

  it('목록에 남은 회의가 연달아 404 여도 다음 완료 회의로 넘어가고, 404 받은 회의를 다시 묻지 않는다', async () => {
    server.use(notFound('mt_09', 'mt_08'))
    const log = recordRequests()
    const app = renderApp(DASHBOARD)
    await waitFor(() => expect(lead()).toContain('2주차 정기회의'), { timeout: 8_000 })
    expect(screen.queryByText('최근 반영을 불러오지 못했어요')).toBeNull()
    await settle(150)
    const asked = [detailRequests(log, 'mt_09').length, detailRequests(log, 'mt_08').length]
    await act(() =>
      app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01', 'meetings', 'list') }),
    )
    await settle(150)
    expect([detailRequests(log, 'mt_09').length, detailRequests(log, 'mt_08').length]).toEqual(
      asked,
    )
    expect(lead()).toContain('2주차 정기회의')
  })

  it('완료 회의가 모두 404 면 정리한 회의가 없다고 보인다', async () => {
    server.use(notFound('mt_09', 'mt_08', 'mt_07'))
    renderApp(DASHBOARD)
    await waitFor(() => expect(screen.getAllByText('아직 정리한 회의가 없어요')).toHaveLength(2), {
      timeout: 8_000,
    })
    expect(screen.queryByText('최근 반영을 불러오지 못했어요')).toBeNull()
  })

  it('받아 둔 최근 반영이 있어도 다시 받은 상세가 403 이면 최근 반영을 오류로 바꾸고 추출을 다시 묻지 않는다', async () => {
    const app = await openDashboard()
    server.use(
      http.get('/api/v1/meetings/mt_09', () =>
        fail('FORBIDDEN', '이 작업을 수행할 권한이 없습니다.', 403),
      ),
    )
    await act(() =>
      app.queryClient.invalidateQueries({
        queryKey: workspaceKey('ws_01', 'meetings', 'detail', 'mt_09'),
      }),
    )
    expect(await screen.findByText('최근 반영을 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '최근 반영 목록' })).toBeNull()
    const log = recordRequests()
    await act(() =>
      app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01', 'extractions') }),
    )
    await settle(150)
    expect(log.started.filter(({ path }) => path.startsWith('/extractions'))).toEqual([])
  })

  async function leaveAndReturn(app: ReturnType<typeof renderApp>) {
    act(() => app.navigate(paths.messages('ws_01')))
    await screen.findByRole('heading', { level: 1, name: '메시지' })
    act(() => app.navigate(DASHBOARD))
    await screen.findByRole('heading', { name: '대시보드' })
  }

  it('받아 둔 상세 수십 개가 404 로 남은 채 목록 갱신도 실패하고 다시 들어와도 렌더가 깨지지 않고 빈 상태에 닿는다 (#405 리뷰)', async () => {
    const [detailTemplate] = db.meetings.filter(({ meeting_id }) => meeting_id === 'mt_09')
    const [summaryTemplate] = db.meetingSummaries.filter(({ meeting_id }) => meeting_id === 'mt_09')
    const added = Array.from({ length: 26 }, (_, index) => `mt_${500 + index}`)
    added.forEach((id, index) => {
      const startedAt = new Date(Date.parse('2026-09-17T05:00:00Z') - index * 3_600_000)
      db.meetings.push({
        ...structuredClone(detailTemplate),
        meeting_id: id,
        started_at: startedAt.toISOString(),
        extraction_id: null,
      })
      db.meetingSummaries.push({
        ...structuredClone(summaryTemplate),
        meeting_id: id,
        started_at: startedAt.toISOString(),
      })
    })
    const done = [...added, 'mt_09', 'mt_08', 'mt_07']
    const app = renderApp(DASHBOARD, { strict: true })
    await screen.findByRole('heading', { name: '대시보드' })
    await waitFor(() => expect(lead()).toContain('3주차 정기회의'))
    await act(() =>
      Promise.all(
        done.map((id) => app.queryClient.fetchQuery(meetingDetailQueryOptions('ws_01', id))),
      ),
    )
    server.use(
      notFound(...done),
      http.get('/api/v1/workspaces/ws_01/meetings', () =>
        fail('SERVICE_UNAVAILABLE', '잠시 뒤 다시 시도해 주세요.', 503),
      ),
    )
    await act(() =>
      app.queryClient.invalidateQueries({
        queryKey: workspaceKey('ws_01', 'meetings', 'detail'),
      }),
    )
    await waitFor(() => expect(screen.getAllByText('아직 정리한 회의가 없어요')).toHaveLength(2), {
      timeout: 10_000,
    })

    await leaveAndReturn(app)
    await waitFor(() => expect(screen.getAllByText('아직 정리한 회의가 없어요')).toHaveLength(2), {
      timeout: 10_000,
    })
    expect(screen.queryByText('최근 반영을 불러오지 못했어요')).toBeNull()
  }, 30_000)

  it('지난 방문에 404 였던 회의가 다시 들어올 때 정상이면 다시 그 회의를 보인다 (#405 리뷰)', async () => {
    const app = await openDashboard()
    server.use(notFound('mt_09'))
    await act(() =>
      app.queryClient.invalidateQueries({
        queryKey: workspaceKey('ws_01', 'meetings', 'detail', 'mt_09'),
      }),
    )
    await waitFor(() => expect(lead()).toContain('채팅 2026-09-11'))

    server.resetHandlers()
    const log = recordRequests()
    await leaveAndReturn(app)
    await waitFor(() => expect(lead()).toContain('3주차 정기회의'))
    await screen.findByRole('list', { name: '최근 반영 목록' })
    expect(detailRequests(log, 'mt_09').length).toBeGreaterThan(0)
  })
})
