import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createMemberAlias,
  deleteMemberAlias,
  memberAliasesQueryOptions,
  memberListQueryOptions,
} from '@/entities/member'
import type { MemberAlias } from '@/entities/member'
import {
  ApiError,
  CLIENT_ERROR_CODES,
  ERROR_CODES,
  createClientError,
  isInvalidResponse,
} from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed, toast } from '@/shared/ui/toast'
import {
  aliasFailure,
  aliasInputFailure,
  aliasRemoved,
  normalizeAliasText,
} from '../lib/aliasMessages'

/** 추가한 결과 중 입력 칸 아래에 남길 것. 이미 있던 별칭이면 서버가 그 행을 돌려줘 새로 생긴 것이 없다 */
export type AliasAddFeedback = { kind: 'failed'; message: string } | { kind: 'exists' }

interface AddVariables {
  aliasText: string
  /** 누른 때 이 팀원에게 있던 별칭 id. 돌려받은 id 가 여기 있으면 이미 있던 별칭이다 */
  known: ReadonlySet<string>
  /** 누른 세션. 끝났으면 보내지 않고, 보낸 요청은 취소하며, 화면·캐시·알림에 아무것도 남기지 않는다 */
  session: SessionScope
}

interface RemoveVariables {
  alias: MemberAlias
  session: SessionScope
}

export interface MemberAliasActions {
  /** 다듬은 글자로 보낸다. 비었으면 아무것도 하지 않고, 100자를 넘으면 보내지 않고 문구만 남긴다. 새로 생겼을 때만 `onAdded` 를 부른다 */
  add: (text: string, onAdded: () => void) => void
  adding: boolean
  addFeedback: AliasAddFeedback | null
  /** 새로 입력하면 지난 결과 문구는 지금 값의 것이 아니다 */
  clearAddFeedback: () => void
  /** 성공·실패를 알림으로 알린다 */
  remove: (alias: MemberAlias) => void
  /** 지우는 중이다. 끝날 때까지 이 팀원의 다른 지우기도 잠긴다 */
  removing: boolean
}

/**
 * 팀원 한 명의 별칭 추가·삭제 (#523). PM 만 쓴다. 고치는 API 가 없어 잘못 배운 별칭은 지우고 다시 넣는다.
 * - 끝나면(성공·실패) 공간의 별칭 목록을 다시 받는다. 성공은 목록을 받은 뒤에 끝난 것으로 본다 — 입력을 비우는 때와 칩이 생기는 때가 같다
 * - 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 라 mutation key 로 묻는다
 * - 세션이 끝났으면 보내지 않고, 늦은 응답은 캐시·알림·문구에 남기지 않는다
 */
export function useMemberAliasActions(workspaceId: string, memberId: string): MemberAliasActions {
  const queryClient = useQueryClient()
  const [addFeedback, setAddFeedback] = useState<AliasAddFeedback | null>(null)
  const aliasesKey = memberAliasesQueryOptions(workspaceId).queryKey
  const addKey = ['member-alias', workspaceId, memberId, 'add'] as const
  const removeKey = ['member-alias', workspaceId, memberId, 'remove'] as const
  const refreshAliases = () => queryClient.invalidateQueries({ queryKey: aliasesKey })

  const create = useMutation<MemberAlias, Error, AddVariables>({
    mutationKey: addKey,
    retry: false,
    mutationFn: async ({ aliasText, session }) => {
      // 앞선 일을 기다리는 사이 세션이 끝났을 수 있다. 그대로 보내면 다음에 로그인한 계정의 쿠키로 저장된다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return createMemberAlias(memberId, aliasText, session.signal)
    },
    onSuccess: async (alias, { known, session }) => {
      if (!session.isCurrent()) return
      await refreshAliases()
      if (session.isCurrent() && known.has(alias.id)) setAddFeedback({ kind: 'exists' })
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      void refreshAliases()
      // 응답을 읽지 못했다. 더해졌을 수 있어 실패로 보이지 않는다 (D-184)
      if (isInvalidResponse(error)) {
        showWriteUnconfirmed(() => void refreshAliases())
        return
      }
      if (error instanceof ApiError && error.code === ERROR_CODES.MEMBER_NOT_FOUND)
        void queryClient.invalidateQueries({
          queryKey: memberListQueryOptions(workspaceId).queryKey,
        })
      const message = aliasFailure(error)
      if (message !== null) setAddFeedback({ kind: 'failed', message })
    },
  })

  const removal = useMutation<void, Error, RemoveVariables>({
    mutationKey: removeKey,
    retry: false,
    mutationFn: async ({ alias, session }) => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      await deleteMemberAlias(alias.id, session.signal)
    },
    onSuccess: async (_, { alias, session }) => {
      if (!session.isCurrent()) return
      await refreshAliases()
      if (session.isCurrent()) toast.show({ title: aliasRemoved(alias.text) })
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      void refreshAliases()
      const message = aliasFailure(error)
      if (message !== null) toast.show({ title: message })
    },
  })

  return {
    add: (text, onAdded) => {
      if (queryClient.isMutating({ mutationKey: addKey }) > 0) return
      const aliasText = normalizeAliasText(text)
      if (aliasText === '') return
      const invalid = aliasInputFailure(aliasText)
      if (invalid !== null) {
        setAddFeedback({ kind: 'failed', message: invalid })
        return
      }
      setAddFeedback(null)
      const known = new Set(
        (queryClient.getQueryData(aliasesKey) ?? [])
          .filter((alias) => alias.memberId === memberId)
          .map(({ id }) => id),
      )
      const session = captureSessionScope()
      create.mutate(
        { aliasText, known, session },
        {
          onSuccess: (alias) => {
            if (session.isCurrent() && !known.has(alias.id)) onAdded()
          },
        },
      )
    },
    adding: create.isPending,
    addFeedback,
    clearAddFeedback: () => setAddFeedback(null),
    remove: (alias) => {
      if (queryClient.isMutating({ mutationKey: removeKey }) > 0) return
      removal.mutate({ alias, session: captureSessionScope() })
    },
    removing: removal.isPending,
  }
}
