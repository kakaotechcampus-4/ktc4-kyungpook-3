import { Toast, ToastProvider, ToastViewport } from './Toast'
import { useToastStore } from './toastStore'

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
      <ToastViewport />
    </ToastProvider>
  )
}
