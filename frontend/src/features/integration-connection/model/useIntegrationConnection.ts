import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import {
  CONNECTING_POLL_MS,
  integrationStartUrl,
  integrationsQueryOptions,
  readIntegrationReturn,
  waitWhileConnecting,
} from '@/entities/integration'
import type { IntegrationProvider, Integrations } from '@/entities/integration'
import { messageSettingsQueryOptions } from '@/entities/message-settings'
import { captureSession } from '@/entities/user'
import { fetchFresh } from '@/shared/api/fetchFresh'
import { useLivePathname } from '@/shared/lib/live-pathname'
import { leaveApp } from '@/shared/lib/location'
import { withoutOAuthResult } from '@/shared/lib/oauth'
import { hasPendingLeave, useGuardedNavigate } from '@/shared/lib/unsaved-changes'

/** 연결을 끝내지 못한 까닭. 취소는 사용자가 고른 것, 실패는 제공자 오류이거나 복귀 뒤 확인에서 연결이 없던 것 */
export type IntegrationConnectionNotice = 'cancelled' | 'failed'

export interface IntegrationConnectionOptions {
  /** OAuth 뒤 돌아올 설정 경로 (D-158) */
  returnPath: string
  /** 복귀 뒤 연결이 확인되면 옮겨 갈 경로. null 이면 설정에 머문다 */
  connectedTo: string | null
}

export interface IntegrationConnection<P extends IntegrationProvider = IntegrationProvider> {
  /** 지금 이 제공자의 연동 상태. 조회 전이면 null */
  integration: Integrations[P] | null
  integrationError: unknown
  retry: () => void
  /** 복귀했는데 연결되지 않았으면 그 까닭 */
  notice: IntegrationConnectionNotice | null
  /** 복귀 뒤 연동 상태를 다시 조회하는 중 */
  verifying: boolean
  /** 복귀 확인 중 제공자가 아직 준비 중이다(`connecting`, Notion 의 DB 붙이기). 끝날 때까지 다시 묻는 중이다 */
  preparing: boolean
  /** 현재 탭을 OAuth 로 옮긴다 (D-158). 복귀 경로는 `returnPath` 다 */
  connect: () => void
}

/**
 * 설정의 연동 연결. 온보딩 연결 단계와 같은 방식이다 — 현재 탭 OAuth, 복귀 결과 파서, 복귀 뒤 재조회.
 * 온보딩과 달리 단계를 저장하지 않는다 — 설정에서 연결해도 온보딩 단계 상태는 그대로다 (D-173).
 * 복귀 주소의 `success` 만 믿지 않는다. 연동 상태를 **다시 조회해** `connected` 일 때만 성공으로 보고,
 * `connectedTo` 가 있으면 그리로 `replace` 이동한다. 취소·실패는 설정에 머물고 안내를 보인다.
 * 복귀 표시는 읽자마자 주소에서 지운다 — 새로고침이 같은 확인을 또 하지 않는다. 다른 제공자의 복귀는 읽지 않는다.
 *
 * 재조회와 캐시 갱신은 끝까지 하지만, 옮기는 것은 확인이 끝났을 때 사용자가 **아직 이 설정 화면에 있을 때만**이다.
 * 확인을 기다리는 동안 다른 화면·공간으로 갔으면 데려오지 않는다. 이탈 확인이 열려 있으면(다른 곳으로 가려고 고르는 중)
 * 끼어들지 않는다.
 * 「아직 이 화면인가」는 라우터 기록의 지금 경로로 본다. 사용자가 누른 이동이 지연 로드 화면을 기다리는 중이면 이 영역이
 * 아직 그려져 있어도 떠난 것이다 (U4 r1 M01 과 같은 경합). 확인 중 세션이 끝났으면(로그아웃·만료) 결과를 버린다 —
 * 이전 사용자의 연동 상태를 비운 캐시에 다시 쓰거나 로그인 화면에서 옮기지 않는다 (U4 r1 M02 와 같은 경합).
 * 옮길 때는 앱 안 이동의 관문(useGuardedNavigate)을 탄다. 확인 중에도 설정의 다른 입력은 고칠 수 있고, 고친 것이 있으면
 * 기존 이탈 확인이 묻는다 — 확인 중에 입력을 잠그면 이 영역이 화면 전체 입력의 상태를 알아야 한다.
 */
