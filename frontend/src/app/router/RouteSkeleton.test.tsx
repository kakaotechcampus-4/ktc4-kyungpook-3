import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { RouteSkeleton } from './RouteSkeleton'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <RouteSkeleton />
    </MemoryRouter>,
  )
  return screen.getByRole('main')
}

describe('RouteSkeleton', () => {
  it.each(['/onboarding/create_workspace', '/onboarding/ws_03/connect_discord'])(
    '%s 는 온보딩 틀(가운데 512px 열)의 뼈대다',
    (path) => {
      const main = renderAt(path)
      expect(main).toHaveAttribute('aria-busy', 'true')
      expect(main).toHaveClass('justify-center', 'items-center')
      expect(main.firstElementChild).toHaveClass('w-[512px]')
    },
  )

  it.each(['/workspaces', '/workspaces/ws_01/dashboard', '/login'])(
    '%s 는 제품 화면 뼈대다',
    (path) => {
      const main = renderAt(path)
      expect(main).toHaveAttribute('aria-busy', 'true')
      expect(main).toHaveClass('max-w-column')
    },
  )
})
