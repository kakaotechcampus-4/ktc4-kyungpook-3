import { PINNED_STACK, setPinnedSlot } from './pinnedSlot'
import { Toast, ToastProvider, ToastViewport } from './Toast'
import { useToastStore } from './toastStore'

/* 오른쪽 아래 24px. 짧은 토스트 목록 아래에 고정 토스트(PinnedToast) 칸이 있다 — 다른 토스트는 그 위로 쌓인다.
   빈 칸은 숨겨 간격(gap)이 생기지 않게 한다. 고정 칸은 화면 높이의 절반을 넘으면 안에서 스크롤한다 —
   고정 토스트가 늘어도 위의 짧은 토스트와 카드 버튼이 화면 밖으로 밀리지 않는다.
   독과 칸은 누름을 통과시킨다 — 카드 사이 간격·빈 목록·알약 옆 빈 자리가 아래 화면의 버튼을 막지 않는다.
   누름은 토스트 면(Toast·고정 토스트가 직접 켠다)만 받는다 */
const DOCK = 'pointer-events-none fixed right-24 bottom-24 z-100 flex flex-col items-end gap-8'

/**
 * 앱에 하나 올리는 토스트 자리. store 의 항목을 `Toast` 로 그린다.
 * 닫히면(시간 만료·액션) store 에서 뺀다. `data-toast-key` 는 같은 key 가 하나뿐인지 확인하는 표식이다.
 */
export function GlobalToaster() {
  const items = useToastStore((state) => state.items)
  const remove = useToastStore((state) => state.remove)

  return (
    <ToastProvider label="알림">
      {items.map((item) => (
        <Toast
          key={item.id}
          data-toast-key={item.key}
          title={item.title}
          description={item.description}
          action={item.action}
          onOpenChange={(open) => {
            if (!open) remove(item.id)
          }}
        />
      ))}
      <div data-testid="toast-dock" className={DOCK}>
        <ToastViewport />
        <div data-testid="pinned-toast-slot" ref={setPinnedSlot} className={PINNED_STACK} />
      </div>
    </ToastProvider>
  )
}
