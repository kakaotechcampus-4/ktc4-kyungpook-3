import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { GuardSkeleton, RouteSkeleton } from './RouteSkeleton'

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

  it.each(['/workspaces/ws_01/meetings', '/workspaces/ws_01/meetings/mt_09'])(
    '%s 는 회의록 틀(왼쪽 목록 308 + 오른쪽 본문)의 2단 뼈대다 — 목록·본문 자리가 화면의 로딩 뼈대와 같다',
    (path) => {
      const main = renderAt(path)
      expect(main).toHaveAttribute('aria-busy', 'true')
      expect(main).not.toHaveClass('max-w-column')
      const aside = screen.getByTestId('minutes-skeleton-aside')
      expect(aside).toHaveClass('w-aside', 'border-r')
      expect(main.firstElementChild).toBe(aside)
      // 회의록 화면이 데이터를 기다릴 때 쓰는 것과 같은 컴포넌트다 (MeetingMinutes · MinutesDetail)
      expect(within(aside).getByTestId('minutes-list-skeleton')).toBeInTheDocument()
      expect(within(main).getByTestId('minutes-detail-skeleton')).toBeInTheDocument()
    },
  )

  it.each(['/workspaces/ws_01/meetings/upload', '/workspaces/ws_01/meetings/mt_10/processing'])(
    '%s 는 회의록이 아니라 한 단 화면이라 제품 화면 뼈대다',
    (path) => {
      const main = renderAt(path)
      expect(main).toHaveClass('max-w-column')
      expect(screen.queryByTestId('minutes-skeleton-aside')).toBeNull()
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

/*
 * UX1-M01 — 가드(세션·소속)는 앱 셸 바깥 칸이라, 셸 안 경로를 기다릴 때 셸 틀과 헤더 뼈대를 함께 그린다.
 * 진짜 헤더와 같은 상자(h-header · 아래 선)라 셸이 뜰 때 화면 뼈대가 헤더 높이만큼 내려가지 않는다.
 * 위치 자체는 e2e/meeting-skeleton.e2e.ts 가 실제 Chromium 에서 잰다.
 */
describe('GuardSkeleton', () => {
  function renderGuardAt(path: string) {
    const { container } = render(
      <MemoryRouter initialEntries={[path]}>
        <GuardSkeleton />
      </MemoryRouter>,
    )
    return container
  }

  it.each([
    '/workspaces/ws_01/meetings',
    '/workspaces/ws_01/meetings/mt_09',
    '/workspaces/ws_01/dashboard',
    '/workspaces/ws_01/tasks',
  ])('%s 는 앱 셸 틀 안에 헤더 뼈대와 그 경로의 화면 뼈대를 그린다', (path) => {
    const container = renderGuardAt(path)
    const shell = container.firstElementChild
    expect(shell).toHaveClass('flex', 'min-h-dvh', 'flex-col')
    const header = screen.getByTestId('app-header-skeleton')
    // 진짜 헤더와 같은 상자 — 높이 토큰 · 아래 선 · 줄어들지 않음
    expect(header).toHaveClass('h-header', 'shrink-0', 'border-b')
    expect(header).toHaveAttribute('aria-hidden', 'true')
    expect(shell?.firstElementChild).toBe(header)
    // 헤더 바로 아래가 그 경로의 화면 뼈대다
    expect(header.nextElementSibling).toBe(screen.getByRole('main'))
    // 뼈대는 랜드마크가 아니다 — 진짜 헤더(banner)와 겹쳐 읽히지 않는다
    expect(screen.queryByRole('banner')).toBeNull()
  })

  it('회의록 경로의 셸 안 뼈대는 2단 회의록 뼈대다', () => {
    renderGuardAt('/workspaces/ws_01/meetings/mt_09')
    expect(screen.getByTestId('minutes-skeleton-aside')).toBeInTheDocument()
  })

  it.each([
    '/login',
    '/workspaces',
    '/onboarding/create_workspace',
    '/onboarding/ws_03/connect_discord',
    // ID 모양이 틀리면 소속 가드가 셸 없는 404 를 그린다
    '/workspaces/bad%20id/dashboard',
  ])('%s 는 헤더가 없는 화면이라 셸 없이 RouteSkeleton 그대로다', (path) => {
    renderGuardAt(path)
    expect(screen.queryByTestId('app-header-skeleton')).toBeNull()
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
  })
})
