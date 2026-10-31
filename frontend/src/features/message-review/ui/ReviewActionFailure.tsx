import { Button } from '@/shared/ui/button'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { REVIEW_GONE_MESSAGE } from '../lib/actionMessages'
import type { MessageReviewAction } from '@/entities/message'
import type { MessageReviewActionControl } from '../model/useMessageReviewAction'

const GONE = 'flex flex-col items-start gap-10'

/**
 * 행동 실패를 행동 가까이에 알린다 (role=alert). 다시 시도하면 같은 요청을 다시 보낸다.
 * 항목이 이미 처리됐거나 없으면 다시 시도 대신 목록을 새로 받게 한다.
 * 화면은 실패 전 서버 상태 그대로다 — 성공처럼 보이게 하지 않는다 (D-137)
 */
export function ReviewActionFailure({
  reviewId,
  actions,
  kinds,
}: {
  reviewId: string
  actions: MessageReviewActionControl
  /** 이 자리에서 알릴 행동. 없으면 모두다 */
  kinds?: readonly MessageReviewAction['kind'][]
}) {
  const failure = actions.failure
  if (failure === null || failure.reviewId !== reviewId) return null
  if (kinds !== undefined && !kinds.includes(failure.kind)) return null
  if (failure.gone)
    return (
      <div role="alert" className={GONE}>
        <p className="text-body font-semibold text-ink">{failure.title}</p>
        <p className="text-caption text-dim">{REVIEW_GONE_MESSAGE}</p>
        <Button onClick={actions.refresh}>목록 새로 받기</Button>
      </div>
    )
  return <QueryErrorState error={failure.error} onRetry={actions.retry} title={failure.title} />
}
