import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { GlobalToaster } from '@/shared/ui/toast'
import { RootErrorBoundary } from './router/errors/RootErrorBoundary'

export interface AppProps {
  queryClient: QueryClient
  /** 라우터 트리. 브라우저는 BrowserRouter, 테스트는 MemoryRouter 로 같은 경로 표를 감싸 넘긴다 */
  children: ReactNode
}

/**
 * Provider 배선만 한다. 인스턴스는 createApp 이 만든다.
 * Root Error Boundary 가 라우터 트리 전체를 감싼다 — 레이아웃·가드·라우터 자체의 렌더 오류가 여기서 멈춘다.
 */
export function App({ queryClient, children }: AppProps) {
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {children}
        <GlobalToaster />
      </QueryClientProvider>
    </RootErrorBoundary>
  )
}
