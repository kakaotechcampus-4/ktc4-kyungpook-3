import { defineConfig, mergeConfig } from 'vitest/config'
import { resolve } from 'node:path'
import base from './vite.config'

export default defineConfig((environment) =>
  mergeConfig(base(environment), {
    cacheDir: '.vite/consent',
    resolve: {
      alias: [
        {
          find: '@/shared/config/policyPublication',
          replacement: resolve(import.meta.dirname, 'e2e/fixtures/published-policy.ts'),
        },
      ],
    },
  }),
)
