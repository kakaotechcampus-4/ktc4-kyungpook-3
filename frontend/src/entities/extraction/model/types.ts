import type { ExtractionEvidence } from '@/shared/types/common'
export type { ExtractionEvidence } from '@/shared/types/common'
export type ExtractionGate = 'auto' | 'review' | 'hold'
export interface ExtractionItem {
  id: string
  title: string
  confidence: number
  gate: ExtractionGate
  assigneeMemberId: string | null
  assigneeLabel: string
  dueDate: string | null
  dueRaw: string | null
  evidence: ExtractionEvidence
  appliedTaskId: string | null
  approvalId: string | null
}
export interface Extraction {
  id: string
  meetingId: string
  items: ExtractionItem[]
}
