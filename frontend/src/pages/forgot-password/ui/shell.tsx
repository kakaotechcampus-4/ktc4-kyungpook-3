import type { AuthShellProps } from '@/widgets/auth-shell'

/** 비밀번호 찾기 화면의 인증 틀 문구. 화면과 라우트 뼈대가 같이 쓴다 (#510) */
export const FORGOT_PASSWORD_SHELL = {
  title: '비밀번호 찾기',
  formLabel: '비밀번호 재설정 요청',
  aside: {
    pose: 'talking',
    title: '메일로 링크를 보내 드릴게요',
    description: '링크를 열고 새 비밀번호를 정하면 다시 로그인할 수 있어요.',
    caption: "Manager's Manager",
  },
} satisfies Omit<AuthShellProps, 'children'>
