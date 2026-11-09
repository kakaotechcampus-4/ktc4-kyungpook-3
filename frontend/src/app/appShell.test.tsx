import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expireSession } from '@/app/expireSession'
import { useUnsavedChangesStore } from '@/shared/lib/unsaved-changes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import {
  businessRequests,
  isDashboardRequest,
  latestDoneExtractionId,
  recordRequests,
} from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* U4-1~U4-5 와 이월(U3-r1 #1·#2). 제품과 같은 배선(renderApp) + MSW + 실제 request 경로 */

const RETURN_KEY = 'onboarding-return-workspace'

/** 두 번째 완료 공간 ws_04 를 붙인다. 팀원이 없다 — 전환 뒤 ws_01 팀원이 보이면 안 된다 */
function addCompletedWorkspace() {
  db.workspaces.push({
    workspace_id: 'ws_04',
    name: '알고리즘 스터디',
    role: 'pm',
    created_at: '2026-09-04T00:00:00Z',
    onboarding: {
      completed: true,
      current_step: null,
      steps: (
        ['create_workspace', 'connect_discord', 'connect_notion', 'connect_members'] as const
      ).map((step) => ({ step, status: 'completed' as const })),
    },
  })
  db.accounts[0].workspaceIds.push('ws_04')
  db.integrations.ws_04 = {
    discord: { status: 'connected', display_name: 'x', connected_at: MOCK_NOW, chat_channel: null },
    notion: { status: 'connected', display_name: 'x', connected_at: MOCK_NOW },
  }
}

const openWorkspaceMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /^워크스페이스 바꾸기/ }))
  return screen.findByRole('menu', { name: /^워크스페이스 바꾸기/ })
}

const openUserMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: '내 계정: 최진호' }))
  return screen.findByRole('menu', { name: /^내 계정/ })
}

/**
 * 설정 화면에 도착한 뒤 포커스가 제목(h1)에 있고 아바타로 돌아가지 않았다.
 * Radix 의 닫힘 포커스 복귀는 다음 태스크라서, 제목에 온 뒤 한 번 더 기다려 다시 본다
 */
async function expectSettingsTitleFocused(avatar: HTMLElement) {
  const title = await screen.findByRole('heading', { level: 1, name: '설정' })
  await waitFor(() => expect(title).toHaveFocus())
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  expect(title).toHaveFocus()
  expect(avatar).not.toHaveFocus()
}

afterEach(() => sessionStorage.clear())

describe('워크스페이스 선택 화면과 헤더 메뉴 (U4-1)', () => {
  it('선택 화면: 소속 공간을 모두 보이고 미완료 공간에 `설정 미완료` 를 붙인다', async () => {
    renderApp('/workspaces')
    const ws02 = await screen.findByRole('button', { name: /사이드 프로젝트/ })
    expect(ws02).toHaveTextContent('설정 미완료')
    expect(screen.getByRole('button', { name: /카테캠 3팀/ })).toHaveTextContent('PM')
    expect(screen.getByRole('button', { name: /카테캠 3팀/ })).not.toHaveTextContent('설정 미완료')
  })

  it('선택 화면: 완료 공간은 대시보드, 미완료 공간은 온보딩 재개 지점이다', async () => {
    const app = renderApp('/workspaces')
    await userEvent.click(await screen.findByRole('button', { name: /카테캠 3팀/ }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')

    app.navigate('/workspaces')
    await userEvent.click(await screen.findByRole('button', { name: /사이드 프로젝트/ }))
    expect(
      await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' }),
    ).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_02/connect_notion')
  })

  it('헤더 메뉴도 같은 목록·같은 표시·같은 진입 정책이다', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    const menu = await openWorkspaceMenu()
    expect(within(menu).getByText('내 워크스페이스 2')).toBeInTheDocument()
    const items = within(menu).getAllByRole('menuitem')
    expect(items[0]).toHaveTextContent('사이드 프로젝트')
    expect(items[0]).toHaveTextContent('설정 미완료')
    expect(items[1]).toHaveTextContent('카테캠 3팀')
    // 지금 공간에 체크가 있다
    expect(
      within(items[1]).getByRole('img', { name: '지금 보는 워크스페이스' }),
    ).toBeInTheDocument()

    await userEvent.click(items[0])
    expect(
      await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' }),
    ).toBeInTheDocument()
    await app.expectPath('/onboarding/ws_02/connect_notion')
  })

  it('헤더에서 미완료 공간에 들어가면 지금 공간을 돌아올 곳으로 적고, 선택 화면에서는 지운다', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    await userEvent.click(
      within(await openWorkspaceMenu()).getByRole('menuitem', { name: /사이드 프로젝트/ }),
    )
    await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' })
    expect(sessionStorage.getItem(RETURN_KEY)).toBe('ws_01')
    // 나가기가 그 공간으로 돌아간다
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    await screen.findByRole('heading', { name: '대시보드' })
    await app.expectPath('/workspaces/ws_01/dashboard')

    // 선택 화면에서 들어가면 앞의 기억을 쓰지 않는다 (U3-r1 #1)
    app.navigate('/workspaces')
    await userEvent.click(await screen.findByRole('button', { name: /사이드 프로젝트/ }))
    await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' })
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
  })
})

