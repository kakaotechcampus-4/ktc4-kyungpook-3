import type { Decorator, Loader, Preview } from '@storybook/react-vite'
import { QueryClientProvider } from '@tanstack/react-query'
import type { RequestHandler } from 'msw'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import '../src/app/styles/index.css'
import { createQueryClient } from '../src/shared/api/queryClient'
import { clearUnsavedChanges } from '../src/shared/lib/unsaved-changes'
import { worker } from '../src/shared/mock/browser'
import { applyScenario } from '../src/shared/mock/scenarios'
import type { MockScenario } from '../src/shared/mock/scenarios'
import { GlobalToaster, toast } from '../src/shared/ui/toast'
import { watchStoryPlay } from './playOutcome'

/*
 * 스토리마다 고르는 것:
 * - parameters.scenario — MSW db 시작 상태(U1 시나리오). 기본은 공간 여러 개로 로그인한 상태
 * - parameters.msw — 기본 handler 위에 그 스토리만 얹는 handler(로딩: delay('infinite'), 오류: fail(...))
 * - parameters.route — MemoryRouter 의 시작 주소
 * - parameters.setup — 시나리오 위에 얹는 db 손질
 * 화면은 제품과 같은 request 경로로 MSW 를 부른다. 스토리를 열 때마다 handler·db·캐시를 처음 상태로 되돌린다 —
 * 스토리를 여는 순서와 상관없이 같은 화면이 나온다 (e2e/storybook/stories.sb.ts 가 지킨다).
 * play 결과(단언 실패 포함)는 playOutcome.ts 가 iframe 에 남긴다 — 같은 테스트가 읽어 깨진 play 를 실패로 본다.
 */
export interface StoryParameters {
  scenario?: MockScenario
  msw?: RequestHandler[]
  route?: string
  /** 시나리오를 적용한 뒤 db 를 더 손본다 — 예: 공간을 팀원 연결 단계로 옮기기 */
  setup?: () => void
}

let started: Promise<unknown> | null = null

const mockLoader: Loader = async (context) => {
  const parameters = context.parameters as StoryParameters
  watchStoryPlay(context.id)
  started ??= worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: './mockServiceWorker.js' },
  })
  await started
  // 인자 없이 불러 앞 스토리가 얹은 handler 만 걷어 낸다. 인자를 주면 기본 handler 자체가 그것으로 바뀌어
  // 이 스토리와 뒤 스토리의 나머지 요청이 모두 처리되지 않는다(MSW 2)
  worker.resetHandlers()
  worker.use(...(parameters.msw ?? []))
  applyScenario(parameters.scenario ?? 'multiple-workspaces')
  parameters.setup?.()
  clearUnsavedChanges()
  toast.clear()
  return {}
}

function Providers({ route, children }: { route: string; children: ReactNode }) {
  // 스토리마다 새 캐시 — 앞 스토리의 조회 결과가 섞이지 않는다
  const [client] = useState(createQueryClient)
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      <GlobalToaster />
    </QueryClientProvider>
  )
}

const withProviders: Decorator = (Story, context) => (
  <Providers key={context.id} route={(context.parameters as StoryParameters).route ?? '/'}>
    <Story />
  </Providers>
)

const preview: Preview = {
  loaders: [mockLoader],
  decorators: [withProviders],
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
  },
}

export default preview
