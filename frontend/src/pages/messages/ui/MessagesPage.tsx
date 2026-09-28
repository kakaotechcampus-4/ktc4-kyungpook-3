import { EmptyState } from '@/shared/ui/empty-state'

const SCREEN = 'flex min-h-dvh items-center justify-center px-24 py-48'

/** 준비 중 안내만 한다. 메시지 API 는 없고 부르지도 않는다 (D-171) */
export function MessagesPage() {
  return (
    <main className={SCREEN}>
      <EmptyState
        title="메시지는 준비 중이에요"
        description="메시지 화면은 정책이 정해지면 만들어요."
      />
    </main>
  )
}
