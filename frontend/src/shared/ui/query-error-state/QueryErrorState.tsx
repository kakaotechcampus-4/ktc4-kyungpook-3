import { COMMON_MESSAGES, failureNotice } from '@/shared/api/errorMessages'
import { Button } from '../button'

export interface QueryErrorStateProps {
  error: unknown
  onRetry: () => void
  /** 기본 `정보를 불러오지 못했어요` */
  title?: string
}

const ROOT = 'flex flex-col items-start gap-10'

const TITLE = 'text-body font-semibold text-ink'

const MESSAGE = 'text-caption text-dim'

/**
 * 예상할 수 있는 조회 실패를 화면 안에서 알린다 (D-129, D-135). 토스트로 보내지 않는다.
 * 문구는 오류 코드로 만든다 — 서버 message 는 보여 주지 않는다. 취소는 실패가 아니라서 그리지 않는다.
 */
export function QueryErrorState({
  error,
  onRetry,
  title = COMMON_MESSAGES.loadFailed,
}: QueryErrorStateProps) {
  const notice = failureNotice(error)
  if (notice === null) return null
  return (
    <div role="alert" className={ROOT}>
      <p className={TITLE}>{title}</p>
      <p className={MESSAGE}>{notice}</p>
      <Button onClick={onRetry}>{COMMON_MESSAGES.retry}</Button>
    </div>
  )
}
