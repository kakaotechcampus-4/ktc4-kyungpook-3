import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes } from 'react-router'
import './app/styles/index.css'
import { App } from './app/App'
import { createApp } from './app/createApp'
import { appRoutes } from './app/router/routes'
import { config } from './shared/config/env'

const root = document.getElementById('root')
if (!root) {
  throw new Error('root element is missing')
}

async function enableMocking(): Promise<void> {
  // DEV 를 먼저 본다 — 번들러가 이 분기를 지워야 프로덕션 번들에 MSW 가 남지 않는다
  if (!import.meta.env.DEV) return
  if (!config.mswEnabled) {
    // 실제 API 로 띄울 때 예전 MSW 실행이 남긴 worker 가 요청을 받지 않게 지운다
    const { unregisterMockWorker } = await import('./app/mockWorkerCleanup')
    if (await unregisterMockWorker()) {
      window.location.reload()
      await new Promise<never>(() => {})
    }
    return
  }
  const { startMockWorker } = await import('@/shared/mock/browser')
  await startMockWorker()
}

// 부팅 조회는 createApp 이 시작한다. worker 가 뜬 뒤에 만들어야 첫 요청부터 MSW 가 받는다
void enableMocking().finally(() => {
  const app = createApp()
  createRoot(root).render(
    <StrictMode>
      <App queryClient={app.queryClient}>
        <BrowserRouter>
          <Routes>{appRoutes}</Routes>
        </BrowserRouter>
      </App>
    </StrictMode>,
  )
})
