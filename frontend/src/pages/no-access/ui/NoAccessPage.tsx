import { paths } from '@/shared/config/routes'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'

const SCREEN = 'flex min-h-dvh items-center justify-center px-24 py-48'

/** 소속 목록에 없는 워크스페이스 (D-131). 공간이 있는지조차 알리지 않는다. API 를 부르지 않는다 */
export function NoAccessPage() {
  const navigate = useGuardedNavigate()
  return (
    <main className={SCREEN}>
      <EmptyState
        pose="squint"
        title="이 워크스페이스에 접근할 수 없어요"
        description="소속된 워크스페이스만 볼 수 있어요."
        action={
          <Button variant="primary" size="lg" onClick={() => navigate(paths.workspaceSelect())}>
            워크스페이스 목록으로
          </Button>
        }
      />
    </main>
  )
}
