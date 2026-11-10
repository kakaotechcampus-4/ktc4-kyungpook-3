import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { leaveApp } from '@/shared/lib/location'
import { readReturnWorkspace, rememberReturnWorkspace } from '@/shared/lib/return-workspace'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { renderApp } from './test/renderApp'
import { walkSignup } from './test/walkSignup'

/* #427 로그인 화면의 카카오. 복귀는 새 문서라 주소만 들고 들어온다 */

vi.mock('@/shared/lib/location', () => ({ leaveApp: vi.fn() }))

const NEXT = paths.tasks('ws_01', 'tk_01')

const NEXT_QUERY = '?next=%2Fworkspaces%2Fws_01%2Ftasks%2Ftk_01'

const returned = (query: string, next = false) =>
  `/login?${next ? `${NEXT_QUERY.slice(1)}&` : ''}oauth=kakao&${query}`

beforeEach(() => {
  vi.mocked(leaveApp).mockClear()
})

describe('카카오 로그인 버튼', () => {
  beforeEach(() => {
    db.authenticated = false
  })

  it('next 를 들고 현재 탭을 옮기고, 앞 사용자의 복귀 공간을 지운다', async () => {
    rememberReturnWorkspace('ws_09')
    renderApp(paths.login(NEXT))
    await userEvent.click(await screen.findByRole('button', { name: '카카오 로그인' }))
    expect(leaveApp).toHaveBeenCalledExactlyOnceWith(`/api/v1/auth/kakao/start${NEXT_QUERY}`)
    expect(readReturnWorkspace()).toBeNull()
  })

  it('회원가입 링크에도 next 가 이어진다 (#427)', async () => {
    const app = renderApp(paths.login(NEXT))
    await userEvent.click(await screen.findByRole('link', { name: '회원가입' }))
    await app.expectPath('/signup')
    await app.expectSearch(NEXT_QUERY)
  })

  it('가입한 새 계정은 next 대신 시작 화면으로 간다. 초대는 그곳에서 받는다 (#411)', async () => {
    const app = renderApp(paths.signup({ next: NEXT }))
    await screen.findByLabelText('이메일')
    await walkSignup({ name: '새 사용자', email: 'new-next@example.com', password: 'password1' })
    await app.expectPath('/onboarding/start')
  })
})

describe('카카오에서 돌아온 결과 안내', () => {
  beforeEach(() => {
    db.authenticated = false
  })

  // 병합 안내(email_exists)는 없어졌다 (#627). 옛 사유가 붙어 와도 일반 실패이고 주소의 값을 싣지 않는다
  it.each([
    'oauth_result=failed',
    'oauth_result=failed&oauth_reason=email_exists',
    'oauth_result=failed&oauth_reason=%EC%9C%84%EC%A1%B0',
  ])('%s 는 오류로 알린다', async (query) => {
    renderApp(returned(query))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '카카오 로그인에 실패했어요. 다시 시도해 주세요.',
    )
    expect(screen.queryByText(/이미 가입된 이메일|위조/)).not.toBeInTheDocument()
  })

  it('취소는 조용한 안내다. 오류가 아니다', async () => {
    renderApp(returned('oauth_result=cancelled'))
    expect(await screen.findByRole('status')).toHaveTextContent('카카오 로그인을 취소했어요.')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('주소에서 결과만 지우고 next 는 남긴다. 지운 뒤에도 안내는 보인다', async () => {
    const app = renderApp(returned('oauth_result=failed', true), {
      strict: true,
    })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await app.expectSearch(NEXT_QUERY)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('다시 제출하면 오류 안내가 사라진다', async () => {
    renderApp(returned('oauth_result=failed'))
    await screen.findByRole('alert')
    await userEvent.type(screen.getByLabelText('이메일'), 'pm@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() =>
      expect(screen.queryByText('카카오 로그인에 실패했어요. 다시 시도해 주세요.')).toBeNull(),
    )
  })

  it('다른 제공자의 복귀는 건드리지 않는다', async () => {
    const app = renderApp('/login?oauth=discord&oauth_result=failed')
    await screen.findByRole('heading', { name: '로그인' })
    expect(screen.queryByRole('alert')).toBeNull()
    await app.expectSearch('?oauth=discord&oauth_result=failed')
  })
})

describe('카카오 로그인 성공 복귀는 이메일 로그인과 같은 곳으로 간다', () => {
  it('마지막 공간이 있어도 재방문이 아니라 공간 개수 분기다 (D-010)', async () => {
    const app = renderApp(returned('oauth_result=success'))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    await app.expectPath('/workspaces')
    expect(app.visited().map(({ pathname }) => pathname)).toEqual(['/login', '/workspaces'])
  })

  it('공간이 없으면 시작 작업 선택이다', async () => {
    applyScenario('no-workspace')
    const app = renderApp(returned('oauth_result=success'))
    expect(await screen.findByRole('heading', { name: '어떻게 시작할까요?' })).toBeInTheDocument()
    await app.expectPath('/onboarding/start')
  })

  it('next 가 있으면 그곳이 먼저다', async () => {
    const app = renderApp(returned('oauth_result=success', true))
    await app.expectPath(NEXT)
  })

  it('다른 제공자의 표시로는 재방문 규칙을 바꾸지 않는다', async () => {
    const app = renderApp('/login?oauth=discord&oauth_result=success')
    await app.expectPath('/workspaces/ws_01/dashboard')
  })
})
