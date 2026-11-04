import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #320 — 초대받은 사람은 가입하거나 로그인한 뒤 받은 초대를 보고, 수락하면 그 공간에 들어간다.
 * invitation-pending: 비로그인이고 iv_02 가 jaehwan@example.com 으로 이재환(mb_03, ws_01)을 기다린다
 */

vi.setConfig({ testTimeout: 15_000 })

const toastOf = (title: string) => document.querySelector(`[data-toast-key="${title}"]`)

async function signUpAsInvitee() {
  db.authenticated = false
  const app = renderApp('/signup')
  await screen.findByRole('heading', { name: '회원가입' })
  await userEvent.type(screen.getByLabelText('이름'), '이재환')
  await userEvent.type(screen.getByLabelText('이메일'), 'jaehwan@example.com')
  await userEvent.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
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

  it('초대받은 이메일로 가입하면 시작 화면과 팀 확인 화면에 받은 초대가 보인다', async () => {
    await signUpAsInvitee()

    const row = await invitationRow('카테캠 3팀')
    expect(row.getByText('팀원 이름 이재환 · 초대한 사람 최진호')).toBeInTheDocument()
    expect(screen.queryByText('PM에게 가입한 이메일로 초대를 요청하세요.')).toBeNull()

    await userEvent.click(screen.getByRole('link', { name: /팀원으로 시작/ }))
    expect(
      (await invitationRow('카테캠 3팀')).getByRole('button', { name: '수락' }),
    ).toBeInTheDocument()
  })

  it('수락하면 공간 목록을 새로 받은 뒤 그 공간 대시보드로 들어가고, 일반 팀원이다', async () => {
    const app = await signUpAsInvitee()
    const log = recordRequests()

    await userEvent.click((await invitationRow('카테캠 3팀')).getByRole('button', { name: '수락' }))

    await app.expectPath(paths.dashboard('ws_01'))
    const accepted = log.timeline.indexOf('answer POST /invitations/iv_02/accept')
    expect(accepted).toBeGreaterThanOrEqual(0)
    expect(log.timeline.indexOf('start GET /workspaces', accepted)).toBeGreaterThan(accepted)
    expect(db.invitations[0]).toMatchObject({ status: 'accepted', accepted_user_id: 'us_02' })

    app.navigate(paths.members('ws_01'))
    expect(await screen.findByRole('region', { name: '이재환' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '팀원 관리' })).toBeNull()
  })

  it('거절은 먼저 묻고, 거절하면 줄이 빠지고 초대를 요청하라는 안내가 보인다', async () => {
    await signUpAsInvitee()

    await userEvent.click((await invitationRow('카테캠 3팀')).getByRole('button', { name: '거절' }))
    const dialog = within(
      await screen.findByRole('dialog', { name: '카테캠 3팀 초대를 거절할까요?' }),
    )
    await userEvent.click(dialog.getByRole('button', { name: '거절' }))

    expect(await screen.findByText('PM에게 가입한 이메일로 초대를 요청하세요.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '받은 초대' })).toBeNull()
    expect(db.invitations[0].status).toBe('declined')
  })

  it('그새 닫힌 초대를 수락하면 수락할 수 없다고 알리고 줄을 지운다', async () => {
    const app = await signUpAsInvitee()
    const accept = (await invitationRow('카테캠 3팀')).getByRole('button', { name: '수락' })
    db.invitations[0].status = 'canceled'

    await userEvent.click(accept)

    expect(await screen.findByText('PM에게 가입한 이메일로 초대를 요청하세요.')).toBeInTheDocument()
    expect(toastOf('이 초대는 더 이상 수락할 수 없어요. PM에게 문의하세요.')).not.toBeNull()
    await app.expectPath('/onboarding/start')
  })

  it('공간이 있는 사람은 선택 화면에서 초대를 보고, 이미 그 공간 팀원이면 수락 거절 없이 들어간다', async () => {
    applyScenario('multiple-workspaces')
    db.invitations.push({
      invitation_id: 'iv_05',
      workspace_id: 'ws_01',
      member_id: 'mb_03',
      email: 'pm@example.com',
      status: 'pending',
      invited_by_user_id: 'us_01',
      accepted_user_id: null,
      created_at: '2026-09-16T09:00:00Z',
      responded_at: null,
    })
    const app = renderApp(paths.workspaceSelect())

    const row = await invitationRow('카테캠 3팀')
    expect(screen.queryByText('PM에게 가입한 이메일로 초대를 요청하세요.')).toBeNull()
    await userEvent.click(row.getByRole('button', { name: '수락' }))

    await app.expectPath(paths.dashboard('ws_01'))
    await waitFor(() => expect(document.querySelector('[data-toast-key]')).toBeNull())
    expect(db.invitations.at(-1)?.status).toBe('pending')
  })
})