export function useIntegrationConnection<P extends IntegrationProvider>(
  workspaceId: string,
  provider: P,
  { returnPath, connectedTo }: IntegrationConnectionOptions,
): IntegrationConnection<P> {
  const queryClient = useQueryClient()
  const navigate = useGuardedNavigate()
  const { pathname } = useLocation()
  const livePathname = useLivePathname()
  const [searchParams] = useSearchParams()
  // 복귀 결과는 처음 그릴 때 한 번 읽는다. 곧 주소에서 지운다
  const [initialReturn] = useState(() => readIntegrationReturn(searchParams))
  const returned = initialReturn?.provider === provider ? initialReturn : null
  // 같은 화면의 다른 제공자 영역이 성공 복귀를 확인한다
  const otherVerifies =
    initialReturn !== null && returned === null && initialReturn.outcome === 'success'
  const [notice, setNotice] = useState<IntegrationConnectionNotice | null>(() =>
    returned !== null && returned.outcome !== 'success' ? returned.outcome : null,
  )
  const [verifying, setVerifying] = useState(() => returned?.outcome === 'success')
  const [preparing, setPreparing] = useState(false)
  // 복귀 확인 중에는 구독이 따로 묻지 않는다 — 확인의 조회가 같은 Query 에 답을 쓴다. 다른 제공자의 확인도 같은 연동 Query 를
  // 묻는다. 이 영역이 먼저 물으면 그 확인이 거두고 다시 묻는다(fetchFresh) — 그래서 이 영역은 캐시에 쓰인 답만 읽는다
  const integrations = useQuery({
    ...integrationsQueryOptions(workspaceId),
    enabled: !verifying && !otherVerifies,
  })
  const handled = useRef(false)
  // 지금 이 영역이 그려져 있나. 떠나면 false 다 — 늦게 끝난 확인이 사용자를 데려오지 않는다
  const present = useRef(false)
  useEffect(() => {
    present.current = true
    return () => {
      present.current = false
    }
  }, [])

  useEffect(() => {
    if (returned === null || handled.current) return
    handled.current = true
    // 복귀 표시를 지운다. 나머지 검색 파라미터(`section`·`next`)는 남긴다 — 실패 뒤 다시 연결해도 같은 곳으로 간다
    navigate({ pathname, search: withoutOAuthResult(searchParams) }, { replace: true })
    if (returned.outcome !== 'success') return
    const isCurrentSession = captureSession()
    void (async () => {
      let connected = false
      try {
        // 복귀한 **뒤의** 연동 상태로 확인한다 (fetchFresh). StrictMode 의 시험 재마운트가 이 영역의 구독을 잠깐 내려 진행 중
        // 조회가 취소돼도, 돌아온 이전 값은 답으로 치지 않고 다시 묻는다 — 확인은 끝까지 간다. 연동 캐시에 쓰는 것은 그 공유
        // Query 하나다 (U4 r4 M06). 세션이 끝나면 취소로 끝나고 다음 세션의 캐시에 쓰지 않는다 (U4 r3 M04)
        // 준비 중(`connecting`)이면 끝날 때까지 다시 묻는다(#204). 이 영역을 떠나면 그만 묻는다 —
        // 다른 화면은 연동 Query 의 자체 재조회가 맡는다
        const latest = await waitWhileConnecting(
          () => fetchFresh(queryClient, integrationsQueryOptions(workspaceId)),
          provider,
          {
            intervalMs: CONNECTING_POLL_MS,
            shouldStop: () => !isCurrentSession() || !present.current,
            onConnecting: () => setPreparing(true),
          },
        )
        connected = latest?.[provider].status === 'connected'
      } catch {
        // 확인하지 못했으면 연결된 것으로 보지 않는다
      }
      setPreparing(false)
      if (!isCurrentSession()) return
      // 알림 설정의 PM 연결 상태(`pms`)는 Discord 연결을 따른다 (#340)
      if (connected && provider === 'discord')
        void queryClient.invalidateQueries({
          queryKey: messageSettingsQueryOptions(workspaceId).queryKey,
        })
      // 확인을 시작한 화면에 그대로 있고(가는 중인 이동도 없고), 다른 곳으로 가려고 고르는 중이 아닐 때만 옮긴다
      const stillHere = present.current && livePathname() === pathname
      if (connected && connectedTo !== null && stillHere && !hasPendingLeave()) {
        navigate(connectedTo, { replace: true })
      }
      if (!connected) setNotice('failed')
      setVerifying(false)
    })()
  }, [
    returned,
    navigate,
    livePathname,
    pathname,
    searchParams,
    queryClient,
    workspaceId,
    provider,
    connectedTo,
  ])

  const connect = useCallback(() => {
    setNotice(null)
    leaveApp(integrationStartUrl(workspaceId, provider, returnPath))
  }, [workspaceId, provider, returnPath])

  return {
    integration: integrations.data?.[provider] ?? null,
    integrationError: integrations.error,
    retry: () => void integrations.refetch(),
    notice,
    verifying,
    preparing,
    connect,
  }
}
