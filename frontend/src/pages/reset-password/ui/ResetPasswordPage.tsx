import { ResetPasswordForm } from '@/features/auth'
import { AuthShell } from '@/widgets/auth-shell'

/**
 * 메일 링크가 여는 비밀번호 변경 (#356). 로그인한 브라우저에서도 열린다 — RedirectIfAuthed 밖이다.
 * 캔버스가 없어 로그인·회원가입의 틀을 그대로 쓴다
 */
export function ResetPasswordPage() {
  return (
    <AuthShell
      title="새 비밀번호"
      formLabel="비밀번호 재설정"
      aside={{
        pose: 'squint',
        title: '새 비밀번호를 정해 주세요',
        description:
          '바꾸면 로그인된 모든 기기에서 로그아웃돼요. 새 비밀번호로 다시 로그인해 주세요.',
        caption: "Manager's Manager",
      }}
    >
      <ResetPasswordForm />
    </AuthShell>
  )
}
