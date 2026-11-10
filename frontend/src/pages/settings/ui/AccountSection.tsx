import { useQuery } from '@tanstack/react-query'
import { sessionQueryOptions } from '@/entities/user'
import { UsernameChangeForm } from '@/features/username-change'
import { SettingsSection } from './SettingsSection'

const LABEL = 'text-[13px] font-semibold text-sub'
const VALUE = 'text-body text-ink'
const NOTE = 'text-caption text-dim'

/**
 * 내 계정 (#627). 공간과 상관없이 같은 계정이라 모든 역할이 본다.
 * 카카오로 가입한 계정은 이메일이 없어 그렇다고 적는다. 아이디는 여기서 바꾼다
 */
export function AccountSection() {
  const user = useQuery(sessionQueryOptions()).data?.user
  if (!user) return null
  return (
    <SettingsSection
      id="settings-account"
      title="계정"
      description="모든 워크스페이스에서 같은 내 계정이에요."
    >
      <dl className="flex flex-col gap-4">
        <dt className={LABEL}>이메일</dt>
        <dd className={VALUE}>{user.email ?? '이메일 없음'}</dd>
        {user.email === null ? (
          <dd className={NOTE}>카카오로 로그인하는 계정이라 이메일이 없어요.</dd>
        ) : null}
      </dl>
      <UsernameChangeForm key={user.id} current={user.username} />
    </SettingsSection>
  )
}
