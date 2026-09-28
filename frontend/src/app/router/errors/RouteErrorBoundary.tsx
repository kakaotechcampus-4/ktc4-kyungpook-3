import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { ErrorBoundary } from './ErrorBoundary'

const SCREEN = 'flex min-h-dvh items-center justify-center px-24 py-48'

/**
 * 화면 한 칸에서 난 예상 밖 렌더 오류 (D-129). routes.tsx 가 페이지 element 를 이것으로 감싼다.
 * 레이아웃과 가드는 그대로 두고 이 칸만 대신 그린다. lazy 코드 조각을 못 받은 오류도 여기서 멈춘다.
 * 조회 실패는 여기로 오지 않는다 — 화면이 QueryErrorState 로 직접 다룬다.
 * 이웃 화면으로 옮겨도 이 경계는 같은 자리에 남는다. 그래서 경로가 바뀌면 오류 상태를 푼다.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname} fallback={<RouteErrorScreen />}>
      {children}
    </ErrorBoundary>
  )
}

function RouteErrorScreen() {
  return (
    <main className={SCREEN}>
      <EmptyState
        pose="squint"
        title="이 화면을 표시하지 못했어요"
        description="다른 화면은 그대로 쓸 수 있어요. 새로고침해도 같으면 잠시 후 다시 시도해 주세요."
        action={
          <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
            새로고침
          </Button>
        }
      />
    </main>
  )
}
