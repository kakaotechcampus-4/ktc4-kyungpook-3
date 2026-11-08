import { useEffect, useId, useRef } from 'react'
import { useSearchParams } from 'react-router'
import type { DisconnectedStatus, Integration, IntegrationStatus } from '@/entities/integration'
import { SETTINGS_PARAMS } from '@/shared/config/routes'
import { formatSeoulMonthDayTime } from '@/shared/lib/date'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { Button } from '@/shared/ui/button'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { useFocusAfterDisconnect } from '../model/useFocusAfterDisconnect'
import { useNotionConnection } from '../model/useNotionConnection'
import type { NotionConnectionNotice } from '../model/useNotionConnection'
import { ConnectionActions } from './ConnectionActions'
import {
  ACTIONS,
  BADGE,
  BODY,
  CARD,
  CARD_BUTTON,
  DOT,
  ICON_BOX,
  META,
  META_VALUE,
  NAME,
  NOTE,
  SECTION,
  TITLE_ROW,
} from './connectionStyles'
import { NotionMark } from './marks'

export interface NotionConnectionSectionProps {
  workspaceId: string
  /** PM 만 연결·재연결·연결 끊기를 한다. 일반 팀원은 상태와 요청 안내만 본다 (U3-3) */
  canManage: boolean
}

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: '연결됨',
  connecting: '준비 중',
  not_connected: '연결 안 됨',
  // 서버의 `revoked` 는 연결 뒤 DB 찾기 실패·중단과, 토큰 갱신이 거절돼 연결이 끊긴 경우 둘 다다.
  // 어느 쪽이든 다시 연결해야 한다 (backend integrations._notion_status)
  revoked: '연결 실패',
}

const CONNECT_LABEL: Record<DisconnectedStatus, string> = {
  not_connected: 'Notion 연결하기',
  revoked: 'Notion 다시 연결하기',
}

const NOTICE: Record<NotionConnectionNotice, string> = {
  cancelled: 'Notion 연결을 취소했어요. 연결하려면 다시 시도해 주세요.',
  failed: 'Notion을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
}

/**
 * 카드의 설명 줄. 연결됐으면 연결한 곳과 시각이다. 캔버스의 `마지막 쓰기` 시각은 API 에 없다.
 * 연결 전에는 선택 기능임을 알린다 — 연결하지 않아도 회의·회의록·태스크는 웹에서 다 쓴다 (D-182)
 */
function NotionMeta({ integration }: { integration: Integration }) {
  if (integration.status !== 'connected')
    return (
      <span className={META}>
        연결하지 않아도 돼요. 연결하면 승인한 태스크가 Notion에도 올라가요.
      </span>
    )
  const connectedAt =
    integration.connectedAt === null ? '' : formatSeoulMonthDayTime(integration.connectedAt)
  return (
    <span className={META}>
      {integration.displayName ?? 'Notion'}
      {connectedAt === '' ? null : (
        <>
          {' · 연결 '}
          <span className={META_VALUE}>{connectedAt}</span>
        </>
      )}
    </span>
  )
}

/**
 * 워크스페이스 설정 `연결` 절의 Notion 카드 (Settings 캔버스). M5 에서 앞당긴 영역을 캔버스 모양으로 옮겼다.
 * 다른 화면에서 이 영역으로 오면(`section=notion`, 대시보드·OAuth 복귀) 제목으로 포커스를 옮겨 바로 이 영역을 읽게 한다.
 */
export function NotionConnectionSection({ workspaceId, canManage }: NotionConnectionSectionProps) {
  const connection = useNotionConnection(workspaceId)
  const [searchParams] = useSearchParams()
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusHere = searchParams.get(SETTINGS_PARAMS.section) === 'notion'

  useEffect(() => {
    if (focusHere) headingRef.current?.focus()
  }, [focusHere])

  // 연동 상태를 받는 자리의 지연·최소 표시 (#508). 붙잡는 동안에는 조회 결과로 생기는 것(배지·설명·버튼·안내·처음 조회
  // 실패)을 모두 그리지 않고, 끝나면 한 번에 바꾼다. OAuth 확인·준비 표시와 알림은 조회 결과가 아니라 타이머를 기다리지 않는다
  const indicator = useLoadingIndicator(
    connection.integration === null && !connection.integrationError,
  )
  const integration = indicator.pending ? null : connection.integration
  const integrationError = indicator.pending ? null : connection.integrationError
  const status = integration?.status ?? null
  const busy = connection.verifying
  // 연결·재연결을 줄 상태. 준비 중(`connecting`)은 DB 를 붙이는 중이라 다시 연결하게 하지 않는다 (#204)
  const disconnected: DisconnectedStatus | null =
    status === 'not_connected' || status === 'revoked' ? status : null
  const focusAfterDisconnect = useFocusAfterDisconnect(headingRef, disconnected !== null)
  const preparing = connection.preparing || status === 'connecting'

  return (
    <section aria-labelledby={headingId} className={SECTION} data-testid="notion-connection">
      <div className={CARD}>
        <span className={ICON_BOX}>
          <NotionMark />
        </span>
        <div className={BODY}>
          <div className={TITLE_ROW}>
            <h3 id={headingId} ref={headingRef} tabIndex={-1} className={NAME}>
              Notion <span className="sr-only">연결</span>
            </h3>
            {status === null ? null : (
              <Reveal indicator={indicator}>
                <span className={BADGE}>
                  <span className={DOT[status]} aria-hidden="true" />
                  {STATUS_LABEL[status]}
                </span>
              </Reveal>
            )}
          </div>
          {indicator.pending ? (
            <DeferredSkeleton indicator={indicator}>
              <Skeleton width={220} />
            </DeferredSkeleton>
          ) : integration === null ? null : (
            <Reveal indicator={indicator}>
              <NotionMeta integration={integration} />
            </Reveal>
          )}
        </div>
        {canManage && disconnected ? (
          <Reveal indicator={indicator}>
            <div className={ACTIONS}>
              <Button
                size="md-compact"
                className={CARD_BUTTON}
                loading={busy}
                onClick={connection.connect}
              >
                {CONNECT_LABEL[disconnected]}
              </Button>
            </div>
          </Reveal>
        ) : null}
        {canManage && status === 'connected' ? (
          <Reveal indicator={indicator}>
            <div className={ACTIONS}>
              <ConnectionActions
                workspaceId={workspaceId}
                provider="notion"
                onDisconnected={focusAfterDisconnect}
              />
            </div>
          </Reveal>
        ) : null}
      </div>

      {status === null && integrationError ? (
        <Reveal indicator={indicator}>
          <QueryErrorState error={integrationError} onRetry={connection.retry} />
        </Reveal>
      ) : null}
      {preparing ? (
        <p role="status" className={NOTE}>
          Notion을 준비하고 있어요. 1분 정도 걸릴 수 있어요.
        </p>
      ) : busy ? (
        <p role="status" className={NOTE}>
          연결을 확인하고 있어요.
        </p>
      ) : null}
      <FormErrorPanel message={connection.notice === null ? null : NOTICE[connection.notice]} />
      {!canManage && disconnected !== null ? (
        <Reveal indicator={indicator}>
          <p className={NOTE}>
            Notion 연결은 PM만 할 수 있어요. 태스크를 Notion에도 올리려면 PM에게 연결을 요청해
            주세요.
          </p>
        </Reveal>
      ) : null}
      {!canManage && status === 'connected' ? (
        <Reveal indicator={indicator}>
          <p className={NOTE}>Notion 연결은 PM이 관리해요.</p>
        </Reveal>
      ) : null}
    </section>
  )
}
