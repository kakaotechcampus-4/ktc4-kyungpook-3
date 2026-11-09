import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { toWorkspace, workspaceListQueryOptions } from '@/entities/workspace'
import type { Workspace } from '@/entities/workspace'
import { getSplashHoldCount } from '@/shared/lib/splash'
import { db } from '@/shared/mock/db'
import { GuardSkeleton, RouteSkeleton } from './RouteSkeleton'

/*
 * 라우트 뼈대는 경로마다 그 화면이 데이터를 기다릴 때와 같은 틀이다 (#510). 여기서는 어느 틀을 고르는지와 접근성 약속을 본다.
 * 화면 안 뼈대와 위치가 같은지는 실제 Chromium 에서 e2e/route-skeleton.e2e.ts 가 잰다
 */

function workspace(role: 'pm' | 'member'): Workspace {
  const dto = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_01')
  if (dto === undefined) throw new Error('ws_01 이 없다')
  return { ...toWorkspace(dto), role }
}

interface RenderOptions {
  /** 캐시에 둔 소속 목록의 ws_01 역할. 없으면 목록을 아직 받지 않았다 */
  role?: 'pm' | 'member'
}

function renderAt(path: string, { role }: RenderOptions = {}) {
  const queryClient = new QueryClient()
  if (role !== undefined)
    queryClient.setQueryData(workspaceListQueryOptions().queryKey, [workspace(role)])
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <RouteSkeleton />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { main: screen.getByRole('main'), queryClient }
}

