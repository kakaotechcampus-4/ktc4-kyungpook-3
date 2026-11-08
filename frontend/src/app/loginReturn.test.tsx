import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { workspaceKey } from '@/shared/api/queryKeys'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { renderApp } from './test/renderApp'

/* #411 ① 로그인이 필요한 주소를 비로그인으로 열면, 로그인 뒤 그 주소로 돌아간다. 앱 밖으로는 보내지 않는다 */

async function logIn() {
  await screen.findByRole('heading', { name: '로그인' })
  await userEvent.type(screen.getByLabelText('이메일'), 'pm@example.com')
  await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
  await userEvent.click(screen.getByRole('button', { name: '로그인' }))
}

describe('비로그인으로 연 보호 주소는 로그인 뒤 그곳으로 돌아간다', () => {
  it('푸시로 연 대화', async () => {
    db.authenticated = false
    const thread = paths.messageThread('ws_01', 'th_01')
    const app = renderApp(thread, { strict: true })

    await app.expectPath('/login')
    await app.expectSearch('?next=%2Fworkspaces%2Fws_01%2Fmessages%2Fthreads%2Fth_01')

    await logIn()
    await app.expectPath(thread)
    expect(await screen.findByRole('heading', { level: 1, name: '메시지' })).toBeInTheDocument()
  })

  it('푸시로 연 태스크', async () => {
    db.authenticated = false
    const task = paths.tasks('ws_01', 'tk_01')
    const app = renderApp(task, { strict: true })

    await app.expectPath('/login')
    await app.expectSearch('?next=%2Fworkspaces%2Fws_01%2Ftasks%2Ftk_01')

    await logIn()
    await app.expectPath(task)
    expect(await screen.findByLabelText('태스크 정보')).toBeInTheDocument()
  })

  it('소속이 아닌 공간이면 그 경로의 접근 불가 화면이다', async () => {
    db.authenticated = false
    db.accounts[0].workspaceIds = ['ws_02']
    const app = renderApp(paths.dashboard('ws_01'))

    await logIn()
    expect(
      await screen.findByRole('heading', { name: '이 워크스페이스에 접근할 수 없어요' }),
    ).toBeInTheDocument()
    await app.expectPath(paths.dashboard('ws_01'))
  })
})

describe('돌아갈 경로가 앱 안 보호 경로가 아니면 버리고 평소처럼 간다', () => {
  it.each(['https%3A%2F%2Fevil.com', '%2F%2Fevil.com', '%2Fsignup'])(
    '/login?next=%s → 공간 개수 분기',
    async (next) => {
      db.authenticated = false
      const app = renderApp(`/login?next=${next}`)

      await logIn()
      expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
      await app.expectPath(paths.workspaceSelect())
    },
  )
})

describe('로그아웃·세션 만료', () => {
  it('직접 로그아웃하면 돌아갈 경로 없이 로그인으로 가고, 다시 로그인하면 공간 개수 분기다', async () => {
    const app = renderApp(paths.members('ws_01'), { strict: true })
    expect(await screen.findByText('김서연')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^내 계정/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: '로그아웃' }))

    await app.expectPath('/login')
    await app.expectSearch('')

    await logIn()
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    await app.expectPath(paths.workspaceSelect())
  })

  it('보던 중 세션이 만료되면 다시 로그인했을 때 그 화면으로 돌아간다', async () => {
    const app = renderApp(paths.members('ws_01'))
    expect(await screen.findByText('김서연')).toBeInTheDocument()

    db.authenticated = false
    // 목 GET /members 는 인증을 보지 않는다. 만료를 만든 한 번만 401 로 덮는다
    server.use(
      http.get('/api/v1/members', () => fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401), {
        once: true,
      }),
    )
    await act(async () => {
      await app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01', 'members') })
    })

    await app.expectPath('/login')
    await app.expectSearch('?next=%2Fworkspaces%2Fws_01%2Fmembers')

    await logIn()
    await app.expectPath(paths.members('ws_01'))
    expect(await screen.findByText('김서연')).toBeInTheDocument()
  })
})
