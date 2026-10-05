import type { OnboardingStep } from '@/entities/workspace'

/** 화면 이름(숨은 h1). 캔버스 카드 제목(`팀 만들기` · `디스코드 연동` …)과 따로 둔다 */
export const STEP_TITLE: Record<OnboardingStep, string> = {
  create_workspace: '워크스페이스 만들기',
  connect_discord: 'Discord 연결',
  connect_notion: 'Notion 연결',
  connect_members: '팀원 연결',
}

export const STEP_NUMBER: Record<OnboardingStep, number> = {
  create_workspace: 1,
  connect_discord: 2,
  connect_notion: 3,
  connect_members: 4,
}
