import type { LoadingIndicator } from '@/shared/lib/loading-indicator'
import { DeferredSkeleton } from '@/shared/ui/deferred-skeleton'
import { Skeleton } from '@/shared/ui/skeleton'
import { GROUP_LABEL } from './listStyles'

/* 목록 행·대화 머리·말풍선과 같은 치수의 뼈대다. 컨테이너(DeferredSkeleton)가 aria-busy 를 지고, 지연 구간에는 빈 자리다 (#508) */

interface SkeletonProps {
  indicator: Pick<LoadingIndicator, 'skeletonVisible'>
}

/**
 * 묶음 이름은 정해진 글자라 막대 대신 글자로 그린다. 개수는 받아야 알아 빠진다. 팀원에게는 보내기 전 확인이 없다.
 * 글자는 자리표시라 스크린리더에서 뺀다 — 기다림은 컨테이너의 aria-busy 가 알린다
 */
export function InboxListSkeleton({ indicator, pm }: SkeletonProps & { pm: boolean }) {
  return (
    <DeferredSkeleton
      indicator={indicator}
      data-testid="message-list-skeleton"
      className="flex flex-col gap-6"
    >
      {pm ? (
        <>
          <p aria-hidden="true" className={`${GROUP_LABEL} px-8`}>
            보내기 전 확인
          </p>
          {[64, 48].map((width) => (
            <div key={width} className="flex flex-col gap-7 px-14 py-13">
              <div className="flex items-center gap-9">
                <Skeleton variant="circle" width={24} height={24} />
                <Skeleton width={56} />
              </div>
              <Skeleton width={`${width}%`} />
            </div>
          ))}
        </>
      ) : null}
      <p aria-hidden="true" className={`${GROUP_LABEL} px-8 ${pm ? 'pt-12' : ''}`}>
        대화
      </p>
      {[56, 72, 48].map((width) => (
        <div key={width} className="flex items-center gap-10 px-12 py-9">
          <Skeleton variant="circle" width={30} height={30} />
          <div className="flex flex-1 flex-col gap-6">
            <Skeleton width={48} />
            <Skeleton width={`${width}%`} />
          </div>
        </div>
      ))}
    </DeferredSkeleton>
  )
}

export function ThreadSkeleton({ indicator }: SkeletonProps) {
  return (
    <DeferredSkeleton
      indicator={indicator}
      data-testid="message-thread-skeleton"
      className="flex flex-1 flex-col"
    >
      <div className="flex h-header shrink-0 items-center gap-11 border-b border-divider px-28 max-md:hidden">
        <Skeleton variant="circle" width={34} height={34} />
        <div className="flex flex-col gap-6">
          <Skeleton width={56} />
          <Skeleton width={120} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-16 bg-surface-sunken px-28 pt-24 max-md:px-16 *:max-w-full">
        <Skeleton variant="block" width={320} height={48} className="self-end rounded-[15px]" />
        <Skeleton variant="block" width={280} height={48} className="ml-36 rounded-[15px]" />
        <Skeleton variant="block" width={360} height={48} className="self-end rounded-[15px]" />
      </div>
    </DeferredSkeleton>
  )
}

/** 보내기 전 확인 미리보기 자리 — 가운데 604 열의 제목·설명·카드 */
export function ReviewSkeleton({ indicator }: SkeletonProps) {
  return (
    <DeferredSkeleton
      indicator={indicator}
      data-testid="message-review-skeleton"
      className="flex justify-center px-36 pt-44"
    >
      <div className="flex w-full max-w-[604px] flex-col gap-24">
        <div className="flex flex-col gap-12">
          <Skeleton variant="block" width="50%" height={28} className="rounded-8" />
          <Skeleton width="70%" />
        </div>
        <Skeleton variant="block" height={160} className="rounded-16" />
      </div>
    </DeferredSkeleton>
  )
}
