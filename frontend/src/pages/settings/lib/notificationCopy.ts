import type { MessageSettings, PmContact } from '@/entities/message-settings'

const WEB_ONLY = 'Discord가 연결되지 않아 웹으로만 알려요'

/**
 * D-177 `웹으로만` 안내. 서버가 PM 마다 알려 주는 `discordLinked` 로만 정한다 — 공간 연동이 없거나 그 PM 의 계정이 없으면 false 다.
 * 모든 PM 이 연결되지 않았으면 이름 없이, 일부만이면 그 PM 들의 이름을 붙인다
 */
export function pmWebOnlyNotice(pms: readonly PmContact[]): string | null {
  const unlinked = pms.filter((pm) => !pm.discordLinked)
  if (unlinked.length === 0) return null
  if (unlinked.length === pms.length) return WEB_ONLY
  return `${unlinked.map((pm) => `${pm.name}님`).join(', ')}은 ${WEB_ONLY}`
}

/**
 * 이미 만든 재촉 제안이 설정 변경에 어떻게 되는가. 수동 승인이면 그대로 남아 PM 이 승인하면 나간다.
 * 자동 승인인 채 재촉 제안을 끄면 이미 만든 제안도 자동으로 나가지 않고, PM 재촉과 한 묶음이면 제안만 빠진다
 * (backend/docs/plan/m6/basis-for-decision/2026-11-04-message-settings.md)
 */
export function existingSuggestionNote(
  settings: Pick<MessageSettings, 'dueReminder' | 'reminderAutoApprove'>,
): string {
  return settings.reminderAutoApprove && !settings.dueReminder
    ? '재촉 제안을 꺼서 이미 만든 제안도 자동으로 나가지 않아요. PM이 넣은 재촉과 묶인 제안은 빠져요.'
    : '설정을 바꿔도 이미 만든 재촉 제안은 그대로예요. 새 설정은 다음 제안부터 적용돼요.'
}
