import { ForgotPasswordForm } from '@/features/auth'
import { AuthShell } from '@/widgets/auth-shell'

/** 비밀번호 재설정 메일 요청 (#356). 캔버스가 없어 로그인·회원가입의 틀을 그대로 쓴다 */
export function ForgotPasswordPage() {
  return (
    <AuthShell
      title="비밀번호 찾기"
      formLabel="비밀번호 재설정 요청"
      aside={{
        pose: 'talking',
        title: '메일로 링크를 보내 드릴게요',
        description: '링크를 열고 새 비밀번호를 정하면 다시 로그인할 수 있어요.',
        caption: "Manager's Manager",
      }}
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
