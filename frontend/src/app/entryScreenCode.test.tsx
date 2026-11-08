import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'
import { paths } from '@/shared/config/routes'
import { provideScreenCode } from '@/shared/lib/screen-code'
import { db } from '@/shared/mock/db'
import { renderApp } from './test/renderApp'

/*
 * #539 B — 로그인 중(공간 목록을 받는 동안) 도착할 화면의 코드를 같은 미리 부르기로 받기 시작한다.
 * 기본은 대시보드, 돌아갈 경로(`?next=`)가 있으면 그 화면이다. 미리 받기는 덤이라 실패해도 로그인을 막지 않는다.
 * 앱의 경로 표가 받는 신호 옆에 엿보는 쪽을 하나 더 붙여 무엇을 부탁했는지 본다.
 */

async function logIn() {
  await screen.findByRole('heading', { name: '로그인' })
  await userEvent.type(screen.getByLabelText('이메일'), 'pm@example.com')
  await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
  await userEvent.click(screen.getByRole('button', { name: '로그인' }))
}

function watchScreenCode(onRequest: (path: string) => void = () => {}) {
  const requested: string[] = []
  onTestFinished(
    provideScreenCode((path) => {
      requested.push(path)
      onRequest(path)
    }),
  )
  return requested
}

describe('로그인 중에 도착할 화면의 코드를 받기 시작한다', () => {
  it('돌아갈 경로가 없으면 대시보드 화면 코드다', async () => {
    db.authenticated = false
    const requested = watchScreenCode()
    renderApp(paths.login())

    await logIn()
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
    expect(requested).toEqual([paths.dashboard(':workspaceId')])
  })

  it('돌아갈 경로가 있으면 그 화면 코드다', async () => {
    db.authenticated = false
    const task = paths.tasks('ws_01', 'tk_01')
    const requested = watchScreenCode()
    const app = renderApp(task)
    await app.expectPath('/login')

    await logIn()
    await app.expectPath(task)
    expect(requested).toEqual([task])
  })

  it('미리 받기가 실패해도 로그인은 막히지 않는다', async () => {
    db.authenticated = false
    const task = paths.tasks('ws_01', 'tk_01')
    watchScreenCode(() => {
      throw new Error('chunk load failed')
    })
    const app = renderApp(task)
    await app.expectPath('/login')

    await logIn()
    await app.expectPath(task)
    expect(await screen.findByLabelText('태스크 정보')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
