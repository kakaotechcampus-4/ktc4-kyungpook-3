import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { businessRequests, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * M8-B — 설정 화면 (Settings 캔버스). 목차, 연결 끊기, 저장 API 가 없는 절(자동 반영 기준·알림·팀 삭제)의 화면 안 동작과 역할 분기.
 * Discord·Notion 연결·OAuth 복귀는 settingsConnections.test.tsx·notionConnection.test.tsx 가 본다
 */

// 앱 전체를 그리고 확인 창·토스트까지 실제로 거친다. 전체 실행 부하에서 기본 5초를 넘겼다 — 다른 앱 수준 검사(dashboard)와 같은 15초를 준다
vi.setConfig({ testTimeout: 15_000 })

const SETTINGS = paths.settings('ws_01')

async function notionArea() {
  return within(await screen.findByTestId('notion-connection'))
}

describe('설정 화면 — PM', () => {
  beforeEach(() => {
    applyScenario('settings-unmapped')
  })

  it('목차는 캔버스 순서이고, 고른 절을 지금 절로 표시하며 그 제목으로 포커스를 옮긴다. 팀원은 팀 화면으로 간다', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const nav = within(await screen.findByRole('navigation', { name: '설정 목차' }))
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual([
      '일반',
      '연결',
      '자동 반영',
      '알림',
      '팀원',
    ])
    // 내 계정 화면은 아직 없다 — 누를 수 없는 항목이다(헤더의 `내 계정` 메뉴와 겹치지 않는다)
    expect(nav.getByText('내 계정')).toHaveAttribute('aria-disabled', 'true')
    expect(nav.queryByRole('button')).toBeNull()
    expect(nav.getByRole('link', { name: '일반' })).toHaveAttribute('aria-current', 'location')

    await user.click(nav.getByRole('link', { name: '알림' }))
    expect(nav.getByRole('link', { name: '알림' })).toHaveAttribute('aria-current', 'location')
    expect(nav.getByRole('link', { name: '일반' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('heading', { level: 2, name: '알림' })).toHaveFocus()
    expect(nav.getByRole('link', { name: '팀원' })).toHaveAttribute('href', paths.members('ws_01'))
  })

  it('연결 끊기는 확인을 거쳐 서버가 끊은 뒤에 미연결로 바뀐다 (D-137)', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const area = await notionArea()
    await user.click(await area.findByRole('button', { name: '연결 끊기' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Notion 연결을 끊을까요?' }))
    expect(
      dialog.getByText('연결을 끊으면 이미 반영한 내용은 그대로 남고, 새 내용만 쓰지 않게 됩니다.'),
    ).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: '연결 끊기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await area.findByText('연결 안 됨')).toBeInTheDocument()
    expect(area.getByRole('button', { name: 'Notion 연결하기' })).toBeInTheDocument()
    expect(db.integrations.ws_01.notion.status).toBe('not_connected')
    // 창을 연 `연결 끊기` 가 사라졌다 — 포커스는 body 가 아니라 이 카드의 제목에 있다
    await waitFor(() => expect(area.getByRole('heading', { name: 'Notion 연결' })).toHaveFocus())
  })

  it('끊은 뒤 연동 상태를 다시 받지 못해도 서버가 끊은 결과대로 미연결을 보이고 제목으로 포커스를 옮긴다', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const area = within(await screen.findByTestId('discord-connection'))
    await user.click(await area.findByRole('button', { name: '연결 끊기' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Discord 연결을 끊을까요?' }))
    server.use(
      http.get('/api/v1/workspaces/ws_01/integrations', () => fail('INTERNAL_ERROR', 'boom', 500)),
    )
    await user.click(dialog.getByRole('button', { name: '연결 끊기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await area.findByText('연결 안 됨')).toBeInTheDocument()
    expect(area.getByRole('button', { name: 'Discord 연결하기' })).toBeInTheDocument()
    expect(db.integrations.ws_01.discord.status).toBe('not_connected')
    await waitFor(() => expect(area.getByRole('heading', { name: 'Discord 연결' })).toHaveFocus())
  })

  it('끊기를 취소하면 요청이 없고, 실패하면 창에 남아 연결 상태가 그대로다', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const area = await notionArea()
    const log = recordRequests()
    await user.click(await area.findByRole('button', { name: '연결 끊기' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '취소' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(businessRequests(log.started).filter(({ method }) => method === 'DELETE')).toEqual([])

    server.use(
      http.delete('/api/v1/workspaces/ws_01/integrations/notion', () =>
        fail('FORBIDDEN', 'pm only', 403),
      ),
    )
    await user.click(area.getByRole('button', { name: '연결 끊기' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: '연결 끊기' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('접근 권한이 없어요.')
    expect(area.getByText('연결됨')).toBeInTheDocument()
  })

  it('자동 반영 기준은 캔버스 기본값(가운데)이고 고를 수 있다. `전부 자동으로 올린다` 는 고를 수 없다', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const group = within(await screen.findByRole('radiogroup', { name: '자동 반영 기준' }))
    expect(group.getByRole('radio', { name: /담당자·마감이 분명한 건만 자동으로/ })).toBeChecked()
    expect(group.getByRole('radio', { name: /전부 자동으로 올린다/ })).toBeDisabled()
    await user.click(group.getByRole('radio', { name: /전부 내가 확인한다/ }))
    expect(group.getByRole('radio', { name: /전부 내가 확인한다/ })).toBeChecked()
  })

  it('알림은 캔버스의 처음 상태이고 켜고 끌 수 있다', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const silence = await screen.findByRole('switch', {
      name: '사흘 넘게 응답이 없으면 나에게만 알려주기',
    })
    expect(screen.getByRole('switch', { name: '마감 하루 전에 담당자에게 DM' })).toBeChecked()
    expect(silence).not.toBeChecked()
    await user.click(silence)
    expect(silence).toBeChecked()
  })

  it('저장 API 가 없는 조작은 준비 중이라고만 알리고 요청하지 않는다', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    await notionArea()
    const log = recordRequests()
    await user.click(await screen.findByRole('button', { name: '팀 삭제' }))
    expect(await screen.findByText('팀 삭제는 아직 준비 중이에요.')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: '채널 바꾸기' }))
    expect(await screen.findByText('채널 바꾸기는 아직 준비 중이에요.')).toBeInTheDocument()
    expect(businessRequests(log.started).filter(({ method }) => method !== 'GET')).toEqual([])
  })
})

describe('설정 화면 — 일반 팀원', () => {
  beforeEach(() => {
    applyScenario('settings-member')
  })

  it('자동 반영 기준·알림은 읽기만 하고, 연결 끊기와 팀 삭제가 없다', async () => {
    renderApp(SETTINGS)
    expect(
      await (await notionArea()).findByText('Notion 연결은 PM이 관리해요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '연결 끊기' })).toBeNull()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
    expect(screen.queryByRole('heading', { name: '이 팀 삭제하기' })).toBeNull()
  })
})
