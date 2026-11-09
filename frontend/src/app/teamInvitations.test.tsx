import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #320 — PM 이 팀 화면에서 로그인 계정 없는 팀원을 초대하고, 팀원마다 최근 초대 상태를 본다.
 * #632 — 초대할 사람은 가입한 아이디로 찾아 이름과 아이디를 확인한 뒤 고른다. 초대는 그 사람의 user_id 로 간다.
 * team-invitations: 박민수 수락(us_02), 이재환 대기(us_03 jaehwan, 그 전에 한도윤에게 보냈다 취소한 초대가 하나 더 있다),
 * 정하늘 거절(us_04 haneul), 김서연은 PM. 한도윤(us_05 doyun)은 어느 팀원과도 이어지지 않은 가입자다
 */

vi.setConfig({ testTimeout: 15_000 })

const TEAM = paths.members('ws_01')
const NOT_FOUND = '가입한 사용자의 아이디를 정확히 입력해 주세요.'
const SEARCH = '/api/v1/users/search'
const CREATE = '/api/v1/workspaces/:workspaceId/invitations'

async function row(name: string) {
  return within(await screen.findByRole('region', { name }))
}

/** 화면에 뜬 알림 중 그 문구가 보이는 것 */
const toastWith = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-toast-key]')).find((node) =>
    node.textContent?.includes(text),
  ) ?? null

const invitationOf = (invitationId: string) =>
  db.invitations.find(({ invitation_id }) => invitation_id === invitationId)

const searches = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ path }) => path.startsWith('/users/search'))

const creates = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(
    ({ method, path }) => method === 'POST' && path === '/workspaces/ws_01/invitations',
  )

/** 그 팀원 줄의 `다시 초대`·`초대` 로 창을 연다 */
async function openInvite(name: string, button = '다시 초대') {
  const user = userEvent.setup()
  await user.click(await (await row(name)).findByRole('button', { name: button }))
  const dialog = within(await screen.findByRole('dialog', { name: `${name} 초대` }))
  return { user, dialog }
}

/** 아이디를 넣고 `찾기` 를 누른다 */
async function find(
  { user, dialog }: Awaited<ReturnType<typeof openInvite>>,
  username: string,
): Promise<void> {
  await user.type(dialog.getByLabelText('아이디'), username)
  await user.click(dialog.getByRole('button', { name: '찾기' }))
}

