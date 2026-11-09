import type { MockInstance } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { clearTrackedMeetings, trackMeeting, useMeetingTrackerStore } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #348 — 회의·회의록·추출 응답이 스키마에 맞지 않을 때 화면. 모르는 회의 상태는 다른 상태로 바꾸지 않고 응답을 읽지 못했다고
 * 알리며 재시도하지 않는다. 모르는 출처는 표시용 분류라 회의록을 보이되 회의 안 시각·길이·배지를 짐작하지 않는다.
 * 되돌리기 응답을 읽지 못하면 되돌려졌을 수 있어 실패라고 하지 않는다
 */

vi.setConfig({ testTimeout: 15_000 })

const INVALID = '응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'
const MT_09 = paths.meetings('ws_01', 'mt_09')

let warning: MockInstance<typeof console.warn>
beforeEach(() => {
  warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warning.mockRestore()
  clearTrackedMeetings()
})

/** 재시도 대기(1초)보다 길게 기다린다. 재시도가 있었다면 이 사이에 두 번째 요청이 나간다 */
const pastRetryDelay = () => act(() => new Promise((resolve) => setTimeout(resolve, 1_300)))

const meetingList = () => screen.getByRole('complementary', { name: '회의 목록' })
const detail = () => screen.getByRole('region', { name: '회의록 본문' })

function summary(meetingId: string) {
  return db.meetingSummaries.find(({ meeting_id }) => meeting_id === meetingId)!
}

it('회의 목록에 모르는 상태가 한 건이라도 있으면 목록 대신 안내와 다시 시도를 보이고 재시도하지 않는다', async () => {
  server.use(
    http.get('/api/v1/workspaces/:workspaceId/meetings', () =>
      ok({ items: [{ ...structuredClone(summary('mt_09')), status: 'archived' }], total: 1 }),
    ),
  )
  const requests = recordRequests()
  renderApp(MT_09)
  await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
  const list = meetingList()
  expect(await within(list).findByText('회의 목록을 불러오지 못했어요')).toBeVisible()
  expect(within(list).getByText(INVALID)).toBeVisible()
  expect(within(list).queryByRole('list', { name: '정리된 회의' })).toBeNull()

  // 회의록 본문이 같은 목록 Query 를 늦게 구독해 한 번 더 받을 수 있다(mount 때 다시 받기). 안내가 뜬 뒤로는 재시도가 없다
  const listRequests = () => requests.started.filter(({ path }) => path.endsWith('/meetings'))
  const shown = listRequests().length
  await pastRetryDelay()
  expect(listRequests()).toHaveLength(shown)

  server.resetHandlers()
  fireEvent.click(within(list).getByRole('button', { name: '다시 시도' }))
  expect(
    await within(list).findByRole('list', { name: '정리된 회의' }, { timeout: 3_000 }),
  ).toBeInTheDocument()
})

it('모르는 출처의 회의는 알 수 없는 출처로 보이고 길이·배지·전사문 시각을 짐작하지 않는다', async () => {
  summary('mt_09').source = 'zoom'
  db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!.source = 'zoom'
  const user = userEvent.setup()
  renderApp(MT_09)
  await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })

  const row = within(within(meetingList()).getByRole('list', { name: '정리된 회의' })).getAllByRole(
    'link',
  )[0]
  expect(row).toHaveTextContent('09/15 14:00 · 4명')
  expect(row).not.toHaveTextContent('46분')
  expect(within(row).queryByText('채팅')).toBeNull()

  const region = detail()
  expect(within(region).getByText('알 수 없는 출처')).toBeInTheDocument()
  expect(within(region).getByText('2026-09-15 14:00')).toBeInTheDocument()
  expect(within(region).queryByText('Discord 자동 수집')).toBeNull()

  await user.click(screen.getByRole('tab', { name: /전사문/ }))
  const lines = within(
    within(screen.getByRole('tabpanel')).getByRole('list', { name: '전사문' }),
  ).getAllByRole('listitem')
  expect(lines.map((line) => line.firstElementChild?.textContent)).toEqual(lines.map(() => ''))
  expect(warning).toHaveBeenCalledWith('Unknown meeting source: zoom')
})

it('정리 중인 회의의 출처를 모르면 단계 수를 짐작하지 않고 단계 없이 정리 중이라고만 보인다', async () => {
  summary('mt_10').source = 'zoom'
  renderApp(paths.meetingProcessing('ws_01', 'mt_10'))
  expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
  expect(screen.queryByRole('list', { name: '정리 단계' })).toBeNull()
  expect(screen.getByRole('main')).not.toHaveTextContent('단계 완료')
})

