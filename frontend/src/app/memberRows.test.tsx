import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import type { RecordedRequest } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * #647 팀원 한 명이 한 줄인 팀원 목록. 팀원 관리 창과 온보딩이 같은 목록을 쓴다 — 여기서는 팀원 관리 창으로 본다.
 * settings-unmapped(ws_01): 김서연(PM, 1123 seoyeon_01) · 박민수(1124 minsu) · 이재환(연결 없음) ·
 * 정하늘(1126, 서버를 떠남). 1125 jihun_dev(지훈)는 아무에게도 연결되지 않았고 1199 는 봇이다
 */

// 앱 전체를 그리고 창 안의 목록과 확인 창을 실제로 거친다. team.test.tsx 와 같은 15초를 준다
vi.setConfig({ testTimeout: 15_000 })

const memberWrites = (requests: RecordedRequest[]) =>
  requests
    .filter(({ method, path }) => method !== 'GET' && path.startsWith('/members'))
    .map(({ method, path }) => `${method} ${path}`)

const dbMember = (id: string) => {
  const member = db.members.find(({ member_id }) => member_id === id)
  if (member === undefined) throw new Error(`${id} missing`)
  return member
}

async function openManage(user: UserEvent) {
  renderApp(paths.members('ws_01'))
  await user.click(await screen.findByRole('button', { name: '팀원 관리' }))
  const dialog = await screen.findByRole('dialog', { name: '팀원 관리' })
  await within(dialog).findByRole('list', { name: '팀원' })
  return within(dialog)
}

const accountField = (name: string) =>
  screen.getByRole('combobox', { name: `${name}의 디스코드 계정` })

/** 그 팀원의 줄. 계정 칸이 있는 줄이다 */
const rowOf = (name: string) => {
  const row = accountField(name).closest('li')
  if (row === null) throw new Error(`${name} row missing`)
  return within(row)
}

async function pickAccount(user: UserEvent, name: string, username: string) {
  await user.click(accountField(name))
  await user.click(await screen.findByRole('option', { name: new RegExp(`^@${username}`) }))
}

beforeEach(() => {
  applyScenario('settings-unmapped')
})

