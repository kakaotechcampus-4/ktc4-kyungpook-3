import type { ReactNode } from 'react'
import { COMMON_MESSAGES } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import type { Loadable } from '../model/useDashboardData'
import type { DashboardRefreshFailure } from '../model/useRefreshFailure'

/* Main 시안의 본문 영역 공통 모양 — 머리줄(제목·오른쪽 링크) 아래 1px 선, 행 사이 1px 선 */
export const SECTION_HEAD = 'flex items-center justify-between gap-16 border-b border-line py-15'
export const SECTION_TITLE = 'text-[14px] leading-[1.75] font-semibold text-ink'
export const HEAD_LINK =
  'inline-flex items-center gap-4 text-caption text-sub hover:text-ink tabular-nums'
export const BADGE =
  'inline-flex h-[21px] shrink-0 items-center gap-5 rounded-6 px-8 text-meta leading-none font-semibold'
export const EMPTY_NOTE = 'py-18 text-body text-dim'
export const ACTION_LINK =
  'inline-flex h-32 shrink-0 items-center gap-3 px-4 text-caption font-semibold text-ink hover:text-sub'

/** 이름의 첫 글자 원. 모르는 담당자는 빈 원이다 */
export function Initial({ name }: { name: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-22 w-22 shrink-0 items-center justify-center rounded-999 bg-divider text-[10px] leading-none text-ink"
    >
      {name?.trim().slice(0, 1) ?? ''}
    </span>
  )
}

interface SectionBodyProps<T> {
  state: Loadable<T>
  /** 실패했을 때 제목. 기본 `정보를 불러오지 못했어요` */
  errorTitle: string
  children: (data: T) => ReactNode
}

/** 영역 하나의 로딩·실패·데이터. 한 영역이 실패해도 다른 영역은 그대로 그린다 (계획 §5) */
export function SectionBody<T>({ state, errorTitle, children }: SectionBodyProps<T>) {
  if (state.status === 'loading')
    return (
      <div aria-busy="true" className="flex flex-col gap-8 py-18">
        <Skeleton lines={3} />
      </div>
    )
  if (state.status === 'error')
    return (
      <div className="py-18">
        <QueryErrorState error={state.error} title={errorTitle} onRetry={state.retry} />
      </div>
    )
  return <>{children(state.data)}</>
}

/**
 * 갱신 실패의 남는 표시 (E-02). 대시보드 제목 근처에 하나만 둔다 — 영역마다 띄우지 않는다. 처음부터 실패한 영역(`QueryErrorState`)과
 * 달리 기존 데이터는 그대로 두고 어느 영역이 최신이 아닌지만 알린다. 다시 시도는 실패한 조회를 모두 다시 부르고, 그동안 잠긴다.
 * 회복하면 사라진다. 실패가 생기는 순간의 알림은 토스트(`useRefreshFailureToast`)가 한 번 한다
 */
export function RefreshFailedNotice({ failure }: { failure: DashboardRefreshFailure }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-8 text-caption text-dim">
      <span>{failure.message}</span>
      <span aria-hidden="true">·</span>
      <Button size="sm" loading={failure.retrying} onClick={failure.retry}>
        {COMMON_MESSAGES.retry}
      </Button>
    </div>
  )
}
