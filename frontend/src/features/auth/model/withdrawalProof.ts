import { z } from 'zod'

export const WITHDRAWAL_STORAGE_KEY = 'account-withdrawal-v1'
const keySchema = z.string().regex(/^[a-f0-9]{64}$/)
const proofSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request'), key: keySchema, accountId: z.string().min(1) }),
  z.object({ kind: z.literal('receipt'), key: keySchema, id: z.string().min(1).max(200) }),
])
export type WithdrawalProof = z.infer<typeof proofSchema>

export function readWithdrawalProof(): WithdrawalProof | null {
  try {
    const raw = sessionStorage.getItem(WITHDRAWAL_STORAGE_KEY)
    if (raw === null) return null
    const parsed = proofSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveWithdrawalProof(proof: WithdrawalProof): void {
  sessionStorage.setItem(WITHDRAWAL_STORAGE_KEY, JSON.stringify(proof))
}

export function clearWithdrawalProof(): void {
  try {
    sessionStorage.removeItem(WITHDRAWAL_STORAGE_KEY)
  } catch {
    return
  }
}

export function createWithdrawalKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('')
}
