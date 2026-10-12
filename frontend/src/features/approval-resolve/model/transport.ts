import type { ApprovalTransport } from '@/entities/approval'
import { config } from '@/shared/config/env'

/**
 * 승인 처리 요청이 가는 곳. 개발 서버이고 MSW 를 켰을 때만 `msw` 다 (계획 §1-6).
 * 미합의 보완 입력(`task_overrides`)과 `보완하기` 는 `msw` 에서만 쓴다. 실 API 는 `live` 다
 */
export function currentApprovalTransport(): ApprovalTransport {
  return import.meta.env.DEV && config.mswEnabled ? 'msw' : 'live'
}