describe('앱 셸 (U4-2)', () => {
  it('헤더에 5개 탭이 있고 설정은 탭이 아니라 프로필 메뉴에 있다', async () => {
    renderApp('/workspaces/ws_01/dashboard')
    const nav = await screen.findByRole('navigation', { name: '주요 화면' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['대시보드', '회의록', '태스크', '메시지', '팀'])
    expect(within(nav).getByRole('link', { name: '대시보드' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).queryByRole('link', { name: /설정/ })).toBeNull()
    // #244 사용자 요청: 설정은 워크스페이스 메뉴에서 프로필 메뉴로 옮겼다. 워크스페이스 메뉴에는 남지 않는다
    const workspaceMenu = await openWorkspaceMenu()
    expect(within(workspaceMenu).queryByRole('menuitem', { name: '워크스페이스 설정' })).toBeNull()
    expect(within(workspaceMenu).queryByRole('menuitem', { name: '설정' })).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(within(await openUserMenu()).getByRole('menuitem', { name: '설정' })).toBeInTheDocument()
  })

  it('다른 마일스톤의 임시 화면도 셸 안에서 탭으로 오간다', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    const nav = await screen.findByRole('navigation', { name: '주요 화면' })
    for (const [tab, heading, path] of [
      // M5 U5 가 회의 자리표시자를 회의록 화면으로 바꿨다. 회의록 탭은 가장 최근 회의록으로 주소를 바꾼다 (D-106, U5-1) —
      // 탭(`/meetings`)은 그 하위 경로에서도 현재 위치로 표시된다
      ['회의록', '회의록', '/workspaces/ws_01/meetings/mt_09'],
      ['태스크', '태스크', '/workspaces/ws_01/tasks'],
      // #315 가 준비 중 안내를 지우고 메시지 화면을 모든 모드에서 연다
      ['메시지', '메시지', '/workspaces/ws_01/messages'],
      // M8-B 가 팀 자리표시자를 Team 캔버스 화면으로 바꿨다 — 제목은 `팀` 이다
      ['팀', '팀', '/workspaces/ws_01/members'],
    ] as const) {
      await userEvent.click(within(nav).getByRole('link', { name: tab }))
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      await app.expectPath(path)
      expect(within(nav).getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page')
    }
    await userEvent.click(within(await openUserMenu()).getByRole('menuitem', { name: '설정' }))
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '주요 화면' })).toBeInTheDocument()
    // 탭 다섯과 설정을 차례로 그린다. M8-B 로 팀·설정이 자리표시자에서 실제 화면이 되어 전체 실행 부하에서 5초를 넘겼다
  }, 10_000)
})

/** 셸 헤더. 화면 머리도 header 라 banner 가 여럿일 수 있어 공간 메뉴가 든 것을 고른다 */
async function shellHeader() {
  const workspace = await screen.findByRole('button', { name: /^워크스페이스 바꾸기/ })
  return workspace.closest('header')!
}

