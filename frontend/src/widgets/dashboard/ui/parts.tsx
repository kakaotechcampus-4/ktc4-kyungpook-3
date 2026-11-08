import type { ReactNode } from 'react'
import { COMMON_MESSAGES } from '@/shared/api/errorMessages'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { Button } from '@/shared/ui/button'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import type { Loadable } from '../model/useDashboardData'
import type { DashboardRefreshFailure } from '../model/useRefreshFailure'
import { LINE_SHAPE } from './frame'

/* Main 시안의 본문 영역 공통 모양 — 머리줄(제목·오른쪽 링크) 아래 1px 선, 행 사이 1px 선 */
export const SECTION_HEAD = 'flex items-center justify-between gap-16 border-b border-line py-15'
export const SECTION_TITLE =
  'text-[14px] leading-[1.75] font-semibold text-ink max-md:text-[17px] max-md:leading-[1.5]'
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

/** 영역 본문 뼈대의 모양. 실제 행과 같은 틀이다 — `review` 는 확인이 필요한 일(제목 + 설명 두 줄), `line` 은 마감 임박·최근 반영(한 줄) */
export interface SectionSkeletonShape {
  rows: number
  kind: 'review' | 'line'
}

/* 행 치수는 Dashboard 의 REVIEW_ROW · DUE_ROW 와 RecentSection 의 ROW 와 같다 */
const SKELETON_ROW = {
  review: 'flex flex-col gap-4 border-b border-line py-18 last:border-b-0',
  line: 'flex items-center border-b border-line px-18 py-12 last:border-b-0 max-md:px-[0px]',
}

/** 영역 본문 뼈대 — 실제 목록과 같은 행 높이·구분선이다. 글자 줄 높이 안에 막대가 앉는다 */
export function SectionSkeleton({ rows, kind }: SectionSkeletonShape) {
  return (
    <ul>
      {Array.from({ length: rows }, (_row, index) => (
        <li key={index} className={SKELETON_ROW[kind]}>
          {kind === 'review' ? (
            <>
              <div className="flex h-lh items-center text-[15px] leading-[1.55]">
                <Skeleton width={`${[48, 60, 40][index % 3]}%`} />
              </div>
              <div className="flex h-lh items-center text-body">
                <Skeleton width="36%" />
              </div>
            </>
          ) : (
            <div className="flex h-[26px] w-full items-center text-control">
              <Skeleton width={`${[64, 52, 72, 44, 58][index % 5]}%`} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

interface SectionBodyProps<T> {
  state: Loadable<T>
  /** 실패했을 때 제목. 기본 `정보를 불러오지 못했어요` */
  errorTitle: string
  /** 기다리는 동안의 뼈대 모양. 기본 한 줄 행 셋 */
  skeleton?: SectionSkeletonShape
  children: (data: T) => ReactNode
}

/**
 * 영역 하나의 로딩·실패·데이터. 한 영역이 실패해도 다른 영역은 그대로 그린다 (계획 §5).
 * 로딩은 지연·최소 표시 규칙을 따른다 — 짧은 응답은 빈 자리만, 보인 뼈대는 최소 시간 둔다 (#508)
 */
export function SectionBody<T>({
  state,
  errorTitle,
  skeleton = LINE_SHAPE,
  children,
}: SectionBodyProps<T>) {
  const indicator = useLoadingIndicator(state.status === 'loading')
  if (state.status === 'loading' || indicator.pending)
    return (
      <DeferredSkeleton indicator={indicator}>
        <SectionSkeleton {...skeleton} />
      </DeferredSkeleton>
    )
  const body =
    state.status === 'error' ? (
      <div className="py-18">
        <QueryErrorState error={state.error} title={errorTitle} onRetry={state.retry} />
      </div>
    ) : (
      children(state.data)
    )
  return <Reveal indicator={indicator}>{body}</Reveal>
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
