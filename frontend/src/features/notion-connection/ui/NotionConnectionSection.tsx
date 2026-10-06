import { useEffect, useId, useRef } from 'react'
import { useSearchParams } from 'react-router'
import type { IntegrationStatus } from '@/entities/integration'
import { SETTINGS_PARAMS } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { useNotionConnection } from '../model/useNotionConnection'
import type { NotionConnectionNotice } from '../model/useNotionConnection'

export interface NotionConnectionSectionProps {
  workspaceId: string
  /** PM 만 연결·재연결한다. 일반 팀원은 상태와 요청 안내만 본다 (U3-3) */
  canManage: boolean
}

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: '연결됨',
  not_connected: '연결 안 됨',
  revoked: '연결 끊김',
}

const CONNECT_LABEL: Record<Exclude<IntegrationStatus, 'connected'>, string> = {
  not_connected: 'Notion 연결하기',
  revoked: 'Notion 다시 연결하기',
}

const NOTICE: Record<NotionConnectionNotice, string> = {
  cancelled: 'Notion 연결을 취소했어요. 연결하려면 다시 시도해 주세요.',
  failed: 'Notion을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
}

/* Settings 캔버스의 `연결` 절에서 Notion 줄만 옮긴다. `속성 다시 맞추기`·`연결 끊기`·Discord 줄은 M8 이다 */
const SECTION = 'flex flex-col gap-14 border-t border-divider pt-24'
/* 17px 은 Settings 캔버스의 절 제목이다 — 모달 제목과 같은 단(docs/impl-decision/2026-09-16-modal-title-17px.md) */
const HEADING = 'text-[17px] font-bold tracking-h2 text-ink focus-visible:outline-none'
const LEAD = 'text-body text-sub'
const ROW = 'flex items-center gap-14 rounded-16 border border-line bg-surface px-18 py-16'
const ICON_BOX =
  'inline-flex h-40 w-40 shrink-0 items-center justify-center rounded-10 bg-surface-sunken text-sub'
const NAME = 'text-body font-semibold text-ink'
/* 11px 배지는 Settings 캔버스 실측이다. 점은 연결됨 먹 · 미연결 점선 회색 · 끊김 강조(위험 배지) */
const BADGE =
  'inline-flex h-20 items-center gap-5 rounded-6 bg-control px-8 text-[11px] leading-none font-semibold text-sub'
const DOT: Record<IntegrationStatus, string> = {
  connected: 'h-5 w-5 rounded-999 bg-ink',
  not_connected: 'h-5 w-5 rounded-999 bg-dashed',
  revoked: 'h-5 w-5 rounded-999 bg-accent',
}
const NOTE = 'text-caption text-dim'

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

/**
 * 워크스페이스 설정의 Notion 연결 영역. M8 설정 화면에서 이 영역만 앞당겼다 (계획 §1).
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

  const status = connection.integration?.status ?? null
  const busy = connection.verifying

  return (
    <section aria-labelledby={headingId} className={SECTION} data-testid="notion-connection">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className={HEADING}>
        Notion 연결
      </h2>
      <p className={LEAD}>
        회의를 정리하려면 Notion이 연결돼 있어야 해요. 정리한 회의록과 태스크를 이 공간의 Notion에
        반영해요.
      </p>

      {status === null && connection.integrationError ? (
        <QueryErrorState error={connection.integrationError} onRetry={connection.retry} />
      ) : status === null ? (
        <div aria-busy="true">
          <Skeleton lines={2} />
        </div>
      ) : (
        <div className={ROW}>
          <span className={ICON_BOX}>
            <NotionMark />
          </span>
          <div className="flex min-w-[0px] flex-1 items-center gap-8">
            <span className={NAME}>Notion</span>
            <span className={BADGE}>
              <span className={DOT[status]} aria-hidden="true" />
              {STATUS_LABEL[status]}
            </span>
          </div>
          {canManage && status !== 'connected' ? (
            <Button variant="primary" loading={busy} onClick={connection.connect}>
              {CONNECT_LABEL[status]}
            </Button>
          ) : null}
          {canManage && status === 'connected' && connection.returnTo !== null ? (
            <GuardedLink to={connection.returnTo} replace className={NOTE}>
              회의 올리기로 돌아가기
            </GuardedLink>
          ) : null}
        </div>
      )}

      {busy ? (
        <p role="status" className={NOTE}>
          연결을 확인하고 있어요.
        </p>
      ) : null}
      <FormErrorPanel message={connection.notice === null ? null : NOTICE[connection.notice]} />
      {!canManage && status !== null && status !== 'connected' ? (
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
