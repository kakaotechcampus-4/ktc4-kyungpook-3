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

/** 로그인 화면의 검색 파라미터. `next` 는 로그인 뒤 돌아갈 앱 안 경로다 — 받는 쪽이 parseReturnPath 로 다시 확인한다 */
export const LOGIN_PARAMS = { next: 'next' } as const

/**
 * 회원가입 화면의 검색 파라미터. `next` 는 LOGIN_PARAMS 와 같다.
 * `kakao=1` 이면 가입이 끝날 때 카카오 계정을 잇는다. 주소에는 모드만 있고 카카오 신원은 서버 쿠키에 있다
 */
export const SIGNUP_PARAMS = { next: 'next', kakao: 'kakao' } as const

/** 설정 화면의 검색 파라미터. `section=notion` 이면 Notion 연결 영역으로 포커스를 옮긴다 */
export const SETTINGS_PARAMS = { section: 'section' } as const

/**
 * 메시지 화면의 검색 파라미터. `review` 는 보내기 전 확인에서 고른 보낼 메시지(묶음 ID)다 (paths.messageReview).
 * `new=reminder` 면 오른쪽 칸에 재촉 만들기를, `new=thread` 면 대화 시작을 연다 (paths.messageCompose·messageStartThread).
 * `message` 는 대화를 열 때 맨 아래 대신 보여 줄 메시지 ID 다 (paths.messageThread)
 */
export const MESSAGE_PARAMS = { review: 'review', compose: 'new', message: 'message' } as const

/**
 * 팀 화면의 검색 파라미터. `connect=members` 면 팀원 연결 창을 연다 — 설정에서 Discord 를 연결한 뒤 오는 곳이다 (D-074).
 * 창을 닫으면 지운다
 */
export const MEMBERS_PARAMS = { connect: 'connect' } as const

function withOptionalId(base: string, id: string | undefined): string {
  return id === undefined ? base : `${base}/${segment(id)}`
}

export const paths = {
  landing: () => '/',
  /** `next` 를 주면 로그인 뒤 그 경로로 돌아간다 (#411) */
  login: (next?: string) =>
    next === undefined
      ? '/login'
      : `/login?${new URLSearchParams({ [LOGIN_PARAMS.next]: next }).toString()}`,
  /** `next` 는 로그인과 같다. `kakao` 는 카카오 연결 가입이다 (#427) */
  signup: ({ next, kakao }: { next?: string; kakao?: boolean } = {}) => {
    const query = new URLSearchParams()
    if (kakao) query.set(SIGNUP_PARAMS.kakao, '1')
    if (next !== undefined) query.set(SIGNUP_PARAMS.next, next)
    const search = query.toString()
    return search === '' ? '/signup' : `/signup?${search}`
  },
  /** 비밀번호 재설정 메일 요청. 로그인한 사용자는 가드가 돌려보낸다 */
  forgotPassword: () => '/forgot-password',
  /** 메일 링크가 여는 변경 화면. 토큰은 `#token=` 으로 온다 — BE 가 이 경로로 링크를 만든다 (#356) */
  resetPassword: () => '/reset-password',
  workspaceSelect: () => '/workspaces',
  onboardingStart: () => '/onboarding/start',
  onboardingMember: () => '/onboarding/member',
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
  meetingSpeakers: (workspaceId: string, meetingId: string) =>
    `${workspaceBase(workspaceId)}/meetings/${segment(meetingId)}/speakers`,
  tasks: (workspaceId: string, taskId?: string) =>
    withOptionalId(`${workspaceBase(workspaceId)}/tasks`, taskId),
  approval: (workspaceId: string, approvalId: string) =>
    `${workspaceBase(workspaceId)}/approvals/${segment(approvalId)}`,
  messages: (workspaceId: string) => `${workspaceBase(workspaceId)}/messages`,
  /** 보내기 전 확인에서 묶음 하나를 고른 목록. 묶음은 목록 응답에 다 있어 따로 경로를 두지 않고 검색 파라미터로 고른다 */
  messageReview: (workspaceId: string, bundleId: string) =>
    `${workspaceBase(workspaceId)}/messages?${new URLSearchParams({ [MESSAGE_PARAMS.review]: bundleId }).toString()}`,
  /** 재촉 만들기. PM 만 연다 */
  messageCompose: (workspaceId: string) =>
    `${workspaceBase(workspaceId)}/messages?${MESSAGE_PARAMS.compose}=reminder`,
  /** 팀원을 골라 대화를 연다. PM 만 연다 */
  messageStartThread: (workspaceId: string) =>
    `${workspaceBase(workspaceId)}/messages?${MESSAGE_PARAMS.compose}=thread`,
  /** 팀원 한 명과의 대화. messageId 를 주면 맨 아래 대신 그 메시지를 보이며 연다 */
  messageThread: (workspaceId: string, threadId: string, messageId?: string) =>
    `${workspaceBase(workspaceId)}/messages/threads/${segment(threadId)}${
      messageId === undefined
        ? ''
        : `?${new URLSearchParams({ [MESSAGE_PARAMS.message]: messageId }).toString()}`
    }`,
  members: (workspaceId: string) => `${workspaceBase(workspaceId)}/members`,
  /** 팀 화면에서 팀원 연결 창을 연 채로 (D-074, D-075) */
  membersConnect: (workspaceId: string) =>
    `${workspaceBase(workspaceId)}/members?${MEMBERS_PARAMS.connect}=members`,
  settings: (workspaceId: string) => `${workspaceBase(workspaceId)}/settings`,
  /** 설정의 Notion 연결 영역 */
  settingsNotion: (workspaceId: string) =>
    `${workspaceBase(workspaceId)}/settings?${new URLSearchParams({ [SETTINGS_PARAMS.section]: 'notion' }).toString()}`,
} as const

/*
 * 개발·MSW 모드에서만 등록하는 경로. 프로덕션 코드는 `import.meta.env.DEV` 분기 안에서만 부른다 —
 * 번들러가 그 분기를 지우면 이 객체도 쓰이지 않아 함께 빠진다.
 */
export const devPaths = {
  /** 모의 OAuth 화면. 실 API 의 `/workspaces/{id}/integrations/{provider}/start` 자리다 */
  mockOAuth: (workspaceId: string, provider: string) =>
    `/__mock/oauth/${segment(workspaceId)}/${segment(provider)}`,
  /** 모의 메일함. 실 API 가 보낼 비밀번호 재설정 메일과 가입 인증 코드를 여기서 본다 (#356, #427) */
  mockMail: () => '/__mock/mail',
  /** 모의 카카오 동의 화면. 실 API 의 `/auth/kakao/start` 자리다 (#427) */
  mockKakao: () => '/__mock/kakao',
} as const
