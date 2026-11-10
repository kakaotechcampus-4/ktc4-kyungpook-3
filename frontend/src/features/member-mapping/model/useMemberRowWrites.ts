import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import {
  createMember,
  fetchMembers,
  memberAliasesQueryOptions,
  memberListQueryOptions,
  updateMember,
  upsertMember,
} from '@/entities/member'
import type { Member } from '@/entities/member'
import { messageSettingsQueryOptions } from '@/entities/message-settings'
import { errorMessage } from '@/shared/api/errorMessages'
import {
  ApiError,
  CLIENT_ERROR_CODES,
  ERROR_CODES,
  createClientError,
  isCanceledError,
  isInvalidResponse,
} from '@/shared/api/errors'
import { fetchFresh } from '@/shared/api/fetchFresh'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed } from '@/shared/ui/toast'
import { checkWrite, writeTarget } from './memberRows'
import type { RowWrite } from './memberRows'

/** 옮기려던 계정의 주인이 확인받은 앞 팀원이 아니다. 그 사이 다른 곳에서 연결이 바뀌었다 */
const MOVE_STALE = '그사이 연결이 바뀌었어요. 새 목록에서 다시 골라 주세요.'

/** 다시 받은 팀원 목록으로 보니 보낼 수 없는 쓰기였다(같은 이름, 바뀐 계정 주인). 아무것도 보내지 않았다 */
class WriteRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WriteRejectedError'
  }
}

/** 옮기기에서 앞 팀원 연결은 풀었는데 새 팀원에 잇지 못했다 */
class MoveLinkError extends Error {
  readonly from: Member
  readonly cause: unknown

  constructor(from: Member, cause: unknown) {
    super('member move link failed')
    this.name = 'MoveLinkError'
    this.from = from
    this.cause = cause
  }
}

interface WriteVariables {
  write: RowWrite
  /** 누른 세션. 끝났으면 보내지 않고, 보낸 요청은 취소하며, 화면·캐시에 아무것도 남기지 않는다 */
  session: SessionScope
}

export interface RowWriteFailure {
  /** `writeTarget` — 문구를 둘 줄이나 항목 */
  target: string
  write: RowWrite
  message: string
  /** `다시 시도` 가 다시 돌 쓰기. 없으면 버튼을 두지 않는다 */
  retry: RowWrite | null
}

/** `started` 만 요청을 보낸다. `skipped` 는 보낼 것이 없었다(같은 이름), `blocked` 는 다른 쓰기가 진행 중이거나 거절했다 */
export type RunResult = 'started' | 'skipped' | 'blocked'

export interface MemberRowWrites {
  /** 진행 중인 쓰기. 그 줄 버튼만 loading 으로 보인다 */
  pending: RowWrite | null
  /** 쓰는 중이다. 모든 줄의 조작을 막는다 */
  busy: boolean
  failure: RowWriteFailure | null
  clearFailure: (target: string) => void
  /** 성공하면 `onSuccess` 에 서버가 돌려준 팀원을 넘긴다 */
  run: (write: RowWrite, onSuccess?: (member: Member) => void) => RunResult
}

const mutationKeyOf = (workspaceId: string) => ['member-rows', workspaceId] as const

/** 팀원 목록 쓰기가 진행 중이다. 창은 이동안 닫히지 않는다 — 닫히면 실패를 보일 곳이 없다 */
export function useMemberRowsBusy(workspaceId: string): boolean {
  return useIsMutating({ mutationKey: mutationKeyOf(workspaceId) }) > 0
}

/** 요청은 나갔는데 서버가 반영했는지 모른다. 4xx 는 서버가 거절한 것이라 반영된 게 없다. 모르는 실패는 반영됐을 수 있다고 본다 */
function mayHaveBeenApplied(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  return error.kind === 'network' || error.status >= 500
}

/** 다른 팀원이 그사이 그 계정을 가져갔다. 화면이 낡았다 */
function isStaleMapping(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR_CODES.DISCORD_USER_ALREADY_MAPPED
}

/**
 * 팀원 목록의 쓰기 실행기 (#647). 줄마다 바로 저장한다.
 * - 목록 전체에서 쓰기는 한 번에 하나다. 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 라
 *   mutation key 와 ref 로 묻는다. 빠른 연속 조작, 같은 계정을 두 줄에서 동시에 고르기가 모두 이것으로 막힌다
 * - 응답을 잃은 실패 뒤에는 캐시를 믿을 수 없다. 보내기 전에 목록을 다시 받아 이름 중복을 다시 본다
 * - 옮기기는 앞 팀원 연결을 푸는 파괴적인 요청이라 캐시가 멀쩡해 보여도 늘 목록을 다시 받는다. 다른 탭·PM 이 바꾼 것은
 *   캐시를 무효로 만들지 않는다. 계정 주인이 확인받은 앞 팀원일 때만 풀고, 아니면 아무것도 보내지 않고 다시 고르게 한다.
 *   다시 받기는 누른 뒤에 출발한 조회만 쓴다(`fetchFresh`) — 누르기 전에 날아간 조회는 그 전 주인을 읽었을 수 있다
 * - 옮기기는 앞 팀원 연결을 먼저 푼다. 같은 계정을 두 팀원에 붙일 수 없다(409 `DISCORD_USER_ALREADY_MAPPED`)
 * - 세션이 끝났으면 보내지 않고, 늦은 응답은 캐시·문구에 남기지 않는다 (#594)
 * - PM 의 Discord 연결이 알림 설정의 PM 연결 상태(`pms`)를 바꾸므로 알림 설정도 다시 받는다 (#340)
 * - 팀원을 다시 받는 곳에서는 별칭도 다시 받는다. 이름을 바꾸면 서버가 옛 이름 별칭을 지우고 새 이름 별칭을 만든다
 */
