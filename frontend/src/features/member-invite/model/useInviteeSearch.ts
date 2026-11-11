import { useCallback, useEffect, useRef, useState } from 'react'
import { searchInvitee } from '@/entities/invitation'
import type { Invitee } from '@/entities/invitation'
import { isUsernameAllowed, normalizeUsername } from '@/entities/user'
import { CLIENT_ERROR_CODES, createClientError, isCanceledError } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'

/**
 * 초대할 가입자 찾기. `username` 은 정규화한 값이다. `none` 은 그 아이디의 가입자가 없거나 이미 이 공간 팀원이다.
 * `invalid` 는 아이디 규칙 밖이라 요청하지 않았다
 */
export type InviteeSearch =
  | { status: 'idle' }
  | { status: 'searching'; username: string }
  | { status: 'found'; username: string; invitee: Invitee }
  | { status: 'none'; username: string }
  | { status: 'invalid'; username: string }
  | { status: 'failed'; username: string; error: unknown }

const IDLE: InviteeSearch = { status: 'idle' }

export interface InviteeSearchControl {
  /** 지금 입력에 대한 결과. 입력이 바뀌면 `idle` 이다 */
  search: InviteeSearch
  /** 지금 입력으로 찾는다 */
  run: () => void
  /** 찾은 그 사람이 초대 사이에 없어졌다(404 `USER_NOT_FOUND`). 결과를 버려 다시 찾게 한다 */
  forget: (userId: string) => void
}

/**
 * 아이디로 초대할 가입자를 찾는다. 찾은 뒤 입력을 바꾸면 결과를 버리고 찾던 요청은 끊는다 — 늦게 온 응답이 새 입력에 붙지 않는다.
 * 누를 때 세션 범위를 잡는다. 세션이 끝나면 요청이 함께 끊기고 늦은 응답은 버린다 (#594)
 */
export function useInviteeSearch(workspaceId: string, input: string): InviteeSearchControl {
  const [result, setResult] = useState<InviteeSearch>(IDLE)
  const pending = useRef<{ username: string; controller: AbortController } | null>(null)
  const username = normalizeUsername(input)
  // 같은 아이디로 되돌려도 지난 결과를 다시 쓰지 않는다. 그사이 탈퇴했을 수 있어 다시 찾게 한다 (#632).
  // 소문자로 바꿔야 같아지는 규칙 밖 글자(켈빈 기호 등)도 바꾼 입력이다 — 숨기기만 하면 되돌릴 때 다시 붙는다
  const stale =
    result.status !== 'idle' &&
    (result.username !== username || (result.status === 'found' && !isUsernameAllowed(input)))
  if (stale) setResult(IDLE)

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
    if (!isUsernameAllowed(input)) {
      setResult({ status: 'invalid', username })
      return
    }
    const session = captureSessionScope()
    const controller = new AbortController()
    pending.current = { username, controller }
    setResult({ status: 'searching', username })
    const find = async () => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return searchInvitee(
        workspaceId,
        username,
        AbortSignal.any([controller.signal, session.signal]),
      )
    }
    const settle = (next: InviteeSearch) => {
      if (pending.current?.controller !== controller || !session.isCurrent()) return
      pending.current = null
      setResult(next)
    }
    find().then(
      (invitee) =>
        settle(
          invitee === null ? { status: 'none', username } : { status: 'found', username, invitee },
        ),
      (error: unknown) => {
        if (!isCanceledError(error)) {
          settle({ status: 'failed', username, error })
          return
        }
        if (pending.current?.controller === controller) pending.current = null
        // 입력이 바뀌었거나 세션이 끝나 끊었다. 같은 값으로 되돌아와도 끝나지 않을 `searching` 이 남지 않게 지운다
        if (pending.current === null)
          setResult((last) =>
            last.status === 'searching' && last.username === username ? IDLE : last,
          )
      },
    )
  }, [input, username, workspaceId])

  const forget = useCallback((userId: string) => {
    setResult((last) => (last.status === 'found' && last.invitee.userId === userId ? IDLE : last))
  }, [])

  return { search: stale ? IDLE : result, run, forget }
}
