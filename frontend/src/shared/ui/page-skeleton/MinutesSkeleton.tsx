import type { ReactNode } from 'react'
import { Skeleton } from '../skeleton'

/* widgets/meeting-minutes 의 MeetingMinutes · MinutesDetail · MinutesTabs 와 같은 치수다 (Meetings 캔버스 실측).
   shared 는 widgets 를 가져올 수 없어 값을 옮겨 적었다. 틀이 바뀌면 여기도 맞춘다 — e2e/meeting-skeleton.e2e.ts 가 위치를 잰다 */
const SCREEN = 'flex flex-1 items-stretch'
const ASIDE = 'flex w-aside shrink-0 flex-col border-r border-divider'
/* 머리 줄은 PM 의 `회의 올리기`(32px) 높이로 고정돼 있다 — 역할과 상관없이 목록이 같은 자리에서 시작한다 */
const ASIDE_HEAD = 'flex min-h-64 items-center justify-between gap-12 px-20 pt-18 pb-14'
const ASIDE_TITLE = 'flex h-lh items-center text-[17px] leading-[1.55]'
const LIST = 'flex flex-col gap-4 px-12'
const ROW = 'flex flex-col gap-6 px-14 py-13'
const SECTION = 'flex min-w-[0px] flex-1 flex-col'
const HEAD = 'flex flex-col gap-7 px-36 pt-44 pb-18'
const TITLE = 'flex h-lh items-center text-[26px] leading-[1.3]'
const CHIP_ROW = 'flex h-22 items-center gap-12'
const TAB_LIST = 'flex items-center gap-18 border-b border-line px-36'
const TAB = 'flex h-[38px] items-center px-3'
const PANEL = 'flex flex-col gap-30 px-36 pt-28 pb-56'

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
 * 컨테이너가 aria-busy 를 진다 (M2 Skeleton 약속).
 */
export function MinutesListSkeleton() {
  return (
    <div aria-busy="true" data-testid="minutes-list-skeleton" className={LIST}>
      {[72, 56, 64].map((width) => (
        <div key={width} className={ROW}>
          <TextLine typography="text-body" width={`${width}%`} />
          <TextLine typography="text-meta" width={112} />
        </div>
      ))}
    </div>
  )
}

/**
 * 고른 회의의 회의록이 오는 동안의 자리 — 실제 본문과 같은 배치다.
 * 제목(26px) · 메타와 출처 칩 · 참석자 칩 · 탭 줄(38px, 아래 선) · 본문. 머리와 탭 줄의 높이가 같아 그려질 때 탭이 움직이지 않는다.
 * `head` 를 주면 머리 뼈대 대신 그것을 그린다 — 목록 요약으로 이미 아는 제목·메타를 먼저 보여 줄 때다 (UX1-M02).
 * 같은 머리 치수로 그려야 탭 줄이 제자리다.
 */
export function MinutesDetailSkeleton({ head }: { head?: ReactNode }) {
  return (
    <div aria-busy="true" data-testid="minutes-detail-skeleton" className="flex flex-col">
      {head ?? <MinutesHeadSkeleton />}
      <div data-testid="minutes-detail-skeleton-tabs" className={TAB_LIST}>
        {[28, 40, 64].map((width) => (
          <div key={width} className={TAB}>
            <Skeleton width={width} />
          </div>
        ))}
      </div>
      <div className={PANEL}>
        <div className="flex flex-col gap-14">
          <TextLine typography="text-[14px] leading-[1.55]" width={72} />
          <Skeleton lines={4} />
        </div>
        <div className="flex flex-col gap-14">
          <TextLine typography="text-[14px] leading-[1.55]" width={96} />
          <Skeleton lines={3} />
        </div>
      </div>
    </div>
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
          <div className={ASIDE_TITLE}>
            <Skeleton variant="block" width={56} height={18} className="rounded-6" />
          </div>
        </div>
        <MinutesListSkeleton />
      </div>
      <div className={SECTION}>
        <MinutesDetailSkeleton />
      </div>
    </main>
  )
}
