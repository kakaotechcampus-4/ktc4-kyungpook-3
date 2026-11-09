import { z } from 'zod'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'

const workspaceSchema = z.object({
  workspace_id: z.string(),
  workspace_name: z.string(),
  disposition: z.enum(['preserve', 'delete', 'transfer_pm']),
})
const planSchema = z.object({
  workspaces: z.array(workspaceSchema),
  blocked_workspace_ids: z.array(z.string()),
})
const receiptSchema = z.object({
  withdrawal_id: z.string(),
  account_deleted_at: z.string(),
  cleanup_status: z.enum(['pending', 'complete']),
})

export type WithdrawalPlan = z.infer<typeof planSchema>
export type WithdrawalReceipt = z.infer<typeof receiptSchema>

export async function fetchWithdrawalPlan(signal?: AbortSignal): Promise<WithdrawalPlan> {
  return parseResponse(
    planSchema,
    await request<unknown>('/auth/withdrawal-plan', { signal }),
    'user',
  )
}

export async function withdrawAccount(key: string, accountId: string): Promise<WithdrawalReceipt> {
  return parseResponse(
    receiptSchema,
    await request<unknown>('/auth/me', {
      method: 'DELETE',
      headers: { 'X-Withdrawal-Key': key, 'X-Withdrawal-Account-ID': accountId },
    }),
    'user',
  )
}

export async function fetchWithdrawalReceipt(
  id: string,
  key: string,
  signal?: AbortSignal,
): Promise<WithdrawalReceipt> {
  return parseResponse(
    receiptSchema,
    await request<unknown>(`/auth/withdrawals/${encodeURIComponent(id)}`, {
      signal,
      notifyUnauthorized: false,
      headers: { 'X-Withdrawal-Key': key },
    }),
    'user',
  )
}
