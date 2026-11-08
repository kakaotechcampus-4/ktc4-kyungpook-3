import { Icon } from '@/shared/ui/icon'
import { Skeleton } from '@/shared/ui/skeleton'
import { BACK, CARD, CARD_BODY, CARD_FOOT, EVIDENCE, ROOT } from './frame'

/**
 * 확인 요청을 기다리는 뼈대 (#508). 실제 화면과 같은 틀이다 — 제목(30px)·안내 줄, 카드(머리 줄 · 칸 셋 · 근거 · 아래 줄).
 * 제목은 요청마다 달라 막대다. 치수는 TITLE · LEAD · CARD · CARD_HEAD · CARD_BODY · EVIDENCE · CARD_FOOT 와 같다
 */
export function ApprovalSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-22">
      <div className="flex flex-col gap-8">
        <div className="flex h-lh items-center text-[30px] leading-[1.3]">
          <Skeleton variant="block" width={280} height={30} className="rounded-8" />
        </div>
        <div className="flex h-lh items-center text-[15px] leading-[1.6]">
          <Skeleton width="60%" />
        </div>
      </div>
      <div className={CARD}>
        <div className="flex h-[46px] items-center border-b border-divider px-20">
          <Skeleton width={160} />
        </div>
        <div className={CARD_BODY}>
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-12 max-md:grid-cols-1">
            {[0, 1, 2].map((field) => (
              <div key={field} className="flex flex-col gap-6">
                <Skeleton width={56} />
                <Skeleton variant="block" height={40} className="rounded-9" />
              </div>
            ))}
          </div>
          <div className={EVIDENCE}>
            <Skeleton width={120} />
            <Skeleton width="70%" />
          </div>
        </div>
        <div className={`${CARD_FOOT} h-[60px]`} />
      </div>
    </div>
  )
}

/**
 * 확인 요청의 라우트 뼈대 (#510). ApprovalReview 가 요청을 기다릴 때와 같다 — `태스크 목록` 돌아가기 줄과 요청 뼈대(#508).
 * 돌아가기 줄은 누를 수 없는 자리표시다. 기다림은 main 의 aria-busy 가 알린다
 */
export function ApprovalRouteSkeleton() {
  return (
    <main aria-busy="true" className={ROOT}>
      <span aria-hidden="true" className={BACK}>
        <Icon name="chevron-left" size={14} />
        태스크 목록
      </span>
      <div>
        <ApprovalSkeleton />
      </div>
    </main>
  )
}
