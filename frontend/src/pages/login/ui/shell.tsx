import type { AuthShellProps } from '@/widgets/auth-shell'

/** 로그인 화면의 인증 틀 문구. 화면과 라우트 뼈대가 같이 쓴다 (#510) */
export const LOGIN_SHELL = {
  title: "Manager's Manager",
  formLabel: '로그인',
  phoneIntro: '회의가 끝나면 할 일은 매스가 챙겨요',
  aside: {
    pose: 'idle',
    title: (
      <>
        한 번의 클릭으로,
        <br />
        매니저가 정리합니다
      </>
    ),
    description: (
      <>
        들어오시면 정리해 둔 회의부터 이어서
        <br />
        확인하실 수 있어요.
      </>
    ),
    caption: "Manager's Manager",
  },
} satisfies Omit<AuthShellProps, 'children'>
