import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useRouteId } from '@/shared/lib/url'
import { EmptyState } from '@/shared/ui/empty-state'

const MAIN =
  'mx-auto flex w-full max-w-shell flex-1 flex-col items-center justify-center px-48 pt-48 pb-96'

/* Button 과 같은 면·크기 토큰의 링크 — 이동이라 <button> 을 쓰지 않는다 */
const PRIMARY_LINK =
  'inline-flex h-40 items-center justify-center rounded-9 bg-ink px-20 text-body font-semibold text-surface hover:bg-dim active:bg-sub'

const SECONDARY_LINK =
  'inline-flex h-40 items-center justify-center rounded-9 bg-control px-20 text-body font-semibold text-ink hover:bg-line-strong'

/**
 * 대시보드 껍데기 (M4). 온보딩이 끝나는 곳(D-013)이라 빈 상태와 다음 행동 안내만 있다.
 * 집계·목록 API 는 부르지 않는다 — 요약 숫자·확인 목록·최근 반영은 M7 이다.
 * 그래서 회의가 있는 공간인지 모른다. 문구는 "비어 있다"고 단정하지 않고 다음 행동만 안내한다
 * (docs/impl-decision/2026-09-29-app-shell-scope.md).
 */
export function DashboardPage() {
  const workspaceId = useRouteId('workspaceId')
  if (workspaceId === null) return null

  return (
    <main className={MAIN}>
      <h1 className="sr-only">대시보드</h1>
      <EmptyState
        titleAs="h2"
        title="확인할 일이 여기에 모여요"
        description="회의 녹음을 올리면 결정사항과 담당자, 마감을 정리해 드려요. 지금은 회의록과 태스크에서 이어서 볼 수 있어요."
        action={
          <GuardedLink to={paths.meetings(workspaceId)} className={PRIMARY_LINK}>
            회의록으로 가기
          </GuardedLink>
        }
        secondaryAction={
          <GuardedLink to={paths.tasks(workspaceId)} className={SECONDARY_LINK}>
            태스크 보기
          </GuardedLink>
        }
      />
    </main>
  )
}
