import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { now as clockNow } from '@/shared/lib/date'
import { messageSettingsQueryOptions } from '../api/messageSettings'
import { deadlineSend } from './sendTiming'
import type { DeadlineSend } from './sendTiming'
import type { NudgeRule } from './types'

export interface DeadlineSendState {
  /** 공간의 재촉 규칙. 받기 전이거나 받지 못했으면 없다 */
  rule: NudgeRule | undefined
  /** 규칙을 모르면 null 이다 — 짐작한 시각을 내지 않는다 */
  deadline: DeadlineSend | null
  ruleFailed: boolean
}

/** 마감 기준 보낼 시각. 지났는지는 처음 그린 때의 시계로 본다 */
export function useDeadlineSend(workspaceId: string, dueDate: string | null): DeadlineSendState {
  const [now] = useState(clockNow)
  const settings = useQuery(messageSettingsQueryOptions(workspaceId))
  const rule = settings.data?.nudgeRule
  return {
    rule,
    deadline: rule === undefined ? null : deadlineSend(dueDate, rule, now),
    ruleFailed: settings.isError,
  }
}
