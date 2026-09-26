import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/styles/index.css'
import App from './App'

const root = document.getElementById('root')
if (!root) {
  throw new Error('root element is missing')
}

async function enableMocking(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_MSW !== 'true') return
  const { worker } = await import('@/shared/mock/browser')
  await worker.start({ onUnhandledRequest: 'warn' })
}

void enableMocking().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
