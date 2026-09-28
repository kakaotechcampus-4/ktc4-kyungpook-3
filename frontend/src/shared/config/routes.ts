/* 경로를 화면마다 문자열로 이어 붙이지 않는다. 가드·화면·순수 함수가 모두 이 함수로 경로를 만든다.
   라우트 패턴(`:workspaceId` 등)은 app/router/routes.tsx 한 곳에 있다. */

function segment(value: string): string {
  return encodeURIComponent(value)
}

function workspaceBase(workspaceId: string): string {
  return `/workspaces/${segment(workspaceId)}`
}

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
  dashboard: (workspaceId: string) => `${workspaceBase(workspaceId)}/dashboard`,
  meetings: (workspaceId: string, meetingId?: string) =>
    withOptionalId(`${workspaceBase(workspaceId)}/meetings`, meetingId),
  tasks: (workspaceId: string, taskId?: string) =>
    withOptionalId(`${workspaceBase(workspaceId)}/tasks`, taskId),
  approval: (workspaceId: string, approvalId: string) =>
    `${workspaceBase(workspaceId)}/approvals/${segment(approvalId)}`,
  messages: (workspaceId: string) => `${workspaceBase(workspaceId)}/messages`,
  members: (workspaceId: string) => `${workspaceBase(workspaceId)}/members`,
  settings: (workspaceId: string) => `${workspaceBase(workspaceId)}/settings`,
} as const
