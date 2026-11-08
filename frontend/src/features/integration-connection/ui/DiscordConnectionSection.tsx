import { useId, useRef } from 'react'
import type { DisconnectedStatus, Integration, IntegrationStatus } from '@/entities/integration'
import { paths } from '@/shared/config/routes'
import { formatSeoulMonthDayTime } from '@/shared/lib/date'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { Button } from '@/shared/ui/button'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { useFocusAfterDisconnect } from '../model/useFocusAfterDisconnect'
import { useIntegrationConnection } from '../model/useIntegrationConnection'
import type { IntegrationConnectionNotice } from '../model/useIntegrationConnection'
import { ChatChannelField } from './ChatChannelField'
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
import { DiscordMark } from './marks'

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

/** 카드의 설명 줄. 연결됐으면 서버 이름과 연결 시각, 아니면 연결하면 무엇을 하는지다. 채널은 카드 아래 `회의 채팅 채널` 칸에서 고른다 (#505) */
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
 * PM 은 카드 아래에서 회의 채팅 채널을 고른다 (#429).
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
  const headingRef = useRef<HTMLHeadingElement>(null)
  // 연동 상태를 받는 자리의 지연·최소 표시 (#508). 붙잡는 동안에는 조회 결과로 생기는 것(배지·설명·버튼·안내·처음 조회
  // 실패)을 모두 그리지 않고, 끝나면 한 번에 바꾼다. OAuth 확인·준비 표시와 알림은 조회 결과가 아니라 타이머를 기다리지 않는다
  const indicator = useLoadingIndicator(
    connection.integration === null && !connection.integrationError,
  )
  const integration = indicator.pending ? null : connection.integration
  const integrationError = indicator.pending ? null : connection.integrationError
  const status = integration?.status ?? null
  const busy = connection.verifying
  const disconnected: DisconnectedStatus | null =
    status === 'not_connected' || status === 'revoked' ? status : null
  const focusAfterDisconnect = useFocusAfterDisconnect(headingRef, disconnected !== null)

  return (
    <section aria-labelledby={headingId} className={SECTION} data-testid="discord-connection">
      <div className={CARD}>
        <span className={ICON_BOX}>
          <DiscordMark />
        </span>
        <div className={BODY}>
          <div className={TITLE_ROW}>
            <h3 id={headingId} ref={headingRef} tabIndex={-1} className={NAME}>
              Discord <span className="sr-only">연결</span>
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
              <DiscordMeta integration={integration} />
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
                provider="discord"
                onDisconnected={focusAfterDisconnect}
                disconnectNote={
                  integration?.chatChannel
                    ? `회의 채팅 채널(#${integration.chatChannel.name}) 수집도 함께 꺼져요.`
                    : undefined
                }
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
      {busy ? (
        <p role="status" className={NOTE}>
          연결을 확인하고 있어요.
        </p>
      ) : null}
      <FormErrorPanel message={connection.notice === null ? null : NOTICE[connection.notice]} />
      {!canManage && disconnected !== null ? (
        <Reveal indicator={indicator}>
          <p className={NOTE}>
            Discord 연결은 PM만 할 수 있어요. 마감 알림을 받으려면 PM에게 Discord 연결을 요청해
            주세요.
          </p>
        </Reveal>
      ) : null}
      {!canManage && status === 'connected' ? (
        <Reveal indicator={indicator}>
          <p className={NOTE}>Discord 연결은 PM이 관리해요.</p>
        </Reveal>
      ) : null}
      {canManage && integration !== null ? (
        <Reveal indicator={indicator}>
          <div className="pt-8">
            <ChatChannelField workspaceId={workspaceId} integration={integration} />
          </div>
        </Reveal>
      ) : null}
    </section>
  )
}