/** 폭을 바꿀 수 있는 matchMedia. 셸은 `(max-width: 767.98px)` 하나만 묻는다 */
function stubViewportWidth(initial: number) {
  let width = initial
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /max-width: ([\d.]+)px/.exec(query)
    return {
      get matches() {
        return max === null ? query === '(prefers-reduced-motion: reduce)' : width <= Number(max[1])
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }
  })
  return (next: number) => {
    width = next
    act(() => listeners.forEach((listener) => listener()))
  }
}

describe('휴대폰 셸 (D-180)', () => {
  it('768px 미만: 탭은 아래 탭 막대로 내려가고 헤더에는 공간·알림·계정만 남는다', async () => {
    stubViewportWidth(360)
    const app = renderApp('/workspaces/ws_01/dashboard')
    const nav = await screen.findByRole('navigation', { name: '주요 화면' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['홈', '회의록', '태스크', '메시지', '팀'])
    expect(within(nav).getByRole('link', { name: '홈' })).toHaveAttribute('aria-current', 'page')

    const header = await shellHeader()
    expect(within(header).queryByRole('link')).toBeNull()
    expect(within(header).getByRole('button', { name: /^알림/ })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: /^워크스페이스 바꾸기/ })).toBeInTheDocument()
    const account = within(await openUserMenu())
    expect(account.getByRole('menuitem', { name: '설정' })).toBeInTheDocument()
    expect(account.getByRole('menuitem', { name: '로그아웃' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(within(nav).getByRole('link', { name: '태스크' }))
    await app.expectPath('/workspaces/ws_01/tasks')
    expect(within(nav).getByRole('link', { name: '태스크' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: '홈' })).not.toHaveAttribute('aria-current')
  })

  it('폭이 768px 을 넘나들면 헤더 탭과 아래 탭 막대가 바로 바뀐다', async () => {
    const resize = stubViewportWidth(1024)
    renderApp('/workspaces/ws_01/dashboard')
    const header = await shellHeader()
    expect(within(header).getByRole('navigation', { name: '주요 화면' })).toBeInTheDocument()

    resize(390)
    expect(within(await shellHeader()).queryByRole('navigation')).toBeNull()
    expect(screen.getAllByRole('navigation', { name: '주요 화면' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: '홈' })).toHaveAttribute('aria-current', 'page')

    resize(768)
    expect(screen.queryByRole('link', { name: '홈' })).toBeNull()
    expect(within(await shellHeader()).getByRole('link', { name: '대시보드' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it.each([
    ['공간 메뉴', /^워크스페이스 바꾸기/, 390, 768],
    ['공간 메뉴', /^워크스페이스 바꾸기/, 1024, 390],
    ['계정 메뉴', /^내 계정/, 390, 768],
    ['계정 메뉴', /^내 계정/, 1024, 390],
  ] as const)(
    '%s를 연 채 폭이 %ipx → %ipx 로 바뀌어도 열린 채 포커스가 남는다',
    async (_, name, from, to) => {
      const resize = stubViewportWidth(from)
      renderApp('/workspaces/ws_01/dashboard')
      await userEvent.click(await screen.findByRole('button', { name }))
      const menu = await screen.findByRole('menu')
      await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement))

      resize(to)
      expect(screen.getByRole('menu')).toBe(menu)
      expect(menu).toContainElement(document.activeElement as HTMLElement)
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(screen.getByRole('button', { name })).toHaveFocus())
    },
  )

  it.each([
    ['알림', /^알림/, 1024, 390],
    ['공간 메뉴', /^워크스페이스 바꾸기/, 390, 1024],
  ] as const)(
    '자리를 옮기는 %s 버튼에 있던 포커스는 %ipx → %ipx 뒤에도 그 버튼에 있다',
    async (_, name, from, to) => {
      const resize = stubViewportWidth(from)
      renderApp('/workspaces/ws_01/dashboard')
      const trigger = await screen.findByRole('button', { name })
      act(() => trigger.focus())
      resize(to)
      expect(screen.getByRole('button', { name })).toBe(trigger)
      expect(trigger).toHaveFocus()
    },
  )
})

describe('메뉴 키보드 (U4-3)', () => {
  it('워크스페이스 메뉴: Enter 로 열고 화살표로 옮기고 Esc 로 닫으면 트리거로 포커스가 돌아온다', async () => {
    renderApp('/workspaces/ws_01/dashboard')
    const trigger = await screen.findByRole('button', { name: /^워크스페이스 바꾸기/ })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: /^워크스페이스 바꾸기/ })
    const items = within(menu).getAllByRole('menuitem')
    await waitFor(() => expect(items[0]).toHaveFocus())

    await userEvent.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(items[2]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(items[1]).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(items.at(-1)).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(items[0]).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('키보드로 고른 항목은 Enter 로 실행된다', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    const trigger = await screen.findByRole('button', { name: /^워크스페이스 바꾸기/ })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    const menu = await screen.findByRole('menu', { name: /^워크스페이스 바꾸기/ })
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus())
    await userEvent.keyboard('{End}{Enter}')
    // 마지막 항목은 워크스페이스 목록이다
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    await app.expectPath('/workspaces')
  })

  it('계정 메뉴도 같은 규칙이다 — Esc 로 닫으면 아바타로 돌아온다', async () => {
    renderApp('/workspaces/ws_01/dashboard')
    const trigger = await screen.findByRole('button', { name: '내 계정: 최진호' })
    expect(trigger).toHaveTextContent('진호')
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: /^내 계정/ })
    expect(within(menu).getByText('pm@example.com')).toBeInTheDocument()
    // #244 로 `설정` 이 로그아웃 위에 들어와 처음 고른 항목이 `설정` 이다
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: '설정' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitem', { name: '로그아웃' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})

describe('이메일 없는 계정 (#627)', () => {
  it('카카오로 가입해 이메일이 없으면 이름 아래에 아이디를 보인다', async () => {
    for (const user of [db.session.user, db.accounts[0].session.user]) user.email = null
    renderApp('/workspaces/ws_01/dashboard')
    const menu = await openUserMenu()
    expect(within(menu).getByText('최진호')).toBeInTheDocument()
    expect(within(menu).getByText('userpm')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '로그아웃' })).toBeInTheDocument()
  })
})

describe('프로필 메뉴의 설정 (#244)', () => {
  it('아바타를 열면 계정 정보 아래·로그아웃 위에 `설정` 이 있고, 고르면 지금 공간의 설정으로 간다', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    const menu = await openUserMenu()
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['설정', '로그아웃', '계정 탈퇴'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: '설정' }))
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/settings')
  })

  it('저장하지 않은 변경이 있으면 이탈 확인을 거친다 — 계속 작성하면 그대로, 버리면 설정', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    await screen.findByRole('heading', { name: '대시보드' })
    useUnsavedChangesStore.getState().mark('test-form')

    await userEvent.click(within(await openUserMenu()).getByRole('menuitem', { name: '설정' }))
    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '계속 작성하기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await app.expectPath('/workspaces/ws_01/dashboard')

    await userEvent.click(within(await openUserMenu()).getByRole('menuitem', { name: '설정' }))
    await userEvent.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/settings')
    // 확인 창을 거쳐 옮겨 가도 포커스는 아바타가 아니라 설정 제목이다
    await expectSettingsTitleFocused(screen.getByRole('button', { name: '내 계정: 최진호' }))
  })

  it('논모달이다 — 열려 있어도 본문을 가리거나 막지 않아 탭을 바로 누를 수 있다', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    await screen.findByRole('heading', { name: '대시보드' })
    await openUserMenu()
    // 모달이면 메뉴 밖을 aria-hidden 으로 숨겨 접근성 트리에서 이 둘을 찾지 못한다
    const nav = screen.getByRole('navigation', { name: '주요 화면' })
    const heading = screen.getByRole('heading', { name: '대시보드' })
    for (const region of [nav, heading]) {
      expect(region.closest('[aria-hidden="true"]')).toBeNull()
      expect(region.closest('[inert]')).toBeNull()
    }
    expect(document.body.style.pointerEvents).not.toBe('none')

    // 모달이면 body 가 pointer-events: none 이라 이 클릭이 막힌다
    await userEvent.click(within(nav).getByRole('link', { name: '태스크' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await app.expectPath('/workspaces/ws_01/tasks')
  })

  it('Space 로도 열리고, 바깥을 누르면 닫힌다', async () => {
    renderApp('/workspaces/ws_01/dashboard')
    const trigger = await screen.findByRole('button', { name: '내 계정: 최진호' })
    trigger.focus()
    await userEvent.keyboard(' ')
    const menu = await screen.findByRole('menu', { name: /^내 계정/ })
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: '설정' })).toHaveFocus())
    await userEvent.click(await screen.findByRole('heading', { name: '대시보드' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('마우스로 `설정` 을 고르면 포커스가 아바타에 남지 않고 설정 화면 제목으로 간다', async () => {
    renderApp('/workspaces/ws_01/dashboard')
    const avatar = await screen.findByRole('button', { name: '내 계정: 최진호' })
    await userEvent.click(within(await openUserMenu()).getByRole('menuitem', { name: '설정' }))
    await expectSettingsTitleFocused(avatar)
  })

  it('키보드(Enter)로 골라도 포커스가 설정 화면 제목으로 간다', async () => {
    renderApp('/workspaces/ws_01/dashboard')
    const avatar = await screen.findByRole('button', { name: '내 계정: 최진호' })
    avatar.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: /^내 계정/ })
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: '설정' })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await expectSettingsTitleFocused(avatar)
  })

  it('이동하지 않고 닫으면 아바타로 돌아온다 — Esc, 이탈 확인의 계속 작성하기', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    await screen.findByRole('heading', { name: '대시보드' })
    const avatar = screen.getByRole('button', { name: '내 계정: 최진호' })

    await openUserMenu()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(avatar).toHaveFocus())

    useUnsavedChangesStore.getState().mark('test-form')
    await userEvent.click(within(await openUserMenu()).getByRole('menuitem', { name: '설정' }))
    await userEvent.click(await screen.findByRole('button', { name: '계속 작성하기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(avatar).toHaveFocus())
    await app.expectPath('/workspaces/ws_01/dashboard')
  })

  it('공간을 고르기 전(선택 화면)의 프로필 메뉴에는 설정이 없다', async () => {
    renderApp('/workspaces')
    await screen.findByRole('heading', { name: '워크스페이스 선택' })
    const menu = await openUserMenu()
    expect(within(menu).queryByRole('menuitem', { name: '설정' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: '로그아웃' })).toBeInTheDocument()
  })
})

