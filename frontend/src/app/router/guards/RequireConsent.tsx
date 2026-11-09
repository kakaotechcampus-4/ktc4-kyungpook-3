import { useQuery } from '@tanstack/react-query'
import { Outlet } from 'react-router'
import { sessionQueryOptions } from '@/entities/user'
import { useLogout } from '@/features/auth'
import { ConsentGate } from '@/features/consent'
import { currentPolicyPublication } from '@/shared/config/policyPublication'
import type { PublishedPolicies } from '@/shared/config/policyPublication'
import { GuardSkeleton } from '../RouteSkeleton'

function PublishedConsentGuard({ documents }: { documents: PublishedPolicies }) {
  const session = useQuery(sessionQueryOptions())
  const logout = useLogout()
  if (!session.data) return <GuardSkeleton />
  return (
    <ConsentGate
      key={`${session.data.user.id}:${documents.terms.version}:${documents.privacy.version}`}
      userId={session.data.user.id}
      documents={documents}
      onLogout={logout.requestLogout}
      logoutPending={logout.isPending}
      logoutError={logout.error}
    >
      <Outlet />
    </ConsentGate>
  )
}

export function RequireConsent() {
  return currentPolicyPublication.kind === 'preparing' ? (
    <Outlet />
  ) : (
    <PublishedConsentGuard documents={currentPolicyPublication.documents} />
  )
}
