import { useMutation } from '@tanstack/react-query'
import { requestMarkdownFile } from '@/shared/api/client'
import { failureNotice } from '@/shared/api/errorMessages'
import { CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { saveTextFile } from '@/shared/lib/download'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/toast'

/** 회의 요약본(.md)을 내려받는다. 요약이 사라졌으면(404 `SUMMARY_NOT_FOUND`) 그 문구로 알린다 (계약 §4.4.2) */
export function SummaryDownloadButton({ meetingId }: { meetingId: string }) {
  const download = useMutation({
    mutationFn: (session: SessionScope) => {
      // 오프라인으로 기다리는 사이 세션이 끝났을 수 있다. 끝난 세션의 요청은 보내지 않는다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return requestMarkdownFile(`/meetings/${encodeURIComponent(meetingId)}/summary.md`, {
        signal: session.signal,
        fallbackFilename: 'summary.md',
      })
    },
    onSuccess: (file, session) => {
      if (!session.isCurrent()) return
      saveTextFile(file.text, file.filename, 'text/markdown;charset=utf-8')
    },
    onError: (error, session) => {
      if (!session.isCurrent()) return
      const notice = failureNotice(error)
      if (notice !== null) toast.show({ title: '요약본을 내려받지 못했어요', description: notice })
    },
  })
  return (
    <Button
      variant="text"
      size="sm"
      loading={download.isPending}
      onClick={() => {
        if (!download.isPending) download.mutate(captureSessionScope())
      }}
    >
      {download.isPending ? '내려받는 중…' : '요약본 내려받기'}
    </Button>
  )
}