describe('대시보드 (U4-4 → M7)', () => {
  // M4 의 빈 상태 껍데기는 M7 대시보드로 바뀌었다. 화면 내용은 app/dashboard.test.tsx 가 본다.
  // 여기서는 셸의 메뉴가 대시보드 조회 밖의 요청을 더하지 않는지만 본다
  it('대시보드 조회만 있고, 메뉴를 열어도 새 업무 요청이 없다', async () => {
    const log = recordRequests()
    renderApp('/workspaces/ws_01/dashboard')
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await screen.findByRole('list', { name: '최근 반영 목록' })
    const before = businessRequests(log.started).length
    expect(
      businessRequests(log.started).every((request) =>
        isDashboardRequest(request, { extractionId: latestDoneExtractionId() }),
      ),
    ).toBe(true)
    await openWorkspaceMenu()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: '내 계정: 최진호' }))
    await screen.findByRole('menu', { name: /^내 계정/ })
    expect(businessRequests(log.started)).toHaveLength(before)
  })
})

describe('워크스페이스 전환 (U4-5)', () => {
  it('저장하지 않은 변경이 있으면 묻는다 — 취소하면 그대로, 이동하면 새 공간 대시보드', async () => {
    addCompletedWorkspace()
    const app = renderApp('/workspaces/ws_01/settings')
    await userEvent.type(await screen.findByLabelText('워크스페이스 이름'), ' 새 이름')

    await userEvent.click(
      within(await openWorkspaceMenu()).getByRole('menuitem', { name: /알고리즘 스터디/ }),
    )
    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '계속 작성하기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await app.expectPath('/workspaces/ws_01/settings')
    expect(screen.getByLabelText('워크스페이스 이름')).toHaveValue('카테캠 3팀 새 이름')
    // 새 공간에 들렀다 온 것도 아니다
    expect(screen.getByRole('heading', { name: '설정' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '대시보드' })).not.toBeInTheDocument()
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(
      '/workspaces/ws_04/dashboard',
    )

    await userEvent.click(
      within(await openWorkspaceMenu()).getByRole('menuitem', { name: /알고리즘 스터디/ }),
    )
    await userEvent.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    // 보던 설정 화면이 아니라 새 공간의 대시보드다 (D-066)
    await app.expectPath('/workspaces/ws_04/dashboard')
    expect(screen.getByRole('button', { name: /^워크스페이스 바꾸기/ })).toHaveTextContent(
      '알고리즘 스터디',
    )
  })

  it('전환한 뒤에는 이전 공간의 데이터가 보이지 않는다', async () => {
    addCompletedWorkspace()
    const app = renderApp('/workspaces/ws_01/members')
    expect(await screen.findByText('김서연')).toBeInTheDocument()

    await userEvent.click(
      within(await openWorkspaceMenu()).getByRole('menuitem', { name: /알고리즘 스터디/ }),
    )
    await screen.findByRole('heading', { name: '대시보드' })
    await userEvent.click(screen.getByRole('link', { name: '팀' }))
    await app.expectPath('/workspaces/ws_04/members')
    await screen.findByRole('heading', { level: 1, name: '팀' })
    // 새 공간의 팀원 조회를 기다리는 동안에도, 받은 뒤에도 ws_01 팀원이 없다
    expect(screen.queryByText('김서연')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(app.queryClient.getQueryState(['workspace', 'ws_04', 'members'])?.status).toBe(
        'success',
      ),
    )
    expect(screen.queryByText('김서연')).not.toBeInTheDocument()
  })

  it('미완료 공간의 대시보드 직접 진입은 막고 온보딩으로 보낸다', async () => {
    const log = recordRequests()
    const app = renderApp('/workspaces/ws_02/dashboard')
    await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' })
    await app.expectPath('/onboarding/ws_02/connect_notion')
    expect(screen.queryByRole('navigation', { name: '주요 화면' })).not.toBeInTheDocument()
    expect(businessRequests(log.started)).toEqual([])
  })
})

