import type { ReactNode } from 'react'
import { DeferredSkeleton } from '../deferred-skeleton'
import { Skeleton } from '../skeleton'

/* widgets/meeting-minutes 의 MeetingMinutes · MinutesDetail · MinutesTabs 와 같은 치수다 (Meetings 캔버스 실측).
   shared 는 widgets 를 가져올 수 없어 값을 옮겨 적었다. 틀이 바뀌면 여기도 맞춘다 — e2e/meeting-skeleton.e2e.ts 가 위치를 잰다 */
const SCREEN = 'flex flex-1 items-stretch max-md:flex-col'
const ASIDE =
  'flex w-aside shrink-0 flex-col border-r border-divider max-md:w-full max-md:border-r-0 max-md:border-b'
/* 머리 줄은 PM 의 `회의 올리기`(32px) 높이로 고정돼 있다 — 역할과 상관없이 목록이 같은 자리에서 시작한다 */
const ASIDE_HEAD = 'flex min-h-64 items-center justify-between gap-12 px-20 pt-18 pb-14'
const ASIDE_TITLE = 'flex h-lh items-center text-[17px] leading-[1.55]'
const LIST = 'flex flex-col gap-4 px-12'
const ROW = 'flex flex-col gap-6 px-14 py-13'
const SECTION = 'flex min-w-[0px] flex-1 flex-col'
const HEAD = 'flex flex-col gap-7 px-36 pt-44 pb-18 max-md:px-20'
const TITLE = 'flex h-lh items-center text-[26px] leading-[1.3]'
const CHIP_ROW = 'flex h-22 items-center gap-12'
const TAB_LIST = 'flex items-center gap-18 border-b border-line px-36 max-md:px-20'
/* 탭 이름은 정해진 글자라 막대 대신 글자로 그린다 — MinutesTabs 의 TAB 과 같은 글자·높이. 첫 탭(요약)이 골라져 있다 */
const TAB =
  'flex h-[38px] items-center border-b-2 border-transparent px-3 text-body font-semibold text-sub'
const TAB_SELECTED = 'border-ink text-ink'
const TAB_LABELS = ['요약', '전사문', '추출된 일']
/* 요약 탭의 묶음 제목 — MinutesBody 의 SECTION_TITLE 과 같다 */
const SECTION_TITLE = 'text-[14px] leading-[1.55] font-semibold text-ink'
const PANEL = 'flex flex-col gap-30 px-36 pt-28 pb-56 max-md:px-20'

/** 라우트 뼈대(MinutesPageSkeleton)와 회의를 바꾼 뒤의 본문 뼈대는 바로 보인다. 화면이 데이터를 기다릴 때는 지연 규칙(#508)을 넘긴다 */
const SHOWN = { skeletonVisible: true }

interface IndicatorProps {
  /** `useLoadingIndicator` 의 결과. 없으면 바로 보인다 */
  indicator?: { skeletonVisible: boolean }
}

/** 글 한 줄 자리 — 그 글자 크기의 줄 높이 안에 12px 뼈대가 가운데 앉는다. 줄 높이가 같아 그려질 때 아래가 밀리지 않는다 */
function TextLine({ typography, width }: { typography: string; width: number | string }) {
  return (
    <div className={`flex h-lh items-center ${typography}`}>
      <Skeleton width={width} />
    </div>
  )
}

/**
 * 본문 머리 뼈대 — 제목 줄 · 메타와 출처 칩 · 참석자 칩. 세 줄 모두 회의록 머리와 같은 고정 높이다 — 제목은 늘 한 줄(넘치면
 * 말줄임, UX1-M04), 메타 줄과 참석자 줄은 칩 한 줄(22). 제목이 길어도 · 참석자가 많아도 탭 줄이 같은 자리다
 */
function MinutesHeadSkeleton() {
  return (
    <div className={HEAD}>
      <div data-testid="minutes-detail-skeleton-title" className={TITLE}>
        <Skeleton variant="block" width="50%" height={26} className="rounded-8" />
      </div>
      <div className={CHIP_ROW}>
        <Skeleton width={150} />
        <Skeleton variant="block" width={64} height={22} className="rounded-6" />
      </div>
      {/* 참석자 줄 — 회의록(이름 칩 한 줄 + `+N`)과 목록 요약 머리(`참석자 N명`)가 모두 칩 한 줄(22) 높이다.
          참석자가 몇 명이든 이 높이라 탭 줄이 같은 자리다 (UX1-M03) */}
      <div className="flex h-22 items-center gap-6">
        {[48, 56, 48, 52].map((width, index) => (
          <Skeleton key={index} variant="block" width={width} height={22} className="rounded-6" />
        ))}
      </div>
    </div>
  )
}