describe('팀원 목록 — 계정 고르기와 옮기기', () => {
  it('잘못 고른 계정을 다른 팀원에서 다시 고르면 연결만 옮기고 앞 팀원 이름은 그대로다', async () => {
    const user = userEvent.setup()
    const leeBodies = recordRequestBodies('PATCH', '/members/mb_03')
    const parkBodies = recordRequestBodies('PATCH', '/members/mb_02')
    await openManage(user)
    await pickAccount(user, '이재환', 'jihun_dev')
    await waitFor(() => expect(accountField('이재환')).toHaveTextContent('@jihun_dev'))
    const log = recordRequests()

    await pickAccount(user, '박민수', 'jihun_dev')
    const confirm = within(await screen.findByRole('dialog', { name: '이재환 님에서 옮길까요?' }))
    expect(
      confirm.getByText('이재환 님은 이름이 그대로 남고 디스코드 연결만 풀려요.'),
    ).toBeInTheDocument()
    await user.click(confirm.getByRole('button', { name: '옮기기' }))

    await waitFor(() => expect(accountField('박민수')).toHaveTextContent('@jihun_dev'))
    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_03', 'PATCH /members/mb_02'])
    await waitFor(() => expect(parkBodies).toEqual([{ discord_user_id: '1125' }]))
    expect(leeBodies).toEqual([{ discord_user_id: '1125' }, { discord_user_id: null }])
    expect(dbMember('mb_03')).toMatchObject({ display_name: '이재환', discord_user_id: null })
    expect(dbMember('mb_02')).toMatchObject({ display_name: '박민수', discord_user_id: '1125' })
    expect(accountField('이재환')).toHaveTextContent('계정 고르기')
    expect(rowOf('이재환').queryByRole('button', { name: '이재환 연결 풀기' })).toBeNull()
  })

  it('계정마다 연결 상태를 보이고 봇은 없다', async () => {
    const user = userEvent.setup()
    await openManage(user)
    await user.click(accountField('이재환'))
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      '@seoyeon_01서연 · 김서연 님에 연결됨',
      '@minsu박민수 님에 연결됨',
      '@jihun_dev지훈 · 연결 안 됨',
    ])
    await user.keyboard('{Escape}')
    expect(accountField('정하늘')).toHaveTextContent('서버에 없는 계정')
    expect(accountField('박민수')).toHaveTextContent('@minsu')
  })

  it('옮기기를 취소하면 아무것도 보내지 않고 화면도 그대로다', async () => {
    const user = userEvent.setup()
    const log = recordRequests()
    await openManage(user)
    await pickAccount(user, '이재환', 'minsu')
    const confirm = within(await screen.findByRole('dialog', { name: '박민수 님에서 옮길까요?' }))
    await user.click(confirm.getByRole('button', { name: '취소' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '박민수 님에서 옮길까요?' })).toBeNull(),
    )
    expect(accountField('이재환')).toHaveTextContent('계정 고르기')
    expect(accountField('박민수')).toHaveTextContent('@minsu')
    expect(memberWrites(log.started)).toEqual([])
  })

  it('옮기기의 잇기가 실패하면 앞 팀원은 연결 안 됨으로 보이고, 새 팀원 줄의 다시 시도로 잇는다', async () => {
    server.use(
      http.patch('/api/v1/members/mb_03', () => fail('INTERNAL_ERROR', 'x', 500), { once: true }),
    )
    const user = userEvent.setup()
    const log = recordRequests()
    await openManage(user)
    await pickAccount(user, '이재환', 'minsu')
    await user.click(
      within(await screen.findByRole('dialog', { name: '박민수 님에서 옮길까요?' })).getByRole(
        'button',
        { name: '옮기기' },
      ),
    )

    expect(await rowOf('이재환').findByRole('alert')).toHaveTextContent(
      '박민수 님 연결은 풀었지만 이 팀원에 잇지 못했어요. 서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    )
    expect(accountField('박민수')).toHaveTextContent('계정 고르기')
    expect(accountField('이재환')).toHaveTextContent('계정 고르기')

    await user.click(rowOf('이재환').getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(accountField('이재환')).toHaveTextContent('@minsu'))
    expect(rowOf('이재환').queryByRole('alert')).toBeNull()
    expect(memberWrites(log.started)).toEqual([
      'PATCH /members/mb_02',
      'PATCH /members/mb_03',
      'PATCH /members/mb_03',
    ])
    expect(dbMember('mb_03').discord_user_id).toBe('1124')
  })

  it('그사이 다른 팀원이 계정을 가져갔으면(409) 줄에 문구를 두고 목록을 다시 받는다', async () => {
    const user = userEvent.setup()
    await openManage(user)
    db.members.push({
      member_id: 'mb_70',
      workspace_id: 'ws_01',
      display_name: '최지훈',
      discord_user_id: '1125',
      notion_name: null,
      role: 'member',
      has_login_account: false,
      created_at: MOCK_NOW,
    })
    await pickAccount(user, '이재환', 'jihun_dev')

    expect(await rowOf('이재환').findByRole('alert')).toHaveTextContent(
      '이미 다른 팀원과 연결된 Discord 계정이에요.',
    )
    expect(await screen.findByRole('button', { name: '최지훈 이름 고치기' })).toBeInTheDocument()
  })

  it('연결 풀기는 묻지 않고 바로 풀고, 그 계정은 연결되지 않은 계정 목록에 들어간다', async () => {
    const user = userEvent.setup()
    const bodies = recordRequestBodies('PATCH', '/members/mb_02')
    const dialog = await openManage(user)
    expect(
      dialog.getByRole('heading', { name: '아직 팀원에 연결되지 않은 디스코드 계정 1개' }),
    ).toBeInTheDocument()

    await user.click(rowOf('박민수').getByRole('button', { name: '박민수 연결 풀기' }))

    await waitFor(() => expect(accountField('박민수')).toHaveTextContent('계정 고르기'))
    await waitFor(() => expect(bodies).toEqual([{ discord_user_id: null }]))
    expect(
      await dialog.findByRole('heading', { name: '아직 팀원에 연결되지 않은 디스코드 계정 2개' }),
    ).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: '@minsu 팀원으로 추가' })).toBeInTheDocument()
  })
})

