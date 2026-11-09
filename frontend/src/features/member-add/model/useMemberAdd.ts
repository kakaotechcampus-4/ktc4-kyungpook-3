import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createMember, memberListQueryOptions, upsertMember } from '@/entities/member'
import type { Member } from '@/entities/member'
import { errorMessage } from '@/shared/api/errorMessages'
import {
  ApiError,
  CLIENT_ERROR_CODES,
  createClientError,
  isCanceledError,
  isInvalidResponse,
} from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed } from '@/shared/ui/toast'
import { checkNewMemberName } from './memberAdd'

const DUPLICATE = '이미 같은 이름의 팀원이 있어요.'

/** 다시 받은 팀원 목록에 같은 이름이 있었다. 보내지 않았다 */
class DuplicateMemberNameError extends Error {
  constructor() {
    super('member name duplicated')
    this.name = 'DuplicateMemberNameError'
  }
}

interface AddVariables {
  displayName: string
  /** 누른 세션. 끝났으면 보내지 않고, 보낸 요청은 취소하며, 화면·캐시에 아무것도 남기지 않는다 */
  session: SessionScope
}

export interface MemberAdd {
  /** 팀원 목록을 받았다. 받기 전에는 같은 이름을 확인할 수 없어 추가를 막는다 */
  ready: boolean
  /** 받은 팀원 목록. 받기 전에는 비어 있다 */
  members: Member[]
  adding: boolean
  /** 입력 칸 아래 오류 문구 */
  feedback: string | null
  clearFeedback: () => void
  /** 비었으면 아무것도 하지 않고, 같은 이름이 있으면 보내지 않고 문구만 남긴다. 성공했을 때만 `onAdded` 를 부른다 */
  add: (text: string, onAdded: () => void) => void
}

/** 요청은 나갔는데 서버가 반영했는지 모른다. 4xx 는 서버가 거절한 것이라 반영된 게 없다 */
function mayHaveBeenApplied(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === 'network' || error.status >= 500)
}

/**
 * Discord 없이 이름만으로 팀원을 추가한다 (#613). 같은 이름은 두 번 추가하지 못한다 — 비교는 `memberNameKey` 다.
 * - 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 라 mutation key 로 묻는다
 * - 응답을 잃은 실패 뒤에는 캐시를 믿을 수 없다. 보내기 전에 목록을 다시 받아 같은 이름을 다시 본다
 * - 세션이 끝났으면 보내지 않고, 늦은 응답은 캐시·문구에 남기지 않는다
 */
export function useMemberAdd(workspaceId: string): MemberAdd {
  const queryClient = useQueryClient()
  const list = useQuery(memberListQueryOptions(workspaceId))
  const [feedback, setFeedback] = useState<string | null>(null)
  const { queryKey } = memberListQueryOptions(workspaceId)
  const mutationKey = ['member-add', workspaceId] as const
  const refreshMembers = () => queryClient.invalidateQueries({ queryKey })

  const create = useMutation<Member, Error, AddVariables>({
    mutationKey,
    retry: false,
    mutationFn: async ({ displayName, session }) => {
      // 앞선 일을 기다리는 사이 세션이 끝났을 수 있다. 그대로 보내면 다음에 로그인한 계정의 쿠키로 만든다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      if (queryClient.getQueryState(queryKey)?.isInvalidated) {
        const members = await queryClient.fetchQuery({
          ...memberListQueryOptions(workspaceId),
          staleTime: 0,
        })
        if (checkNewMemberName(displayName, members).kind === 'duplicate')
          throw new DuplicateMemberNameError()
      }
      return createMember({ workspaceId, displayName }, session.signal)
    },
    onSuccess: (member, { session }) => {
      if (!session.isCurrent()) return
      // 목록을 다시 받기 전에 같은 이름을 또 보내지 않게 만든 팀원을 바로 넣는다
      queryClient.setQueryData<Member[]>(queryKey, (members) => upsertMember(members, member))
      void refreshMembers()
    },
    onError: (error, { session }) => {
      if (!session.isCurrent() || isCanceledError(error)) return
      if (error instanceof DuplicateMemberNameError) {
        setFeedback(DUPLICATE)
        return
      }
      if (isInvalidResponse(error)) {
        void refreshMembers()
        showWriteUnconfirmed(() => void refreshMembers())
        return
      }
      if (mayHaveBeenApplied(error)) void refreshMembers()
      setFeedback(errorMessage(error))
    },
  })

  return {
    ready: list.data !== undefined,
    members: list.data ?? [],
    adding: create.isPending,
    feedback,
    clearFeedback: () => setFeedback(null),
    add: (text, onAdded) => {
      if (queryClient.isMutating({ mutationKey }) > 0) return
      const members = queryClient.getQueryData<Member[]>(queryKey)
      if (members === undefined) return
      const checked = checkNewMemberName(text, members)
      if (checked.kind === 'empty') return
      if (checked.kind === 'duplicate') {
        setFeedback(DUPLICATE)
        return
      }
      setFeedback(null)
      const session = captureSessionScope()
      create.mutate(
        { displayName: checked.displayName, session },
        {
          onSuccess: () => {
            if (session.isCurrent()) onAdded()
          },
        },
      )
    },
  }
}
