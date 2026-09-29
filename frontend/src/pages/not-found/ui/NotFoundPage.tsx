import { paths } from '@/shared/config/routes'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'

const SCREEN = 'flex min-h-dvh items-center justify-center px-24 py-48'

/** 알 수 없는 경로, 모양이 틀린 ID. API 를 부르지 않는다 */
export function NotFoundPage() {
  const navigate = useGuardedNavigate()
  return (
    <main className={SCREEN}>
      <EmptyState
        pose="squint"
        title="페이지를 찾을 수 없어요"
        description="주소를 다시 확인해 주세요."
        action={
          <Button variant="primary" size="lg" onClick={() => navigate(paths.landing())}>
            처음으로
          </Button>
        }
      />
    </main>
  )
}
