import type { AuthShellProps } from '@/widgets/auth-shell'

/** 회원가입 화면의 인증 틀 문구. 화면과 라우트 뼈대가 같이 쓴다 (#510) */
export const SIGNUP_SHELL = {
  title: '계정 만들기',
  formLabel: '회원가입',
  aside: {
    pose: 'idle',
    title: "계정을 만들고 Manager's Manager를 시작해보세요",
    description: (
      <>
        팀을 관리하는 분만 계정을 만들면 돼요.
        <br />
        팀원은 쓰던 대로 Discord만 씁니다.
      </>
    ),
    caption: '5분이면 연결까지 끝납니다',
  },
} satisfies Omit<AuthShellProps, 'children'>
