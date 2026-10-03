import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Storybook 10 + Vite 빌더. 프로젝트의 vite.config.ts(React · Tailwind · `@` 별칭)를 그대로 쓴다.
 * public/ 을 정적 폴더로 올려 MSW 서비스 워커(mockServiceWorker.js)를 같이 내보낸다.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  staticDirs: ['../public'],
  core: { disableTelemetry: true },
}

export default config