describe('새 워크스페이스 만들기 (U3-r1 #2)', () => {
  it('헤더 메뉴 → 만들기 → 나가기 → 시작한 공간의 대시보드', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    await userEvent.click(
      within(await openWorkspaceMenu()).getByRole('menuitem', { name: '새 워크스페이스 만들기' }),
    )
    await screen.findByRole('heading', { name: '워크스페이스 만들기' })
    expect(sessionStorage.getItem(RETURN_KEY)).toBe('ws_01')
    await userEvent.type(screen.getByLabelText('팀 이름'), '새 팀')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await screen.findByRole('heading', { name: 'Discord 연결' })

    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')
    // 새 공간은 설정 미완료로 메뉴에 남는다 (D-070)
    const menu = await openWorkspaceMenu()
    expect(within(menu).getByRole('menuitem', { name: /새 팀/ })).toHaveTextContent('설정 미완료')
  })

  it('이탈 확인이 이동을 붙잡아도 — 버리고 나가면 만들기로 가고, 나가기는 시작한 공간으로 돌아온다', async () => {
    const app = renderApp('/workspaces/ws_01/settings')
    await userEvent.type(await screen.findByLabelText('워크스페이스 이름'), ' 새 이름')
    await userEvent.click(
      within(await openWorkspaceMenu()).getByRole('menuitem', { name: '새 워크스페이스 만들기' }),
    )
    // 붙잡힌 동안은 그 자리다
    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/settings')
    await userEvent.click(screen.getByRole('button', { name: '변경 내용 버리고 나가기' }))

    await screen.findByRole('heading', { name: '워크스페이스 만들기' })
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    await app.expectPath('/workspaces/ws_01/dashboard')
  })

  it('선택 화면에서 시작하면 돌아올 공간이 없어 나가기가 선택 화면이다', async () => {
    sessionStorage.setItem(RETURN_KEY, 'ws_01')
    const app = renderApp('/workspaces')
    await userEvent.click(await screen.findByRole('button', { name: '새 워크스페이스 만들기' }))
    await screen.findByRole('heading', { name: '워크스페이스 만들기' })
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    await app.expectPath('/workspaces')
  })
})

