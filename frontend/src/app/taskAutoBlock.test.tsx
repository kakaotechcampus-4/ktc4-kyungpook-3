import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { setMockRole } from '@/shared/mock/sessions'
import { addHistory, updateTask } from '@/shared/mock/task-state'
import { renderApp } from './test/renderApp'

/*
 * #330 무응답 자동 막힘 풀기. notifications-default 의 tk_06(STT 정확도 측정)은 스케줄러가 막았고,
 * tk_03(DB 스키마 정리)은 사람이 막았다
 */

beforeEach(() => applyScenario('notifications-default'))

const AUTO_NOTICE = '리마인드에 응답이 없어 자동으로 막혔어요.'

function field(term: string): HTMLElement {
  return within(screen.getByLabelText('태스크 정보')).getByText(term, { selector: 'dt' })
    .nextElementSibling as HTMLElement
}

async function openDetail(taskId: string, title: string) {
  const app = renderApp(paths.tasks('ws_01', taskId))
  await screen.findByRole('heading', { level: 2, name: title })
  return app
}

describe('태스크 상세의 자동 막힘 (#330)', () => {
  it('PM 이 막힘을 풀면 상태와 사유가 막히기 전 값으로 돌아가고 알린다', async () => {
    const user = userEvent.setup()
    await openDetail('tk_06', 'STT 정확도 측정')
    expect(await within(field('막힌 사유')).findByText(AUTO_NOTICE)).toBeInTheDocument()

    await user.click(within(field('막힌 사유')).getByRole('button', { name: '막힘 풀기' }))

    await waitFor(() => expect(screen.getByTestId('task-status')).toHaveTextContent('진행 중'))
    expect(field('막힌 사유')).toHaveTextContent('없음')
    expect(within(field('막힌 사유')).queryByText(AUTO_NOTICE)).toBeNull()
    expect(await screen.findByText('자동 막힘을 풀었어요')).toBeInTheDocument()
  })

  it('일반 팀원은 자동 막힘만 보고 풀 수 없다', async () => {
    setMockRole('member')
    await openDetail('tk_06', 'STT 정확도 측정')
    expect(await within(field('막힌 사유')).findByText(AUTO_NOTICE)).toBeInTheDocument()
    expect(within(field('막힌 사유')).queryByRole('button', { name: '막힘 풀기' })).toBeNull()
  })

  it('사람이 건 막힘은 사유가 같은 문구여도 자동 막힘이 아니다', async () => {
    const task = db.tasks.find(({ task_id }) => task_id === 'tk_03')!
    task.blocker = '리마인드에 72시간 동안 응답이 없어요'
    addHistory('tk_03', 'status', 'in_progress', 'blocked', 'mb_01', 'manual')
    await openDetail('tk_03', 'DB 스키마 정리')
    await screen.findByRole('list', { name: '변경 이력' })
    expect(field('막힌 사유')).toHaveTextContent('리마인드에 72시간 동안 응답이 없어요')
    expect(screen.queryByText(AUTO_NOTICE)).toBeNull()
    expect(screen.queryByRole('button', { name: '막힘 풀기' })).toBeNull()
  })

  it('막힌 뒤 값이 바뀌어 409 면 안내하고 태스크를 다시 불러온다', async () => {
    const user = userEvent.setup()
    await openDetail('tk_06', 'STT 정확도 측정')
    const undo = await within(field('막힌 사유')).findByRole('button', { name: '막힘 풀기' })
    // 화면이 모르는 사이 다른 PM 이 사유를 고쳤다
    updateTask(
      db.tasks.find(({ task_id }) => task_id === 'tk_06')!,
      { blocker: '카톡으로 들었어요' },
      'mb_01',
    )

    await user.click(undo)

    expect(await screen.findByText('막힘을 풀지 못했어요')).toBeInTheDocument()
    expect(
      screen.getByText(
        '막힌 뒤 상태나 사유가 바뀌어 되돌릴 수 없어요. 최신 태스크를 다시 불러왔어요.',
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(field('막힌 사유')).toHaveTextContent('카톡으로 들었어요'))
    expect(screen.getByTestId('task-status')).toHaveTextContent('막힘')
  })
})

describe('보드의 자동 막힘 배지 (#330)', () => {
  const card = (title: string) =>
    screen.getByRole('link', { name: title }).closest('article') as HTMLElement

  it('자동 막힌 카드는 자동 막힘 배지이고, 사유 창에서 PM 이 풀 수 있다', async () => {
    const user = userEvent.setup()
    renderApp(`${paths.tasks('ws_01')}?view=board`)
    const badge = await within(await waitFor(() => card('STT 정확도 측정'))).findByRole('button', {
      name: '자동 막힘, 막힌 사유 보기',
    })
    expect(
      within(card('DB 스키마 정리')).getByRole('button', { name: '막힘, 막힌 사유 보기' }),
    ).toBeVisible()

    await user.click(badge)
    const dialog = await screen.findByRole('dialog', { name: '막힌 사유' })
    expect(dialog).toHaveTextContent('리마인드에 72시간 동안 응답이 없어요')
    await user.click(within(dialog).getByRole('button', { name: '막힘 풀기' }))

    await waitFor(() =>
      expect(within(card('STT 정확도 측정')).queryByRole('button', { name: /막힘/ })).toBeNull(),
    )
  })
})
