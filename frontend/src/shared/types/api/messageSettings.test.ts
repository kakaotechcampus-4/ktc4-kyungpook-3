import { applyScenario } from '@/shared/mock/scenarios'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import { messageSettingsSchema } from './messageSettings'

const valid = {
  due_reminder: true,
  minutes_summary: true,
  silence_alert: false,
  nudge_rule: { days_before: 1, hour: 9 },
  pm_alert_method: 'both',
  reminder_auto_approve: false,
  saved: true,
  pms: [{ member_id: 'mb_01', name: '김서연', discord_linked: true }],
}

describe('메시지·알림 설정 스키마', () => {
  it('모르는 PM 알림 방법은 둘 다로 바꾸지 않고 읽지 않는다', () => {
    const result = messageSettingsSchema.safeParse({ ...valid, pm_alert_method: 'sms' })
    expect(result.error?.issues[0]?.path).toEqual(['pm_alert_method'])
  })

  it.each([
    ['재촉 규칙 누락', { nudge_rule: undefined }],
    ['PM 연결 여부 누락', { pms: [{ member_id: 'mb_01', name: '김서연' }] }],
  ])('%s 는 읽지 않는다', (_, patch) => {
    expect(messageSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })
})

describe('MSW handler 응답이 같은 스키마를 따른다', () => {
  it('messages-default 상태의 설정 읽기와 바꾸기', async () => {
    applyScenario('messages-default')
    messageSettingsSchema.parse(await fetchDto('/workspaces/ws_01/message-settings'))
    const changed = messageSettingsSchema.parse(
      await fetchDto(
        '/workspaces/ws_01/message-settings',
        jsonRequest('PATCH', { pm_alert_method: 'web' }),
      ),
    )
    expect(changed.pm_alert_method).toBe('web')
  })
})
