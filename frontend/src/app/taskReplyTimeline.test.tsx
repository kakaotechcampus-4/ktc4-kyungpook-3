import { onTestFinished } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http, HttpResponse } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { handlers } from '@/shared/mock/handlers'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { toTaskResponse } from '@/shared/mock/task-state'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #344 태스크 상세의 변경 이력에 답장과 그 답장이 바꾼 값을 묶어 보인다. 시나리오 reply-judgment:
 * 이재환의 답장 mg_31 이 tk_03 을 막힘 → 완료로 자동 반영했고(rc_02), 마감 26일 변경은 승인 대기다(rc_03)
 */

vi.setConfig({ testTimeout: 15_000 })

const REPLY_META = '이재환 답장 · Discord · 2026-09-17 10:00'

async function openTk03() {
  renderApp(paths.tasks('ws_01', 'tk_03'))
  await screen.findByRole('heading', { level: 1, name: 'DB 스키마 정리' })
  const history = await screen.findByRole('list', { name: '변경 이력' })
  await within(history).findByText(REPLY_META)
  return history
}

function replyRow(history: HTMLElement): HTMLElement {
  return within(history).getByText(REPLY_META).closest('li') as HTMLElement
}

function changeRow(history: HTMLElement, text: string): HTMLElement {
  return within(replyRow(history)).getByText(text).closest('li') as HTMLElement
}

const historyLines = (history: HTMLElement) =>
  Array.from(history.children, (item) => item.querySelector('p')?.textContent ?? '')

describe('태스크 상세의 답장 기록 (#344)', () => {
  it('PM 은 답장과 그 답장이 바꾼 값을 한 칸으로 보고, 자동 반영을 되돌린다', async () => {
    applyScenario('reply-judgment')
    const user = userEvent.setup()
    const history = await openTk03()
    const reply = replyRow(history)

    expect(within(reply).getByText(/DB 스키마 정리는 끝냈어요/)).toBeVisible()
    const status = changeRow(history, '상태: 완료')
    expect(within(status).getByText('자동 반영')).toBeVisible()
    expect(within(status).getByText('DB 스키마 정리를 끝냈대요')).toBeVisible()
    expect(within(changeRow(history, '마감: 2026-09-26')).getByText('승인 대기')).toBeVisible()
    expect(within(reply).getAllByRole('button', { name: '되돌리기' })).toHaveLength(1)
    // 자동 반영 이력은 답장 칸에만 있다
    expect(historyLines(history)).not.toContain('상태: 막힘 → 완료')

    await user.click(within(status).getByRole('button', { name: '되돌리기' }))

    await waitFor(() => expect(screen.getByTestId('task-status')).toHaveTextContent('막힘'))
    expect(await screen.findByText('답장으로 바꾼 값을 되돌렸어요')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(changeRow(history, '상태: 완료')).getByText('되돌림')).toBeVisible(),
    )
    expect(within(replyRow(history)).queryByRole('button', { name: '되돌리기' })).toBeNull()
    // 되돌린 값은 새 이력 한 줄이고, 변경자는 /history 에서 채운다
    await waitFor(() => expect(historyLines(history)[0]).toBe('상태: 완료 → 막힘'))
    expect(history.children[0]).toHaveTextContent('김서연 · 리마인더 답장')
  })

  it('보는 사이 태스크가 지워져 되돌리기가 404 면 볼 수 없는 태스크로 바뀌고 목록에서도 빠진다', async () => {
    applyScenario('reply-judgment')
    const user = userEvent.setup()
    // 목록을 먼저 받아 두어야 지운 태스크가 남은 목록 캐시를 다시 받는지 볼 수 있다
    renderApp(paths.tasks('ws_01'))
    await user.click(await screen.findByRole('link', { name: /DB 스키마 정리/ }))
    await screen.findByRole('heading', { level: 1, name: 'DB 스키마 정리' })
    const history = await screen.findByRole('list', { name: '변경 이력' })
    await within(history).findByText(REPLY_META)
    db.tasks = db.tasks.filter(({ task_id }) => task_id !== 'tk_03')

    await user.click(
      within(changeRow(history, '상태: 완료')).getByRole('button', { name: '되돌리기' }),
    )

    expect(
      await screen.findByRole('heading', { level: 2, name: '이 태스크를 볼 수 없어요' }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 1, name: 'DB 스키마 정리' })).toBeNull()

    await user.click(screen.getByRole('link', { name: '태스크 목록으로' }))
    expect(await screen.findByText('회원가입 화면')).toBeInTheDocument()
    // 같은 이름은 그 태스크의 승인 카드(ap_31)에만 남는다
    await waitFor(() =>
      expect(
        screen
          .queryAllByText('DB 스키마 정리')
          .filter((element) => element.closest('[data-kind="approval"]') === null),
      ).toEqual([]),
    )
  })

  it('일반 팀원은 답장 글 대신 안내를 보고 되돌릴 수 없다', async () => {
    applyScenario('reply-judgment-member')
    const history = await openTk03()
    const reply = replyRow(history)

    expect(within(reply).getByText('답장 내용은 PM과 답장한 팀원만 볼 수 있어요.')).toBeVisible()
    expect(within(reply).queryByText(/DB 스키마 정리는 끝냈어요/)).toBeNull()
    expect(within(reply).queryByText('DB 스키마 정리를 끝냈대요')).toBeNull()
    expect(within(changeRow(history, '상태: 완료')).getByText('자동 반영')).toBeVisible()
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull()
  })
})