it('추출 항목 한 건이 깨지면 추출된 일 대신 안내를 보이고 회의록 본문은 남긴다', async () => {
  server.use(
    http.get('/api/v1/extractions/:extractionId', () => {
      const extraction = structuredClone(
        db.extractions.find(({ extraction_id }) => extraction_id === 'ex_01')!,
      )
      return ok({
        ...extraction,
        items: extraction.items.map((item, index) =>
          index === 1 ? { ...item, task: { title: null } } : item,
        ),
      })
    }),
  )
  const user = userEvent.setup()
  renderApp(MT_09)
  await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })

  await user.click(screen.getByRole('tab', { name: /추출된 일/ }))
  const tasks = screen.getByRole('tabpanel')
  expect(await within(tasks).findByText('추출된 일을 불러오지 못했어요')).toBeVisible()
  expect(within(tasks).getByText(INVALID)).toBeVisible()
  expect(within(detail()).getByText('Discord 자동 수집')).toBeInTheDocument()
  expect(warning).toHaveBeenCalledWith('Invalid extraction response', [
    expect.objectContaining({ path: 'items[1].task.title', value: null }),
  ])
})

it('되돌리기 응답을 읽지 못하면 실패라고 하지 않고 결과를 확인하지 못했다고 알리며, 새로고침이 추출을 다시 받는다', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
  onTestFinished(() => {
    vi.useRealTimers()
  })
  server.use(
    http.post('/api/v1/extractions/:extractionId/items/:itemId/revert', () =>
      ok({ item_id: 'it_02' }),
    ),
  )
  const log = recordRequests()
  const user = userEvent.setup()
  renderApp(paths.dashboard('ws_01'))
  const recent = await screen.findByRole('list', { name: '최근 반영 목록' })
  const row = within(recent)
    .getAllByTestId('recent-row')
    .find((each) => each.textContent?.includes('회원가입 화면'))!
  await user.click(within(row).getByRole('button', { name: '회원가입 화면 되돌리기' }))
  const dialog = await screen.findByRole('dialog', { name: '자동 반영을 되돌릴까요?' })
  await user.click(within(dialog).getByRole('button', { name: '되돌리기' }))

  const notice = (
    await screen.findByText('변경 결과를 확인하지 못했어요', {}, { timeout: 5_000 })
  ).closest('li') as HTMLElement
  expect(within(notice).getByText(/서버에는 반영됐을 수 있어요/)).toBeInTheDocument()
  expect(screen.queryByText(INVALID)).toBeNull()
  expect(screen.queryByText('자동 반영을 되돌렸어요')).toBeNull()

  const before = log.started.length
  fireEvent.click(within(notice).getByRole('button', { name: '새로고침' }))
  await waitFor(() =>
    expect(log.started.slice(before)).toContainEqual({ method: 'GET', path: '/extractions/ex_01' }),
  )
})

describe('처리 추적기와 읽지 못한 상세 (#348 리뷰)', () => {
  const MT_10 = paths.meetingProcessing('ws_01', 'mt_10')
  type Log = ReturnType<typeof recordRequests>
  const detailRequests = (log: Log) =>
    log.started.filter(({ method, path }) => method === 'GET' && path === '/meetings/mt_10')
  const invalidDetail = () =>
    http.get('/api/v1/meetings/mt_10', () =>
      ok({
        ...structuredClone(db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')!),
        status: 'archived',
      }),
    )
  const tracked = () =>
    useMeetingTrackerStore.getState().meetings.some(({ meetingId }) => meetingId === 'mt_10')

  /** polling 간격(3초)보다 오래 기다리고 창 포커스·연결 복귀를 일으켜도 상세 요청이 늘지 않는다 */
  async function expectNoMoreDetailRequests(log: Log) {
    const before = detailRequests(log).length
    await act(() => new Promise((resolve) => setTimeout(resolve, 3_500)))
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    expect(detailRequests(log)).toHaveLength(before)
  }

  afterEach(() => {
    focusManager.setFocused(undefined)
    onlineManager.setOnline(true)
  })

  it('받아 둔 상세 없이 처음부터 읽지 못하면 안내와 다시 시도만 보이고, 추적은 끝내지 않은 채 다시 묻지 않는다', async () => {
    trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_10' })
    server.use(invalidDetail())
    const log = recordRequests()
    renderApp(MT_10)
    expect(await screen.findByText(INVALID, {}, { timeout: 5_000 })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '정리하고 있어요' })).toBeNull()

    await expectNoMoreDetailRequests(log)
    expect(tracked()).toBe(true)
    expect(screen.queryByText('회의를 정리하지 못했어요')).toBeNull()

    server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
  }, 25_000)

  it('받아 둔 상세가 있어도 다음 응답을 읽지 못하면 마지막 단계 대신 안내를 보이고 다시 묻지 않는다. 다시 시도가 성공하면 다시 지켜본다', async () => {
    const log = recordRequests()
    renderApp(MT_10)
    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    await waitFor(() => expect(tracked()).toBe(true))

    server.use(invalidDetail())
    expect(await screen.findByText(INVALID, {}, { timeout: 5_000 })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '정리하고 있어요' })).toBeNull()
    expect(screen.queryByRole('list', { name: '정리 단계' })).toBeNull()

    await expectNoMoreDetailRequests(log)
    expect(tracked()).toBe(true)

    server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    const recovered = detailRequests(log).length
    await act(() => new Promise((resolve) => setTimeout(resolve, 3_500)))
    expect(detailRequests(log).length).toBeGreaterThan(recovered)
  }, 25_000)
})
