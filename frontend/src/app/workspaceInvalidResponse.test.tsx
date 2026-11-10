import type { MockInstance } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { expireSession } from './expireSession'
import { renderApp } from './test/renderApp'

/*
 * #348 마지막 묶음 — 연동·초대·팀원·메시지 설정 응답이 스키마에 맞지 않을 때 화면. 상태 판단 값은 짐작한 상태로 그리지 않고
 * 응답을 읽지 못했다고 알린다. 표시용 별칭 출처는 받은 값을 남기고 `알 수 없는 출처` 다. 쓰기 응답을 읽지 못하면 실패라 하지 않는다
 */

vi.setConfig({ testTimeout: 15_000 })

const INVALID = '응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'
const UNCONFIRMED = '변경 결과를 확인하지 못했어요'

let warning: MockInstance<typeof console.warn>
beforeEach(() => {
  warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warning.mockRestore()
})

/** 재시도 대기(1초)보다 길게 기다린다. 재시도가 있었다면 이 사이에 두 번째 요청이 나간다 */
const pastRetryDelay = () => act(() => new Promise((resolve) => setTimeout(resolve, 1_300)))

const toastWith = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-toast-key]')).find((node) =>
    node.textContent?.includes(text),
  ) ?? null

it('연동 상태를 모르면 미연결로 그려 다시 연결하라고 하지 않고 안내만 보이며 재시도하지 않는다', async () => {
  applyScenario('settings-unmapped')
  server.use(
    http.get('/api/v1/workspaces/:workspaceId/integrations', () =>
      ok({
        ...structuredClone(db.integrations.ws_01),
        notion: { status: 'paused', display_name: null, connected_at: null },
      }),
    ),
  )
  const log = recordRequests()
  renderApp(paths.settings('ws_01'))
  expect((await screen.findAllByText(INVALID, {}, { timeout: 5_000 })).length).toBeGreaterThan(0)
  expect(screen.queryByText('연결 안 됨')).toBeNull()
  expect(screen.queryByRole('button', { name: /연결하기/ })).toBeNull()

  await pastRetryDelay()
  expect(log.started.filter(({ path }) => path === '/workspaces/ws_01/integrations')).toHaveLength(
    1,
  )
})

it('PM 알림 방법을 모르면 고른 칸을 짐작해 보이지 않고 안내한다', async () => {
  applyScenario('messages-default')
  server.use(
    http.get('/api/v1/workspaces/:workspaceId/message-settings', () =>
      ok({
        due_reminder: true,
        minutes_summary: true,
        silence_alert: true,
        nudge_rule: { days_before: 1, hour: 9 },
        pm_alert_method: 'sms',
        reminder_auto_approve: false,
        saved: true,
        updated_at: null,
        updated_by: null,
        pms: [],
      }),
    ),
  )
  renderApp(paths.settings('ws_01'))
  expect((await screen.findAllByText(INVALID, {}, { timeout: 5_000 })).length).toBeGreaterThan(0)
  expect(screen.queryByRole('radiogroup', { name: 'PM 알림 방식' })).toBeNull()
})

