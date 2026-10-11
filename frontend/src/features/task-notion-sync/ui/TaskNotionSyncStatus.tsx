import { useId } from 'react'
import { errorMessage } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { ErrorText } from '@/shared/ui/error-text'
import { notionSyncLabel } from '../lib/notionSyncLabel'
import { useTaskNotionSync } from '../model/useTaskNotionSync'

const ROOT = 'flex flex-col gap-6'
const ROW = 'flex flex-wrap items-center gap-12'
const NOTE = 'text-meta text-dim'

export interface TaskNotionSyncStatusProps {
  workspaceId: string
  taskId: string
  /** 반영 실패를 다시 요청할 수 있는가. PM 에게만 있다 */
  canRetry: boolean
}

/**
 * 태스크의 Notion 반영 상태와 PM 의 재시도 (계획 §4-7, §4-8). 문구는 서버 상태만 따른다.
 * 이 컴포넌트가 화면에 있는 동안만 반영 중 polling 이 돈다
 */
export function TaskNotionSyncStatus({ workspaceId, taskId, canRetry }: TaskNotionSyncStatusProps) {
  const errorId = useId()
  const sync = useTaskNotionSync(workspaceId, taskId)
  if (sync.task === undefined) return <span className={NOTE}>확인하는 중이에요</span>
  const status = sync.task.notionSyncStatus

  return (
    <div className={ROOT}>
      <div className={ROW}>
        <span aria-live="polite" data-testid="notion-sync-status">
          {notionSyncLabel(status)}
        </span>
        {status === 'failed' && canRetry ? (
          <Button
            size="sm"
            variant="outline"
            loading={sync.retryPending}
            aria-describedby={sync.retryError === null ? undefined : errorId}
            onClick={sync.retry}
          >
            다시 반영하기
          </Button>
        ) : null}
      </div>
      {sync.retried !== undefined && status === 'pending' ? (
        <p className={NOTE}>다시 반영을 요청했어요. 반영되면 여기에서 바뀌어요.</p>
      ) : null}
      {sync.retryError !== null && status === 'failed' ? (
        <ErrorText id={errorId}>{errorMessage(sync.retryError)}</ErrorText>
      ) : null}
    </div>
  )
}
