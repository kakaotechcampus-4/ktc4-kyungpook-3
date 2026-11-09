import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import {
  WORKSPACE_LIST_QUERY_KEY,
  createWorkspace,
  fetchFreshWorkspaces,
  upsertWorkspaceInList,
  workspaceEntryPath,
} from '@/entities/workspace'
import type { Workspace } from '@/entities/workspace'
import { isInvalidResponse } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import { findCreatedWorkspace } from './createdWorkspace'
import { saveOnboardingProgress } from './progress'

/** 만들기 한 번의 끝. 그 밖의 실패(이름 겹침·네트워크·단계 저장)는 던진다 */
export type CreateWorkspaceOutcome =
  /** 공간을 확인했고 생성 단계도 저장했다. 이어 갈 경로다 */
  | { kind: 'entered'; path: string }
  /** 만들기 응답을 읽지 못했고 다시 받은 목록에서도 그 공간을 하나로 정하지 못했다. 다시 만들면 공간이 둘 생길 수 있다 */
  | { kind: 'unconfirmed' }
  /** 누른 뒤 세션이 끝났다. 알림·이동을 하지 않는다 */
  | { kind: 'ended' }

export interface CreateWorkspaceFlow {
  /**
   * 공간을 만들고 생성 단계 완료를 저장한다. 생성은 성공했는데 단계 저장이 실패하면 던진다.
   * 다시 부르면 **만든 공간을 그대로 쓰고** 단계 저장만 다시 한다. 만들기는 다시 보내지 않는다
   */
  create: (name: string) => Promise<CreateWorkspaceOutcome>
  /** 이미 만들어 둔 공간. 있으면 이름 입력을 잠근다 */
  created: Workspace | null
}

/**
 * 온보딩 1단계 (D-014). 생성 직후 목록 캐시에 새 공간을 넣는다 — 소속 가드가 그 공간을 알아야 한다.
 * 생성 응답이 곧 생성자 PM 멤버십이다 (백엔드가 PM Member 를 함께 만든다).
 * 만들기 응답을 읽지 못하면(`INVALID_RESPONSE`) 공간이 생겼을 수 있다. 목록을 다시 받아 보내기 전에 없던 그 공간을 찾으면
 * 그 공간으로 이어 간다 (D-184 의 복구 경로). 누를 때의 세션이 끝났으면 요청을 끊고 뒷처리를 하지 않는다 (#594)
 */
export function useCreateWorkspace(): CreateWorkspaceFlow {
  const queryClient = useQueryClient()
  // 재시도 판단은 ref 로 한다 — 렌더를 기다리지 않는다. 화면에 보일 값은 state 다
  const createdRef = useRef<Workspace | null>(null)
  const [created, setCreated] = useState<Workspace | null>(null)

  const create = useCallback(
    async (name: string): Promise<CreateWorkspaceOutcome> => {
      const session = captureSessionScope()
      try {
        let workspace = createdRef.current
        if (workspace === null) {
          const listed = queryClient.getQueryData<Workspace[]>(WORKSPACE_LIST_QUERY_KEY)
          const knownBefore = listed === undefined ? null : new Set(listed.map(({ id }) => id))
          try {
            workspace = await createWorkspace({ name }, session.signal)
          } catch (error) {
            if (!isInvalidResponse(error) || !session.isCurrent()) throw error
            const latest = await fetchFreshWorkspaces(queryClient).catch(() => null)
            workspace = latest === null ? null : findCreatedWorkspace(latest, name, knownBefore)
          }
          if (!session.isCurrent()) return { kind: 'ended' }
          if (workspace === null) return { kind: 'unconfirmed' }
          upsertWorkspaceInList(queryClient, workspace)
          createdRef.current = workspace
          setCreated(workspace)
        }
        const saved = await saveOnboardingProgress(queryClient, workspace.id, {
          step: 'create_workspace',
          action: 'complete',
        })
        if (!session.isCurrent()) return { kind: 'ended' }
        return { kind: 'entered', path: workspaceEntryPath(saved) }
      } catch (error) {
        if (!session.isCurrent()) return { kind: 'ended' }
        throw error
      }
    },
    [queryClient],
  )

  return { create, created }
}
