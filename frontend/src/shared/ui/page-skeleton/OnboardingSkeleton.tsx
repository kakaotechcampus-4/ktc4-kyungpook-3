import { Skeleton } from '../skeleton'

/* widgets/onboarding 의 OnboardingLayout · OnboardingCard 와 같은 치수다 — 가운데 512px 열, 34px 간격.
   shared 는 widgets 를 가져올 수 없어 값을 옮겨 적었다. 틀이 바뀌면 여기도 맞춘다 */
const SCREEN = 'relative flex min-h-dvh items-center justify-center bg-surface px-48 py-64'

const COLUMN = 'flex w-[512px] max-w-full flex-col gap-34'

const DOTS = 'flex items-center justify-center gap-7'

const BUBBLE_ROW = 'flex items-start gap-12'

const CARD = 'flex flex-col gap-8 rounded-10 border border-line px-22 pt-22 pb-18'

/**
 * 온보딩 화면이 오는 동안의 자리 (D-129). 단계 점 · 매스 말풍선 두 줄 · 단계 카드 · `n / 4` 줄이
 * 실제 화면과 같은 자리에 앉는다 — PageSkeleton(제품 화면 왼쪽 위) 을 쓰면 그려질 때 내용이 튄다.
 */
export function OnboardingSkeleton() {
  return (
    <main aria-busy="true" className={SCREEN}>
      <div className={COLUMN}>
        <div className={DOTS}>
          {Array.from({ length: 4 }, (_dot, index) => (
            <Skeleton key={index} variant="circle" width={6} height={6} />
          ))}
        </div>
        <div className="flex flex-col gap-20">
          {[0, 1].map((row) => (
            <div key={row} className={BUBBLE_ROW}>
              <Skeleton variant="circle" width={38} height={38} className="shrink-0" />
              <Skeleton variant="block" height={48} className="rounded-10" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-28">
          <div className={CARD}>
            <Skeleton width={120} height={16} />
            <Skeleton lines={2} />
            <div className="flex justify-end pt-8">
              <Skeleton variant="block" width={96} height={40} className="rounded-8" />
            </div>
          </div>
          <Skeleton width={128} height={36} />
        </div>
      </div>
    </main>
  )
}
