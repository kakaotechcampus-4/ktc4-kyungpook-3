import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { MESSAGE_SETTINGS_FAILED_TITLE } from '@/features/message-settings'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { businessRequests, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * M8-B — 설정 화면 (Settings 캔버스). 목차, 연결 끊기, 알림 설정 저장(#340), 저장 API 가 없는 절(자동 반영 기준·팀 삭제)의 화면 안 동작과 역할 분기.
 * Discord·Notion 연결·OAuth 복귀는 settingsConnections.test.tsx·notionConnection.test.tsx 가 본다
 */

// 앱 전체를 그리고 확인 창·토스트까지 실제로 거친다. 전체 실행 부하에서 기본 5초를 넘겼다 — 다른 앱 수준 검사(dashboard)와 같은 15초를 준다
vi.setConfig({ testTimeout: 15_000 })

const SETTINGS = paths.settings('ws_01')
const NOTICE = 'Discord가 연결되지 않아 웹으로만 알려요'
const SILENCE = '사흘 넘게 응답이 없으면 나에게만 알려주기'
const EXISTING_NOTE =
  '설정을 바꿔도 이미 만든 재촉 제안은 그대로예요. 새 설정은 다음 제안부터 적용돼요.'
const AUTO_OFF_NOTE =
  '재촉 제안을 꺼서 이미 만든 제안도 자동으로 나가지 않아요. PM이 넣은 재촉과 묶인 제안은 빠져요.'

/** 이 테스트 동안 설정 PATCH 의 본문을 보낸 순서대로 모은다 */
function recordPatches(): unknown[] {
  const bodies: unknown[] = []
  const onStart = ({ request }: { request: Request }) => {
    if (request.method === 'PATCH' && new URL(request.url).pathname.endsWith('/message-settings'))
      void request
        .clone()
        .json()
        .then((body: unknown) => bodies.push(body))
  }
  server.events.on('request:start', onStart)
  onTestFinished(() => server.events.removeListener('request:start', onStart))
  return bodies
}

/** 재촉 규칙 칸을 열고 줄을 누른다 */
async function choose(user: ReturnType<typeof userEvent.setup>, field: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: field }))
  await user.click(await screen.findByRole('option', { name: option }))
}

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
    expect(area.getByRole('button', { name: 'Discord 연결하기' })).toHaveClass('min-h-[36px]')
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

  it('캔버스 실측 — 카드 버튼은 최소 36px 이고, 목차와 `팀 삭제` 의 글자는 13px 이다', async () => {
    renderApp(SETTINGS)
    const area = await notionArea()
    for (const name of ['속성 다시 맞추기', '연결 끊기'])
      expect(await area.findByRole('button', { name })).toHaveClass('min-h-[36px]')
    // `text-control` 은 같은 이름의 색 토큰과 겹쳐 글자 크기를 만들지 않는다 — 크기를 직접 쓴다
    expect(screen.getByRole('link', { name: '일반' })).toHaveClass('text-[13px]')
    expect(screen.getByRole('button', { name: '팀 삭제' })).toHaveClass('text-[13px]')
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

  it('알림은 서버 값을 읽는다 — 저장한 적 없으면 기본값(세 토글 켜짐, 재촉 자동 승인 꺼짐, 하루 전 09:00, 둘 다)이다', async () => {
    renderApp(SETTINGS)
    const due = await screen.findByRole('switch', { name: '마감 하루 전 09:00에 담당자에게 DM' })
    expect(due).toBeChecked()
    expect(screen.getByRole('switch', { name: /회의 정리가 끝나면/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: SILENCE })).toBeChecked()
    expect(screen.getByRole('switch', { name: '재촉 자동 승인' })).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: '재촉 며칠 전' })).toHaveTextContent('1일 전')
    expect(screen.getByRole('combobox', { name: '재촉 보낼 시각' })).toHaveTextContent('09:00')
    expect(
      within(screen.getByRole('radiogroup', { name: 'PM 알림 방식' })).getByRole('radio', {
        name: /^둘 다/,
      }),
    ).toBeChecked()
    expect(screen.getByText(EXISTING_NOTE)).toBeInTheDocument()
  })

  it('PM 이 토글을 바꾸면 그 칸만 PATCH 하고, 다시 열어도 저장된 값이다', async () => {
    const user = userEvent.setup()
    const patches = recordPatches()
    const view = renderApp(SETTINGS)
    const silence = await screen.findByRole('switch', { name: SILENCE })
    await user.click(silence)
    expect(silence).not.toBeChecked()
    await waitFor(() => expect(patches).toEqual([{ silence_alert: false }]))
    await waitFor(() => expect(db.messageSettings.ws_01?.silence_alert).toBe(false))

    const method = within(screen.getByRole('radiogroup', { name: 'PM 알림 방식' }))
    await user.click(method.getByRole('radio', { name: /^웹/ }))
    await waitFor(() =>
      expect(patches).toEqual([{ silence_alert: false }, { pm_alert_method: 'web' }]),
    )
    await waitFor(() => expect(db.messageSettings.ws_01?.pm_alert_method).toBe('web'))

    view.unmount()
    renderApp(SETTINGS)
    expect(await screen.findByRole('switch', { name: SILENCE })).not.toBeChecked()
    expect(
      within(screen.getByRole('radiogroup', { name: 'PM 알림 방식' })).getByRole('radio', {
        name: /^웹/,
      }),
    ).toBeChecked()
    expect(screen.getByRole('switch', { name: /회의 정리가 끝나면/ })).toBeChecked()
  })

  it('재촉 규칙을 바꾸면 규칙 전체를 보내고 토글 제목이 따라 바뀐다. 당일은 `마감 당일` 이다', async () => {
    const user = userEvent.setup()
    const patches = recordPatches()
    renderApp(SETTINGS)
    await screen.findByRole('combobox', { name: '재촉 며칠 전' })
    await choose(user, '재촉 며칠 전', '2일 전')
    await choose(user, '재촉 보낼 시각', '18:00')
    expect(
      screen.getByRole('switch', { name: '마감 2일 전 18:00에 담당자에게 DM' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(patches).toEqual([
        { nudge_rule: { days_before: 2, hour: 9 } },
        { nudge_rule: { days_before: 2, hour: 18 } },
      ]),
    )
    await waitFor(() =>
      expect(db.messageSettings.ws_01?.nudge_rule).toEqual({ days_before: 2, hour: 18 }),
    )

    await choose(user, '재촉 며칠 전', '당일')
    expect(
      await screen.findByRole('switch', { name: '마감 당일 18:00에 담당자에게 DM' }),
    ).toBeInTheDocument()
    // 시각은 밤에도 고를 수 있다 — 0~23시 전부다
    await user.click(screen.getByRole('combobox', { name: '재촉 보낼 시각' }))
    expect(within(await screen.findByRole('listbox')).getAllByRole('option')).toHaveLength(24)
  })

  it.each([
    ['403', () => fail('FORBIDDEN', 'pm only', 403), '접근 권한이 없어요.'],
    ['500', () => fail('INTERNAL_ERROR', 'boom', 500), '서버에 문제가 생겼어요'],
  ])('저장이 %s 로 실패하면 값이 돌아오고 알림이 뜬다', async (_status, reply, message) => {
    const user = userEvent.setup()
    server.use(http.patch('/api/v1/workspaces/ws_01/message-settings', reply))
    renderApp(SETTINGS)
    const due = await screen.findByRole('switch', { name: '마감 하루 전 09:00에 담당자에게 DM' })
    await user.click(due)
    expect(await screen.findByText(MESSAGE_SETTINGS_FAILED_TITLE)).toBeInTheDocument()
    // Radix 토스트가 잠깐 그리는 스크린리더 알림(span[aria-live])도 같은 글을 품는다 — 토스트 본문만 본다
    expect(
      screen.getByText(message, { exact: false, ignore: 'script, style, span[aria-live]' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(due).toBeChecked())

    await choose(user, '재촉 보낼 시각', '18:00')
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '재촉 보낼 시각' })).toHaveTextContent('09:00'),
    )
    expect(
      screen.getByRole('switch', { name: '마감 하루 전 09:00에 담당자에게 DM' }),
    ).toBeInTheDocument()
    expect(db.messageSettings.ws_01).toBeUndefined()
  })

  it('알림 토글은 꺼짐 안내를 읽는다. 자동 승인인 채 재촉 제안을 끄면 이미 만든 제안 안내가 예외 문구로 바뀐다', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    const due = await screen.findByRole('switch', { name: '마감 하루 전 09:00에 담당자에게 DM' })
    const auto = screen.getByRole('switch', { name: '재촉 자동 승인' })
    const minutes = screen.getByRole('switch', { name: /회의 정리가 끝나면/ })
    expect(due).toHaveAccessibleDescription(/끄면 재촉 제안을 만들지 않습니다/)
    expect(auto).toHaveAccessibleDescription(/끄면 승인하지 않은 재촉 제안은 그대로 남습니다/)
    expect(minutes).toHaveAccessibleDescription(/끄면 채널에 올리지 않습니다.*설정만 저장돼요/)
    expect(screen.getByRole('switch', { name: SILENCE })).toHaveAccessibleDescription(
      /끄면 PM 알림만 보내지 않습니다/,
    )
    expect(screen.getByRole('radiogroup', { name: 'PM 알림 방식' })).toHaveAccessibleDescription(
      /Discord DM은 준비 중이라 고른 방식은 저장만 돼요/,
    )

    await user.click(auto)
    expect(auto).toBeChecked()
    expect(due).toHaveAccessibleDescription(/이미 만든 제안도 자동으로 보내지 않습니다/)
    expect(screen.getByText(EXISTING_NOTE)).toBeInTheDocument()
    await user.click(due)
    expect(due).not.toBeChecked()
    expect(auto).toBeChecked()
    expect(await screen.findByText(AUTO_OFF_NOTE)).toBeInTheDocument()
    await waitFor(() =>
      expect(db.messageSettings.ws_01).toMatchObject({
        reminder_auto_approve: true,
        due_reminder: false,
      }),
    )
  })

  it('PM 이 여럿이면 Discord 가 연결되지 않은 PM 의 이름을 붙여 웹으로만 안내한다', async () => {
    db.members.push({
      member_id: 'mb_91',
      workspace_id: 'ws_01',
      display_name: '이후 PM',
      discord_user_id: null,
      notion_name: null,
      role: 'pm',
      created_at: '2026-09-02T00:00:00Z',
    })
    renderApp(SETTINGS)
    const notice = `이후 PM님은 ${NOTICE}`
    expect(await screen.findByText(notice)).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'PM 알림 방식' })).toHaveAccessibleDescription(
      new RegExp(`^${notice}`),
    )
  })

  it('모든 PM 의 Discord 가 연결되지 않았으면 이름 없이 웹으로만 안내한다', async () => {
    const creator = db.members.find((member) => member.member_id === 'mb_01')
    if (creator === undefined) throw new Error('mb_01 missing')
    creator.discord_user_id = null
    renderApp(SETTINGS)
    const discord = within(await screen.findByTestId('discord-connection'))
    expect(await discord.findByText('연결됨')).toBeInTheDocument()
    expect(await screen.findByText(NOTICE)).toBeInTheDocument()
  })

  it('Discord 를 건너뛴 공간은 웹으로만 안내하고 Discord DM 과 둘 다는 고를 수 있다', async () => {
    applyScenario('settings-discord-skipped')
    renderApp(paths.settings('ws_03'))
    expect(await screen.findByText(NOTICE)).toBeInTheDocument()
    const method = within(screen.getByRole('radiogroup', { name: 'PM 알림 방식' }))
    expect(method.getByRole('radio', { name: /^Discord DM/ })).toBeEnabled()
    expect(method.getByRole('radio', { name: /^둘 다/ })).toBeEnabled()
    expect(method.getByRole('radio', { name: /^둘 다/ })).toBeChecked()
  })

  it('모든 PM 의 Discord 가 연결돼 있으면 웹으로만 안내를 보이지 않는다', async () => {
    renderApp(SETTINGS)
    await screen.findByRole('switch', { name: SILENCE })
    expect(screen.queryByText(NOTICE, { exact: false })).toBeNull()
  })

  it('같은 화면에서 Discord 연결을 끊으면 웹으로만 안내가 나타난다', async () => {
    const user = userEvent.setup()
    renderApp(SETTINGS)
    await screen.findByRole('switch', { name: SILENCE })
    expect(screen.queryByText(NOTICE, { exact: false })).toBeNull()

    const area = within(await screen.findByTestId('discord-connection'))
    await user.click(await area.findByRole('button', { name: '연결 끊기' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Discord 연결을 끊을까요?' }))
    await user.click(dialog.getByRole('button', { name: '연결 끊기' }))

    expect(await area.findByText('연결 안 됨')).toBeInTheDocument()
    expect(await screen.findByText(NOTICE)).toBeInTheDocument()
  })

  it('설정 조회가 실패하면 알림 절에 다시 시도를 보이고, 다시 받으면 토글이 보인다', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/v1/workspaces/ws_01/message-settings', () =>
        fail('INTERNAL_ERROR', 'boom', 500),
      ),
    )
    renderApp(SETTINGS)
    const section = within(await screen.findByRole('region', { name: '알림' }))
    const retry = await section.findByRole('button', { name: '다시 시도' }, { timeout: 5_000 })
    expect(section.queryByRole('switch', { name: SILENCE })).toBeNull()
    server.resetHandlers()
    await user.click(retry)
    expect(await section.findByRole('switch', { name: SILENCE })).toBeChecked()
  })
})

