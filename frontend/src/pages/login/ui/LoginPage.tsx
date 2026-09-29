import { LoginForm } from '@/features/auth'
import { AuthShell } from '@/widgets/auth-shell'

/** Login 캔버스. 가드(RedirectIfAuthed)가 로그인한 사용자를 먼저 돌려보낸다 */
export function LoginPage() {
  return (
    <AuthShell
      title="Manager's Manager"
      formLabel="로그인"
      aside={{
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
      }}
    >
      <LoginForm />
    </AuthShell>
  )
}
