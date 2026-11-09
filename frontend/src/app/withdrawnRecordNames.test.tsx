import { webcrypto } from 'node:crypto'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { login, withdrawAccount } from '@/entities/user'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { renderApp } from './test/renderApp'

async function leaveAndSignInAsRemainingPm() {
  applyScenario('team-invitations')
  const next = db.members.find((member) => member.member_id === 'mb_02')
  if (!next) throw new Error('next PM missing')
  next.role = 'pm'
  await withdrawAccount('9'.repeat(64), db.session.user.user_id)
  const account = db.accounts[0]
  if (!account) throw new Error('remaining PM account missing')
  await login({ email: account.session.user.email ?? '', password: account.password ?? '' })
}

describe('탈퇴한 작성자의 공동 기록 표시', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto)
    sessionStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('태스크 담당자와 변경 이력은 익명이며 담당자로 새로 선택할 수 없다', async () => {
    await leaveAndSignInAsRemainingPm()
    renderApp('/workspaces/ws_01/tasks/tk_01')
    expect(await screen.findByRole('heading', { name: '로그인 API 연동' })).toBeInTheDocument()
    expect(await screen.findAllByText('탈퇴한 사용자')).not.toHaveLength(0)
    expect(
      await screen.findByText(
        '탈퇴한 담당자에게는 재촉을 보낼 수 없어요. 새 담당자를 정해 주세요.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '재촉 만들기' })).toBeNull()
    const history = within(await screen.findByRole('list', { name: '변경 이력' }))
    expect(await history.findByText(/탈퇴한 사용자 · 직접 변경/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '담당자 수정' }))
    const picker = await screen.findByRole('combobox', { name: '담당자' })
    expect(picker).toHaveTextContent('탈퇴한 사용자')
    await userEvent.click(picker)
    expect(await screen.findByRole('option', { name: '탈퇴한 사용자' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('태스크 목록의 담당자 이름은 익명 기록 목록에서 읽는다', async () => {
    await leaveAndSignInAsRemainingPm()
    renderApp('/workspaces/ws_01/tasks?tab=all')
    expect(await screen.findAllByText('탈퇴한 사용자')).not.toHaveLength(0)
    expect(screen.queryByText('김서연')).toBeNull()
  })

  it('승인의 요청자와 처리자는 익명 이름으로 남는다', async () => {
    await leaveAndSignInAsRemainingPm()
    const approval = db.approvals[0]
    if (!approval) throw new Error('approval missing')
    approval.requested_by = 'mb_01'
    approval.resolved_by = 'mb_01'
    approval.status = 'approved'
    approval.resolved_at = '2026-11-09T00:00:00Z'
    renderApp(`/workspaces/ws_01/approvals/${approval.approval_id}`)
    expect(
      await screen.findByText('요청한 사람 탈퇴한 사용자 · 처리한 사람 탈퇴한 사용자'),
    ).toBeInTheDocument()
  })

  it('같은 익명 기록 주체는 팀 카드에는 나타나지 않는다', async () => {
    await leaveAndSignInAsRemainingPm()
    renderApp('/workspaces/ws_01/members')
    expect(await screen.findByRole('region', { name: '박민수' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '탈퇴한 사용자' })).toBeNull()
  })
})
