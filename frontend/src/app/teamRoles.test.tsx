import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

vi.setConfig({ testTimeout: 15_000 })

const TEAM = paths.members('ws_01')
const minsu = () => db.members.find(({ member_id }) => member_id === 'mb_02')

async function openPromotion() {
  const user = userEvent.setup()
  const row = within(await screen.findByRole('region', { name: '박민수' }))
  await user.click(await row.findByRole('button', { name: 'PM 권한 부여' }))
  const dialog = within(
    await screen.findByRole('dialog', { name: '박민수에게 PM 권한을 부여할까요?' }),
  )
  return { user, dialog }
}

describe('팀 화면 PM 권한 부여', () => {
  beforeEach(() => applyScenario('team-invitations'))

  it('로그인 계정이 연결된 일반 팀원에게만 권한 부여 조작을 보인다', async () => {
    renderApp(TEAM)
    const linked = within(await screen.findByRole('region', { name: '박민수' }))
    expect(await linked.findByRole('button', { name: 'PM 권한 부여' })).toBeInTheDocument()
    for (const name of ['김서연', '이재환', '정하늘']) {
      const row = within(screen.getByRole('region', { name }))
      expect(row.queryByRole('button', { name: 'PM 권한 부여' })).toBeNull()
    }
  })

  it('영향을 확인하고 PM 권한을 부여하면 팀원 역할이 갱신되고 내 권한은 유지된다', async () => {
    renderApp(TEAM)
    const { user, dialog } = await openPromotion()
    expect(dialog.getByText(/내 PM 권한은 유지돼요/)).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'PM 권한 부여' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const row = within(screen.getByRole('region', { name: '박민수' }))
    expect(await row.findByText('PM')).toBeInTheDocument()
    expect(row.queryByRole('button', { name: 'PM 권한 부여' })).toBeNull()
    expect(minsu()?.role).toBe('pm')
    expect(db.members.find(({ member_id }) => member_id === 'mb_01')?.role).toBe('pm')
  })

  it('확인창을 닫으면 역할을 바꾸지 않는다', async () => {
    renderApp(TEAM)
    const { user, dialog } = await openPromotion()
    await user.click(dialog.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(minsu()?.role).toBe('member')
  })

  it('요청 중 중복 변경과 확인창 닫기를 막는다', async () => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.patch('/api/v1/members/mb_02', async () => {
        await released
      }),
    )
    renderApp(TEAM)
    const { user, dialog } = await openPromotion()
    const requests = recordRequests()
    await user.click(dialog.getByRole('button', { name: 'PM 권한 부여' }))
    await waitFor(() => expect(dialog.getByRole('button', { name: '닫기' })).toBeDisabled())
    await user.click(dialog.getByRole('button', { name: 'PM 권한 부여' }))
    expect(
      requests.started.filter(
        ({ method, path }) => method === 'PATCH' && path === '/members/mb_02',
      ),
    ).toHaveLength(1)
    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it.each([
    ['MEMBER_HAS_PENDING_INVITATION', /초대/],
    ['LAST_PM_REQUIRED', /PM/],
  ])('서버가 %s로 거절하면 창에서 이유를 안내하고 역할을 유지한다', async (code, message) => {
    server.use(http.patch('/api/v1/members/mb_02', () => fail(code, code, 409)))
    renderApp(TEAM)
    const { user, dialog } = await openPromotion()
    await user.click(dialog.getByRole('button', { name: 'PM 권한 부여' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent(message)
    expect(minsu()?.role).toBe('member')
    expect(dialog.getByRole('button', { name: 'PM 권한 부여' })).toBeEnabled()
  })

  it('일반 팀원 세션에는 권한 부여 조작을 보이지 않는다', async () => {
    setMockRole('member')
    renderApp(TEAM)
    await screen.findByRole('region', { name: '박민수' })
    expect(screen.queryByRole('button', { name: 'PM 권한 부여' })).toBeNull()
  })
})
