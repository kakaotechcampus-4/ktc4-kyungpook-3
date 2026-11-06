import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { applyScenario } from '@/shared/mock/scenarios'
import { renderApp } from './test/renderApp'

/*
 * #344 태스크 상세의 변경 이력에 답장과 그 답장이 바꾼 값을 묶어 보인다. 시나리오 reply-judgment:
 * 이재환의 답장 mg_31 이 tk_03 을 막힘 → 완료로 자동 반영했고(rc_02), 마감 26일 변경은 승인 대기다(rc_03)
 */

vi.setConfig({ testTimeout: 15_000 })

const REPLY_META = '이재환 답장 · Discord · 2026-09-17 10:00'

async function openTk03() {
  renderApp(paths.tasks('ws_01', 'tk_03'))
  await screen.findByRole('heading', { level: 2, name: 'DB 스키마 정리' })
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
