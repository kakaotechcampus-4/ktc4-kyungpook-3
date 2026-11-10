import { useCallback, useEffect, useRef, useState } from 'react'
import { isCanceledError } from '@/shared/api/errors'
import { fetchUsernameAvailability } from '../api/username'
import { isUsernameAllowed, normalizeUsername } from './username'
import type { UsernameCheck, UsernameUnavailableReason } from './username'

const IDLE: UsernameCheck = { status: 'idle' }

export interface UsernameCheckControl {
  /** 지금 입력에 대한 결과. 다른 값을 확인한 결과는 `idle` 로 보인다 */
  check: UsernameCheck
  /** 지금 입력을 확인했고 쓸 수 있다. 가입·저장 버튼이 이 값으로 켜진다 */
  confirmed: boolean
  /** 지금 입력을 확인한다 */
  run: () => void
  /** 가입·변경 응답이 이 아이디를 거절했다(409 `USERNAME_TAKEN`, 400 username). 칸 오류가 되고 버튼이 꺼진다 */
  reject: (username: string, reason: Exclude<UsernameUnavailableReason, 'current'>) => void
}

/**
 * 아이디 중복 확인. `current` 는 설정의 지금 내 아이디다. 같은 값이면 요청하지 않고 `current` 다.
 * 확인 뒤 입력을 바꾸면 결과가 지금 입력과 맞지 않아 저절로 `idle` 로 보이고, 확인 중이던 요청은 끊는다.
 */
export function useUsernameCheck(input: string, current?: string): UsernameCheckControl {
  const [result, setResult] = useState<UsernameCheck>(IDLE)
  const pending = useRef<{ username: string; controller: AbortController } | null>(null)
  const username = normalizeUsername(input)

  useEffect(() => {
    if (pending.current !== null && pending.current.username !== username) {
      pending.current.controller.abort()
      pending.current = null
    }
  }, [username])

  useEffect(() => () => pending.current?.controller.abort(), [])

  const run = useCallback(() => {
    pending.current?.controller.abort()
    pending.current = null
    if (current !== undefined && username === current) {
      setResult({ status: 'unavailable', username, reason: 'current' })
      return
    }
    if (!isUsernameAllowed(input)) {
      setResult({ status: 'unavailable', username, reason: 'invalid' })
      return
    }
    const controller = new AbortController()
    pending.current = { username, controller }
    setResult({ status: 'checking', username })
    fetchUsernameAvailability(username, controller.signal).then(
      (answer) => {
        if (pending.current?.controller !== controller) return
        pending.current = null
        setResult(
          answer.available
            ? { status: 'available', username }
            : { status: 'unavailable', username, reason: answer.reason },
        )
      },
      (error: unknown) => {
        if (isCanceledError(error)) {
          // 입력이 바뀌어 끊었다. 같은 값으로 되돌아와도 끝나지 않을 `checking` 이 남지 않게 지운다
          if (pending.current === null)
            setResult((last) =>
              last.status === 'checking' && last.username === username ? IDLE : last,
            )
          return
        }
        if (pending.current?.controller !== controller) return
        pending.current = null
        setResult({ status: 'failed', username, error })
      },
    )
  }, [current, input, username])

  const reject = useCallback<UsernameCheckControl['reject']>((rejected, reason) => {
    setResult({ status: 'unavailable', username: rejected, reason })
  }, [])

  // 저장해 지금 내 아이디가 된 값의 `available` 은 지난 확인이다. 다시 저장할 것이 없다
  const settled = result.status === 'available' && result.username === current
  // 정규화 값만 비교하면 소문자로 바꿔야 같아지는 규칙 밖 글자(켈빈 기호 등)가 앞 확인을 물려받는다
  const reusable =
    result.status !== 'idle' &&
    result.username === username &&
    (result.status !== 'available' || isUsernameAllowed(input))
  const check = reusable && !settled ? result : IDLE
  return { check, confirmed: check.status === 'available', run, reject }
}
