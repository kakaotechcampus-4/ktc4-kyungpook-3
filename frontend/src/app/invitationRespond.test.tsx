import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { list } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #320 — 초대받은 사람은 로그인한 뒤 받은 초대를 보고, 수락하면 그 공간에 들어간다.
 * invitation-pending: 비로그인이고 iv_02 가 가입자 이재환(us_03, 아이디 jaehwan)에게 팀원 이재환(mb_03, ws_01)으로 기다린다.
 * #632 — 초대는 계정에 묶여 PM 이 아이디로 찾아 보낸다
 */

vi.setConfig({ testTimeout: 15_000 })

/** 화면에 뜬 알림 중 그 문구가 보이는 것 */
const toastWith = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-toast-key]')).find((node) =>
    node.textContent?.includes(text),
  ) ?? null

async function signInAsInvitee() {
  const app = renderApp('/login')
  await userEvent.type(await screen.findByLabelText('이메일'), 'jaehwan@example.com')
  await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
  await userEvent.click(screen.getByRole('button', { name: '로그인' }))
  await app.expectPath('/onboarding/start')
  return app
}

async function invitationRow(workspaceName: string) {
  const area = within(await screen.findByRole('region', { name: '받은 초대' }))
  return within(area.getByText(workspaceName).closest('li') as HTMLElement)
}

describe('받은 초대', () => {
  beforeEach(() => {
    applyScenario('invitation-pending')
  })

  it('초대받은 계정으로 로그인하면 시작 화면과 팀 확인 화면에 받은 초대가 보인다', async () => {
    const app = await signInAsInvitee()

    const row = await invitationRow('카테캠 3팀')
    expect(row.getByText('팀원 이름 이재환 · 초대한 사람 최진호')).toBeInTheDocument()
    expect(
      screen.queryByText('PM에게 내 아이디(jaehwan)를 알려 주고 초대를 요청하세요.'),
    ).toBeNull()

    await userEvent.click(screen.getByRole('link', { name: /팀원으로 시작/ }))
    await app.expectPath('/onboarding/member')
    expect(
      (await invitationRow('카테캠 3팀')).getByRole('button', { name: '수락' }),
    ).toBeInTheDocument()
  })

  it('수락하면 공간 목록을 새로 받은 뒤 그 공간 대시보드로 들어가고, 일반 팀원이다', async () => {
    const app = await signInAsInvitee()
    const log = recordRequests()

    await userEvent.click((await invitationRow('카테캠 3팀')).getByRole('button', { name: '수락' }))

    await app.expectPath(paths.dashboard('ws_01'))
    const accepted = log.timeline.indexOf('answer POST /invitations/iv_02/accept')
    expect(accepted).toBeGreaterThanOrEqual(0)
    expect(log.timeline.indexOf('start GET /workspaces', accepted)).toBeGreaterThan(accepted)
    expect(db.invitations[0]).toMatchObject({ status: 'accepted', accepted_user_id: 'us_03' })

    app.navigate(paths.members('ws_01'))
    expect(await screen.findByRole('region', { name: '이재환' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '팀원 관리' })).toBeNull()
  })

  it('수락 전에 시작한 목록 다시 확인이 늦게 끝나도 수락 뒤 새로 받은 목록으로 그 공간에 들어간다', async () => {
    const app = await signInAsInvitee()
    await userEvent.click(screen.getByRole('link', { name: /팀원으로 시작/ }))
    await invitationRow('카테캠 3팀')
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get(
        '/api/v1/workspaces',
        async () => {
          const beforeAccept = list([])
          await released
          return beforeAccept
        },
        { once: true },
      ),
    )
    const log = recordRequests()

    await userEvent.click(screen.getByRole('button', { name: '목록 다시 확인' }))
    await waitFor(() => expect(log.timeline).toContain('start GET /workspaces'))
    await userEvent.click((await invitationRow('카테캠 3팀')).getByRole('button', { name: '수락' }))
    await waitFor(() => expect(log.timeline).toContain('answer POST /invitations/iv_02/accept'))
    release()

    await app.expectPath(paths.dashboard('ws_01'))
    expect(screen.queryByText('이 초대는 더 이상 수락할 수 없어요. PM에게 문의하세요.')).toBeNull()
  })

  it('거절은 먼저 묻고, 거절하면 줄이 빠지고 초대를 요청하라는 안내가 보인다', async () => {
    await signInAsInvitee()

    await userEvent.click((await invitationRow('카테캠 3팀')).getByRole('button', { name: '거절' }))
    const dialog = within(
      await screen.findByRole('dialog', { name: '카테캠 3팀 초대를 거절할까요?' }),
    )
    await userEvent.click(dialog.getByRole('button', { name: '거절' }))

    expect(
      await screen.findByText('PM에게 내 아이디(jaehwan)를 알려 주고 초대를 요청하세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '받은 초대' })).toBeNull()
    expect(db.invitations[0].status).toBe('declined')
  })

  it('그새 닫힌 초대를 수락하면 수락할 수 없다고 알리고 줄을 지운다', async () => {
    const app = await signInAsInvitee()
    const accept = (await invitationRow('카테캠 3팀')).getByRole('button', { name: '수락' })
    db.invitations[0].status = 'canceled'

    await userEvent.click(accept)

    expect(
      await screen.findByText('PM에게 내 아이디(jaehwan)를 알려 주고 초대를 요청하세요.'),
    ).toBeInTheDocument()
    expect(toastWith('이 초대는 더 이상 수락할 수 없어요. PM에게 문의하세요.')).not.toBeNull()
    await app.expectPath('/onboarding/start')
  })

  it('공간이 있는 사람은 선택 화면에서 초대를 보고, 이미 그 공간 팀원이면 수락 거절 없이 들어간다', async () => {
    applyScenario('multiple-workspaces')
    db.invitations.push({
      invitation_id: 'iv_05',
      workspace_id: 'ws_01',
      member_id: 'mb_03',
      invited_user_id: 'us_01',
      status: 'pending',
      invited_by_user_id: 'us_01',
      accepted_user_id: null,
      created_at: '2026-09-16T09:00:00Z',
      responded_at: null,
    })
    const app = renderApp(paths.workspaceSelect())

    const row = await invitationRow('카테캠 3팀')
    expect(screen.queryByText('PM에게 내 아이디(userpm)를 알려 주고 초대를 요청하세요.')).toBeNull()
    await userEvent.click(row.getByRole('button', { name: '수락' }))

    await app.expectPath(paths.dashboard('ws_01'))
    await waitFor(() => expect(document.querySelector('[data-toast-key]')).toBeNull())
    expect(db.invitations.at(-1)?.status).toBe('pending')
  })
})
