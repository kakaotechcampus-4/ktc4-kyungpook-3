import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { createWorkspace, upsertWorkspaceInList, workspaceEntryPath } from '@/entities/workspace'
import type { Workspace } from '@/entities/workspace'
import { saveOnboardingProgress } from './progress'

export interface CreateWorkspaceFlow {
  /**
   * 공간을 만들고 생성 단계 완료를 저장한 뒤 이어 갈 경로를 돌려준다.
   * 생성은 성공했는데 단계 저장이 실패하면 던진다. 다시 부르면 **만든 공간을 그대로 쓰고** 단계 저장만 다시 한다.
   */
  create: (name: string) => Promise<string>
  /** 이미 만들어 둔 공간. 있으면 이름 입력을 잠근다 */
  created: Workspace | null
}

/**
 * 온보딩 1단계 (D-014). 생성 직후 목록 캐시에 새 공간을 넣는다 — 소속 가드가 그 공간을 알아야 한다.
 * 생성 응답이 곧 생성자 PM 멤버십이다 (백엔드가 PM Member 를 함께 만든다).
 */
export function useCreateWorkspace(): CreateWorkspaceFlow {
  const queryClient = useQueryClient()
  // 재시도 판단은 ref 로 한다 — 렌더를 기다리지 않는다. 화면에 보일 값은 state 다
  const createdRef = useRef<Workspace | null>(null)
  const [created, setCreated] = useState<Workspace | null>(null)

  const create = useCallback(
    async (name: string) => {
      let workspace = createdRef.current
      if (workspace === null) {
        workspace = await createWorkspace({ name })
        createdRef.current = workspace
        setCreated(workspace)
        upsertWorkspaceInList(queryClient, workspace)
      }
      const saved = await saveOnboardingProgress(queryClient, workspace.id, {
        step: 'create_workspace',
        action: 'complete',
      })
      return workspaceEntryPath(saved)
    },
    [queryClient],
  )

  return { create, created }
}
