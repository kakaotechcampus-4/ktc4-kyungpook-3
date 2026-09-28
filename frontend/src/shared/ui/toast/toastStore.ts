import { create } from 'zustand'
import type { ToastActionSpec } from './Toast'

/** 동시에 보이는 토스트 수. 넘치면 오래된 것부터 뺀다 */
export const MAX_VISIBLE_TOASTS = 3

export interface ToastInput {
  /** 같은 key 는 하나로 합친다. 없으면 제목이 key 다 */
  key?: string
  title: string
  description?: string
  action?: ToastActionSpec
}

export interface ToastItem {
  /** 합칠 때마다 새로 받는다 — 표시 시간이 처음부터 다시 흐른다 */
  id: number
  key: string
  title: string
  description?: string
  action?: ToastActionSpec
}

interface ToastState {
  items: ToastItem[]
  show: (input: ToastInput) => void
  remove: (id: number) => void
  clear: () => void
}

let nextId = 0

/* 전역 토스트는 클라이언트 UI 상태다 (D-110). 서버 데이터를 담지 않는다. */
export const useToastStore = create<ToastState>()((set) => ({
  items: [],
  show: (input) =>
    set((state) => {
      const key = input.key ?? input.title
      nextId += 1
      const item: ToastItem = {
        id: nextId,
        key,
        title: input.title,
        description: input.description,
        action: input.action,
      }
      const others = state.items.filter((existing) => existing.key !== key)
      return { items: [...others, item].slice(-MAX_VISIBLE_TOASTS) }
    }),
  remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clear: () => set({ items: [] }),
}))

/** 화면은 이것만 부른다. 표시 시간은 `Toast` 기본값이다 — 5초, 액션이 있으면 10초 */
export const toast = {
  show: (input: ToastInput) => useToastStore.getState().show(input),
  clear: () => useToastStore.getState().clear(),
}
