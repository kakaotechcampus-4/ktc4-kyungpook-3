import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { businessRequests, recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { onTestFinished } from 'vitest'
import { renderApp } from './test/renderApp'

/*
 * M8-B — 팀 화면 (Team 캔버스). 팀원별 상태와 맡은 일, 연결되지 않은 계정(D-076), 팀원 연결 재진입(D-074·D-075).
 * 날짜에 기대는 판정(위험·주의, 먼저 챙길 것, 앞으로 7일)은 widgets/team/lib/team.test.ts 가 본다
 */

// 앱 전체를 그리고 조회 넷(팀원·태스크·연결·Discord 사용자)과 창을 실제로 거친다. 전체 실행 부하에서 기본 5초를 넘겼다 —
// 다른 앱 수준 검사(dashboard)와 같은 15초를 준다
vi.setConfig({ testTimeout: 15_000 })

const TEAM = paths.members('ws_01')

async function unlinkedArea() {
  return within(await screen.findByRole('region', { name: '연결되지 않은 계정' }))
}

/** 창 바깥 덮개. 창이 열리면 Radix 가 창 밖을 접근성 트리에서 숨겨 역할로 찾지 못한다 */
const dbMember = (id: string) => {
  const member = db.members.find(({ member_id }) => member_id === id)
  if (member === undefined) throw new Error(`${id} missing`)
  return member
}

function scrimOf(dialog: HTMLElement): HTMLElement {
  const scrim = dialog.parentElement?.querySelector<HTMLElement>(':scope > button')
  if (!scrim) throw new Error('scrim not found')
  return scrim
}

describe('팀 화면 — PM', () => {
  beforeEach(() => {
    applyScenario('settings-unmapped')
  })

  it('제목에 인원수가 없고, 팀원마다 역할·상태 배지와 맡은 일이 있다', async () => {
    renderApp(TEAM)
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    const pm = within(await screen.findByRole('region', { name: '김서연' }))
    expect(pm.getByText('PM')).toBeInTheDocument()
    expect(pm.getByText(/^(위험|주의|정상)$/)).toBeInTheDocument()
    expect(
      within(pm.getByRole('list', { name: '김서연의 일' }))
        .getAllByRole('listitem')
        .map((item) => item.firstElementChild?.firstElementChild?.textContent),
    ).toEqual(['로그인 API 연동', '배포 스크립트', '폰트 적용'])
    // 마감이 없는 일은 확인이 필요하다고 적는다
    const minsu = within(screen.getByRole('region', { name: '박민수' }))
    expect(minsu.getByText('마감 미정 — 확인 필요')).toBeInTheDocument()
    // Discord 서버를 떠난 팀원은 비활성이다 (D-031)
    expect(
      await within(screen.getByRole('region', { name: '정하늘' })).findByText(
        '팀원 · Discord 서버를 나갔어요',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '앞으로 7일' })).toBeInTheDocument()
  })

  it('연결되지 않은 계정은 제목에 인원수 없이 팀원과 잇지 않은 Discord 사용자를 보인다 — 봇은 없다 (D-076)', async () => {
    renderApp(TEAM)
    const area = await unlinkedArea()
    expect(area.getByRole('heading')).toHaveTextContent(/^연결되지 않은 계정$/)
    expect(await area.findByText('jihun_dev')).toBeInTheDocument()
    expect(area.queryByText('manager_bot')).toBeNull()
    expect(area.getByRole('button', { name: '연결 — jihun_dev' })).toBeInTheDocument()
  })

  it('`연결` 은 팀원 관리 창을 열고, 연결 안 된 계정을 팀원으로 추가하면 그 계정이 팀원이 된다', async () => {
    const user = userEvent.setup()
    const app = renderApp(TEAM)
    const area = await unlinkedArea()
    await user.click(await area.findByRole('button', { name: '연결 — jihun_dev' }))

    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    await app.expectSearch('?connect=members')
    await user.click(await dialog.findByRole('button', { name: '@jihun_dev 팀원으로 추가' }))
    const editor = await dialog.findByRole('textbox', { name: '지훈의 새 이름' })
    await user.clear(editor)
    await user.type(editor, '최지훈{Enter}')
    expect(await dialog.findByRole('button', { name: '최지훈 이름 고치기' })).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: '닫기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await app.expectSearch('')
    expect(await screen.findByRole('region', { name: '최지훈' })).toBeInTheDocument()
    expect(db.members).toContainEqual(
      expect.objectContaining({ display_name: '최지훈', discord_user_id: '1125' }),
    )
    expect(
      await (await unlinkedArea()).findByText('모든 Discord 계정이 팀원과 연결돼 있어요.'),
    ).toBeInTheDocument()
  })

  it('미리 추가한 팀원의 줄에서 계정을 고르면 새로 만들지 않고 그 팀원에 잇는다 (#613)', async () => {
    const user = userEvent.setup()
    renderApp(TEAM)
    const area = await unlinkedArea()
    await user.click(await area.findByRole('button', { name: '연결 — jihun_dev' }))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    const account = await dialog.findByRole('combobox', { name: '이재환의 디스코드 계정' })

    const log = recordRequests()
    await user.click(account)
    await user.click(await screen.findByRole('option', { name: /^@jihun_dev/ }))
    await waitFor(() => expect(account).toHaveTextContent('@jihun_dev'))
    expect(
      log.started
        .filter(({ method, path }) => method !== 'GET' && path.startsWith('/members'))
        .map(({ method, path }) => `${method} ${path}`),
    ).toEqual(['PATCH /members/mb_03'])
    expect(db.members).toContainEqual(
      expect.objectContaining({
        member_id: 'mb_03',
        display_name: '이재환',
        discord_user_id: '1125',
      }),
    )
  })

  it('`팀원 관리` 로 연 창은 줄마다 저장하고 아래 버튼은 `닫기` 하나다. 아무것도 바꾸지 않고 닫을 수 있다 (D-075)', async () => {
    const user = userEvent.setup()
    const app = renderApp(TEAM)
    const manage = await screen.findByRole('button', { name: '팀원 관리' })
    // 캔버스 `height:34px; min-height:36px`, 아이콘 간격 7px
    expect(manage).toHaveClass('min-h-[36px]', 'gap-7')
    await user.click(manage)
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    // 이미 이은 팀원은 계정이 골라져 있고, 잇지 않은 팀원은 비어 있다
    expect(
      await dialog.findByRole('combobox', { name: '박민수의 디스코드 계정' }),
    ).toHaveTextContent('@minsu')
    expect(dialog.getByRole('combobox', { name: '이재환의 디스코드 계정' })).toHaveTextContent(
      '계정 고르기',
    )
    expect(
      dialog.queryByText('PM의 디스코드 계정을 고르지 않으면 Discord 알림을 받을 수 없어요.'),
    ).toBeNull()
    expect(dialog.queryByRole('button', { name: '저장' })).toBeNull()
    expect(dialog.queryByRole('button', { name: '나중에 하기' })).toBeNull()

    const log = recordRequests()
    await user.click(dialog.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await app.expectSearch('')
    expect(businessRequests(log.started).filter(({ method }) => method !== 'GET')).toEqual([])
    // 연 기록에서 한 칸 돌아와 닫는다 — 같은 주소의 기록이 하나 더 쌓이지 않아 다음 뒤로 가기가 이전 화면으로 간다
    expect(app.visitedActions().at(-1)).toBe('POP')
    expect(app.visited().at(-1)?.key).toBe(app.visited()[0]?.key)
  })

  it('PM 이 디스코드에 연결되지 않았으면 Discord 알림을 못 받는다고 안내하고, PM 줄에서 계정을 고르면 안내가 사라진다 (D-177)', async () => {
    dbMember('mb_01').discord_user_id = null
    const user = userEvent.setup()
    renderApp(TEAM)
    await user.click(await screen.findByRole('button', { name: '팀원 관리' }))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    const hint = 'PM의 디스코드 계정을 고르지 않으면 Discord 알림을 받을 수 없어요.'
    expect(await dialog.findByText(hint)).toBeInTheDocument()

    await user.click(dialog.getByRole('combobox', { name: '김서연의 디스코드 계정' }))
    await user.click(await screen.findByRole('option', { name: /^@seoyeon_01/ }))
    await waitFor(() => expect(dialog.queryByText(hint)).toBeNull())
    expect(dbMember('mb_01')).toMatchObject({ display_name: '김서연', discord_user_id: '1123' })
  })

  it('줄마다 초대 상태와 조작이 있고, 창에서 초대를 취소하면 팀 화면의 그 팀원 줄도 바로 바뀐다', async () => {
    applyScenario('team-invitations')
    const user = userEvent.setup()
    renderApp(TEAM)
    const page = within(await screen.findByRole('region', { name: '이재환' }))
    expect(await page.findByRole('button', { name: '초대 취소' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '팀원 관리' }))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    const rowOf = (name: string) => {
      const row = dialog.getByRole('combobox', { name: `${name}의 디스코드 계정` }).closest('li')
      if (row === null) throw new Error(`${name} row missing`)
      return within(row)
    }
    await dialog.findByRole('combobox', { name: '이재환의 디스코드 계정' })
    expect(await rowOf('이재환').findByText('대기')).toBeInTheDocument()
    expect(await rowOf('박민수').findByRole('button', { name: '연결 끊기' })).toBeInTheDocument()

    await user.click(rowOf('이재환').getByRole('button', { name: '초대 취소' }))
    expect(await rowOf('이재환').findByRole('button', { name: '다시 초대' })).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const after = within(screen.getByRole('region', { name: '이재환' }))
    expect(after.getByRole('button', { name: '다시 초대' })).toBeInTheDocument()
    expect(after.queryByRole('button', { name: '초대 취소' })).toBeNull()
  })

  it('주소의 `connect=members` 로 오면 창이 열려 있다 — 설정의 Discord 연결 성공이 오는 곳이다 (D-074)', async () => {
    const user = userEvent.setup()
    const app = renderApp(paths.membersConnect('ws_01'))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    // 이 화면이 기록을 쌓지 않았다 — 뒤로 가지 않고 주소의 표시만 지운다(앱 밖으로 나가지 않는다)
    await user.click(await dialog.findByRole('button', { name: '닫기' }))
    await app.expectSearch('')
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
  })

  it('쓰는 동안에는 `닫기`·Esc·바깥 클릭으로 창이 닫히지 않고, 실패하면 창 안의 그 항목에 오류가 남는다', async () => {
    const user = userEvent.setup()
    const gate = deferred()
    server.use(
      http.post('/api/v1/members', async () => {
        await gate.promise
        return fail('INTERNAL_ERROR', 'boom', 500)
      }),
    )
    renderApp(TEAM)
    await user.click(await screen.findByRole('button', { name: '팀원 관리' }))
    const dialogElement = await screen.findByRole('dialog', { name: '팀원 관리' })
    const dialog = within(dialogElement)
    await user.click(await dialog.findByRole('button', { name: '@jihun_dev 팀원으로 추가' }))
    await waitFor(() => expect(dialog.getByRole('button', { name: '닫기' })).toBeDisabled())

    await user.keyboard('{Escape}')
    await user.click(scrimOf(dialogElement))
    expect(screen.getByRole('dialog', { name: '팀원 관리' })).toBe(dialogElement)

    gate.resolve()
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    )
    expect(dialog.getByRole('button', { name: '닫기' })).toBeEnabled()
  })

  it('팀원을 받는 동안 제목과 기다림 표시를 그리고 팀원 영역은 아직 없다', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.get('/api/v1/members', async () => {
        await gate.promise
        return undefined
      }),
    )
    renderApp(TEAM)
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    expect(screen.getByRole('main').querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('region', { name: '김서연' })).toBeNull()
  })

  it('팀원 조회가 실패하면 본문에 다시 시도를 보이고 연결되지 않은 계정 영역은 그리지 않는다', async () => {
    server.use(
      http.get('/api/v1/members', () => fail('FORBIDDEN', 'Forbidden: member check failed', 403)),
    )
    renderApp(TEAM)
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '연결되지 않은 계정' })).toBeNull()
  })

  it('팀원 조회가 실패하면 창도 뼈대에 머물지 않고 오류·다시 시도·닫기를 보인다', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/v1/members', () => fail('FORBIDDEN', 'Forbidden: member check failed', 403), {
        once: true,
      }),
    )
    renderApp(TEAM)
    await user.click(await screen.findByRole('button', { name: '팀원 관리' }))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    const retry = await dialog.findByRole('button', { name: '다시 시도' })
    expect(dialog.getByRole('button', { name: '닫기' })).toBeInTheDocument()
    await user.click(retry)
    expect(
      await dialog.findByRole('combobox', { name: '박민수의 디스코드 계정' }),
    ).toHaveTextContent('@minsu')
  })
})

