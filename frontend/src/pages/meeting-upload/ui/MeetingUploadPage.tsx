import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { MeetingUploadForm, useUploadEntry } from '@/features/meeting-upload'
import { paths } from '@/shared/config/routes'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { useRouteId } from '@/shared/lib/url'
import { DeferredSkeleton } from '@/shared/ui/deferred-skeleton'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'

/* Upload 캔버스 실측 — 위 48 · 아래 72, 본문 700px 한 단, 제목 30px (docs/impl-decision/2026-10-02-meeting-upload-screen.md) */
const PAGE = 'mx-auto flex w-full max-w-shell flex-1 justify-center px-48 pt-48 pb-72 max-md:px-20'
const COLUMN = 'flex w-full max-w-[700px] flex-col gap-26'
const TITLE = 'text-[30px] leading-[1.25] font-bold tracking-h1 text-ink'
const LEAD = 'text-body text-sub'
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

/**
 * 올릴 수 있는지 확인하는 동안의 뼈대 (#508). 업로드 폼과 같은 틀이다 — 파일 끌어 놓기 칸, 회의 정보 칸(제목 · 날짜 · 참석자).
 * 정해진 글자(칸 이름)는 글자로 그린다. 자리표시라 스크린리더에서 뺀다. 치수는 AudioDropzone 의 ZONE, MeetingUploadForm 의
 * ROOT · FIELDS · ROW 와 같다
 */
function UploadSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-26">
      <div className="flex flex-col items-center gap-14 rounded-16 border border-line bg-surface-sunken px-32 py-44">
        <Skeleton variant="block" width={48} height={48} className="rounded-9" />
        <div className="flex w-full flex-col items-center gap-5">
          <Skeleton width={200} />
          <Skeleton width={140} />
        </div>
        <Skeleton width={260} />
      </div>
      <div className="flex flex-col gap-18 rounded-16 border border-line bg-surface p-22">
        <div className="grid grid-cols-[minmax(0px,1fr)_200px] gap-14 max-md:grid-cols-1">
          {['회의 제목', '회의 날짜'].map((label) => (
            <div key={label} className="flex flex-col gap-6">
              <span className="text-caption text-sub">{label}</span>
              <Skeleton variant="block" height={44} className="rounded-9" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-6">
          <span className="text-caption text-sub">참석자</span>
          <Skeleton variant="block" width={64} height={32} className="rounded-9" />
        </div>
      </div>
    </div>
  )
}