describe('팀 화면 — 팀원 초대', () => {
  beforeEach(() => {
    applyScenario('team-invitations')
  })

  it('팀원마다 최근 초대의 상태와 초대받은 사람의 이름·아이디, 할 수 있는 조작을 보인다', async () => {
    renderApp(TEAM)

    const jaehwan = await row('이재환')
    expect(await jaehwan.findByText('대기')).toBeInTheDocument()
    expect(jaehwan.getByText('이재환 · jaehwan')).toBeInTheDocument()
    expect(jaehwan.queryByText('한도윤 · doyun')).toBeNull()
    expect(jaehwan.getByRole('button', { name: '다시 초대' })).toBeInTheDocument()
    expect(jaehwan.getByRole('button', { name: '초대 취소' })).toBeInTheDocument()

    const minsu = await row('박민수')
    expect(minsu.getByText('수락')).toBeInTheDocument()
    expect(minsu.getByText('박민수 · minsu@example.com')).toBeInTheDocument()
    expect(minsu.getByRole('button', { name: '연결 끊기' })).toBeInTheDocument()
    expect(minsu.queryByRole('button', { name: /초대/ })).toBeNull()

    const haneul = await row('정하늘')
    expect(haneul.getByText('거절')).toBeInTheDocument()
    expect(haneul.getByText('정하늘 · haneul')).toBeInTheDocument()
    expect(haneul.getByRole('button', { name: '다시 초대' })).toBeInTheDocument()

    const seoyeon = await row('김서연')
    // 별칭 단추(#523)만 남는다 — 초대 조작이 없다
    expect(seoyeon.getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringMatching(/^별칭/),
    ])
    expect(seoyeon.queryByText(/^(대기|수락|거절|취소|연결 끊김)$/)).toBeNull()
  })

  it('초대한 적 없는 팀원은 `초대` 만 있다', async () => {
    applyScenario('settings-unmapped')
    renderApp(TEAM)

    const jaehwan = await row('이재환')
    expect(await jaehwan.findByRole('button', { name: '초대' })).toBeInTheDocument()
    expect(jaehwan.queryByText(/^(대기|수락|거절|취소|연결 끊김)$/)).toBeNull()
  })

  it('아이디로 찾은 사람의 이름·아이디를 확인하고 초대하면 그 user_id 로 보내고 기다리던 초대는 취소된다', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(CREATE, async ({ request }) => {
        bodies.push(await request.clone().json())
      }),
    )
    renderApp(TEAM)
    const opened = await openInvite('이재환')
    const { user, dialog } = opened
    expect(
      dialog.getByText('기다리는 초대(이재환 · jaehwan)는 취소되고 새 초대가 만들어져요.'),
    ).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '초대하기' })).toBeDisabled()

    await find(opened, ' DoYun ')

    expect(await dialog.findByText('한도윤')).toBeInTheDocument()
    expect(dialog.getByText('doyun')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: '초대하기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bodies).toEqual([{ member_id: 'mb_03', user_id: 'us_05' }])
    const jaehwan = await row('이재환')
    expect(await jaehwan.findByText('한도윤 · doyun')).toBeInTheDocument()
    expect(jaehwan.getByText('대기')).toBeInTheDocument()
    expect(toastWith('초대를 만들었어요')).toHaveTextContent(
      '알림은 가지 않아요. 이재환에게 doyun 계정으로 로그인해 받은 초대를 수락하라고 알려 주세요.',
    )
    expect(invitationOf('iv_02')?.status).toBe('canceled')
  })

  it('Enter 는 찾은 사람이 없으면 찾고, 찾은 뒤에는 초대한다', async () => {
    renderApp(TEAM)
    const { user, dialog } = await openInvite('정하늘')
    const log = recordRequests()

    await user.type(dialog.getByLabelText('아이디'), 'doyun{Enter}')
    expect(await dialog.findByText('한도윤')).toBeInTheDocument()
    expect(creates(log)).toEqual([])

    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(creates(log)).toHaveLength(1)
  })

  it('찾는 아이디의 가입자가 없거나 이미 이 팀원이면 안내하고 초대하기는 꺼져 있다', async () => {
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    const { user, dialog } = opened

    await find(opened, 'nobody1')

    expect(await dialog.findByText(NOT_FOUND)).toBeInTheDocument()
    expect(dialog.getByLabelText('아이디')).toHaveAttribute('aria-invalid', 'true')
    expect(dialog.getByRole('button', { name: '초대하기' })).toBeDisabled()

    await user.clear(dialog.getByLabelText('아이디'))
    await find(opened, 'minsu')

    expect(await dialog.findByText(NOT_FOUND)).toBeInTheDocument()
    expect(dialog.queryByText('박민수')).toBeNull()
    expect(dialog.getByRole('button', { name: '초대하기' })).toBeDisabled()
  })

  it('아이디 규칙 밖이면 찾지 않고 규칙을 알린다', async () => {
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    const log = recordRequests()

    await find(opened, 'do')

    expect(
      await opened.dialog.findByText('아이디는 영문과 숫자로 된 4~20자로 입력해 주세요.'),
    ).toBeInTheDocument()
    expect(searches(log)).toEqual([])
  })

  it('찾은 뒤 입력을 바꾸면 찾은 사람이 사라지고 초대하기가 꺼진다', async () => {
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    const { user, dialog } = opened
    await find(opened, 'doyun')
    expect(await dialog.findByText('한도윤')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '초대하기' })).toBeEnabled()

    await user.type(dialog.getByLabelText('아이디'), '2')

    expect(dialog.queryByText('한도윤')).toBeNull()
    expect(dialog.getByRole('button', { name: '초대하기' })).toBeDisabled()
    expect(dialog.getByRole('button', { name: '찾기' })).toBeEnabled()
  })

  it('늦게 온 이전 검색 응답은 바뀐 입력에 붙지 않는다', async () => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let lateAnswered = false
    server.use(
      http.get(SEARCH, async ({ request }) => {
        if (new URL(request.url).searchParams.get('q') !== 'doyun') return
        await released
        lateAnswered = true
        return ok({ items: [{ user_id: 'us_05', username: 'doyun', name: '한도윤' }] })
      }),
    )
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    const { user, dialog } = opened
    const log = recordRequests()
    await find(opened, 'doyun')
    await waitFor(() => expect(searches(log)).toHaveLength(1))

    await user.clear(dialog.getByLabelText('아이디'))
    await find(opened, 'jaehwan')
    expect(await dialog.findByText('이재환')).toBeInTheDocument()
    release()

    await waitFor(() => expect(lateAnswered).toBe(true))
    await user.click(dialog.getByLabelText('아이디'))
    expect(dialog.getByText('jaehwan')).toBeInTheDocument()
    expect(dialog.queryByText('한도윤')).toBeNull()
  })

  it('찾는 중에 입력을 바꿨다가 되돌려도 찾기가 멈춰 있지 않다', async () => {
    server.use(http.get(SEARCH, () => new Promise<never>(() => {})))
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    const { user, dialog } = opened
    await find(opened, 'doyun')
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: '찾기' })).toHaveAttribute('aria-busy', 'true'),
    )

    await user.type(dialog.getByLabelText('아이디'), '2{Backspace}')

    await waitFor(() => expect(dialog.getByRole('button', { name: '찾기' })).toBeEnabled())
    expect(dialog.getByRole('button', { name: '찾기' })).not.toHaveAttribute('aria-busy')
  })

  it.each([
    ['권한이 없으면', () => fail('FORBIDDEN', 'forbidden', 403), '접근 권한이 없어요.'],
    [
      '네트워크가 끊기면',
      () => HttpResponse.error(),
      '네트워크에 연결할 수 없어요. 연결을 확인해 주세요.',
    ],
    [
      '응답 모양이 다르면',
      () => ok({ items: [{ user_id: 'us_05', username: 'doyun' }] }),
      '응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
    ],
  ])('검색이 실패해도 창 안에 이유를 보인다 — %s', async (_, respond, message) => {
    server.use(http.get(SEARCH, respond))
    renderApp(TEAM)
    const opened = await openInvite('정하늘')

    await find(opened, 'doyun')

    expect(await opened.dialog.findByText(message)).toBeInTheDocument()
    expect(opened.dialog.queryByText('한도윤')).toBeNull()
    expect(opened.dialog.getByRole('button', { name: '초대하기' })).toBeDisabled()
  })

  it('초대를 보내는 동안에는 아이디를 고칠 수 없고 한 번만 보낸다', async () => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post(CREATE, async () => {
        await released
      }),
    )
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    const { user, dialog } = opened
    const log = recordRequests()
    await find(opened, 'doyun')
    await dialog.findByText('한도윤')
    const field = dialog.getByLabelText('아이디')

    await user.click(dialog.getByRole('button', { name: '초대하기' }))
    await waitFor(() => expect(field).toBeDisabled())
    await user.type(field, 'x')
    await user.click(dialog.getByRole('button', { name: '초대하기' }))

    expect(field).toHaveValue('doyun')
    expect(dialog.getByRole('button', { name: '초대하기' })).toBeDisabled()
    expect(creates(log)).toHaveLength(1)
    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(creates(log)).toHaveLength(1)
  })

  it('`초대 취소` 는 묻지 않고 취소하고, 그 팀원은 다시 초대할 수 있다', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    const jaehwan = await row('이재환')
    await user.click(await jaehwan.findByRole('button', { name: '초대 취소' }))

    expect(await jaehwan.findByText('취소')).toBeInTheDocument()
    expect(jaehwan.queryByRole('button', { name: '초대 취소' })).toBeNull()
    expect(jaehwan.getByRole('button', { name: '다시 초대' })).toBeInTheDocument()
    expect(toastWith('초대를 취소했어요')).not.toBeNull()
    expect(invitationOf('iv_02')?.status).toBe('canceled')
  })

  it('`연결 끊기` 는 먼저 묻고, 끊으면 연결 끊김이 되어 다시 초대할 수 있다', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    await user.click(await (await row('박민수')).findByRole('button', { name: '연결 끊기' }))

    const dialog = within(
      await screen.findByRole('dialog', { name: '박민수의 계정 연결을 끊을까요?' }),
    )
    expect(dialog.getByText(/^박민수\(minsu@example\.com\) 계정은/)).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(invitationOf('iv_01')?.status).toBe('accepted')

    await user.click((await row('박민수')).getByRole('button', { name: '연결 끊기' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '연결 끊기' }),
    )

    const minsu = await row('박민수')
    expect(await minsu.findByText('연결 끊김')).toBeInTheDocument()
    expect(minsu.getByRole('button', { name: '다시 초대' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toastWith('계정 연결을 끊었어요')).not.toBeNull()
    expect(invitationOf('iv_01')?.status).toBe('revoked')
  })

  it('다른 팀원으로 기다리는 초대가 있는 사용자는 창 안에 이유를 보이고 아무것도 만들지 않는다', async () => {
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    const before = structuredClone(db.invitations)
    await find(opened, 'jaehwan')
    await opened.dialog.findByText('이재환')

    await opened.user.click(opened.dialog.getByRole('button', { name: '초대하기' }))

    expect(
      await opened.dialog.findByText(
        '이 사용자에게 다른 팀원으로 보낸 초대가 기다리고 있어요. 그 초대를 먼저 취소해 주세요.',
      ),
    ).toBeInTheDocument()
    expect(opened.dialog.getByLabelText('아이디')).toHaveAttribute('aria-invalid', 'true')
    expect(db.invitations).toEqual(before)
  })

  it('찾은 뒤 그 사람이 탈퇴했으면 다시 찾으라고 알린다', async () => {
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    await find(opened, 'doyun')
    await opened.dialog.findByText('한도윤')
    db.accounts = db.accounts.filter(({ session }) => session.user.user_id !== 'us_05')

    await opened.user.click(opened.dialog.getByRole('button', { name: '초대하기' }))

    expect(
      await opened.dialog.findByText('가입한 사용자를 찾을 수 없어요. 아이디를 다시 찾아 주세요.'),
    ).toBeInTheDocument()
  })

  it('이미 계정이 연결된 팀원이라는 거절도 창 안에 보인다', async () => {
    server.use(http.post(CREATE, () => fail('MEMBER_ALREADY_LINKED', 'linked', 409)))
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    await find(opened, 'doyun')
    await opened.dialog.findByText('한도윤')

    await opened.user.click(opened.dialog.getByRole('button', { name: '초대하기' }))

    expect(
      await opened.dialog.findByText('이미 로그인 계정이 연결된 팀원이에요.'),
    ).toBeInTheDocument()
  })

  it('창을 닫았다 다시 열면 입력과 찾은 사람이 비어 있다', async () => {
    renderApp(TEAM)
    const opened = await openInvite('정하늘')
    await find(opened, 'doyun')
    await opened.dialog.findByText('한도윤')

    await opened.user.click(opened.dialog.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const reopened = await openInvite('정하늘')

    expect(reopened.dialog.getByLabelText('아이디')).toHaveValue('')
    expect(reopened.dialog.queryByText('한도윤')).toBeNull()
    expect(reopened.dialog.getByRole('button', { name: '초대하기' })).toBeDisabled()
  })

  it('그새 처리된 초대를 취소하면 알리고 최신 상태로 바꾼다', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    const jaehwan = await row('이재환')
    const cancel = await jaehwan.findByRole('button', { name: '초대 취소' })
    const stale = invitationOf('iv_02')
    if (stale) stale.status = 'declined'

    await user.click(cancel)

    expect(await jaehwan.findByText('거절')).toBeInTheDocument()
    expect(toastWith('이미 처리된 초대예요.')).not.toBeNull()
  })
})
