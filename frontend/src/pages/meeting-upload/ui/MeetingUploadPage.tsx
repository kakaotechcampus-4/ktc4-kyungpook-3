import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { MeetingUploadForm, useUploadEntry } from '@/features/meeting-upload'
import { paths } from '@/shared/config/routes'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { useRouteId } from '@/shared/lib/url'
import { DeferredSkeleton } from '@/shared/ui/deferred-skeleton'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { COLUMN, LEAD, LEAD_TEXT, PAGE, TITLE, TITLE_TEXT } from './styles'
import { UploadSkeleton } from './UploadSkeleton'

/* 로딩을 거쳐 나타난 내용의 불투명도 전환 (#508). 로딩 중에도 보이던 제목 묶음(첫 자식)은 빼고 그 아래만 */
const REVEAL_BELOW_TITLE =
  'motion-safe:[&>:not(:first-child)]:animate-[loading-reveal_150ms_ease-out]'

/**
 * 회의 올리기 (PM 전용 — 가드는 라우터의 RequirePM). 들어올 때 정리 중 회의를 먼저 본다 (U3-1).
 * Notion 연결은 묻지 않는다 — 선택 기능이다 (D-182).
 * 텍스트 회의록 탭은 없다(D-084). `창을 닫아도 됩니다` 는 다른 화면을 써도 된다는 뜻으로 바꿨다(D-094).
 */
export function MeetingUploadPage() {
  const workspaceId = useRouteId('workspaceId')
  if (workspaceId === null) return null
  return <MeetingUpload workspaceId={workspaceId} />
}

function UploadLayout({ reveal = false, children }: { reveal?: boolean; children: ReactNode }) {
  return (
    <main className={PAGE}>
      <div className={reveal ? `${COLUMN} ${REVEAL_BELOW_TITLE}` : COLUMN}>
        <div className="flex flex-col gap-8">
          <h1 className={TITLE}>{TITLE_TEXT}</h1>
          <p className={LEAD}>{LEAD_TEXT}</p>
        </div>
        {children}
      </div>
    </main>
  )
}

function MeetingUpload({ workspaceId }: { workspaceId: string }) {
  const entry = useUploadEntry(workspaceId)
  const indicator = useLoadingIndicator(entry.kind === 'checking')
  const reveal = indicator.reveal

  // 정리 중 회의로 가는 것은 뼈대의 최소 표시를 기다리지 않는다 — 이 화면을 그리지 않는다
  if (entry.kind === 'processing')
    return <Navigate to={paths.meetingProcessing(workspaceId, entry.meetingId)} replace />
  if (entry.kind === 'checking' || indicator.pending)
    return (
      <UploadLayout>
        <DeferredSkeleton indicator={indicator}>
          <UploadSkeleton />
        </DeferredSkeleton>
      </UploadLayout>
    )
  switch (entry.kind) {
    case 'error':
      return (
        <UploadLayout reveal={reveal}>
          <QueryErrorState
            error={entry.error}
            onRetry={entry.retry}
            title="회의를 올릴 수 있는지 확인하지 못했어요"
          />
        </UploadLayout>
      )
    case 'ready':
      return (
        <UploadLayout reveal={reveal}>
          <MeetingUploadForm workspaceId={workspaceId} />
        </UploadLayout>
      )
  }
}
