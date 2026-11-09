import { useEffect, useState } from 'react'
import { Button } from '@/shared/ui/button'
import type { ButtonVariant } from '@/shared/ui/button'
import { resendSecondsLeft } from '../model/passwordReset'

interface ResendButtonProps {
  /** 다시 보낼 수 있는 시각(ms) */
  resendAt: number
  pending: boolean
  onResend: () => void
  variant?: ButtonVariant
}

/**
 * 다시 보낼 수 있을 때까지 막고 남은 초를 보인다. 보낼 때마다 key 로 새로 그려 시계가 다시 시작한다.
 * 시계는 `Date.now()` 다 — 브라우저 MSW 는 `now()`(shared/lib/date)를 멈춰 두어 그 시계로는 줄지 않는다.
 */
export function ResendButton({
  resendAt,
  pending,
  onResend,
  variant = 'primary',
}: ResendButtonProps) {
  const [at, setAt] = useState(() => Date.now())
  const secondsLeft = resendSecondsLeft(resendAt, at)
  const counting = secondsLeft > 0

  useEffect(() => {
    if (!counting) return
    const timer = window.setInterval(() => setAt(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [counting])

  return (
    <Button variant={variant} size="auth" disabled={counting} loading={pending} onClick={onResend}>
      {counting ? `다시 보내기 (${secondsLeft}초)` : '다시 보내기'}
    </Button>
  )
}
