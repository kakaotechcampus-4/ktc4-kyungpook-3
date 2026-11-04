/** 이 화면 안의 절. 목차를 누르면 그 절로 옮긴다 */
export const SETTINGS_SECTIONS = [
  { id: 'settings-general', label: '일반' },
  { id: 'settings-connections', label: '연결' },
  { id: 'settings-auto-apply', label: '자동 반영' },
  { id: 'settings-notifications', label: '알림' },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']