describe('나가기 뒤 복귀 기억 (U4-r1 #3)', () => {
  it('나가기로 실제로 나가면 기억을 지운다 — 주소창으로 다른 미완료 공간에 들어가도 앞 공간으로 가지 않는다', async () => {
    sessionStorage.setItem(RETURN_KEY, 'ws_01')
    const app = renderApp('/onboarding/create_workspace')
    await screen.findByRole('heading', { name: '워크스페이스 만들기' })
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    await screen.findByRole('heading', { name: '대시보드' })
    await app.expectPath('/workspaces/ws_01/dashboard')
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull()

    // 메뉴를 거치지 않고 주소로 미완료 공간의 온보딩에 들어간다
    app.navigate('/onboarding/ws_02/connect_notion')
    await screen.findByRole('heading', { name: 'PM이 워크스페이스 설정을 마무리하고 있어요' })
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
  })

  it('이탈 확인에서 계속 작성하기를 고르면 기억이 남는다', async () => {
    sessionStorage.setItem(RETURN_KEY, 'ws_01')
    const app = renderApp('/onboarding/create_workspace')
    await userEvent.type(await screen.findByLabelText('팀 이름'), '적는 중')
    await userEvent.click(screen.getByRole('link', { name: '온보딩 나가기' }))
    await userEvent.click(await screen.findByRole('button', { name: '계속 작성하기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await app.expectPath('/onboarding/create_workspace')
    expect(sessionStorage.getItem(RETURN_KEY)).toBe('ws_01')
    // 대시보드에 들렀다 온 것도 아니다
    expect(screen.getByRole('heading', { name: '워크스페이스 만들기' })).toBeInTheDocument()
    expect(screen.getByLabelText('팀 이름')).toHaveValue('적는 중')
    expect(screen.queryByRole('heading', { name: '대시보드' })).not.toBeInTheDocument()
    expect(app.visited().map(({ pathname }) => pathname)).toEqual(['/onboarding/create_workspace'])
  })
})

describe('복귀 공간 기억의 정리 (U3-r1 #1)', () => {
  it('로그아웃하면 지운다', async () => {
    sessionStorage.setItem(RETURN_KEY, 'ws_01')
    renderApp('/workspaces/ws_01/dashboard')
    await userEvent.click(await screen.findByRole('button', { name: /^내 계정/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
    await screen.findByRole('heading', { name: '로그인' })
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull()
  })

  it('다른 사용자가 로그인하면 지운다', async () => {
    sessionStorage.setItem(RETURN_KEY, 'ws_01')
    db.authenticated = false
    renderApp('/login')
    await screen.findByRole('heading', { name: '로그인' })
    await userEvent.type(screen.getByLabelText('이메일'), 'pm@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('heading', { name: '워크스페이스 선택' })
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull()
  })

  it('세션이 만료되면 지운다', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    await screen.findByRole('heading', { name: '대시보드' })
    sessionStorage.setItem(RETURN_KEY, 'ws_01')
    act(() => {
      expect(expireSession(app.queryClient)).toBe(true)
    })
    await screen.findByRole('heading', { name: '로그인' })
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull()
    expect(useUnsavedChangesStore.getState().sources.size).toBe(0)
  })
})