/**
 * 회의록 목록이 오는 동안의 자리 — 정리된 회의 행(제목 한 줄 · 메타 한 줄)과 같은 높이의 세 줄.
 * 컨테이너(DeferredSkeleton)가 aria-busy 를 진다 (M2 Skeleton 약속).
 */
export function MinutesListSkeleton({ indicator = SHOWN }: IndicatorProps) {
  return (
    <DeferredSkeleton indicator={indicator} data-testid="minutes-list-skeleton" className={LIST}>
      {[72, 56, 64].map((width) => (
        <div key={width} className={ROW}>
          <TextLine typography="text-body" width={`${width}%`} />
          <TextLine typography="text-meta" width={112} />
        </div>
      ))}
    </DeferredSkeleton>
  )
}

/**
 * 고른 회의의 회의록이 오는 동안의 자리 — 실제 본문과 같은 배치다.
 * 제목(26px) · 메타와 출처 칩 · 참석자 칩 · 탭 줄(38px, 아래 선) · 본문. 머리와 탭 줄의 높이가 같아 그려질 때 탭이 움직이지 않는다.
 * `head` 를 주면 머리 뼈대 대신 그것을 그린다 — 목록 요약으로 이미 아는 제목·메타를 먼저 보여 줄 때다 (UX1-M02).
 * 같은 머리 치수로 그려야 탭 줄이 제자리다.
 */
export function MinutesDetailSkeleton({
  head,
  indicator = SHOWN,
}: IndicatorProps & { head?: ReactNode }) {
  return (
    <DeferredSkeleton
      indicator={indicator}
      data-testid="minutes-detail-skeleton"
      className="flex flex-col"
    >
      {head ?? <MinutesHeadSkeleton />}
      {/* 정해진 글자는 자리표시라 스크린리더에서 뺀다 — 기다림은 컨테이너의 aria-busy 가 알린다 */}
      <div data-testid="minutes-detail-skeleton-tabs" aria-hidden="true" className={TAB_LIST}>
        {TAB_LABELS.map((label, index) => (
          <div key={label} className={index === 0 ? `${TAB} ${TAB_SELECTED}` : TAB}>
            {label}
          </div>
        ))}
      </div>
      <div className={PANEL}>
        <TextLine typography="text-[14px] leading-[1.7]" width="80%" />
        <div className="flex flex-col gap-14">
          <p aria-hidden="true" className={SECTION_TITLE}>
            핵심 내용
          </p>
          <Skeleton lines={3} />
        </div>
        <div className="flex flex-col gap-14">
          <p aria-hidden="true" className={SECTION_TITLE}>
            결정한 것
          </p>
          <Skeleton lines={2} />
        </div>
      </div>
    </DeferredSkeleton>
  )
}

/**
 * 회의록 화면 코드·가드 캐시를 기다리는 동안의 자리 (RouteSkeleton). 왼쪽 목록(308) + 오른쪽 본문 2단이다 —
 * 가운데 한 열의 PageSkeleton 을 쓰면 회의록이 그려질 때 목록·본문이 크게 튄다. 목록과 본문 자리는 화면이 데이터를 기다릴 때
 * 쓰는 것(MinutesListSkeleton · MinutesDetailSkeleton)과 같은 컴포넌트라 코드가 온 뒤에도 모양이 바뀌지 않는다.
 */
export function MinutesPageSkeleton() {
  return (
    <main aria-busy="true" className={SCREEN}>
      <div data-testid="minutes-skeleton-aside" className={ASIDE}>
        <div className={ASIDE_HEAD}>
          {/* 목록 제목은 정해진 글자다 — MeetingMinutes 의 ASIDE_TITLE 과 같은 글자 */}
          <p aria-hidden="true" className={`${ASIDE_TITLE} font-bold tracking-h2 text-ink`}>
            회의록
          </p>
        </div>
        <MinutesListSkeleton />
      </div>
      <div className={SECTION}>
        <MinutesDetailSkeleton />
      </div>
    </main>
  )
}
