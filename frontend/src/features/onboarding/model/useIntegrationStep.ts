import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  fetchIntegrations,
  integrationStartUrl,
  integrationsQueryOptions,
  readIntegrationReturn,
} from '@/entities/integration'
import type { Integration, IntegrationProvider, Integrations } from '@/entities/integration'
import { workspaceDetailQueryOptions } from '@/entities/workspace'
import { paths } from '@/shared/config/routes'
import { leaveApp } from '@/shared/lib/location'
import { useOnboardingSave } from './useOnboardingSave'

const STEP_BY_PROVIDER = { discord: 'connect_discord', notion: 'connect_notion' } as const

/** 연결을 끝내지 못한 까닭. 취소는 사용자가 고른 것이고, 실패는 제공자 오류이거나 복귀 뒤 확인에서 연결이 없던 것이다 */
export type IntegrationNotice = 'cancelled' | 'failed'

export interface IntegrationStep {
  /** 지금 연동 상태. 조회 전이면 null */
  integration: Integration | null
  /** 두 제공자 모두의 연동 상태 — 앞 단계 연결 알림에 쓴다. 조회 전이면 null */
  integrations: Integrations | null
  /** 건너뛰기 저장이 실패했는데 서버에는 이 단계가 이미 건너뜀이다(또는 그걸 확인하는 중·확인하지 못했다).
   *  재시도(건너뛰기)만 할 수 있고 연결은 막는다. 서버가 pending 이면 막지 않는다 */
  connectBlocked: boolean
  integrationsError: unknown
  retryIntegrations: () => void
  /** 복귀했는데 연결되지 않았으면 그 까닭 */
  notice: IntegrationNotice | null
  /** 복귀 뒤 연동 상태를 다시 조회하는 중 */
  verifying: boolean
  /** 현재 탭을 OAuth 로 옮긴다 (D-158). 복귀 경로는 이 단계다 */
  connect: () => void
  /** 연결된 상태에서 단계 완료를 저장한다 — 복귀 뒤 저장이 실패했을 때의 재시도 자리 */
  complete: () => Promise<void>
  skip: () => Promise<void>
  saving: boolean
  saveError: unknown
}

/**
 * Discord·Notion 연결 단계. 복귀 주소의 결과(`oauth_result=success`)만으로 완료하지 않는다 —
 * 연동 상태를 **다시 조회해** `connected` 일 때만 단계를 완료한다. 취소·실패면 단계는 그대로 pending 이다.
 * 복귀 표시는 읽자마자 주소에서 지운다. 새로고침이 같은 확인을 또 하지 않는다.
 */
export function useIntegrationStep(
  workspaceId: string,
  provider: IntegrationProvider,
): IntegrationStep {
  const step = STEP_BY_PROVIDER[provider]
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const onboarding = useOnboardingSave(workspaceId)
  // 복귀 결과는 처음 그릴 때 한 번 읽는다. 곧 주소에서 지운다
  const [returned] = useState(() => {
    const result = readIntegrationReturn(searchParams)
    return result !== null && result.provider === provider ? result : null
  })
  const [notice, setNotice] = useState<IntegrationNotice | null>(() =>
    returned !== null && returned.outcome !== 'success' ? returned.outcome : null,
  )
  const [verifying, setVerifying] = useState(() => returned?.outcome === 'success')
  // 복귀 확인 중에는 구독 조회를 멈춘다 — 확인이 직접 받은 값을 캐시에 넣는다. 같은 조회가 겹쳐 나가지 않는다
  const integrations = useQuery({ ...integrationsQueryOptions(workspaceId), enabled: !verifying })
  // 건너뛰기 저장이 실패했다. 연쇄(D-073)는 앞 요청만 성공했을 수 있어, 서버는 이미 건너뜀인데
  // 화면은 pending 일 수 있다. 그 상태에서 연결하면 서버와 갈린다 — 그때만 건너뛰기 재시도만 허용한다.
  // 첫 요청부터 실패해 서버가 pending 이면 연결도 그대로 할 수 있다 (F-r1 #6)
  const [connectBlocked, setConnectBlocked] = useState(false)
  const handled = useRef(false)

  const { save } = onboarding
  useEffect(() => {
    if (returned === null || handled.current) return
    handled.current = true
    // 복귀 표시를 지운다 — 새로고침이 같은 확인을 또 하지 않는다
    void navigate(pathname, { replace: true })
    if (returned.outcome !== 'success') return
    void (async () => {
      let connected = false
      try {
        // 캐시 조회(fetchQuery)에 합치지 않고 직접 받는다. 화면의 구독이 잠깐 끊기면(StrictMode 재마운트 등)
        // TanStack Query 가 진행 중 요청을 취소해 합쳐진 확인까지 실패로 끝난다
        const latest = await fetchIntegrations(workspaceId)
        queryClient.setQueryData(integrationsQueryOptions(workspaceId).queryKey, latest)
        connected = latest[provider].status === 'connected'
      } catch {
        // 확인하지 못했으면 연결된 것으로 보지 않는다
      }
      if (!connected) {
        setNotice('failed')
        setVerifying(false)
        return
      }
      // 저장 실패는 saveError 로 보인다. 연결은 됐으니 `다음` 으로 저장만 다시 한다
      await save({ step, action: 'complete' }).catch(() => undefined)
      setVerifying(false)
    })()
  }, [returned, navigate, pathname, queryClient, workspaceId, provider, save, step])

  const connect = useCallback(() => {
    leaveApp(integrationStartUrl(workspaceId, provider, paths.onboardingStep(workspaceId, step)))
  }, [workspaceId, provider, step])

  const complete = useCallback(async () => {
    setNotice(null)
    await save({ step, action: 'complete' }).catch(() => undefined)
  }, [save, step])

  /** 서버에 이 단계가 건너뜀으로 저장됐는가. 확인하지 못하면 저장됐을 수 있다고 본다 */
  const skippedOnServer = useCallback(async () => {
    try {
      const latest = await queryClient.fetchQuery({
        ...workspaceDetailQueryOptions(workspaceId),
        staleTime: 0,
      })
      return latest.onboarding.steps.some((item) => item.step === step && item.status === 'skipped')
    } catch {
      return true
    }
  }, [queryClient, workspaceId, step])

  const skip = useCallback(async () => {
    setNotice(null)
    try {
      await save({ step, action: 'skip' })
      setConnectBlocked(false)
    } catch {
      // 확인이 끝날 때까지는 막아 둔다 — 그 사이에 연결을 누르지 못하게
      setConnectBlocked(true)
      setConnectBlocked(await skippedOnServer())
    }
  }, [save, step, skippedOnServer])

  return {
    integration: integrations.data?.[provider] ?? null,
    integrations: integrations.data ?? null,
    connectBlocked,
    integrationsError: integrations.error,
    retryIntegrations: () => void integrations.refetch(),
    notice,
    verifying,
    connect,
    complete,
    skip,
    saving: onboarding.isPending,
    saveError: onboarding.error,
  }
}
