import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  agreeConsents,
  consentKey,
  consentQueryOptions,
  ConsentFields,
  emptyConsentSelection,
  matchesPublication,
  policyVersions,
} from '@/entities/consent'
import { ApiError } from '@/shared/api/errors'
import { errorMessage } from '@/shared/api/errorMessages'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { PublishedPolicies } from '@/shared/config/policyPublication'
import { Button } from '@/shared/ui/button'

export function ConsentGate({
  userId,
  documents,
  children,
  pendingFallback,
  onLogout,
  logoutPending,
  logoutError,
}: {
  userId: string
  documents: PublishedPolicies
  children: ReactNode
  pendingFallback: ReactNode
  onLogout: () => void
  logoutPending: boolean
  logoutError: unknown
}) {
  const queryClient = useQueryClient()
  const versions = policyVersions(documents)
  const scope = { userId, ...versions }
  const query = useQuery(consentQueryOptions(scope))
  const [selection, setSelection] = useState(emptyConsentSelection)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const changedAccount = [query.error, failure].some(
    (error) => error instanceof ApiError && error.code === 'CONSENT_ACCOUNT_CHANGED',
  )
  const mismatch = query.data !== undefined && !matchesPublication(query.data, versions)
  if (!changedAccount && !query.isError && !mismatch && query.data?.required === false)
    return children
  if (query.isPending) return pendingFallback

  const submit = async () => {
    if (!selection.terms || !selection.privacy || saving) return
    const session = captureSessionScope()
    setSaving(true)
    setFailure(null)
    try {
      const result = await agreeConsents(scope, session.signal)
      if (!session.isCurrent()) return
      queryClient.setQueryData(consentKey(scope), result)
      if (result.required) setFailure(new Error('agreement was not recorded'))
    } catch (error) {
      if (!session.isCurrent()) return
      setFailure(error)
      setSelection(emptyConsentSelection())
      if (!(error instanceof ApiError && error.code === 'CONSENT_ACCOUNT_CHANGED'))
        await query.refetch()
    } finally {
      if (session.isCurrent()) setSaving(false)
    }
  }

  const problem = failure ?? query.error
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[680px] flex-col justify-center gap-24 px-24 py-48 text-ink">
      <h1 className="text-[30px] leading-[1.25] font-bold tracking-h1">서비스 이용 동의</h1>
      {changedAccount ? (
        <>
          <p role="alert">
            로그인한 계정이 바뀌었어요. 새로고침한 뒤 계정과 문서를 다시 확인해 주세요.
          </p>
          <Button onClick={() => window.location.reload()}>새로고침</Button>
        </>
      ) : mismatch ? (
        <>
          <p role="alert">공개된 문서와 서버의 판본이 달라요. 새로고침한 뒤 다시 확인해 주세요.</p>
          <Button onClick={() => window.location.reload()}>새로고침</Button>
        </>
      ) : query.isError ? (
        <>
          <p role="alert">동의 기록을 확인하지 못했어요. {errorMessage(query.error)}</p>
          <Button onClick={() => void query.refetch()} loading={query.isFetching}>
            다시 확인
          </Button>
        </>
      ) : (
        <form
          className="flex flex-col gap-24"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <p className="text-body text-sub">
            서비스를 계속 이용하려면 두 문서를 확인하고 동의해 주세요.
          </p>
          <ConsentFields
            documents={documents}
            value={selection}
            onChange={setSelection}
            disabled={saving}
          />
          {problem !== null && (
            <p role="alert">동의 기록을 저장하지 못했어요. {errorMessage(problem)}</p>
          )}
          <Button type="submit" loading={saving} disabled={!selection.terms || !selection.privacy}>
            동의하고 계속하기
          </Button>
        </form>
      )}
      {!changedAccount && (
        <Button variant="ghost" onClick={onLogout} loading={logoutPending}>
          로그아웃
        </Button>
      )}
      {logoutError !== null && (
        <p role="alert">로그아웃하지 못했어요. {errorMessage(logoutError)}</p>
      )}
    </main>
  )
}
