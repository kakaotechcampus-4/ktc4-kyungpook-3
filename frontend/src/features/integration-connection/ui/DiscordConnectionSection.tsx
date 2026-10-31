import { useId } from 'react'
import type { DisconnectedStatus, Integration, IntegrationStatus } from '@/entities/integration'
import { paths } from '@/shared/config/routes'
import { formatSeoulMonthDayTime } from '@/shared/lib/date'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { useIntegrationConnection } from '../model/useIntegrationConnection'
import type { IntegrationConnectionNotice } from '../model/useIntegrationConnection'
import { ConnectionActions } from './ConnectionActions'
import {
  ACTIONS,
  BADGE,
  BODY,
  CARD,
  DOT,
  ICON_BOX,
  META,
  META_VALUE,
  NAME,
  NOTE,
  SECTION,
  TITLE_ROW,
} from './connectionStyles'

export interface DiscordConnectionSectionProps {
  workspaceId: string
  /** PM 만 연결·재연결·연결 끊기를 한다. 서버의 연결 시작이 PM 이 아니면 실패로 돌려보낸다. 일반 팀원은 상태와 요청 안내만 본다 */
  canManage: boolean
}

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: '연결됨',
  connecting: '준비 중',
  not_connected: '연결 안 됨',
  revoked: '연결 끊김',
}

const CONNECT_LABEL: Record<DisconnectedStatus, string> = {
  not_connected: 'Discord 연결하기',
  revoked: 'Discord 다시 연결하기',
}

const NOTICE: Record<IntegrationConnectionNotice, string> = {
  cancelled: 'Discord 연결을 취소했어요. 연결하려면 다시 시도해 주세요.',
  failed: 'Discord를 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
}

/* Settings 캔버스 `연결` 절의 Discord 표식 */
function DiscordMark() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.7 5.1A18 18 0 0 0 15.4 3.8l-.5 1.1a16 16 0 0 0-5.8 0l-.5-1.1a18 18 0 0 0-4.3 1.3C1.6 9.1.9 13 .9 16.8a17 17 0 0 0 5.3 2.7l1.1-1.8-1.7-.9.4-.3a13 13 0 0 0 12 0l.4.3-1.7.9 1.1 1.8a17 17 0 0 0 5.3-2.7c0-4.4-.9-8-3.4-11.7ZM8.1 14.6c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.8 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.7.9 1.7 2-.7 2-1.7 2Z" />
    </svg>
  )
}

/** 카드의 설명 줄. 연결됐으면 서버 이름과 연결 시각, 아니면 연결하면 무엇을 하는지다. 캔버스의 `읽는 채널` 은 API 에 없다 */
function DiscordMeta({ integration }: { integration: Integration }) {
  if (integration.status !== 'connected')
    return <span className={META}>팀 채널에 마감 리마인드와 회의록 요약을 보내요.</span>
  const connectedAt =
    integration.connectedAt === null ? '' : formatSeoulMonthDayTime(integration.connectedAt)
  return (
    <span className={META}>
      {integration.displayName ?? 'Discord 서버'}
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
 * 워크스페이스 설정 `연결` 절의 Discord 카드 (Settings 캔버스). 온보딩에서 건너뛴 Discord 를 여기서 연결한다 (D-011).
 * 연결해도 온보딩 단계는 저장하지 않는다 — 건너뜀으로 저장된 단계는 그대로다 (D-173).
 * OAuth 는 설정으로 돌아오고, 연결이 확인되면 팀 화면의 팀원 연결로 간다 (D-074).
 */
export function DiscordConnectionSection({
  workspaceId,
  canManage,
}: DiscordConnectionSectionProps) {
  const connection = useIntegrationConnection(workspaceId, 'discord', {
    returnPath: paths.settings(workspaceId),
    connectedTo: paths.membersConnect(workspaceId),
  })
  const headingId = useId()
  const integration = connection.integration
  const status = integration?.status ?? null
  const busy = connection.verifying
  const disconnected: DisconnectedStatus | null =
    status === 'not_connected' || status === 'revoked' ? status : null

  return (
    <section aria-labelledby={headingId} className={SECTION} data-testid="discord-connection">
      <div className={CARD}>
        <span className={ICON_BOX}>
          <DiscordMark />
        </span>
        <div className={BODY}>
          <div className={TITLE_ROW}>
            <h3 id={headingId} className={NAME}>
              Discord <span className="sr-only">연결</span>
            </h3>
            {status === null ? null : (
              <span className={BADGE}>
                <span className={DOT[status]} aria-hidden="true" />
                {STATUS_LABEL[status]}
              </span>
            )}
          </div>
          {integration === null ? (
            connection.integrationError ? null : (
              <div aria-busy="true">
                <Skeleton width={220} />
              </div>
            )
          ) : (
            <DiscordMeta integration={integration} />
          )}
        </div>
        {canManage && disconnected ? (
          <div className={ACTIONS}>
            <Button size="md-compact" loading={busy} onClick={connection.connect}>
              {CONNECT_LABEL[disconnected]}
            </Button>
          </div>
        ) : null}
        {canManage && status === 'connected' ? (
          <div className={ACTIONS}>
            <ConnectionActions workspaceId={workspaceId} provider="discord" />
          </div>
        ) : null}
      </div>

      {status === null && connection.integrationError ? (
        <QueryErrorState error={connection.integrationError} onRetry={connection.retry} />
      ) : null}
      {busy ? (
        <p role="status" className={NOTE}>
          연결을 확인하고 있어요.
        </p>
      ) : null}
      <FormErrorPanel message={connection.notice === null ? null : NOTICE[connection.notice]} />
      {!canManage && disconnected !== null ? (
        <p className={NOTE}>
          Discord 연결은 PM만 할 수 있어요. 마감 알림을 받으려면 PM에게 Discord 연결을 요청해
          주세요.
        </p>
      ) : null}
      {!canManage && status === 'connected' ? (
        <p className={NOTE}>Discord 연결은 PM이 관리해요.</p>
      ) : null}
    </section>
  )
}
