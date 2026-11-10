import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { SETTINGS_SECTIONS } from './settingsSections'
import type { SettingsSectionId } from './settingsSections'
import { NAV_ITEM as ITEM } from './settingsStyles'

export interface SettingsNavProps {
  workspaceId: string
  current: SettingsSectionId
  onSelect: (id: SettingsSectionId) => void
}

/**
 * 설정 왼쪽 목차 (Settings 캔버스). 일반·연결·자동 반영·알림·계정은 이 화면의 절로 옮긴다.
 * 팀원은 설정과 따로 있는 팀 화면으로 간다(2026-10-30 사용자 답변). 캔버스의 누를 수 없던 `내 계정` 은 계정 절이 대신한다 (#627)
 */
export function SettingsNav({ workspaceId, current, onSelect }: SettingsNavProps) {
  return (
    <nav aria-label="설정 목차" className="flex flex-col gap-2">
      {SETTINGS_SECTIONS.map(({ id, label }) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={id === current ? 'location' : undefined}
          className={ITEM}
          onClick={(event) => {
            event.preventDefault()
            onSelect(id)
          }}
        >
          {label}
        </a>
      ))}
      <GuardedLink to={paths.members(workspaceId)} className={ITEM}>
        팀원
      </GuardedLink>
    </nav>
  )
}
