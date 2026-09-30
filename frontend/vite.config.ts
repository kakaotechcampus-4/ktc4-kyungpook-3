import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      // 백엔드에 CORS 가 없다. 이 프록시가 로컬 연동의 유일한 경로다.
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
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
})
