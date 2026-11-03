import { Button } from '@/shared/ui/button'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { REVIEW_GONE_MESSAGE, TIME_PASSED_MESSAGE, TIME_PASSED_TITLE } from '../lib/actionMessages'
import { actionTarget } from '../model/useMessageAction'
import type { MessageAction } from '@/entities/message'
import type { MessageActionControl } from '../model/useMessageAction'

const GONE = 'flex flex-col items-start gap-10'

/**
 * 행동 실패를 행동 가까이에 알린다 (role=alert). 다시 시도하면 같은 요청을 다시 보낸다.
 * 항목이 이미 처리됐거나 없으면 다시 시도 대신 목록을 새로 받게 한다.
 * 예정 시각이 지난 발송은 여기서 다시 시도하지 않는다 — 시각을 다시 고르는 안내가 그 자리다.
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
  if (failure.cause === 'time_passed')
    return (
      <div role="alert" className={GONE}>
        <p className="text-body font-semibold text-ink">{TIME_PASSED_TITLE}</p>
        <p className="text-caption text-dim">{TIME_PASSED_MESSAGE}</p>
      </div>
    )
  if (failure.cause === 'gone')
    return (
      <div role="alert" className={GONE}>
        <p className="text-body font-semibold text-ink">{failure.title}</p>
        <p className="text-caption text-dim">{REVIEW_GONE_MESSAGE}</p>
        <Button onClick={actions.refresh}>목록 새로 받기</Button>
      </div>
    )
  return <QueryErrorState error={failure.error} onRetry={actions.retry} title={failure.title} />
}
