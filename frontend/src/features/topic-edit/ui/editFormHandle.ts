import { useImperativeHandle, useRef } from 'react'
import type { FocusEvent, Ref, RefObject } from 'react'

/** 패널이 열린 고치기 폼에 묻는 것. 다른 고치기로 옮기기 전에 초안이 있는지 보고, 남기기로 하면 쓰던 칸으로 돌아간다 */
export interface EditFormHandle {
  dirty: boolean
  /** 마지막으로 쓰던 칸, 아직 없으면 첫 칸으로 포커스를 옮긴다 */
  focus: () => void
}

/** 폼의 onFocus 에 다는 처리를 돌려준다. 확인 창을 연 단추가 아니라 쓰던 칸으로 돌아가려고 마지막 칸을 기억한다 */
export function useEditFormHandle(
  ref: Ref<EditFormHandle> | undefined,
  dirty: boolean,
  first: RefObject<HTMLElement | null>,
) {
  const last = useRef<HTMLElement | null>(null)
  useImperativeHandle(
    ref,
    () => ({ dirty, focus: () => (last.current ?? first.current)?.focus() }),
    [dirty, first],
  )
  return (event: FocusEvent<HTMLFormElement>) => {
    const { target } = event
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
      last.current = target
  }
}
