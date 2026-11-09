import type { QueryClient } from '@tanstack/react-query'
import { showWriteUnconfirmed } from '@/shared/ui/toast'
import { taskKeys } from '../api/taskApi'

/** 태스크 쓰기 응답을 읽지 못했다고 알린다. `새로고침` 은 이 공간의 태스크 목록·상세·이력을 다시 받는다 */
export function showTaskWriteUnconfirmed(queryClient: QueryClient, workspaceId: string): void {
  showWriteUnconfirmed(
    () => void queryClient.invalidateQueries({ queryKey: taskKeys(workspaceId) }),
  )
}