describe('쓰기 응답을 읽지 못함 (#348)', () => {
  it('답장 변경 되돌리기 응답을 읽지 못하면 결과를 확인하지 못했다고 알리고, 새로고침은 태스크를 다시 받는다', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warning.mockRestore())
    applyScenario('reply-judgment')
    server.use(
      http.post('/api/v1/tasks/:taskId/reply-changes/:changeId/undo', () =>
        ok({
          ...toTaskResponse(db.tasks.find(({ task_id }) => task_id === 'tk_03')!),
          status: 'archived',
        }),
      ),
    )
    const user = userEvent.setup()
    const log = recordRequests()
    const history = await openTk03()
    await user.click(
      within(changeRow(history, '상태: 완료')).getByRole('button', { name: '되돌리기' }),
    )
    const notice = (
      await screen.findByText('변경 결과를 확인하지 못했어요', {}, { timeout: 5_000 })
    ).closest('li') as HTMLElement
    expect(within(notice).getByText(/서버에는 반영됐을 수 있어요/)).toBeInTheDocument()
    expect(screen.queryByText('되돌리지 못했어요')).toBeNull()
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    const before = log.started.length
    fireEvent.click(within(notice).getByRole('button', { name: '새로고침' }))
    await waitFor(() =>
      expect(log.started.slice(before)).toContainEqual({ method: 'GET', path: '/tasks/tk_03' }),
    )
  })
})

describe('모르는 답장 줄 (#348)', () => {
  /** 서버 기록 응답에서 자동 반영 줄(rc_02, undoable)만 바꾼다 */
  function patchAutoChange(patch: Record<string, string>) {
    server.use(
      http.get('/api/v1/tasks/:taskId/timeline', async ({ request }) => {
        const response = await getResponse(handlers, request)
        const body = (await response!.json()) as {
          data: { items: { kind: string; changes?: { change_id: string }[] }[] }
        }
        for (const item of body.data.items)
          item.changes = item.changes?.map((change) =>
            change.change_id === 'rc_02' ? { ...change, ...patch } : change,
          )
        return HttpResponse.json(body)
      }),
    )
  }

  it.each([
    ['종류', { field: 'priority' }, '알 수 없는 변경이에요', '자동 반영'],
    ['결과', { result: 'escalated' }, '상태: 완료', '알 수 없는 결과'],
    [
      '종류와 결과',
      { field: 'priority', result: 'escalated' },
      '알 수 없는 변경이에요',
      '알 수 없는 결과',
    ],
  ])(
    '%s를 모르는 줄은 서버가 되돌릴 수 있다고 해도 PM 에게 되돌리기가 없고 쓰기 요청이 나가지 않는다',
    async (_, patch, change, result) => {
      applyScenario('reply-judgment')
      patchAutoChange(patch)
      const requests = recordRequests()
      const history = await openTk03()
      const row = changeRow(history, change)
      expect(within(row).getByText(result)).toBeVisible()
      expect(within(replyRow(history)).queryByRole('button', { name: '되돌리기' })).toBeNull()
      expect(requests.started.filter(({ method }) => method !== 'GET')).toEqual([])
    },
  )
})
