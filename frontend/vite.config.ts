import { configDefaults, defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const DEFAULT_PROXY_TARGET = 'http://localhost:8000'

/** `API_PROXY_TARGET` 은 개발 서버만 읽는다. `VITE_` 접두사가 없어 브라우저 번들에 들어가지 않는다 */
function proxyTarget(mode: string): string {
  const raw = (loadEnv(mode, import.meta.dirname, '').API_PROXY_TARGET ?? '').trim()
  if (raw === '') return DEFAULT_PROXY_TARGET
  if (!/^https?:\/\//.test(raw) || !URL.canParse(raw)) {
    throw new Error(`API_PROXY_TARGET 은 http(s) 주소여야 한다: ${raw}`)
  }
  return raw.replace(/\/+$/, '')
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // 앱의 워커는 푸시 서비스 워커 하나다. 범위가 주소 폴더라 고정 주소 `/push/sw.js` 로 두어 MSW(`/`)와 겹치지 않게 하고,
  // 배포마다 같은 주소라 브라우저가 새 판으로 갱신한다. iife 는 모듈 서비스 워커를 못 쓰는 브라우저도 받는다
  worker: {
    format: 'iife',
    rolldownOptions: { output: { entryFileNames: 'push/sw.js' } },
  },
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      // 대화 신호 웹소켓. 서버는 Origin 의 host:port 가 Host 와 다르면 거절해서 Host 를 바꾸지 않는다.
      // Vite 는 키 순서대로 맞춰 보므로 /api 보다 앞에 둔다
      '^/api/v1/workspaces/[^/]+/messages/ws$': {
        target: proxyTarget(mode),
        ws: true,
        changeOrigin: false,
      },
      // 백엔드에 CORS 가 없다. 이 프록시가 로컬 연동의 유일한 경로다.
      // 경로는 그대로 넘긴다(/api/v1/...). 세션 쿠키는 Domain 없이 오므로 localhost 에 저장된다
      '/api': { target: proxyTarget(mode), changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/shared/test/setup.ts'],
    // e2e/ 는 Playwright 몫이다 (*.e2e.ts). Vitest 가 집어 가지 않게 뺀다
    exclude: [...configDefaults.exclude, 'e2e/**'],
    css: false,
    passWithNoTests: true,
  },
}))