describe('팀 화면 — Discord 를 건너뛴 공간', () => {
  beforeEach(() => {
    applyScenario('settings-discord-skipped')
  })

  it('연결되지 않은 계정 영역은 Discord 미연결을 알리고 설정으로 안내한다. 팀원 연결 창도 같다', async () => {
    const user = userEvent.setup()
    renderApp(paths.members('ws_03'))
    const area = await unlinkedArea()
    expect(
      await area.findByText('Discord를 연결하지 않아 서버의 계정을 불러올 수 없어요.'),
    ).toBeInTheDocument()
    expect(area.getByRole('link', { name: '설정에서 Discord 연결하기' })).toHaveAttribute(
      'href',
      paths.settings('ws_03'),
    )

    await user.click(screen.getByRole('button', { name: '팀원 관리' }))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    expect(
      dialog.getByText(/Discord를 연결하지 않아 디스코드 계정을 고를 수 없어요/),
    ).toBeInTheDocument()
    // 디스코드 계정 칸과 연결 안 된 계정 영역이 없다. 이름 고치기는 된다
    expect(await dialog.findByRole('button', { name: '최진호 이름 고치기' })).toBeInTheDocument()
    expect(dialog.queryByRole('combobox')).toBeNull()
    expect(dialog.queryByText(/아직 팀원에 연결되지 않은 디스코드 계정/)).toBeNull()
  })

  it('팀원 관리 창에서 이름만 적어 팀원을 추가하면 목록의 새 줄이 된다. 설정 링크는 그 아래에 있다 (#613)', async () => {
    const bodies = recordRequestBodies('POST', '/members')
    const user = userEvent.setup()
    renderApp(paths.members('ws_03'))
    await user.click(await screen.findByRole('button', { name: '팀원 관리' }))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    const name = await dialog.findByRole('textbox', { name: '팀원 이름' })
    const link = dialog.getByRole('link', { name: '설정에서 Discord 연결하기' })
    expect(name.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.type(name, '박민수')
    await user.click(dialog.getByRole('button', { name: '추가' }))
    expect(await dialog.findByRole('button', { name: '박민수 이름 고치기' })).toBeInTheDocument()
    expect(name).toHaveValue('')
    expect(bodies).toEqual([{ workspace_id: 'ws_03', display_name: '박민수' }])

    await user.type(name, ' 박민수')
    await user.click(dialog.getByRole('button', { name: '추가' }))
    expect(await dialog.findByText('이미 같은 이름의 팀원이 있어요.')).toBeInTheDocument()
    expect(bodies).toHaveLength(1)

    await user.click(dialog.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const added = within(await screen.findByRole('region', { name: '박민수' }))
    expect(await added.findByRole('button', { name: '초대' })).toBeInTheDocument()
  })

  it('추가 응답을 읽지 못하면 실패라고 하지 않고 결과를 확인하지 못했다고 알린다 (#613)', async () => {
    server.use(
      http.post('/api/v1/members', () => new HttpResponse('<html></html>', { status: 201 }), {
        once: true,
      }),
    )
    const user = userEvent.setup()
    renderApp(paths.members('ws_03'))
    await user.click(await screen.findByRole('button', { name: '팀원 관리' }))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    const name = await dialog.findByRole('textbox', { name: '팀원 이름' })
    await user.type(name, '박민수')
    await user.click(dialog.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('변경 결과를 확인하지 못했어요')).toBeInTheDocument()
    expect(name).not.toHaveAccessibleDescription()
    expect(name).toHaveValue('박민수')
  })

  it('추가가 201 인데 팀원을 읽지 못하면 결과를 확인하지 못했다고 알리고, 다시 눌러도 같은 이름을 또 만들지 않는다 (#613)', async () => {
    server.use(
      http.post(
        '/api/v1/members',
        async ({ request }) => {
          const body = (await request.json()) as { workspace_id: string; display_name: string }
          db.members.push({
            member_id: 'mb_88',
            workspace_id: body.workspace_id,
            display_name: body.display_name,
            discord_user_id: null,
            notion_name: null,
            role: 'member',
            has_login_account: false,
            created_at: MOCK_NOW,
          })
          return HttpResponse.json({ data: null, error: null }, { status: 201 })
        },
        { once: true },
      ),
    )
    const log = recordRequests()
    const user = userEvent.setup()
    renderApp(paths.members('ws_03'))
    await user.click(await screen.findByRole('button', { name: '팀원 관리' }))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    const name = await dialog.findByRole('textbox', { name: '팀원 이름' })
    await user.type(name, '박민수')
    await user.click(dialog.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('변경 결과를 확인하지 못했어요')).toBeInTheDocument()
    expect(name).not.toHaveAccessibleDescription()
    await user.click(dialog.getByRole('button', { name: '추가' }))
    expect(await dialog.findByText('이미 같은 이름의 팀원이 있어요.')).toBeInTheDocument()
    expect(
      log.started.filter(({ method, path }) => method === 'POST' && path === '/members'),
    ).toHaveLength(1)
    expect(
      db.members.filter(
        ({ workspace_id, display_name }) => workspace_id === 'ws_03' && display_name === '박민수',
      ),
    ).toHaveLength(1)
  })

  it('팀원 목록을 받지 못하면 팀원 관리 창에 오류와 `다시 시도` 를 보이고, 다시 받으면 추가할 수 있다 (#613)', async () => {
    let failing = true
    server.use(
      http.get('/api/v1/members', () => (failing ? fail('FORBIDDEN', 'x', 403) : undefined)),
    )
    const user = userEvent.setup()
    renderApp(paths.members('ws_03'))
    await user.click(await screen.findByRole('button', { name: '팀원 관리' }))
    const dialog = within(await screen.findByRole('dialog', { name: '팀원 관리' }))
    const retry = await dialog.findByRole('button', { name: '다시 시도' })
    expect(dialog.queryByRole('textbox', { name: '팀원 이름' })).toBeNull()

    failing = false
    await user.click(retry)
    const name = await dialog.findByRole('textbox', { name: '팀원 이름' })
    await user.type(name, '박민수')
    await user.click(dialog.getByRole('button', { name: '추가' }))
    expect(await dialog.findByRole('button', { name: '박민수 이름 고치기' })).toBeInTheDocument()
  })
})

describe('팀 화면 — Discord 를 연결하지 않은 공간의 일반 팀원', () => {
  beforeEach(() => {
    applyScenario('settings-member')
  })

  it('연결되지 않은 계정 영역은 Discord 미연결만 알리고 설정으로 가는 링크가 없다. `팀원 관리` 도 없다', async () => {
    renderApp(TEAM)
    expect(await screen.findByRole('region', { name: '김서연' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '팀원 관리' })).toBeNull()
    const area = await unlinkedArea()
    expect(
      await area.findByText('Discord를 연결하지 않아 서버의 계정을 불러올 수 없어요.'),
    ).toBeInTheDocument()
    expect(area.queryByRole('link')).toBeNull()
  })
})

describe('팀 화면 — 일반 팀원', () => {
  beforeEach(() => {
    applyScenario('settings-member')
    db.integrations.ws_01.discord = {
      status: 'connected',
      display_name: '카테캠 3팀 서버',
      connected_at: '2026-09-01T00:00:00Z',
      chat_channel: null,
    }
  })

  it('팀원 목록과 연결되지 않은 계정은 보지만 `팀원 관리`·`연결` 이 없고, 주소로도 창이 열리지 않는다', async () => {
    renderApp(paths.membersConnect('ws_01'))
    expect(await screen.findByRole('region', { name: '김서연' })).toBeInTheDocument()
    const area = await unlinkedArea()
    expect(await area.findByText('jihun_dev')).toBeInTheDocument()
    expect(area.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: '팀원 관리' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('팀원 초대 상태와 조작이 없고 PM 전용 초대 목록을 부르지 않는다', async () => {
    const log = recordRequests()
    renderApp(TEAM)
    expect(await screen.findByRole('heading', { name: '앞으로 7일' })).toBeInTheDocument()
    // 팀원 목록은 로딩 자리의 최소 표시가 끝난 뒤 그려진다 (#508)
    await screen.findByRole('region', { name: '김서연' })
    for (const name of ['김서연', '박민수', '이재환', '정하늘'])
      expect(
        within(screen.getByRole('region', { name })).queryByRole('button', {
          name: /초대|연결 끊기/,
        }),
        name,
      ).toBeNull()
    expect(log.started.filter(({ path }) => path.includes('/invitations'))).toEqual([])
  })
})

describe('팀 화면 — 서울 오늘에 기대는 카드', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(MOCK_NOW))
    applyScenario('settings-unmapped')
  })
  afterEach(() => vi.useRealTimers())

  it('PM 은 `먼저 챙길 것` 카드를 보고, 앞으로 7일은 오늘 칸에 `오늘` 을 적는다', async () => {
    renderApp(TEAM)
    expect(await screen.findByRole('region', { name: '먼저 챙길 것' })).toBeInTheDocument()
    const week = screen.getByRole('region', { name: '앞으로 7일' })
    const todayCell = within(week).getByText('오늘').closest('li')
    expect(todayCell?.querySelector('time')).toHaveAttribute('dateTime', '2026-09-18')
  })
})

describe('팀 화면 — 기한 지남을 색 말고도 알린다 (KWCAG 색에 무관한 인식)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(MOCK_NOW))
    applyScenario('settings-unmapped')
  })
  afterEach(() => vi.useRealTimers())

  it('기한이 지난 마감에만 경고 표식이 붙고 기한 지남으로 읽힌다', async () => {
    renderApp(TEAM)
    const rows = within(
      within(await screen.findByRole('region', { name: '박민수' })).getByRole('list', {
        name: '박민수의 일',
      }),
    ).getAllByRole('listitem')
    const due = (title: string) => {
      const row = rows.find((item) => within(item).queryByText(title) !== null)
      return row?.querySelector('span.tabular-nums') as HTMLElement
    }
    expect(due('회원가입 화면')).toHaveTextContent('09/16 기한 지남')
    expect(due('회원가입 화면').querySelector('svg')).not.toBeNull()
    expect(due('토큰 정리')).toHaveTextContent(/^09\/17$/)
    expect(due('토큰 정리').querySelector('svg')).toBeNull()
  })
})