describe('팀 화면', () => {
  beforeEach(() => {
    applyScenario('team-invitations')
  })

  it('초대 상태를 모르면 취소된 초대로 그려 다시 초대하라고 하지 않고 안내한다', async () => {
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/invitations', () =>
        ok({
          items: [
            {
              invitation_id: 'iv_09',
              member_id: 'mb_03',
              invited_user: { user_id: 'us_03', username: 'jaehwan', name: '이재환' },
              status: 'expired',
              accepted_user: null,
              created_at: '2026-09-10T00:00:00Z',
            },
          ],
          total: 1,
        }),
      ),
    )
    const log = recordRequests()
    renderApp(paths.members('ws_01'))
    const row = within(await screen.findByRole('region', { name: '이재환' }))
    expect(
      await row.findByText('초대 상태를 불러오지 못했어요.', {}, { timeout: 5_000 }),
    ).toBeInTheDocument()
    expect(row.queryByText('취소됨')).toBeNull()
    expect(row.queryByRole('button', { name: /초대/ })).toBeNull()

    await pastRetryDelay()
    expect(log.started.filter(({ path }) => path === '/workspaces/ws_01/invitations')).toHaveLength(
      1,
    )
  })

  it('모르는 별칭 출처는 직접 추가로 보이지 않고 `알 수 없는 출처` 다', async () => {
    db.aliases = db.aliases.map((alias) =>
      alias.alias_id === 'al_10' ? { ...alias, source: 'import' } : alias,
    )
    renderApp(paths.members('ws_01'))
    const user = userEvent.setup()
    const row = within(await screen.findByRole('region', { name: '이재환' }))
    await user.click(await row.findByRole('button', { name: /^별칭 \d+$/ }))
    const chips = within(row.getByRole('list', { name: '이재환의 별칭' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(chips).toContain('재한알 수 없는 출처')
  })

  it('별칭 더하기 응답을 읽지 못하면 실패라 하지 않고 결과를 확인하지 못했다고 알린다', async () => {
    server.use(
      http.post('/api/v1/members/:memberId/aliases', () =>
        ok({ alias_id: 'al_99' }, { status: 201 }),
      ),
    )
    renderApp(paths.members('ws_01'))
    const user = userEvent.setup()
    const row = within(await screen.findByRole('region', { name: '이재환' }))
    await user.click(await row.findByRole('button', { name: /^별칭 \d+$/ }))
    await user.type(row.getByRole('textbox', { name: '이재환의 새 별칭' }), '재환 대리')
    await user.click(row.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(toastWith(UNCONFIRMED)).not.toBeNull())
    expect(row.queryByText(INVALID)).toBeNull()
  })
})

it('저장한 채팅 채널의 이름이 비어 있어도 연동 응답을 거절하지 않고 이름 없는 채널로 보인다 (#634 리뷰)', async () => {
  applyScenario('settings-unmapped')
  db.integrations.ws_01.discord = {
    status: 'connected',
    display_name: 'Discord 연결됨',
    connected_at: '2026-09-01T00:00:00Z',
    chat_channel: { channel_id: 'ch_77', name: null },
  }
  renderApp(paths.settings('ws_01'))
  const area = within(await screen.findByTestId('discord-connection', {}, { timeout: 5_000 }))
  expect(await area.findByText('이름 없는 채널(ch_77)')).toBeInTheDocument()
  expect(screen.queryByText(INVALID)).toBeNull()
})

describe('워크스페이스 만들기 응답을 읽지 못함 (#634 리뷰)', () => {
  const POST_WORKSPACES = (requests: { method: string; path: string }[]) =>
    requests.filter(({ method, path }) => method === 'POST' && path === '/workspaces').length

  async function submitCreate(name: string) {
    const app = renderApp('/onboarding/create_workspace')
    await screen.findByRole('heading', { name: '워크스페이스 만들기' }, { timeout: 5_000 })
    await userEvent.type(screen.getByLabelText('팀 이름'), name)
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    return app
  }

  it('서버가 만들었으면 다시 받은 목록에서 그 공간을 찾아 다음 단계로 이어 가고 다시 만들지 않는다', async () => {
    // 실제 handler 가 만들게 두고 응답만 깨뜨린다. 안쪽 요청은 원래 handler 로 넘어간다
    let inner = false
    server.use(
      http.post('/api/v1/workspaces', async ({ request }) => {
        if (inner) return undefined
        inner = true
        const real = await fetch(request.url, {
          method: 'POST',
          headers: request.headers,
          body: await request.text(),
        })
        inner = false
        const { data } = (await real.json()) as { data: Record<string, unknown> }
        return ok({ ...data, created_at: 123 }, { status: 201 })
      }),
    )
    const app = await submitCreate('복구 팀')

    expect(
      await screen.findByRole('heading', { name: 'Discord 연결' }, { timeout: 5_000 }),
    ).toBeInTheDocument()
    const created = db.workspaces.find(({ name }) => name === '복구 팀')
    await app.expectPath(`/onboarding/${created?.workspace_id}/connect_discord`)
    expect(toastWith(UNCONFIRMED)).toBeNull()
    // 기록에는 이 테스트가 넘긴 안쪽 요청도 들어간다. 서버에 그 이름의 공간이 하나뿐인지로 다시 만들지 않았음을 본다
    expect(db.workspaces.filter(({ name }) => name === '복구 팀')).toHaveLength(1)
  })

  it('그 공간을 하나로 찾지 못하면 다시 만들지 않고 결과를 확인하지 못했다고 알린 뒤 공간 선택으로 보낸다', async () => {
    server.use(
      http.post('/api/v1/workspaces', () => ok({ workspace_id: 'ws_99' }, { status: 201 })),
    )
    const log = recordRequests()
    const app = await submitCreate('없는 팀')

    await waitFor(() => expect(toastWith(UNCONFIRMED)).not.toBeNull())
    await app.expectPath('/workspaces')
    expect(POST_WORKSPACES(log.started)).toBe(1)
  })

  it('만드는 사이 세션이 끝나면 늦은 응답이 결과 확인 알림을 다시 띄우지 않는다 (#594 규칙)', async () => {
    const gate = deferred()
    server.use(
      http.post('/api/v1/workspaces', async () => {
        await gate.promise
        return ok({ workspace_id: 'ws_99' }, { status: 201 })
      }),
    )
    const app = await submitCreate('늦은 팀')
    // 만들기 POST 가 나간 뒤다
    await waitFor(() => expect(screen.getByRole('button', { name: '만들기' })).toBeDisabled())

    act(() => {
      expireSession(app.queryClient)
    })
    gate.resolve()
    await screen.findByRole('heading', { name: '로그인' }, { timeout: 5_000 })
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    expect(toastWith(UNCONFIRMED)).toBeNull()
  })
})
