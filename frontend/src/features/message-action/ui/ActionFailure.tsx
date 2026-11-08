import { QueryErrorState } from '@/shared/ui/query-error-state'
import { actionTarget } from '../model/useMessageAction'
import type { MessageAction } from '@/entities/message'
import type { MessageActionControl } from '../model/useMessageAction'

/**
 * 행동 실패를 행동 가까이에 알린다 (role=alert). 다시 시도하면 같은 요청을 다시 보낸다.
 * 화면이 따로 다루는 거절(KNOWN_FAILURES)은 다시 시도 없이 그 문구만 쓴다. 토스트로 알린 거절과
 * 보내기 전 확인이 잠금과 함께 그리는 승인의 지난 시각은 여기서 그리지 않는다.
 * 화면은 실패 전 서버 상태 그대로다 — 성공처럼 보이게 하지 않는다 (D-137)
 */
export function ActionFailure({
  target,
  actions,
  kinds,
}: {
  target: string
  actions: MessageActionControl
  /** 이 자리에서 알릴 행동. 없으면 모두다 */
  kinds?: readonly MessageAction['kind'][]
}) {
  const failure = actions.failure
  if (failure === null || actionTarget(failure.action) !== target) return null
  if (kinds !== undefined && !kinds.includes(failure.action.kind)) return null
  const known = failure.known
  if (known === null)
    return <QueryErrorState error={failure.error} onRetry={actions.retry} title={failure.title} />
  if (known.place === 'toast') return null
  if (known.then === 'lockApproval' && failure.action.kind === 'approve') return null
  return (
    <div role="alert" className="flex flex-col items-start gap-6">
      <p className="text-body font-semibold text-ink">{failure.title}</p>
      <p className="text-caption text-dim">{known.message}</p>
    </div>
  )
}