describe('팀원 목록 — 팀원 추가와 이름 고치기', () => {
  it('연결 안 된 계정을 팀원으로 추가하면 표시 이름으로 만들고 그 줄의 이름 고치기 칸을 연다', async () => {
    const user = userEvent.setup()
    const created = recordRequestBodies('POST', '/members')
    const dialog = await openManage(user)
    await user.click(dialog.getByRole('button', { name: '@jihun_dev 팀원으로 추가' }))

    const editor = await dialog.findByRole('textbox', { name: '지훈의 새 이름' })
    expect(editor).toHaveFocus()
    expect(editor).toHaveValue('지훈')
    await waitFor(() =>
      expect(created).toEqual([
        { workspace_id: 'ws_01', display_name: '지훈', discord_user_id: '1125' },
      ]),
    )
    expect(
      dialog.getByText('모든 디스코드 계정이 팀원에 연결됐어요.', { exact: true }),
    ).toBeInTheDocument()

    const newId = db.members.at(-1)?.member_id ?? ''
    const renamed = recordRequestBodies('PATCH', `/members/${newId}`)
    await user.clear(editor)
    await user.type(editor, '최지훈{Enter}')
    expect(await dialog.findByRole('button', { name: '최지훈 이름 고치기' })).toBeInTheDocument()
    await waitFor(() => expect(renamed).toEqual([{ display_name: '최지훈' }]))
    expect(accountField('최지훈')).toHaveTextContent('@jihun_dev')
  })

  it('표시 이름과 같은 이름의 팀원이 있으면 보내지 않고 그 줄에서 고르라고 한다', async () => {
    db.members.push({
      member_id: 'mb_70',
      workspace_id: 'ws_01',
      display_name: '지훈',
      discord_user_id: null,
      notion_name: null,
      role: 'member',
      has_login_account: false,
      created_at: MOCK_NOW,
    })
    const user = userEvent.setup()
    const log = recordRequests()
    const dialog = await openManage(user)
    await user.click(dialog.getByRole('button', { name: '@jihun_dev 팀원으로 추가' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      '같은 이름의 팀원 지훈 님이 있어요. 그 줄에서 이 계정을 골라 주세요.',
    )
    expect(memberWrites(log.started)).toEqual([])
  })

  it('이름 고치기는 다른 팀원과 같은 이름이면 보내지 않고, 자기 이름 그대로면 요청 없이 닫고, 새 이름은 저장한다', async () => {
    const user = userEvent.setup()
    const log = recordRequests()
    const bodies = recordRequestBodies('PATCH', '/members/mb_03')
    const dialog = await openManage(user)

    await user.click(dialog.getByRole('button', { name: '이재환 이름 고치기' }))
    const editor = dialog.getByRole('textbox', { name: '이재환의 새 이름' })
    await user.clear(editor)
    await user.type(editor, ' 박민수{Enter}')
    expect(editor).toHaveAccessibleDescription('이미 같은 이름의 팀원이 있어요.')

    await user.clear(editor)
    await user.type(editor, '이재환 ')
    await user.click(dialog.getByRole('button', { name: '저장' }))
    expect(dialog.queryByRole('textbox', { name: '이재환의 새 이름' })).toBeNull()
    expect(memberWrites(log.started)).toEqual([])

    await user.click(dialog.getByRole('button', { name: '이재환 이름 고치기' }))
    await user.clear(dialog.getByRole('textbox', { name: '이재환의 새 이름' }))
    await user.type(dialog.getByRole('textbox', { name: '이재환의 새 이름' }), '이재민{Enter}')
    expect(await dialog.findByRole('button', { name: '이재민 이름 고치기' })).toBeInTheDocument()
    await waitFor(() => expect(bodies).toEqual([{ display_name: '이재민' }]))
    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_03'])
  })

  it('이름 고치기 칸의 Esc 는 고치기만 취소하고 창은 닫지 않는다', async () => {
    const user = userEvent.setup()
    const dialog = await openManage(user)
    await user.click(dialog.getByRole('button', { name: '이재환 이름 고치기' }))
    await user.type(dialog.getByRole('textbox', { name: '이재환의 새 이름' }), '민')
    await user.keyboard('{Escape}')

    expect(dialog.queryByRole('textbox', { name: '이재환의 새 이름' })).toBeNull()
    expect(screen.getByRole('dialog', { name: '팀원 관리' })).toBeInTheDocument()
    expect(dialog.getByText('이재환')).toBeInTheDocument()
  })
})

describe('팀원 목록 — 쓰기는 한 번에 하나', () => {
  it('쓰는 동안 두 번 눌러도, 다른 줄을 조작해도 요청은 하나다', async () => {
    const gate = deferred()
    server.use(
      http.patch('/api/v1/members/mb_02', async () => {
        await gate.promise
        // 아무것도 돌려주지 않아 기본 handler 가 저장한다
      }),
    )
    const user = userEvent.setup()
    const log = recordRequests()
    const dialog = await openManage(user)
    const unlink = rowOf('박민수').getByRole('button', { name: '박민수 연결 풀기' })
    await user.click(unlink)
    await user.click(unlink)

    await waitFor(() => expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_02']))
    expect(unlink).toHaveAttribute('aria-busy', 'true')
    expect(dialog.getByRole('button', { name: '이재환 이름 고치기' })).toBeDisabled()
    expect(accountField('이재환')).toBeDisabled()
    expect(dialog.getByRole('button', { name: '@jihun_dev 팀원으로 추가' })).toBeDisabled()

    gate.resolve()
    await waitFor(() => expect(accountField('박민수')).toHaveTextContent('계정 고르기'))
    expect(memberWrites(log.started)).toEqual(['PATCH /members/mb_02'])
    expect(accountField('이재환')).toBeEnabled()
  })

  it('응답을 읽지 못하면 실패라고 하지 않고 결과를 확인하지 못했다고 알린다', async () => {
    server.use(
      http.patch(
        '/api/v1/members/mb_02',
        () => new HttpResponse('<html></html>', { status: 200 }),
        {
          once: true,
        },
      ),
    )
    const user = userEvent.setup()
    await openManage(user)
    await user.click(rowOf('박민수').getByRole('button', { name: '박민수 연결 풀기' }))

    expect(await screen.findByText('변경 결과를 확인하지 못했어요')).toBeInTheDocument()
    expect(rowOf('박민수').queryByRole('alert')).toBeNull()
  })
})
