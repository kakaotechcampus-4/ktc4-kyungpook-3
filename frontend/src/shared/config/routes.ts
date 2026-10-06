/* 경로를 화면마다 문자열로 이어 붙이지 않는다. 가드·화면·순수 함수가 모두 이 함수로 경로를 만든다.
   라우트 패턴(`:workspaceId` 등)은 app/router/routes.tsx 한 곳에 있다. */

function segment(value: string): string {
  return encodeURIComponent(value)
}

function workspaceBase(workspaceId: string): string {
  return `/workspaces/${segment(workspaceId)}`
}

/** 지난 온보딩 단계를 둘러보는 표시. `?review=1` 이면 가드가 저장된 지난 단계를 보여 준다 */
export const ONBOARDING_REVIEW_PARAM = 'review'

/**
 * 설정 화면의 검색 파라미터. `section=notion` 이면 Notion 연결 영역으로 포커스를 옮기고,
 * `next` 는 Notion 연결이 끝난 뒤 돌아갈 곳이다 — 그 공간의 업로드 경로만 받는다 (D-097, D-098)
 */
export const SETTINGS_PARAMS = { section: 'section', next: 'next' } as const

function withOptionalId(base: string, id: string | undefined): string {
  return id === undefined ? base : `${base}/${segment(id)}`
}

export const paths = {
  landing: () => '/',
  login: () => '/login',
  signup: () => '/signup',
  workspaceSelect: () => '/workspaces',
  onboardingCreate: () => '/onboarding/create_workspace',
  onboardingStep: (workspaceId: string, step: string) =>
    `/onboarding/${segment(workspaceId)}/${segment(step)}`,
  /** 지난 단계 둘러보기 — docs/impl-decision/2026-09-28-onboarding-layout.md (2026-09-29) */
  onboardingReview: (workspaceId: string, step: string) =>
    `/onboarding/${segment(workspaceId)}/${segment(step)}?${ONBOARDING_REVIEW_PARAM}=1`,
  dashboard: (workspaceId: string) => `${workspaceBase(workspaceId)}/dashboard`,
  meetings: (workspaceId: string, meetingId?: string) =>
    withOptionalId(`${workspaceBase(workspaceId)}/meetings`, meetingId),
  /** 회의 올리기. PM 전용이다 — docs/impl-decision/2026-10-02-meeting-upload-policy.md */
  meetingUpload: (workspaceId: string) => `${workspaceBase(workspaceId)}/meetings/upload`,
  /** 회의 정리 중. 워크스페이스 팀원 모두 볼 수 있다 */
  meetingProcessing: (workspaceId: string, meetingId: string) =>
    `${workspaceBase(workspaceId)}/meetings/${segment(meetingId)}/processing`,
  tasks: (workspaceId: string, taskId?: string) =>
    withOptionalId(`${workspaceBase(workspaceId)}/tasks`, taskId),
  approval: (workspaceId: string, approvalId: string) =>
    `${workspaceBase(workspaceId)}/approvals/${segment(approvalId)}`,
  messages: (workspaceId: string) => `${workspaceBase(workspaceId)}/messages`,
  members: (workspaceId: string) => `${workspaceBase(workspaceId)}/members`,
  settings: (workspaceId: string) => `${workspaceBase(workspaceId)}/settings`,
  /** 설정의 Notion 연결 영역. `next` 를 주면 연결 성공 뒤 그곳으로 돌아간다 — 받는 쪽이 업로드 경로인지 다시 확인한다 */
  settingsNotion: (workspaceId: string, next?: string) => {
    const query = new URLSearchParams({ [SETTINGS_PARAMS.section]: 'notion' })
    if (next !== undefined) query.set(SETTINGS_PARAMS.next, next)
    return `${workspaceBase(workspaceId)}/settings?${query.toString()}`
  },
} as const

/*
 * 개발·MSW 모드에서만 등록하는 경로. 프로덕션 코드는 `import.meta.env.DEV` 분기 안에서만 부른다 —
 * 번들러가 그 분기를 지우면 이 객체도 쓰이지 않아 함께 빠진다.
 */
export const devPaths = {
  /** 모의 OAuth 화면. 실 API 의 `/workspaces/{id}/integrations/{provider}/start` 자리다 */
  mockOAuth: (workspaceId: string, provider: string) =>
    `/__mock/oauth/${segment(workspaceId)}/${segment(provider)}`,
} as const
