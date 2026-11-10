import { useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { useCompactScreen } from '@/shared/lib/compact-screen'
import { QuickGuidePanel } from './QuickGuidePanel'
import type { QuickGuideForm } from './QuickGuidePanel'

export type QuickGuideButtonProps = Omit<ComponentProps<'button'>, 'type' | 'onClick' | 'ref'>

/**
 * 안내 패널을 여는 단추. 저절로 열지 않는다. 모양과 이름(글자나 aria-label)은 놓이는 자리가 준다 —
 * 헤더의 `?` · 빈 화면의 `방법 보기` · 온보딩의 `어떻게 쓰나요?`
 */
export function QuickGuideButton(props: QuickGuideButtonProps) {
  const compact = useCompactScreen()
  const [open, setOpen] = useState(false)
  // 연 때의 폭으로 모양을 정하고 닫을 때까지 지킨다. 연 채 768px 을 넘나들며 모달·시트를 바꿔 끼우면
  // 새 대화상자가 연 단추를 모른 채 열려, 닫은 뒤 포커스가 body 로 빠졌다
  const [form, setForm] = useState<QuickGuideForm>('modal')
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
          setForm(compact ? 'sheet' : 'modal')
          setOpen(true)
        }}
      />
      <QuickGuidePanel
        open={open}
        onOpenChange={setOpen}
        form={form}
        returnFocus={() => button.current}
      />
    </>
  )
}
