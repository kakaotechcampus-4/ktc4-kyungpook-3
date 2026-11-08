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
 * 설정 왼쪽 목차 (Settings 캔버스). 일반·연결·자동 반영·알림은 이 화면의 절로 옮긴다.
 * 팀원은 설정과 따로 있는 팀 화면으로 간다(2026-10-30 사용자 답변). 내 계정 화면은 아직 없어 누를 수 없는 항목이다
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
      {/* 내 계정 화면은 아직 없다. 계정 조작(로그아웃)은 헤더의 `내 계정` 메뉴에 있다 — 누를 수 없는 항목으로 둔다 */}
      <span aria-disabled="true" className={ITEM}>
        내 계정<span className="sr-only"> (준비 중)</span>
      </span>
    </nav>
  )
}
