import { QueryErrorState } from '@/shared/ui/query-error-state'

const PAGE = 'mx-auto flex max-w-column flex-col px-24 py-48'

interface ScreenErrorProps {
  error: unknown
  onRetry: () => void
}

/** 가드가 필요한 캐시(세션·목록)를 끝내 못 받았을 때. 로그아웃으로 보지 않고 다시 시도를 준다 */
export function ScreenError({ error, onRetry }: ScreenErrorProps) {
  return (
    <main className={PAGE}>
      <QueryErrorState error={error} onRetry={onRetry} />
    </main>
  )
}
