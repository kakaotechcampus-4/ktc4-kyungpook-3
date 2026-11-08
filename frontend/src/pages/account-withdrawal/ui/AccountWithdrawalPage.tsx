import { WithdrawalPanel } from '@/features/auth'
import { AuthShell } from '@/widgets/auth-shell'

export function AccountWithdrawalPage() {
  return (
    <AuthShell
      title="계정 탈퇴"
      formLabel="계정 탈퇴 확인"
      aside={{
        pose: 'squint',
        title: '남길 기록과 지울 정보를 확인해요',
        description: '팀의 공동 기록은 보존하고 개인 계정과 연결 정보는 정리해요.',
        caption: "Manager's Manager",
      }}
    >
      <WithdrawalPanel />
    </AuthShell>
  )
}
