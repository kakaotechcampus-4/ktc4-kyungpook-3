import { http } from 'msw'
import { z } from 'zod'
import { db } from '../db'
import { requireAuth } from '../auth-guard'
import { fail, ok } from '../envelope'
import { isMemberOf, linkedUserIdOf, normalizeEmail, roleIn, sessionMemberId } from '../sessions'

function plan() {
  const workspaces = db.workspaces
    .filter(({ workspace_id }) => isMemberOf(workspace_id))
    .map((workspace) => {
      const members = db.members.filter(
        (member) =>
          member.workspace_id === workspace.workspace_id &&
          !db.withdrawnMemberIds.includes(member.member_id),
      )
      const own = sessionMemberId(workspace.workspace_id)
      const otherPm = members.some(
        (member) =>
          member.member_id !== own &&
          member.role === 'pm' &&
          linkedUserIdOf(member.member_id) !== null,
      )
      const disposition =
        members.length <= 1
          ? 'delete'
          : roleIn(workspace.workspace_id) === 'pm' && !otherPm
            ? 'transfer_pm'
            : 'preserve'
      return { workspace_id: workspace.workspace_id, workspace_name: workspace.name, disposition }
    })
  return {
    workspaces,
    blocked_workspace_ids: workspaces
      .filter((workspace) => workspace.disposition === 'transfer_pm')
      .map((workspace) => workspace.workspace_id),
  }
}

async function proofHash(request: Request): Promise<string | null> {
  const proof = request.headers.get('X-Withdrawal-Key')
  if (proof === null || !/^[a-f0-9]{64}$/.test(proof)) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function eraseApprovalActors(payload: Record<string, unknown>, memberIds: ReadonlySet<string>) {
  if (typeof payload.assignee_member_id === 'string' && memberIds.has(payload.assignee_member_id))
    payload.assignee_raw = null
  if (
    typeof payload.evidence_speaker_member_id === 'string' &&
    memberIds.has(payload.evidence_speaker_member_id)
  )
    payload.evidence_speaker = null
  if (Array.isArray(payload.merged_items)) {
    for (const part of z.array(z.unknown()).parse(payload.merged_items)) {
      if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
        const parsed = z.record(z.string(), z.unknown()).parse(part)
        eraseApprovalActors(parsed, memberIds)
        Object.assign(part, parsed)
      }
    }
  }
}

export const withdrawalHandlers = [
  http.get('/api/v1/auth/withdrawal-plan', () => requireAuth() ?? ok(plan())),
  http.delete('/api/v1/auth/me', async ({ request }) => {
    const keyHash = await proofHash(request)
    if (keyHash === null) return fail('INVALID_REQUEST', '재시도 키가 필요합니다.', 400)
    const prior = db.withdrawals.find((entry) => entry.keyHash === keyHash)
    if (prior) return ok(prior.receipt, { status: 202 })
    const denied = requireAuth()
    if (denied) return denied
    if (request.headers.get('X-Withdrawal-Account-ID') !== db.session.user.user_id)
      return fail('WITHDRAWAL_ACCOUNT_CHANGED', '로그인 계정이 변경됐습니다.', 409)
    const before = plan()
    if (before.blocked_workspace_ids.length)
      return fail('LAST_PM_REQUIRED', 'PM 권한을 먼저 이전해 주세요.', 409, {
        workspace_ids: before.blocked_workspace_ids,
      })
    const userId = db.session.user.user_id
    const email = normalizeEmail(db.session.user.email)
    const memberIds = new Set(
      db.members
        .filter((member) => linkedUserIdOf(member.member_id) === userId)
        .map((member) => member.member_id),
    )
    const deleted = new Set(
      before.workspaces
        .filter((workspace) => workspace.disposition === 'delete')
        .map((workspace) => workspace.workspace_id),
    )
    for (const member of db.members) {
      if (!memberIds.has(member.member_id)) continue
      member.display_name = '탈퇴한 사용자'
      member.discord_user_id = null
      member.notion_name = null
      member.has_login_account = false
      member.role = 'member'
    }
    db.withdrawnMemberIds.push(...memberIds)
    db.aliases = db.aliases.filter((alias) => !memberIds.has(alias.member_id))
    for (const approval of db.approvals) eraseApprovalActors(approval.payload, memberIds)
    for (const extraction of db.extractions) {
      for (const item of extraction.items) {
        if (item.assignee.member_id !== null && memberIds.has(item.assignee.member_id)) {
          item.assignee.raw = null
          item.assignee.display_name = '탈퇴한 사용자'
        }
        if (
          item.evidence.speaker_member_id !== null &&
          memberIds.has(item.evidence.speaker_member_id)
        )
          item.evidence.speaker = null
      }
    }
    for (const thread of db.messageThreads) {
      if (memberIds.has(thread.member_id)) thread.name = '탈퇴한 사용자'
    }
    db.invitations = db.invitations.filter(
      (invitation) =>
        invitation.email !== email &&
        invitation.accepted_user_id !== userId &&
        !memberIds.has(invitation.member_id),
    )
    for (const invitation of db.invitations)
      if (invitation.invited_by_user_id === userId) invitation.invited_by_user_id = null
    db.consents = db.consents.filter((consent) => consent.user_id !== userId)
    db.accounts = db.accounts.filter((account) => account.session.user.user_id !== userId)
    db.passwordReset.tokens = db.passwordReset.tokens.filter((token) => token.email !== email)
    db.passwordReset.outbox = db.passwordReset.outbox.filter((mail) => mail.to !== email)
    delete db.signupVerification.codes[email]
    db.signupVerification.outbox = db.signupVerification.outbox.filter((mail) => mail.to !== email)
    for (const [proof, value] of Object.entries(db.signupVerification.proofs))
      if (value.email === email) delete db.signupVerification.proofs[proof]
    delete db.loginLimit[email]
    db.workspaces = db.workspaces.filter((workspace) => !deleted.has(workspace.workspace_id))
    db.members = db.members.filter((member) => !deleted.has(member.workspace_id))
    db.meetings = db.meetings.filter((meeting) => !deleted.has(meeting.workspace_id))
    db.tasks = db.tasks.filter((task) => !deleted.has(task.workspace_id))
    db.messageThreads = db.messageThreads.filter((thread) => !deleted.has(thread.workspace_id))
    db.messageBundles = db.messageBundles.filter((bundle) => !deleted.has(bundle.workspace_id))
    for (const workspaceId of deleted) delete db.integrations[workspaceId]
    db.authenticated = false
    db.kakao.pending = null
    db.push.subscriptions = db.push.subscriptions.filter(
      (subscription) => subscription.user_id !== userId,
    )
    db.session = {
      user: { user_id: '', name: '탈퇴한 사용자', email: '', avatar_url: null },
      workspace_count: 0,
      last_workspace_id: null,
    }
    const receipt = {
      withdrawal_id: crypto.randomUUID(),
      account_deleted_at: new Date().toISOString(),
      cleanup_status: 'pending' as const,
    }
    db.withdrawals.push({ keyHash, receipt, checks: 0 })
    return ok(receipt, { status: 202 })
  }),
  http.get('/api/v1/auth/withdrawals/:id', async ({ request, params }) => {
    const keyHash = await proofHash(request)
    const entry = db.withdrawals.find(
      (record) => record.receipt.withdrawal_id === params.id && record.keyHash === keyHash,
    )
    if (!entry) return fail('UNAUTHENTICATED', '확인할 수 없는 요청입니다.', 401)
    entry.checks += 1
    if (entry.checks >= 2) entry.receipt.cleanup_status = 'complete'
    return ok(entry.receipt)
  }),
]
