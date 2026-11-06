import { http } from 'msw'
import type {
  MessageSettingsDto,
  MessageSettingsPatchDto,
} from '@/shared/types/api/messageSettings'
import { requireMember, requirePmRole } from '../auth-guard'
import { db } from '../db'
import type { MockMessageSettings } from '../db'
import { fail, ok } from '../envelope'
import { sessionMemberId } from '../sessions'

/** 백엔드 services/message_settings.DEFAULTS. 저장한 적 없는 공간은 이 값과 `saved: false` 다 */
const DEFAULTS: Omit<MockMessageSettings, 'updated_at' | 'updated_by'> = {
  due_reminder: true,
  minutes_summary: true,
  silence_alert: true,
  nudge_rule: { days_before: 1, hour: 9 },
  pm_alert_method: 'both',
  reminder_auto_approve: false,
}

const BOOLEAN_KEYS = [
  'due_reminder',
  'minutes_summary',
  'silence_alert',
  'reminder_auto_approve',
] as const
const PM_ALERT_METHODS: readonly unknown[] = ['web', 'discord_dm', 'both']

const invalid = (key: string, msg: string) =>
  fail('INVALID_REQUEST', '요청 형식이 올바르지 않습니다.', 400, {
    fields: [{ loc: ['body', key], msg }],
  })

/** 백엔드 pm_contacts. Discord 연동 행(끊으면 not_connected)과 그 PM 의 Discord 계정이 모두 있어야 연결된 것이다 */
function pmContacts(workspaceId: string): MessageSettingsDto['pms'] {
  const connected =
    (db.integrations[workspaceId]?.discord.status ?? 'not_connected') !== 'not_connected'
  return db.members
    .filter((member) => member.workspace_id === workspaceId && member.role === 'pm')
    .sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.member_id.localeCompare(b.member_id),
    )
    .map((member) => ({
      member_id: member.member_id,
      name: member.display_name,
      discord_linked: connected && member.discord_user_id !== null,
    }))
}

function settingsDto(workspaceId: string): MessageSettingsDto {
  const row = db.messageSettings[workspaceId]
  const values = row ?? { ...DEFAULTS, updated_at: null, updated_by: null }
  return { ...structuredClone(values), saved: row !== undefined, pms: pmContacts(workspaceId) }
}

/**
 * 본문을 백엔드 pydantic 처럼 엄격하게 읽는다. `9.0` 은 JS 에서 9 가 되므로 숫자의 원문을 보고
 * 정수 표기가 아니면 문자열로 남긴다 — 정수 칸 검사에서 거절된다
 */
async function readStrictBody(request: Request): Promise<unknown> {
  const text = await request.text()
  try {
    return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) =>
      typeof value === 'number' && !/^-?\d+$/.test(context?.source ?? '')
        ? (context?.source ?? String(value))
        : value,
    )
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isIntIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** `MessageSettingsPatch`. 빈 본문, 모르는 키, null, 범위 밖 값, 다른 타입은 400 이다 */
function readPatch(body: unknown): MessageSettingsPatchDto | Response {
  if (!isRecord(body)) return invalid('body', 'Input should be a valid dictionary')
  const keys = Object.keys(body)
  if (keys.length === 0) return invalid('body', '바꿀 설정을 하나 이상 보내야 합니다.')
  const patch: MessageSettingsPatchDto = {}
  for (const key of keys) {
    const value = body[key]
    if (value === null) return invalid(key, `${key} 는 null 일 수 없습니다.`)
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') return invalid(key, 'Input should be a valid boolean')
      patch[key as (typeof BOOLEAN_KEYS)[number]] = value
    } else if (key === 'pm_alert_method') {
      if (!PM_ALERT_METHODS.includes(value))
        return invalid(key, "Input should be 'web', 'discord_dm' or 'both'")
      patch.pm_alert_method = value as MessageSettingsPatchDto['pm_alert_method']
    } else if (key === 'nudge_rule') {
      if (!isRecord(value)) return invalid(key, 'Input should be a valid dictionary')
      const extra = Object.keys(value).find((name) => name !== 'days_before' && name !== 'hour')
      if (extra !== undefined) return invalid(key, 'Extra inputs are not permitted')
      if (!isIntIn(value.days_before, 0, 3))
        return invalid(key, 'days_before should be an integer from 0 to 3')
      if (!isIntIn(value.hour, 0, 23)) return invalid(key, 'hour should be an integer from 0 to 23')
      patch.nudge_rule = { days_before: value.days_before, hour: value.hour }
    } else return invalid(key, 'Extra inputs are not permitted')
  }
  return patch
}

export const messageSettingsHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/message-settings', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requireMember(workspaceId)
    if (denied) return denied
    return ok(settingsDto(workspaceId))
  }),

  /** 보낸 키만 바꾼다. 처음 바꿀 때 기본값으로 행을 만든다 */
  http.patch('/api/v1/workspaces/:workspaceId/message-settings', async ({ params, request }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requirePmRole(workspaceId)
    if (denied) return denied
    const patch = readPatch(await readStrictBody(request))
    if (patch instanceof Response) return patch
    const current = db.messageSettings[workspaceId] ?? {
      ...structuredClone(DEFAULTS),
      updated_at: null,
      updated_by: null,
    }
    db.messageSettings[workspaceId] = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
      // 새로 만든 공간은 세션 팀원 대응이 없다(sessions.ts). 실 API 는 늘 PM 의 member_id 다
      updated_by: sessionMemberId(workspaceId),
    }
    return ok(settingsDto(workspaceId))
  }),
]