describe('설정 화면 — 일반 팀원', () => {
  beforeEach(() => {
    applyScenario('settings-member')
  })

  it('이름·자동 반영 기준·알림은 읽기만 하고, 되돌리기·연결 끊기와 팀 삭제가 없다', async () => {
    renderApp(SETTINGS)
    expect(
      await (await notionArea()).findByText('Notion 연결은 PM이 관리해요.'),
    ).toBeInTheDocument()
    expect(await screen.findByText(NOTICE)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '워크스페이스 이름' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '되돌리기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '연결 끊기' })).toBeNull()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled()
    expect(screen.queryByRole('heading', { name: '이 팀 삭제하기' })).toBeNull()
  })

  it('알림은 PM 이 저장한 값을 그대로 보인다', async () => {
    db.messageSettings.ws_01 = {
      due_reminder: false,
      minutes_summary: true,
      silence_alert: false,
      nudge_rule: { days_before: 3, hour: 20 },
      pm_alert_method: 'web',
      reminder_auto_approve: true,
      updated_at: '2026-09-17T00:00:00Z',
      updated_by: 'mb_01',
    }
    renderApp(SETTINGS)
    const due = await screen.findByRole('switch', { name: '마감 3일 전 20:00에 담당자에게 DM' })
    expect(due).not.toBeChecked()
    expect(due).toBeDisabled()
    expect(screen.getByRole('switch', { name: '재촉 자동 승인' })).toBeChecked()
    expect(screen.getByRole('switch', { name: SILENCE })).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: '재촉 보낼 시각' })).toHaveTextContent('20:00')
    expect(
      within(screen.getByRole('radiogroup', { name: 'PM 알림 방식' })).getByRole('radio', {
        name: /^웹/,
      }),
    ).toBeChecked()
    expect(screen.getByText(AUTO_OFF_NOTE)).toBeInTheDocument()
  })
})
