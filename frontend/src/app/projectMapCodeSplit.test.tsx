import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { deferred } from '@/shared/test/deferred'
import { renderApp } from './test/renderApp'

/*
 * #551 — 그래프 보기와 배치 라이브러리(d3-force)는 그래프 탭을 고를 때 받는다. 셸과 다른 화면, 목록 보기는 받지 않는다.
 * 모듈을 막아 두고 언제 불리는지 본다. 모듈은 한 번만 불리므로 파일의 테스트가 순서대로 이어진다
 */

const modules = vi.hoisted(() => ({ loaded: [] as string[], release: () => {} }))
vi.mock('@/widgets/project-map/ui/GraphView', async (original) => {
  const { promise, resolve } = deferred()
  modules.release = resolve
  modules.loaded.push('graph')
  await promise
  return original()
})
vi.mock('d3-force', async (original) => {
  modules.loaded.push('d3-force')
  return original()
})

vi.setConfig({ testTimeout: 15_000 })
const FIRST_PAINT = { timeout: 5_000 }

it('셸과 목록 보기는 그래프 코드를 받지 않고, 그래프 탭을 고르면 받는 동안 대기를 그린다', async () => {
  const user = userEvent.setup()
  renderApp(`${paths.projectMap('ws_01')}?view=list`)
  await screen.findByRole('heading', { level: 2, name: '로그인·계정' }, FIRST_PAINT)
  expect(modules.loaded).toEqual([])

  await user.click(screen.getByRole('tab', { name: '그래프' }))
  expect(
    await screen.findByRole('status', { name: '그래프를 불러오는 중이에요' }),
  ).toBeVisible()
  expect(modules.loaded).toEqual(['graph'])

  modules.release()
  expect(await screen.findByRole('img', { name: /그래프/ }, FIRST_PAINT)).toBeInTheDocument()
  expect(modules.loaded).toEqual(['graph', 'd3-force'])
})
