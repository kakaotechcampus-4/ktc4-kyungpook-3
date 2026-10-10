import { useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { MeetingUploadForm, useUploadEntry } from '@/features/meeting-upload'
import type { NotionBlockReason } from '@/features/meeting-upload'
import { NotionRequiredModal } from '@/features/notion-connection'
import { paths } from '@/shared/config/routes'
import { useRouteId } from '@/shared/lib/url'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'

/* Upload 캔버스 실측 — 위 48 · 아래 72, 본문 700px 한 단, 제목 30px (docs/impl-decision/2026-10-02-meeting-upload-screen.md) */
const PAGE = 'mx-auto flex w-full max-w-shell flex-1 justify-center px-48 pt-48 pb-72'
const COLUMN = 'flex w-full max-w-[700px] flex-col gap-26'
const TITLE = 'text-[30px] leading-[1.25] font-bold tracking-h1 text-ink'
const LEAD = 'text-body text-sub'

/**
 * 회의 올리기 (PM 전용 — 가드는 라우터의 RequirePM). 들어올 때 정리 중 회의와 Notion 연결을 먼저 본다 (U3-1).
 * 텍스트 회의록 탭은 없다(D-084). `창을 닫아도 됩니다` 는 다른 화면을 써도 된다는 뜻으로 바꿨다(D-094).
 */
export function MeetingUploadPage() {
  const workspaceId = useRouteId('workspaceId')
  if (workspaceId === null) return null
  return <MeetingUpload workspaceId={workspaceId} />
}

function UploadLayout({ children }: { children: ReactNode }) {
  return (
    <main className={PAGE}>
      <div className={COLUMN}>
        <div className="flex flex-col gap-8">
          <h1 className={TITLE}>회의를 올려 주세요</h1>
          <p className={LEAD}>
            정리가 끝나면 알려드릴게요. 정리하는 동안 다른 화면을 써도 괜찮아요.
          </p>
        </div>
        {children}
      </div>
    </main>
  )
}

function MeetingUpload({ workspaceId }: { workspaceId: string }) {
  const entry = useUploadEntry(workspaceId)
  const navigate = useNavigate()
  // 업로드 응답이 연동 오류(409)였을 때의 모달. 진입 판정의 모달과 같은 컴포넌트다
  const [blocked, setBlocked] = useState<NotionBlockReason | null>(null)

  switch (entry.kind) {
    case 'processing':
      return <Navigate to={paths.meetingProcessing(workspaceId, entry.meetingId)} replace />
    case 'checking':
      return (
        <UploadLayout>
          <div aria-busy="true">
            <Skeleton lines={4} />
          </div>
        </UploadLayout>
      )
    case 'error':
      return (
        <UploadLayout>
          <QueryErrorState
            error={entry.error}
            onRetry={entry.retry}
            title="회의를 올릴 수 있는지 확인하지 못했어요"
          />
        </UploadLayout>
      )
    case 'blocked':
      // 업로드 화면으로 들어오지 않는다 — 취소하면 회의록 목록으로 (D-097)
      return (
        <UploadLayout>
          <NotionRequiredModal
            workspaceId={workspaceId}
            reason={entry.reason}
            onCancel={() => void navigate(paths.meetings(workspaceId), { replace: true })}
          />
        </UploadLayout>
      )
    case 'ready':
      return (
        <UploadLayout>
          <MeetingUploadForm workspaceId={workspaceId} onBlocked={setBlocked} />
          <NotionRequiredModal
            workspaceId={workspaceId}
            reason={blocked}
            onCancel={() => setBlocked(null)}
            onLeave={() => setBlocked(null)}
          />
        </UploadLayout>
      )
  }
}
