import { useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { QuickGuidePanel } from './QuickGuidePanel'

export type QuickGuideButtonProps = Omit<ComponentProps<'button'>, 'type' | 'onClick' | 'ref'>

/**
 * 안내 패널을 여는 단추. 저절로 열지 않는다. 모양과 이름(글자나 aria-label)은 놓이는 자리가 준다 —
 * 헤더의 `?` · 빈 화면의 `방법 보기` · 온보딩의 `어떻게 쓰나요?`
 */
export function QuickGuideButton(props: QuickGuideButtonProps) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        {...props}
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          // Safari 는 눌러도 단추에 포커스를 주지 않는다. 모달이 열 때 포커스를 연 요소로 기억하므로 먼저 준다
          event.currentTarget.focus()
          setOpen(true)
        }}
      />
      <QuickGuidePanel open={open} onOpenChange={setOpen} returnFocus={() => button.current} />
    </>
  )
}
