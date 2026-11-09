import type { MockInstance } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
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
              email: 'jaehwan@example.com',
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