describe('RouteSkeleton — 화면마다 화면 안 뼈대와 같은 틀', () => {
  it.each([
    ['/login', ["Manager's Manager", '이메일', '비밀번호를 잊으셨나요?', '처음이신가요?']],
    ['/signup', ['계정 만들기', '이메일', '또는', '이미 계정이 있으신가요?']],
    ['/forgot-password', ['비밀번호 찾기', '이메일']],
    ['/workspaces', ['워크스페이스 선택', '들어갈 워크스페이스를 골라 주세요.']],
    [
      '/workspaces/ws_01/dashboard',
      ['워크스페이스 현황', '확인 대기', '확인이 필요한 일', '마감 임박', '최근 반영'],
    ],
    ['/workspaces/ws_01/tasks', ['태스크', '전체', '확인 필요', '마감 전체', '담당자 전체']],
    ['/workspaces/ws_01/tasks?view=board', ['태스크', '시작 전', '진행 중', '완료']],
    ['/workspaces/ws_01/tasks/tk_01', ['태스크 목록', '태스크 정보', '변경 이력']],
    ['/workspaces/ws_01/approvals/ap_01', ['태스크 목록']],
    ['/workspaces/ws_01/messages', ['메시지', '새 재촉', '새 대화', '보내기 전 확인', '대화']],
    ['/workspaces/ws_01/members', ['팀', '팀원 관리', '연결되지 않은 계정']],
    ['/workspaces/ws_01/settings', ['설정', '일반', '워크스페이스 이름', 'Discord', 'Notion']],
    ['/workspaces/ws_01/meetings/upload', ['회의를 올려 주세요', '회의 제목', '참석자']],
    ['/workspaces/ws_01/meetings/mt_11/speakers', ['누가 말했는지 골라 주세요']],
  ])('%s 는 그 화면의 틀과 정해진 글자를 그린다', (path, texts) => {
    const { main } = renderAt(path)
    expect(main).toHaveAttribute('aria-busy', 'true')
    for (const text of texts) expect(within(main).getAllByText(text).length).toBeGreaterThan(0)
  })

  it('가입 첫 단계의 뼈대에는 인증할 이메일만 있고 프로필 칸은 없다', () => {
    const { main } = renderAt('/signup')
    expect(within(main).queryByText('이름')).not.toBeInTheDocument()
    expect(within(main).queryByText('비밀번호')).not.toBeInTheDocument()
  })

  it.each([
    '/login',
    '/workspaces',
    '/workspaces/ws_01/dashboard',
    '/workspaces/ws_01/tasks',
    '/workspaces/ws_01/tasks/tk_01',
    '/workspaces/ws_01/messages',
    '/workspaces/ws_01/members',
    '/workspaces/ws_01/settings',
    '/workspaces/ws_01/meetings/upload',
    '/workspaces/ws_01/meetings/mt_11/speakers',
  ])(
    '%s 의 글자·버튼은 자리표시라 스크린리더에서 빠진다 — 제목·링크·버튼이 읽히지 않는다',
    (path) => {
      renderAt(path)
      expect(screen.queryAllByRole('heading')).toHaveLength(0)
      expect(screen.queryAllByRole('link')).toHaveLength(0)
      expect(screen.queryAllByRole('button')).toHaveLength(0)
    },
  )

  it('그려져 있는 동안 스플래시를 잡는다 — 첫 화면이 아니다', () => {
    expect(getSplashHoldCount()).toBe(0)
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/workspaces/ws_01/dashboard']}>
          <RouteSkeleton />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(getSplashHoldCount()).toBe(1)
    unmount()
    expect(getSplashHoldCount()).toBe(0)
  })

  it('역할은 캐시에 있는 소속 목록으로 정한다 — 팀원이면 확인 필요 자리가 없다', () => {
    renderAt('/workspaces/ws_01/dashboard', { role: 'member' })
    expect(screen.queryByText('확인이 필요한 일')).toBeNull()
    expect(screen.queryByText('확인 대기')).toBeNull()
    expect(screen.getByText('마감 임박')).toBeInTheDocument()
  })

  it.each([
    ['/workspaces/ws_01/tasks', '확인 필요'],
    ['/workspaces/ws_01/members', '팀원 관리'],
    ['/workspaces/ws_01/messages', '새 재촉'],
    ['/workspaces/ws_01/messages', '새 대화'],
    ['/workspaces/ws_01/messages', '보내기 전 확인'],
  ])('팀원의 %s 에는 PM 의 「%s」 가 없다', (path, pmOnly) => {
    renderAt(path, { role: 'member' })
    expect(screen.queryByText(pmOnly)).toBeNull()
  })

  it('소속 목록을 아직 받지 않았으면 PM 틀이고, 목록을 새로 부르지 않는다 — 가드가 세션을 기다리는 동안이다', () => {
    const { queryClient } = renderAt('/workspaces/ws_01/dashboard')
    expect(screen.getByText('확인이 필요한 일')).toBeInTheDocument()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it.each(['/onboarding/create_workspace', '/onboarding/ws_03/connect_discord'])(
    '%s 는 온보딩 틀(가운데 512px 열)의 뼈대다',
    (path) => {
      const { main } = renderAt(path)
      expect(main).toHaveAttribute('aria-busy', 'true')
      expect(main).toHaveClass('justify-center', 'items-center')
      expect(main.firstElementChild).toHaveClass('w-[512px]')
    },
  )

  it.each(['/workspaces/ws_01/meetings', '/workspaces/ws_01/meetings/mt_09'])(
    '%s 는 회의록 틀(왼쪽 목록 308 + 오른쪽 본문)의 2단 뼈대다 — 목록·본문 자리가 화면의 로딩 뼈대와 같다',
    (path) => {
      const { main } = renderAt(path)
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

  /* 라우터는 대소문자를 가리지 않고 끝 슬래시를 받는다(caseSensitive 기본 false). 뼈대도 같은 경로를 같은 화면으로 본다 */
  it.each([
    ['/login/', '이메일'],
    ['/LOGIN', '이메일'],
    ['/Signup/', '이메일'],
    ['/Workspaces/', '워크스페이스 선택'],
    ['/Workspaces/ws_01/Dashboard/', '워크스페이스 현황'],
    ['/workspaces/ws_01/TASKS?view=board', '시작 전'],
    ['/workspaces/ws_01/tasks/tk_01/', '태스크 정보'],
    ['/workspaces/ws_01/Members/', '연결되지 않은 계정'],
    ['/workspaces/ws_01/Meetings/UPLOAD/', '회의를 올려 주세요'],
    ['/workspaces/ws_01/meetings/mt_11/Speakers/', '누가 말했는지 골라 주세요'],
    ['/workspaces/ws_01/Messages/', '보내기 전 확인'],
  ])('%s 도 실제 라우트처럼 그 화면의 뼈대다', (path, text) => {
    const { main } = renderAt(path)
    expect(within(main).getAllByText(text).length).toBeGreaterThan(0)
  })

  it('끝 슬래시가 붙은 회의 처리 주소도 처리 화면 틀이다', () => {
    const { main } = renderAt('/workspaces/ws_01/meetings/mt_10/processing/')
    expect(main.firstElementChild).toHaveClass('max-w-[560px]')
  })

  it('공간 ID 모양이 틀리면 화면 뼈대가 아니다 — 소속 가드가 404 를 그린다', () => {
    const { main } = renderAt('/workspaces/bad%20id/dashboard')
    expect(main).toHaveClass('max-w-column')
  })

  it('회의 처리는 정리 상태를 기다리는 한 단(560) 틀이다', () => {
    const { main } = renderAt('/workspaces/ws_01/meetings/mt_10/processing')
    expect(main.firstElementChild).toHaveClass('max-w-[560px]')
  })

  it.each(['/', '/reset-password', '/workspaces/ws_01/nope', '/nowhere'])(
    '%s 는 틀을 모르는 화면이라 일반 뼈대다',
    (path) => {
      const { main } = renderAt(path)
      expect(main).toHaveClass('max-w-column')
    },
  )

  it('휴대폰에서 대화를 바로 여는 주소는 셸을 걷은 전체 화면이라 일반 뼈대다', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767.98px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const { main } = renderAt('/workspaces/ws_01/messages/threads/th_01')
    expect(main).toHaveClass('max-w-column')
  })
})

/*
 * UX1-M01 — 가드(세션·소속)는 앱 셸 바깥 칸이라, 셸 안 경로를 기다릴 때 셸 틀과 헤더 뼈대를 함께 그린다.
 * 진짜 헤더와 같은 상자(h-header · 아래 선)라 셸이 뜰 때 화면 뼈대가 헤더 높이만큼 내려가지 않는다.
 * 위치 자체는 e2e/meeting-skeleton.e2e.ts 가 실제 Chromium 에서 잰다.
 */
describe('GuardSkeleton', () => {
  function renderGuardAt(path: string) {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <GuardSkeleton />
        </MemoryRouter>
      </QueryClientProvider>,
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
