import { useEffect, useId, useRef } from 'react'
import { useSearchParams } from 'react-router'
import type { DisconnectedStatus, Integration, IntegrationStatus } from '@/entities/integration'
import { SETTINGS_PARAMS } from '@/shared/config/routes'
import { formatSeoulMonthDayTime } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
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

export interface NotionConnectionSectionProps {
  workspaceId: string
  /** PM 만 연결·재연결·연결 끊기를 한다. 일반 팀원은 상태와 요청 안내만 본다 (U3-3) */
  canManage: boolean
}

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: '연결됨',
  connecting: '준비 중',
  not_connected: '연결 안 됨',
  // 서버의 `revoked` 는 DB 찾기 실패·중단이다. 「끊김」이 아니다 (NotionRequiredModal 과 같은 까닭)
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

function NotionMark() {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8.5 16.5v-9l7 9v-9" strokeLinecap="round" />
    </svg>
  )
}

/** 카드의 설명 줄. 연결됐으면 연결한 곳과 시각이다. 캔버스의 `마지막 쓰기` 시각은 API 에 없다 */
function NotionMeta({ integration }: { integration: Integration }) {
  if (integration.status !== 'connected')
    return <span className={META}>정리한 회의록과 태스크를 이 공간의 Notion에 반영해요.</span>
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
 * 차단 모달에서 오면(`section=notion`) 제목으로 포커스를 옮겨 바로 이 영역을 읽게 한다.
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

  const integration = connection.integration
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
            <NotionMeta integration={integration} />
          )}
        </div>
        {canManage && disconnected ? (
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
        ) : null}
        {canManage && status === 'connected' ? (
          <div className={ACTIONS}>
            <ConnectionActions
              workspaceId={workspaceId}
              provider="notion"
              onDisconnected={focusAfterDisconnect}
            />
          </div>
        ) : null}
      </div>

      {status === null && connection.integrationError ? (
        <QueryErrorState error={connection.integrationError} onRetry={connection.retry} />
      ) : null}
      {canManage && status === 'connected' && connection.returnTo !== null ? (
        <GuardedLink to={connection.returnTo} replace className={`${NOTE} self-start`}>
          회의 올리기로 돌아가기
        </GuardedLink>
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
        <p className={NOTE}>
          Notion 연결은 PM만 할 수 있어요. 회의를 정리하려면 PM에게 Notion 연결을 요청해 주세요.
        </p>
      ) : null}
      {!canManage && status === 'connected' ? (
        <p className={NOTE}>Notion 연결은 PM이 관리해요.</p>
      ) : null}
    </section>
  )
}
