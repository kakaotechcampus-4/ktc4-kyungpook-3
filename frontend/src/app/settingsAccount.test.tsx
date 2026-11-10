import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* #627 설정의 계정 절. 아이디를 보고 바꾸고, 이메일 없는 카카오 계정도 깨지지 않는다 */

vi.setConfig({ testTimeout: 15_000 })

const SETTINGS = paths.settings('ws_01')

const RULE = '아이디는 영문과 숫자로 된 4~20자로 입력해 주세요.'

async function accountSection() {
  return within(await screen.findByRole('region', { name: '계정' }))
}

async function typeUsername(value: string) {
  const field = (await accountSection()).getByLabelText('아이디')
  await userEvent.clear(field)
  await userEvent.type(field, value)
  return field
}

const saveButton = () => screen.getByRole('button', { name: '저장' })

const availabilityGets = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ path }) => path.startsWith('/auth/username-availability'))

describe('계정 절', () => {
  it('목차의 알림 다음에 있고, 이메일과 지금 아이디를 보인다', async () => {
    applyScenario('single-workspace')
    renderApp(SETTINGS)
    const nav = within(await screen.findByRole('navigation', { name: '설정 목차' }))
    await userEvent.click(nav.getByRole('link', { name: '계정' }))
    expect(screen.getByRole('heading', { level: 2, name: '계정' })).toHaveFocus()

    const section = await accountSection()
    expect(section.getByText('pm@example.com')).toBeInTheDocument()
    expect(section.getByLabelText('아이디')).toHaveValue('userpm')
    expect(section.queryByText('이메일 없음')).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('일반 팀원도 자기 아이디를 바꿀 수 있다', async () => {
    applyScenario('settings-member')
    renderApp(SETTINGS)
    const field = await typeUsername('member01')
    expect(field).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: '중복 확인' }))
    expect(await screen.findByText('사용할 수 있는 아이디예요.')).toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })
})

describe('이메일 없는 카카오 계정', () => {
  beforeEach(() => applyScenario('kakao-account'))

  it('설정은 이메일 없음과 까닭을 보이고, 사용자 메뉴는 이름 아래에 아이디를 보인다', async () => {
    renderApp(SETTINGS)
    const section = await accountSection()
    expect(section.getByText('이메일 없음')).toBeInTheDocument()
    expect(section.getByText('카카오로 로그인하는 계정이라 이메일이 없어요.')).toBeInTheDocument()
    expect(section.getByLabelText('아이디')).toHaveValue('userpm')

    await userEvent.click(screen.getByRole('button', { name: '내 계정: 최진호' }))
    const menu = within(await screen.findByRole('menu', { name: /^내 계정/ }))
    expect(menu.getByText('userpm')).toBeInTheDocument()
  })

  it('아이디를 바꾸면 응답으로 세션을 고쳐 메뉴에도 바로 보이고 /auth/me 를 다시 묻지 않는다', async () => {
    const bodies = recordRequestBodies('PATCH', '/users/me')
    const log = recordRequests()
    renderApp(SETTINGS)
    await typeUsername(' NewName1 ')
    await userEvent.click(screen.getByRole('button', { name: '중복 확인' }))
    await screen.findByText('사용할 수 있는 아이디예요.')
    const before = log.started.length
    await userEvent.click(saveButton())

    expect(await screen.findByText('아이디를 바꿨어요.')).toBeInTheDocument()
    expect(bodies).toEqual([{ username: 'newname1' }])
    expect(db.accounts[0].session.user.username).toBe('newname1')
    const field = (await accountSection()).getByLabelText('아이디')
    expect(field).toHaveValue('newname1')
    expect(saveButton()).toBeDisabled()
    expect(log.started.slice(before).filter(({ path }) => path === '/auth/me')).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: '내 계정: 최진호' }))
    const menu = within(await screen.findByRole('menu', { name: /^내 계정/ }))
    expect(menu.getByText('newname1')).toBeInTheDocument()
  })
})

