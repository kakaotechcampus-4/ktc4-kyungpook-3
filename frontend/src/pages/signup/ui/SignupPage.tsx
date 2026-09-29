import { SignupForm } from '@/features/auth'
import { AuthShell } from '@/widgets/auth-shell'

/** Signup 캔버스. 랜딩에서 바로 오지 않고 로그인의 링크로만 온다 (D-004) */
export function SignupPage() {
  return (
    <AuthShell
      title="계정 만들기"
      formLabel="회원가입"
      aside={{
        pose: 'squint',
        title: "계정을 만들고 Manager's Manager를 시작해보세요",
        description: (
          <>
            팀을 관리하는 분만 계정을 만들면 돼요.
            <br />
            팀원은 쓰던 대로 Discord만 씁니다.
          </>
        ),
        caption: '5분이면 연결까지 끝납니다',
      }}
    >
      <SignupForm />
    </AuthShell>
  )
}
