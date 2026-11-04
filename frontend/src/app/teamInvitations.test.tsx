import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #320 — PM 이 팀 화면에서 로그인 계정 없는 팀원을 가입 이메일로 초대하고, 팀원마다 최근 초대 상태를 본다.
 * team-invitations: 박민수 수락(us_02), 이재환 대기(그 전에 취소한 초대가 하나 더 있다), 정하늘 거절, 김서연은 PM
 */

vi.setConfig({ testTimeout: 15_000 })

const TEAM = paths.members('ws_01')

async function row(name: string) {
  return within(await screen.findByRole('region', { name }))
}

/** 화면에 뜬 알림 중 그 문구가 보이는 것 */
const toastWith = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-toast-key]')).find((node) =>
    node.textContent?.includes(text),
  ) ?? null

const invitationOf = (invitationId: string) =>
  db.invitations.find(({ invitation_id }) => invitation_id === invitationId)

describe('팀 화면 — 팀원 초대', () => {
  beforeEach(() => {
    applyScenario('team-invitations')
  })

  it('팀원마다 최근 초대의 상태와 이메일, 할 수 있는 조작을 보인다', async () => {
    renderApp(TEAM)

    const jaehwan = await row('이재환')
    expect(await jaehwan.findByText('대기')).toBeInTheDocument()
    expect(jaehwan.getByText('jaehwan@example.com')).toBeInTheDocument()
    expect(jaehwan.queryByText('jaehwan@exmaple.com')).toBeNull()
    expect(jaehwan.getByRole('button', { name: '다시 초대' })).toBeInTheDocument()
    expect(jaehwan.getByRole('button', { name: '초대 취소' })).toBeInTheDocument()

    const minsu = await row('박민수')
    expect(minsu.getByText('수락')).toBeInTheDocument()
    expect(minsu.getByText('박민수 · minsu@example.com')).toBeInTheDocument()
    expect(minsu.getByRole('button', { name: '연결 끊기' })).toBeInTheDocument()
    expect(minsu.queryByRole('button', { name: /초대/ })).toBeNull()

    const haneul = await row('정하늘')
    expect(haneul.getByText('거절')).toBeInTheDocument()
    expect(haneul.getByText('haneul@example.com')).toBeInTheDocument()
    expect(haneul.getByRole('button', { name: '다시 초대' })).toBeInTheDocument()

    const seoyeon = await row('김서연')
    expect(seoyeon.queryByRole('button')).toBeNull()
    expect(seoyeon.queryByText(/^(대기|수락|거절|취소|연결 끊김)$/)).toBeNull()
  })

  it('초대한 적 없는 팀원은 `초대` 만 있다', async () => {
    applyScenario('settings-unmapped')
    renderApp(TEAM)

    const jaehwan = await row('이재환')
    expect(await jaehwan.findByRole('button', { name: '초대' })).toBeInTheDocument()
    expect(jaehwan.queryByText(/^(대기|수락|거절|취소|연결 끊김)$/)).toBeNull()
  })

  it('다시 초대하면 기다리던 초대가 취소되고 새 이메일로 대기가 된다', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    await user.click(await (await row('이재환')).findByRole('button', { name: '다시 초대' }))

    const dialog = within(await screen.findByRole('dialog', { name: '이재환 초대' }))
    expect(
      dialog.getByText('기다리는 초대(jaehwan@example.com)는 취소되고 새 초대가 만들어져요.'),
    ).toBeInTheDocument()
    await user.type(dialog.getByLabelText('가입 이메일'), ' JH.Lee@Example.com ')
    await user.click(dialog.getByRole('button', { name: '초대하기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const jaehwan = await row('이재환')
    expect(await jaehwan.findByText('jh.lee@example.com')).toBeInTheDocument()
    expect(jaehwan.getByText('대기')).toBeInTheDocument()
    expect(toastWith('초대를 만들었어요')).toHaveTextContent(
      '메일은 가지 않아요. 이재환에게 JH.Lee@Example.com로 가입하거나 로그인하라고 알려 주세요.',
    )
    expect(invitationOf('iv_02')?.status).toBe('canceled')
    expect(
      db.invitations.filter(
        ({ member_id, status }) => member_id === 'mb_03' && status === 'pending',
      ),
    ).toMatchObject([{ email: 'jh.lee@example.com', invited_by_user_id: 'us_01' }])
  })

  it('초대를 보내는 동안에는 이메일을 고칠 수 없고 한 번만 보낸다', async () => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('/api/v1/workspaces/:workspaceId/invitations', async () => {
        await released
      }),
    )
    const user = userEvent.setup()
    renderApp(TEAM)
    const log = recordRequests()
    await user.click(await (await row('정하늘')).findByRole('button', { name: '다시 초대' }))

    const dialog = within(await screen.findByRole('dialog', { name: '정하늘 초대' }))
    const field = dialog.getByLabelText('가입 이메일')
    await user.type(field, 'haneul2@example.com')
    await user.click(dialog.getByRole('button', { name: '초대하기' }))
    await waitFor(() => expect(field).toBeDisabled())
    await user.type(field, 'x')
    await user.click(dialog.getByRole('button', { name: '초대하기' }))

    expect(field).toHaveValue('haneul2@example.com')
    expect(dialog.getByRole('button', { name: '초대하기' })).toBeDisabled()
    expect(
      log.started.filter(
        ({ method, path }) => method === 'POST' && path === '/workspaces/ws_01/invitations',
      ),
    ).toHaveLength(1)
    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      log.started.filter(
        ({ method, path }) => method === 'POST' && path === '/workspaces/ws_01/invitations',
      ),
    ).toHaveLength(1)
  })

  it('`초대 취소` 는 묻지 않고 취소하고, 그 팀원은 다시 초대할 수 있다', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    const jaehwan = await row('이재환')
    await user.click(await jaehwan.findByRole('button', { name: '초대 취소' }))

    expect(await jaehwan.findByText('취소')).toBeInTheDocument()
    expect(jaehwan.queryByRole('button', { name: '초대 취소' })).toBeNull()
    expect(jaehwan.getByRole('button', { name: '다시 초대' })).toBeInTheDocument()
    expect(toastWith('초대를 취소했어요')).not.toBeNull()
    expect(invitationOf('iv_02')?.status).toBe('canceled')
  })

  it('`연결 끊기` 는 먼저 묻고, 끊으면 연결 끊김이 되어 다시 초대할 수 있다', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    await user.click(await (await row('박민수')).findByRole('button', { name: '연결 끊기' }))

    const dialog = within(
      await screen.findByRole('dialog', { name: '박민수의 계정 연결을 끊을까요?' }),
    )
    expect(dialog.getByText(/^박민수\(minsu@example\.com\) 계정은/)).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(invitationOf('iv_01')?.status).toBe('accepted')

    await user.click((await row('박민수')).getByRole('button', { name: '연결 끊기' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '연결 끊기' }),
    )

    const minsu = await row('박민수')
    expect(await minsu.findByText('연결 끊김')).toBeInTheDocument()
    expect(minsu.getByRole('button', { name: '다시 초대' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toastWith('계정 연결을 끊었어요')).not.toBeNull()
    expect(invitationOf('iv_01')?.status).toBe('revoked')
  })

  it('다른 팀원에게 기다리는 초대가 있는 이메일은 창 안에 이유를 보이고 아무것도 만들지 않는다', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    await user.click(await (await row('정하늘')).findByRole('button', { name: '다시 초대' }))
    const before = structuredClone(db.invitations)

    const dialog = within(await screen.findByRole('dialog', { name: '정하늘 초대' }))
    await user.type(dialog.getByLabelText('가입 이메일'), 'jaehwan@example.com')
    await user.click(dialog.getByRole('button', { name: '초대하기' }))

    expect(
      await dialog.findByText(
        '이 이메일로 다른 팀원에게 보낸 초대가 기다리고 있어요. 그 초대를 먼저 취소해 주세요.',
      ),
    ).toBeInTheDocument()
    expect(dialog.getByLabelText('가입 이메일')).toHaveAttribute('aria-invalid', 'true')
    expect(db.invitations).toEqual(before)
  })

  it('이메일 형식이 틀리면 요청을 보내지 않는다', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    const log = recordRequests()
    await user.click(await (await row('정하늘')).findByRole('button', { name: '다시 초대' }))

    const dialog = within(await screen.findByRole('dialog', { name: '정하늘 초대' }))
    await user.type(dialog.getByLabelText('가입 이메일'), 'haneul.example.com')
    await user.click(dialog.getByRole('button', { name: '초대하기' }))

    expect(await dialog.findByText('이메일 형식을 확인해 주세요.')).toBeInTheDocument()
    expect(log.started.filter(({ method }) => method === 'POST')).toEqual([])
  })

  it('이미 계정이 연결된 팀원이라는 거절도 창 안에 보인다', async () => {
    server.use(
      http.post('/api/v1/workspaces/:workspaceId/invitations', () =>
        fail('MEMBER_ALREADY_LINKED', 'linked', 409),
      ),
    )
    const user = userEvent.setup()
    renderApp(TEAM)
    await user.click(await (await row('정하늘')).findByRole('button', { name: '다시 초대' }))

    const dialog = within(await screen.findByRole('dialog', { name: '정하늘 초대' }))
    await user.type(dialog.getByLabelText('가입 이메일'), 'haneul2@example.com')
    await user.click(dialog.getByRole('button', { name: '초대하기' }))

    expect(await dialog.findByText('이미 로그인 계정이 연결된 팀원이에요.')).toBeInTheDocument()
  })

  it('그새 처리된 초대를 취소하면 알리고 최신 상태로 바꾼다', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    const jaehwan = await row('이재환')
    const cancel = await jaehwan.findByRole('button', { name: '초대 취소' })
    const stale = invitationOf('iv_02')
    if (stale) stale.status = 'declined'

    await user.click(cancel)

    expect(await jaehwan.findByText('거절')).toBeInTheDocument()
    expect(toastWith('이미 처리된 초대예요.')).not.toBeNull()
  })
})
