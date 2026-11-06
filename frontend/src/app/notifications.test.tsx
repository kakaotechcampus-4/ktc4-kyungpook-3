import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { notificationFixtures } from '@/shared/mock/fixtures/notification'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* #330 앱 머리의 알림 종. 안 읽은 수가 배지이고, 누른 알림은 읽음 표시 뒤 링크로 옮긴다 */

beforeEach(() => {
  db.notifications = structuredClone(notificationFixtures)
})

async function openBell() {
  const user = userEvent.setup()
  const app = renderApp(paths.members('ws_01'))
  const bell = await screen.findByRole('button', { name: '알림, 읽지 않은 알림 4개' })
  await user.click(bell)
  const list = await screen.findByRole('dialog', { name: '알림 목록' })
  return { app, user, list }
}

const item = (list: HTMLElement, text: string) =>
  within(list)
    .getAllByRole('button')
    .find((button) => button.textContent?.includes(text)) as HTMLElement

describe('알림 종 (#330)', () => {
  it('안 읽은 수를 배지로 보이고, 목록은 종류별 제목과 본문이다. 모르는 종류는 기본 제목이다', async () => {
    const { list } = await openBell()
    const titles = within(list)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('span')?.textContent)
    expect(titles).toEqual([
      '응답이 없어 태스크가 막혔어요, 안 읽음',
      '보낼 재촉을 확인해 주세요, 안 읽음',
      '재촉이 자동으로 취소됐어요, 안 읽음',
      '새 알림, 안 읽음',
      '재촉을 다시 승인해 주세요',
    ])
    expect(list).toHaveTextContent('정하늘님의 답장을 태스크에 반영했어요.')
  })

  it('태스크 알림을 누르면 읽음으로 표시한 뒤 태스크 상세로 가고, 배지가 줄어든다', async () => {
    const log = recordRequests()
    const { app, user, list } = await openBell()
    await user.click(item(list, 'STT 정확도 측정'))

    await app.expectPath(paths.tasks('ws_01', 'tk_06'))
    expect(log.started).toContainEqual({
      method: 'POST',
      path: '/workspaces/ws_01/notifications/nt_01/read',
    })
    expect(
      await screen.findByRole('button', { name: '알림, 읽지 않은 알림 3개' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '알림 목록' })).toBeNull()
  })

  it.each([
    ['이재환님이 답장해', paths.messageThread('ws_01', 'th_01'), ''],
    ['보내기 전에 확인해 주세요', paths.messages('ws_01'), '?review=rv_01'],
  ])('%s 알림은 메시지 화면으로 간다', async (text, pathname, search) => {
    const { app, user, list } = await openBell()
    await user.click(item(list, text))
    await app.expectPath(pathname)
    await app.expectSearch(search)
  })

  it('모르는 링크는 읽음만 표시하고 옮기지 않는다', async () => {
    const { app, user, list } = await openBell()
    await user.click(item(list, '정하늘님의 답장을'))

    expect(
      await screen.findByRole('button', { name: '알림, 읽지 않은 알림 3개' }),
    ).toBeInTheDocument()
    expect(
      db.notifications.find(({ notification_id }) => notification_id === 'nt_04')?.read_at,
    ).not.toBeNull()
    await app.expectPath(paths.members('ws_01'))
  })

  it('읽음 표시가 실패하면 안내하고 옮기지 않는다', async () => {
    server.use(
      http.post('/api/v1/workspaces/:workspaceId/notifications/:notificationId/read', () =>
        fail('INTERNAL_ERROR', 'boom', 500),
      ),
    )
    const { app, user, list } = await openBell()
    await user.click(item(list, 'STT 정확도 측정'))

    expect(await within(list).findByRole('alert')).toBeInTheDocument()
    await app.expectPath(paths.members('ws_01'))
  })

  it('알림이 없으면 배지 없이 빈 안내를 보인다', async () => {
    db.notifications = []
    const user = userEvent.setup()
    renderApp(paths.members('ws_01'))
    await user.click(await screen.findByRole('button', { name: '알림' }))
    expect(await screen.findByRole('dialog', { name: '알림 목록' })).toHaveTextContent(
      '아직 알림이 없어요.',
    )
  })
})

it('목록 조회가 실패하면 목록 안에서 다시 시도한다', async () => {
  let fails = true
  server.use(
    http.get('/api/v1/workspaces/:workspaceId/notifications', () =>
      fails ? fail('INTERNAL_ERROR', 'boom', 500) : undefined,
    ),
  )
  const user = userEvent.setup()
  renderApp(paths.members('ws_01'))
  await user.click(await screen.findByRole('button', { name: '알림' }))
  const list = await screen.findByRole('dialog', { name: '알림 목록' })
  const retry = await within(list).findByRole('button', { name: '다시 시도' })
  fails = false
  await user.click(retry)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '알림, 읽지 않은 알림 4개' })).toBeInTheDocument(),
  )
})
