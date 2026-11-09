import { webcrypto } from 'node:crypto'
import { onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { z } from 'zod'
import {
  SESSION_QUERY_KEY,
  advanceSessionGeneration,
  login,
  withdrawAccount,
} from '@/entities/user'
import { request } from '@/shared/api/client'
import {
  WITHDRAWAL_STORAGE_KEY,
  readWithdrawalProof,
  saveWithdrawalProof,
} from '@/features/auth/model/withdrawalProof'
import { ApiError } from '@/shared/api/errors'
import { workspaceKey } from '@/shared/api/queryKeys'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'
import { walkSignup } from './test/walkSignup'
import { installPushBrowser } from './test/pushBrowser'

vi.setConfig({ testTimeout: 15_000 })

function readyAccount() {
  applyScenario('team-invitations')
  const otherPm = db.members.find((member) => member.member_id === 'mb_02')
  if (!otherPm) throw new Error('linked teammate missing')
  otherPm.role = 'pm'
}

async function confirmWithdrawal() {
  await userEvent.click(
    await screen.findByRole('checkbox', { name: '삭제 범위와 새 초대가 필요함을 확인했어요.' }),
  )
  await userEvent.click(screen.getByRole('button', { name: '계정 탈퇴하기' }))
}

describe('계정 탈퇴', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubGlobal('crypto', webcrypto)
  })
  afterEach(() => {
    onlineManager.setOnline(true)
    sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('오프라인으로 멈춘 탈퇴는 로그아웃 뒤 같은 계정으로 다시 로그인한 세션에서 나가지 않는다 (#594)', async () => {
    readyAccount()
    const app = renderApp('/account/withdrawal')
    const log = recordRequests()
    await userEvent.click(
      await screen.findByRole('checkbox', { name: '삭제 범위와 새 초대가 필요함을 확인했어요.' }),
    )
    onlineManager.setOnline(false)
    await userEvent.click(screen.getByRole('button', { name: '계정 탈퇴하기' }))
    await waitFor(() =>
      expect(app.queryClient.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true),
    )

    // 로그아웃과 같은 계정의 다시 로그인이 세션 세대를 두 번 올린다. 서버의 계정 ID 검사는 같은 계정을 가르지 못한다
    act(() => {
      advanceSessionGeneration()
      advanceSessionGeneration()
    })
    onlineManager.setOnline(true)

    await waitFor(() => expect(app.queryClient.isMutating()).toBe(0))
    expect(log.timeline).not.toContain('start DELETE /auth/me')
    expect(db.withdrawals).toHaveLength(0)
    expect(db.authenticated).toBe(true)
    expect(screen.queryByText('탈퇴 요청이 거절됐어요. 계정은 변경되지 않았어요.')).toBeNull()
  })

  it('마지막 PM이면 권한 이전을 안내하고 계정과 캐시를 유지한다', async () => {
    applyScenario('team-invitations')
    const app = renderApp('/account/withdrawal')
    expect(await screen.findByRole('link', { name: '팀에서 권한 이전하기' })).toHaveAttribute(
      'href',
      '/workspaces/ws_01/members',
    )
    expect(screen.getByRole('button', { name: '계정 탈퇴하기' })).toBeDisabled()
    expect(db.authenticated).toBe(true)
    expect(db.withdrawals).toHaveLength(0)
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).not.toBeNull()
  })

  it('성공한 뒤에만 인증 캐시를 지우고 공동 작성자를 익명으로 남긴다', async () => {
    readyAccount()
    const browser = installPushBrowser({ permission: 'granted', subscribed: true })
    const ownId = db.session.user.user_id
    const originalTasks = db.tasks.map((task) => task.task_id)
    const app = renderApp('/account/withdrawal')
    app.queryClient.setQueryData(workspaceKey('ws_01', 'private'), 'private payload')
    await confirmWithdrawal()
    expect(await screen.findByRole('heading', { name: '개인정보 정리 중' })).toBeInTheDocument()
    expect(db.authenticated).toBe(false)
    expect(db.accounts.some((account) => account.session.user.user_id === ownId)).toBe(false)
    expect(db.members.find((member) => member.member_id === 'mb_01')).toMatchObject({
      display_name: '탈퇴한 사용자',
      discord_user_id: null,
      notion_name: null,
    })
    expect(db.tasks.map((task) => task.task_id)).toEqual(originalTasks)
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull()
    expect(app.queryClient.getQueryData(workspaceKey('ws_01', 'private'))).toBeUndefined()
    await waitFor(() => expect(browser.subscription.unsubscribe).toHaveBeenCalledOnce())
    expect(readWithdrawalProof()).toMatchObject({
      kind: 'receipt',
    })
    expect(
      await screen.findByRole('heading', { name: '탈퇴 완료' }, { timeout: 10_000 }),
    ).toBeInTheDocument()
  })

  it('조건이 요청 직전에 바뀌어 거절되면 인증과 푸시를 건드리지 않는다', async () => {
    readyAccount()
    const browser = installPushBrowser({ permission: 'granted', subscribed: true })
    const beforeAccounts = structuredClone(db.accounts)
    const app = renderApp('/account/withdrawal')
    server.use(
      http.delete('/api/v1/auth/me', () =>
        fail('LAST_PM_REQUIRED', '이전 필요', 409, { workspace_ids: ['ws_01'] }),
      ),
    )
    await confirmWithdrawal()
    expect(
      await screen.findByText('PM 조건이 바뀌었어요. 권한 이전 후 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    expect(db.accounts).toEqual(beforeAccounts)
    expect(db.authenticated).toBe(true)
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).not.toBeNull()
    expect(sessionStorage.getItem(WITHDRAWAL_STORAGE_KEY)).toBeNull()
    expect(browser.subscription.unsubscribe).not.toHaveBeenCalled()
  })

  it('네트워크 실패 뒤 같은 proof로 다시 요청하고 계정 삭제를 한 번만 처리한다', async () => {
    readyAccount()
    let firstKey = ''
    server.use(
      http.delete('/api/v1/auth/me', ({ request }) => {
        firstKey = request.headers.get('X-Withdrawal-Key') ?? ''
        return HttpResponse.error()
      }),
    )
    renderApp('/account/withdrawal')
    await confirmWithdrawal()
    expect(
      await screen.findByRole('heading', { name: '처리 결과를 확인해 주세요' }),
    ).toBeInTheDocument()
    expect(db.authenticated).toBe(true)
    const proof = readWithdrawalProof()
    expect(firstKey).toHaveLength(64)
    expect(proof?.key).toBe(firstKey)
    server.resetHandlers()
    await userEvent.click(screen.getByRole('button', { name: '처리 결과 다시 확인' }))
    expect(await screen.findByRole('heading', { name: '개인정보 정리 중' })).toBeInTheDocument()
    expect(db.withdrawals).toHaveLength(1)
  })

  it('성공 응답을 잃어도 로그인이 없는 같은 proof 재시도는 같은 영수증이다', async () => {
    readyAccount()
    const key = 'a'.repeat(64)
    const owner = db.session.user.user_id
    const first = await withdrawAccount(key, owner)
    expect(db.authenticated).toBe(false)
    const again = await withdrawAccount(key, owner)
    expect(again.withdrawal_id).toBe(first.withdrawal_id)
    expect(db.withdrawals).toHaveLength(1)
  })

  it('새로고침으로 돌아와도 인증 없이 저장한 영수증을 계속 확인한다', async () => {
    readyAccount()
    const key = 'b'.repeat(64)
    const result = await withdrawAccount(key, db.session.user.user_id)
    saveWithdrawalProof({ kind: 'receipt', key, id: result.withdrawal_id })
    renderApp('/account/withdrawal')
    expect(await screen.findByRole('heading', { name: '개인정보 정리 중' })).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: '탈퇴 완료' }, { timeout: 8000 }),
    ).toBeInTheDocument()
  })

  it('미완료 요청의 원래 계정과 다른 계정이면 재시도하지 않는다', async () => {
    readyAccount()
    saveWithdrawalProof({ kind: 'request', key: 'c'.repeat(64), accountId: 'another-account' })
    renderApp('/account/withdrawal')
    expect(
      await screen.findByText(
        '다른 계정으로 로그인됐어요. 이전 요청으로 현재 계정을 탈퇴시키지 않아요.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '처리 결과 다시 확인' })).toBeDisabled()
    expect(db.withdrawals).toHaveLength(0)
    expect(db.authenticated).toBe(true)
  })

  it('서버도 기대 계정이 다르면 다른 계정을 삭제하지 않는다', async () => {
    readyAccount()
    await expect(withdrawAccount('d'.repeat(64), 'another-account')).rejects.toMatchObject({
      code: 'WITHDRAWAL_ACCOUNT_CHANGED',
    } satisfies Partial<ApiError>)
    expect(db.authenticated).toBe(true)
    expect(db.withdrawals).toHaveLength(0)
  })

  it('잘못된 영수증 proof는 완료로 표시하거나 현재 로그인 계정을 종료하지 않는다', async () => {
    readyAccount()
    saveWithdrawalProof({ kind: 'receipt', key: 'e'.repeat(64), id: 'unknown-receipt' })
    const app = renderApp('/account/withdrawal')
    expect(await screen.findByText(/이 요청의 처리 상태를 확인하지 못했어요/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '탈퇴 완료' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '개인정보 정리 중' })).toBeNull()
    expect(db.authenticated).toBe(true)
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).not.toBeNull()
  })

  it('남은 PM의 활성 팀원 목록에서 익명 작성자는 제외하고 다시 수정하거나 초대할 수 없다', async () => {
    readyAccount()
    await withdrawAccount('f'.repeat(64), db.session.user.user_id)
    const remaining = db.accounts[0]
    if (!remaining) throw new Error('remaining PM missing')
    await login({ email: remaining.session.user.email, password: remaining.password })
    const members = z
      .object({ items: z.array(z.object({ member_id: z.string() })) })
      .parse(await request<unknown>('/members', { params: { workspace_id: 'ws_01' } }))
    expect(members.items.map((member) => member.member_id)).not.toContain('mb_01')
    await expect(
      request('/members/mb_01', { method: 'PATCH', body: { display_name: '복원' } }),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' })
    await expect(
      request('/workspaces/ws_01/invitations', {
        method: 'POST',
        body: { member_id: 'mb_01', email: 'fresh@example.com' },
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' })
    expect(db.members.find((member) => member.member_id === 'mb_01')?.display_name).toBe(
      '탈퇴한 사용자',
    )
  })

  it('같은 이메일 재가입은 새 사용자이며 옛 팀과 초대를 복구하지 않는다', async () => {
    readyAccount()
    const email = db.session.user.email
    const oldId = db.session.user.user_id
    const app = renderApp('/account/withdrawal')
    await confirmWithdrawal()
    await screen.findByRole('heading', { name: '개인정보 정리 중' })
    await userEvent.click(screen.getByRole('link', { name: '새 계정 만들기' }))
    await screen.findByRole('heading', { name: '회원가입' })
    await walkSignup({ name: '새 계정', email, password: 'new-password123' })
    await app.expectPath('/onboarding/start')
    expect(db.session.user.user_id).not.toBe(oldId)
    expect(db.session.workspace_count).toBe(0)
    expect(
      db.accounts.find((account) => account.session.user.user_id === db.session.user.user_id)
        ?.workspaceIds,
    ).toEqual([])
    expect(db.invitations.some((invitation) => invitation.email === email)).toBe(false)
    expect(await screen.findByText('PM에게 가입한 이메일로 초대를 요청하세요.')).toBeInTheDocument()
  })

  it('공개 사용자 메뉴에서 탈퇴 화면으로 이동할 수 있다', async () => {
    readyAccount()
    const app = renderApp('/workspaces/ws_01/members')
    await userEvent.click(await screen.findByRole('button', { name: /내 계정:/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '계정 탈퇴' }))
    await app.expectPath('/account/withdrawal')
    expect(await screen.findByRole('heading', { name: '계정 탈퇴', level: 1 })).toBeInTheDocument()
  })
})
