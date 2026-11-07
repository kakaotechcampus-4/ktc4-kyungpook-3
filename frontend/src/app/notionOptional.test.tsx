import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { completeMeeting } from '@/shared/mock/meetingFlow'
import { renderApp } from './test/renderApp'

/*
 * #507 — Notion 은 선택 기능이다 (D-182). 연결하지 않은 공간에서 정리한 회의의 회의록·태스크·승인 화면이
 * Notion 반영 중·실패를 잘못 보이지 않는다. 미연동 공간의 태스크는 서버가 `notion_sync_status = null` 로 둔다
 * (backend notion_sync.enqueue_task_sync, MSW task-state.enqueueTaskSync).
 */

const WRONG_SYNC = /반영 중|반영 실패|반영됨/

function disconnectNotion() {
  db.integrations.ws_01.notion = { status: 'not_connected', display_name: null, connected_at: null }
}

beforeEach(() => {
  disconnectNotion()
})

describe('Notion 을 연결하지 않은 공간 (D-182)', () => {
  it('정리가 끝난 회의의 회의록과 그 회의가 만든 태스크에 반영 중·실패가 없다', async () => {
    const { taskIds } = completeMeeting('mt_10')
    expect(taskIds.length).toBeGreaterThan(0)
    expect(
      db.tasks.filter(({ task_id }) => taskIds.includes(task_id)).map((t) => t.notion_sync_status),
    ).toEqual(taskIds.map(() => null))

    const user = userEvent.setup()
    renderApp(paths.meetings('ws_01', 'mt_10'))
    await screen.findByRole('heading', { level: 2, name: '기획 논의 녹음' })
    await user.click(screen.getByRole('tab', { name: /추출된 일/ }))
    const panel = screen.getByRole('tabpanel')
    expect(
      within(panel).getByText(
        'Notion을 연결했다면 확실한 태스크는 바로, 확인이 필요한 태스크는 승인한 뒤 Notion에도 올라가요.',
      ),
    ).toBeInTheDocument()
    expect(within(panel).queryByText(WRONG_SYNC)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('태스크 상세는 반영 상태 없음이고 다시 반영하기가 없다', async () => {
    const { taskIds } = completeMeeting('mt_10')
    const taskId = taskIds[0]
    const title = db.tasks.find(({ task_id }) => task_id === taskId)!.title
    renderApp(paths.tasks('ws_01', taskId))
    await screen.findByRole('heading', { level: 1, name: title })
    await waitFor(() =>
      expect(screen.getByTestId('notion-sync-status')).toHaveTextContent('반영 상태 없음'),
    )
    expect(screen.queryByRole('button', { name: '다시 반영하기' })).toBeNull()
  })

  it('확인 필요를 승인하면 결과는 반영 상태 없음이다 — 반영 중으로 보이지 않는다', async () => {
    const approval = db.approvals.find(({ approval_id }) => approval_id === 'ap_02')!
    approval.payload.due_date = '2026-09-30'
    renderApp(paths.approval('ws_01', 'ap_02'))
    const approve = await screen.findByRole('button', { name: '승인' })
    await waitFor(() => expect(approve).toBeEnabled())
    await userEvent.click(approve)

    await waitFor(() =>
      expect(screen.getByTestId('notion-sync-status')).toHaveTextContent('반영 상태 없음'),
    )
    expect(screen.queryByText(WRONG_SYNC)).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 반영하기' })).toBeNull()
  })
})
