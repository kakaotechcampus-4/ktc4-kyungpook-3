import { Skeleton } from '@/shared/ui/skeleton'

/* 목록 행·대화 머리·말풍선과 같은 치수의 뼈대다. 컨테이너가 aria-busy 를 진다 (M2 Skeleton 약속) */

export function InboxListSkeleton() {
  return (
    <div aria-busy="true" data-testid="message-list-skeleton" className="flex flex-col gap-6">
      <div className="px-8 py-4">
        <Skeleton width={72} />
      </div>
      {[64, 48].map((width) => (
        <div key={width} className="flex flex-col gap-7 px-14 py-13">
          <div className="flex items-center gap-9">
            <Skeleton variant="circle" width={24} height={24} />
            <Skeleton width={56} />
          </div>
          <Skeleton width={`${width}%`} />
        </div>
      ))}
      <div className="px-8 pt-16 pb-4">
        <Skeleton width={32} />
      </div>
      {[56, 72, 48].map((width) => (
        <div key={width} className="flex items-center gap-10 px-12 py-9">
          <Skeleton variant="circle" width={30} height={30} />
          <div className="flex flex-1 flex-col gap-6">
            <Skeleton width={48} />
            <Skeleton width={`${width}%`} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ThreadSkeleton() {
  return (
    <div aria-busy="true" data-testid="message-thread-skeleton" className="flex flex-1 flex-col">
      <div className="flex h-header shrink-0 items-center gap-11 border-b border-divider px-28">
        <Skeleton variant="circle" width={34} height={34} />
        <div className="flex flex-col gap-6">
          <Skeleton width={56} />
          <Skeleton width={120} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-16 bg-surface-sunken px-28 pt-24">
        <Skeleton variant="block" width={320} height={48} className="self-end rounded-[15px]" />
        <Skeleton variant="block" width={280} height={48} className="ml-36 rounded-[15px]" />
        <Skeleton variant="block" width={360} height={48} className="self-end rounded-[15px]" />
      </div>
    </div>
  )
}

/** 보내기 전 확인 미리보기 자리 — 가운데 604 열의 제목·설명·카드 */
export function ReviewSkeleton() {
  return (
    <div
      aria-busy="true"
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
    </div>
  )
}
