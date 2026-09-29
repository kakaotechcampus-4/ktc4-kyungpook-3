import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expireSession } from '@/app/expireSession'
import { useUnsavedChangesStore } from '@/shared/lib/unsaved-changes'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { businessRequests, recordRequests } from '@/shared/test/requests'
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
      steps: ['create_workspace', 'connect_discord', 'connect_notion', 'connect_members'].map(
        (step) => ({ step, status: 'completed' }),
      ),
    },
  })
  db.accounts[0].workspaceIds.push('ws_04')
  db.integrations.ws_04 = {
    discord: { status: 'connected', display_name: 'x', connected_at: MOCK_NOW },
    notion: { status: 'connected', display_name: 'x', connected_at: MOCK_NOW },
  }
}

const openWorkspaceMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /^워크스페이스 바꾸기/ }))
  return screen.findByRole('menu', { name: /^워크스페이스 바꾸기/ })
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
  it('헤더에 5개 탭이 있고 설정은 탭이 아니라 워크스페이스 메뉴에 있다', async () => {
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
    expect(
      within(await openWorkspaceMenu()).getByRole('menuitem', { name: '워크스페이스 설정' }),
    ).toBeInTheDocument()
  })

  it('다른 마일스톤의 임시 화면도 셸 안에서 탭으로 오간다', async () => {
    const app = renderApp('/workspaces/ws_01/dashboard')
    const nav = await screen.findByRole('navigation', { name: '주요 화면' })
    for (const [tab, heading, path] of [
      ['회의록', '회의', '/workspaces/ws_01/meetings'],
      ['태스크', '태스크', '/workspaces/ws_01/tasks'],
      ['메시지', '메시지는 준비 중이에요', '/workspaces/ws_01/messages'],
      ['팀', '팀원', '/workspaces/ws_01/members'],
    ] as const) {
      await userEvent.click(within(nav).getByRole('link', { name: tab }))
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      await app.expectPath(path)
      expect(within(nav).getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page')
    }
    await userEvent.click(
      within(await openWorkspaceMenu()).getByRole('menuitem', { name: '워크스페이스 설정' }),
    )
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '주요 화면' })).toBeInTheDocument()
  })
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
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: '로그아웃' })).toHaveFocus(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})

describe('대시보드 (U4-4)', () => {
  it('빈 상태와 다음 행동 안내만 있고 집계·목록 API 요청은 0회다', async () => {
    const log = recordRequests()
    renderApp('/workspaces/ws_01/dashboard')
    expect(
      await screen.findByRole('heading', { name: '확인할 일이 여기에 모여요' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '회의록으로 가기' })).toHaveAttribute(
      'href',
      '/workspaces/ws_01/meetings',
    )
    // 메뉴를 열어도 새 요청이 없다 — 부팅 조회 캐시만 쓴다
    await openWorkspaceMenu()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: '내 계정: 최진호' }))
    await screen.findByRole('menu', { name: /^내 계정/ })
    expect(businessRequests(log.started)).toEqual([])
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
    await screen.findByRole('heading', { name: '팀원' })
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
    await app.expectPath('/onboarding/create_workspace')
    expect(sessionStorage.getItem(RETURN_KEY)).toBe('ws_01')
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