export function useMemberRowWrites(workspaceId: string): MemberRowWrites {
  const queryClient = useQueryClient()
  const { queryKey } = memberListQueryOptions(workspaceId)
  const mutationKey = mutationKeyOf(workspaceId)
  const lock = useRef(false)
  const [failure, setFailure] = useState<RowWriteFailure | null>(null)

  const refreshMembers = () => {
    void queryClient.invalidateQueries({ queryKey })
    void queryClient.invalidateQueries({
      queryKey: memberAliasesQueryOptions(workspaceId).queryKey,
    })
  }
  const refreshSettings = () =>
    queryClient.invalidateQueries({ queryKey: messageSettingsQueryOptions(workspaceId).queryKey })

  const mutation = useMutation<Member | null, Error, WriteVariables>({
    mutationKey,
    retry: false,
    mutationFn: async ({ write, session }) => {
      // 앞선 일을 기다리는 사이 세션이 끝났을 수 있다. 그대로 보내면 다음에 로그인한 계정의 쿠키로 쓴다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      let members = queryClient.getQueryData<Member[]>(queryKey) ?? []
      let checked = write
      if (write.kind === 'move' || queryClient.getQueryState(queryKey)?.isInvalidated) {
        members = await fetchFresh(queryClient, {
          queryKey,
          queryFn: ({ signal }) =>
            fetchMembers(workspaceId, AbortSignal.any([signal, session.signal])),
        })
        const recheck = checkWrite(write, members)
        if (recheck.kind === 'reject') throw new WriteRejectedError(recheck.message)
        // 잃은 응답이 이미 반영했다 — 보낼 것 없이 끝난다
        if (recheck.kind === 'skip')
          return write.kind === 'rename'
            ? (members.find(({ id }) => id === write.memberId) ?? null)
            : null
        checked = recheck.write
      }
      const save = (member: Member) => {
        if (session.isCurrent())
          queryClient.setQueryData<Member[]>(queryKey, (list) => upsertMember(list, member))
        return member
      }
      const { signal } = session
      switch (checked.kind) {
        case 'rename':
          return save(
            await updateMember(checked.memberId, { displayName: checked.displayName }, signal),
          )
        case 'link':
          return save(
            await updateMember(checked.memberId, { discordUserId: checked.discordUserId }, signal),
          )
        case 'unlink':
          return save(await updateMember(checked.memberId, { discordUserId: null }, signal))
        case 'create':
          return save(
            await createMember(
              {
                workspaceId,
                displayName: checked.displayName,
                ...(checked.discordUserId === null ? {} : { discordUserId: checked.discordUserId }),
              },
              signal,
            ),
          )
        case 'move': {
          const holder = members.find(
            ({ discordUserId }) => discordUserId === checked.discordUserId,
          )
          if (holder?.id === checked.memberId) return holder
          if (holder === undefined || holder.id !== checked.fromId)
            throw new WriteRejectedError(MOVE_STALE)
          save(await updateMember(holder.id, { discordUserId: null }, signal))
          try {
            return save(
              await updateMember(
                checked.memberId,
                { discordUserId: checked.discordUserId },
                signal,
              ),
            )
          } catch (error) {
            throw new MoveLinkError(holder, error)
          }
        }
      }
    },
    onSuccess: (_, { session }) => {
      if (!session.isCurrent()) return
      refreshMembers()
      void refreshSettings()
    },
    onError: (error, { write, session }) => {
      if (!session.isCurrent() || isCanceledError(error)) return
      const target = writeTarget(write)
      if (error instanceof WriteRejectedError) {
        setFailure({ target, write, message: error.message, retry: null })
        return
      }
      const moved = error instanceof MoveLinkError ? error : null
      const cause = moved?.cause ?? error
      if (moved !== null) void refreshSettings()
      if (isInvalidResponse(cause)) {
        refreshMembers()
        showWriteUnconfirmed(refreshMembers)
        return
      }
      if (moved !== null || mayHaveBeenApplied(cause) || isStaleMapping(cause)) refreshMembers()
      setFailure(
        moved !== null && write.kind === 'move'
          ? {
              target,
              write,
              message: `${moved.from.displayName} 님 연결은 풀었지만 이 팀원에 잇지 못했어요. ${errorMessage(cause)}`,
              retry: {
                kind: 'link',
                memberId: write.memberId,
                discordUserId: write.discordUserId,
              },
            }
          : { target, write, message: errorMessage(cause), retry: null },
      )
    },
    onSettled: () => {
      lock.current = false
    },
  })

  const run = (write: RowWrite, onSuccess?: (member: Member) => void): RunResult => {
    if (lock.current || queryClient.isMutating({ mutationKey }) > 0) return 'blocked'
    const checked = checkWrite(write, queryClient.getQueryData<Member[]>(queryKey) ?? [])
    if (checked.kind === 'skip') return 'skipped'
    if (checked.kind === 'reject') {
      setFailure({ target: writeTarget(write), write, message: checked.message, retry: null })
      return 'blocked'
    }
    setFailure(null)
    lock.current = true
    const session = captureSessionScope()
    mutation.mutate(
      { write: checked.write, session },
      {
        onSuccess: (member) => {
          if (member !== null && session.isCurrent()) onSuccess?.(member)
        },
      },
    )
    return 'started'
  }

  return {
    pending: mutation.isPending ? mutation.variables.write : null,
    busy: mutation.isPending,
    failure,
    clearFailure: (target) =>
      setFailure((current) => (current?.target === target ? null : current)),
    run,
  }
}
