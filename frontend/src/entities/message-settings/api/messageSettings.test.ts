import { request } from '@/shared/api/client'
import { db } from '@/shared/mock/db'
import { setMockRole } from '@/shared/mock/sessions'
import {
  fetchMessageSettings,
  messageSettingsQueryOptions,
  updateMessageSettings,
} from './messageSettings'

const PATH = '/workspaces/ws_01/message-settings'

describe('메시지·알림 설정 조회', () => {
  it('key 는 공간 아래 message-settings 다 — messages 접두어 무효화에 걸리지 않는다', () => {
    expect(messageSettingsQueryOptions('ws_01').queryKey).toEqual([
      'workspace',
      'ws_01',
      'message-settings',
    ])
  })

  it('저장한 적 없으면 백엔드 기본값과 saved false 이고, PM 의 Discord 연결을 함께 준다', async () => {
    await expect(fetchMessageSettings('ws_01')).resolves.toEqual({
      dueReminder: true,
      minutesSummary: true,
      silenceAlert: true,
      reminderAutoApprove: false,
      nudgeRule: { daysBefore: 1, hour: 9 },
      pmAlertMethod: 'both',
      saved: false,
      pms: [{ memberId: 'mb_01', name: '김서연', discordLinked: true }],
    })
  })

  it('공간의 Discord 가 끊겼거나 PM 의 Discord 계정이 없으면 연결되지 않은 PM 이다', async () => {
    db.members.push({
      member_id: 'mb_91',
      workspace_id: 'ws_01',
      display_name: '이후 PM',
      discord_user_id: null,
      notion_name: null,
      role: 'pm',
      has_login_account: false,
      created_at: '2026-09-02T00:00:00Z',
    })
    expect((await fetchMessageSettings('ws_01')).pms).toEqual([
      { memberId: 'mb_01', name: '김서연', discordLinked: true },
      { memberId: 'mb_91', name: '이후 PM', discordLinked: false },
    ])
    db.integrations.ws_01.discord.status = 'not_connected'
    expect((await fetchMessageSettings('ws_01')).pms.map((pm) => pm.discordLinked)).toEqual([
      false,
      false,
    ])
  })

  it('일반 팀원도 읽는다. 비소속 공간은 403 이다', async () => {
    setMockRole('member')
    await expect(fetchMessageSettings('ws_01')).resolves.toMatchObject({ saved: false })
    await expect(fetchMessageSettings('ws_99')).rejects.toMatchObject({ status: 403 })
  })
})

describe('메시지·알림 설정 변경', () => {
  it('바꾼 칸만 바뀌고 저장된다. 재촉 규칙은 두 값을 함께 바꾼다', async () => {
    await expect(updateMessageSettings('ws_01', { dueReminder: false })).resolves.toMatchObject({
      dueReminder: false,
      minutesSummary: true,
      nudgeRule: { daysBefore: 1, hour: 9 },
      saved: true,
    })
    await updateMessageSettings('ws_01', { nudgeRule: { daysBefore: 0, hour: 18 } })
    await expect(fetchMessageSettings('ws_01')).resolves.toMatchObject({
      dueReminder: false,
      nudgeRule: { daysBefore: 0, hour: 18 },
      saved: true,
    })
    expect(db.messageSettings.ws_01).toMatchObject({ updated_by: 'mb_01' })
    expect(db.messageSettings.ws_01.updated_at).not.toBeNull()
  })

  it('일반 팀원이 바꾸면 403 이고 값이 그대로다', async () => {
    setMockRole('member')
    await expect(updateMessageSettings('ws_01', { silenceAlert: false })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
    await expect(fetchMessageSettings('ws_01')).resolves.toMatchObject({
      silenceAlert: true,
      saved: false,
    })
  })

  it.each([
    ['빈 본문', {}],
    ['모르는 키', { mute_all: true }],
    ['null', { due_reminder: null }],
    ['문자열 불리언', { due_reminder: 'true' }],
    ['숫자 불리언', { silence_alert: 1 }],
    ['모르는 알림 방식', { pm_alert_method: 'email' }],
    ['범위 밖 며칠 전', { nudge_rule: { days_before: 4, hour: 9 } }],
    ['범위 밖 시각', { nudge_rule: { days_before: 1, hour: 24 } }],
    ['시각 빠짐', { nudge_rule: { days_before: 1 } }],
    ['재촉 규칙의 모르는 키', { nudge_rule: { days_before: 1, hour: 9, minute: 0 } }],
    ['문자열 시각', { nudge_rule: { days_before: 1, hour: '9' } }],
  ])('%s 는 400 INVALID_REQUEST 이고 저장하지 않는다', async (_name, body) => {
    await expect(request(`${PATH}`, { method: 'PATCH', body })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    })
    expect(db.messageSettings.ws_01).toBeUndefined()
  })

  it('소수 표기 시각(9.0)도 정수로 바꿔 받지 않는다', async () => {
    await expect(
      request(PATH, { method: 'PATCH', body: '{"nudge_rule":{"days_before":1,"hour":9.0}}' }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_REQUEST' })
    expect(db.messageSettings.ws_01).toBeUndefined()
  })
})
