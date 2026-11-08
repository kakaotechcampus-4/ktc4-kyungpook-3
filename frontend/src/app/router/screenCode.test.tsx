import { Route } from 'react-router'
import type { ComponentType, ReactNode } from 'react'
import { lazyPage } from './lazyPage'
import { screenCodePreloader } from './screenCode'

/*
 * #536·#539 — 경로로 그 화면의 지연 로드 `load` 를 찾아 미리 부른다. 지연 로드와 같은 `load` 를 한 번만 부른다.
 * 경로 표는 앱과 같은 모양(화면을 다른 칸으로 감싼 화면 칸, 경로 없는 바깥 칸, 하위 경로를 받는 `*`)으로 작게 만든다
 */

const Blank: ComponentType = () => null

function Frame({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

function setup(load: () => Promise<ComponentType>) {
  const routes = (
    <Route path="/">
      <Route element={<Frame />}>
        <Route path="workspaces/:workspaceId/tasks" element={<Frame>{lazyPage(load)}</Frame>} />
        <Route path="workspaces/:workspaceId/messages/*" element={lazyPage(load)} />
        <Route path="plain" element={<Frame />} />
      </Route>
    </Route>
  )
  return screenCodePreloader(routes)
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('경로의 화면 코드를 미리 부른다', () => {
  it('감싼 화면 칸 안의 지연 로드 화면을 찾아 부르고, 검색 문자열은 무시한다', async () => {
    const load = vi.fn(() => Promise.resolve(Blank))
    const preload = setup(load)

    preload('/workspaces/ws_01/tasks?tab=needs_review')
    expect(load).toHaveBeenCalledTimes(1)
    await flush()
    preload('/workspaces/ws_02/tasks')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('하위 경로를 받는 화면도 찾는다', () => {
    const load = vi.fn(() => Promise.resolve(Blank))
    setup(load)('/workspaces/ws_01/messages/threads/th_01')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('지연 로드 화면이 아닌 경로·없는 경로는 아무것도 부르지 않는다', () => {
    const load = vi.fn(() => Promise.resolve(Blank))
    const preload = setup(load)
    preload('/plain')
    preload('/nowhere')
    expect(load).not.toHaveBeenCalled()
  })

  it('실패는 조용히 넘기고, 다음 부름이 다시 받는다', async () => {
    const load = vi
      .fn<() => Promise<ComponentType>>()
      .mockRejectedValueOnce(new Error('chunk load failed'))
      .mockResolvedValue(Blank)
    const preload = setup(load)

    preload('/workspaces/ws_01/tasks')
    await flush()
    preload('/workspaces/ws_01/tasks')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