describe('아이디 바꾸기', () => {
  beforeEach(() => applyScenario('single-workspace'))

  it('지금 아이디와 같으면 묻지 않고 지금 쓰고 있다고 알린다. 저장할 수 없다', async () => {
    const log = recordRequests()
    renderApp(SETTINGS)
    const field = await typeUsername('UserPM')
    await userEvent.click(screen.getByRole('button', { name: '중복 확인' }))

    await waitFor(() =>
      expect(field).toHaveAccessibleDescription('영문·숫자 4~20자 지금 쓰고 있는 아이디예요.'),
    )
    expect(availabilityGets(log)).toEqual([])
    expect(saveButton()).toBeDisabled()
  })

  it('확인 뒤 남이 가져가 409 USERNAME_TAKEN 이면 아이디 칸 오류가 되고 저장이 꺼진다', async () => {
    db.usernameRace = ['newname1']
    renderApp(SETTINGS)
    const field = await typeUsername('newname1')
    await userEvent.click(screen.getByRole('button', { name: '중복 확인' }))
    await screen.findByText('사용할 수 있는 아이디예요.')
    await userEvent.click(saveButton())

    await waitFor(() =>
      expect(field).toHaveAccessibleDescription('영문·숫자 4~20자 이미 사용 중인 아이디예요.'),
    )
    expect(saveButton()).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(db.accounts[0].session.user.username).toBe('userpm')
  })

  it('규칙 밖이면 묻지 않고 알린다. 서버가 400 username 칸 오류를 줘도 같은 문구다', async () => {
    const log = recordRequests()
    renderApp(SETTINGS)
    const field = await typeUsername('a b')
    await userEvent.click(screen.getByRole('button', { name: '중복 확인' }))
    await waitFor(() => expect(field).toHaveAccessibleDescription(`영문·숫자 4~20자 ${RULE}`))
    expect(availabilityGets(log)).toEqual([])

    server.use(
      http.patch(
        '/api/v1/users/me',
        () =>
          fail('INVALID_REQUEST', 'x', 400, {
            fields: [{ loc: ['body', 'username'], msg: 'Value error' }],
          }),
        { once: true },
      ),
    )
    await typeUsername('newname1')
    await userEvent.click(screen.getByRole('button', { name: '중복 확인' }))
    await screen.findByText('사용할 수 있는 아이디예요.')
    await userEvent.click(saveButton())
    await waitFor(() => expect(field).toHaveAccessibleDescription(`영문·숫자 4~20자 ${RULE}`))
    expect(saveButton()).toBeDisabled()
  })

  it('그 밖의 실패는 폼 위에 알리고 다시 저장할 수 있다', async () => {
    server.use(
      http.patch('/api/v1/users/me', () => fail('INTERNAL_ERROR', 'x', 500), { once: true }),
    )
    renderApp(SETTINGS)
    await typeUsername('newname1')
    await userEvent.click(screen.getByRole('button', { name: '중복 확인' }))
    await screen.findByText('사용할 수 있는 아이디예요.')
    await userEvent.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 문제가 생겼어요.')
    await userEvent.click(saveButton())
    expect(await screen.findByText('아이디를 바꿨어요.')).toBeInTheDocument()
  })

  it('응답을 읽지 못하면 실패라고 하지 않고, 새로고침이 세션을 다시 받는다 (D-184)', async () => {
    server.use(http.patch('/api/v1/users/me', () => ok({ user_id: 'us_01' }), { once: true }))
    const log = recordRequests()
    renderApp(SETTINGS)
    await typeUsername('newname1')
    await userEvent.click(screen.getByRole('button', { name: '중복 확인' }))
    await screen.findByText('사용할 수 있는 아이디예요.')
    await userEvent.click(saveButton())

    const notice = (await screen.findByText('변경 결과를 확인하지 못했어요')).closest(
      'li',
    ) as HTMLElement
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    const before = log.started.length
    fireEvent.click(within(notice).getByRole('button', { name: '새로고침' }))
    await waitFor(() =>
      expect(log.started.slice(before)).toContainEqual({ method: 'GET', path: '/auth/me' }),
    )
  })

  it('바꾼 채 나가려 하면 이탈 확인을 거친다', async () => {
    const app = renderApp(SETTINGS)
    await typeUsername('newname1')
    await userEvent.click(
      within(screen.getByRole('navigation', { name: '설정 목차' })).getByRole('link', {
        name: '팀원',
      }),
    )
    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '계속 작성하기' }))
    await app.expectPath(SETTINGS)
  })
})
