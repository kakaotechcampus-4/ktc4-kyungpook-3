import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { ErrorBoundary } from './ErrorBoundary'

const SCREEN = 'flex min-h-dvh items-center justify-center px-24 py-48'

/**
 * 최종 방어선 (D-129). App 이 라우터 트리 전체를 이것으로 감싼다.
 * 레이아웃이나 가드 자체가 깨져서 화면 칸의 경계까지 닿지 못한 오류를 받고, 앱 전체를 대신 그린다.
 * 라우터 바깥이라 라우터 hook 과 링크를 쓰지 않는다. 회복은 새로고침 하나다.
 */
export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary fallback={<RootErrorScreen />}>{children}</ErrorBoundary>
}

function RootErrorScreen() {
  return (
    <main className={SCREEN}>
      <EmptyState
        pose="squint"
        title="앱을 표시하지 못했어요"
        description="새로고침해 주세요. 계속되면 잠시 후 다시 시도해 주세요."
        action={
          <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
            새로고침
          </Button>
        }
      />
    </main>
  )
}
