import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { requestMarkdownFile } from '@/shared/api/client'
import { failureNotice } from '@/shared/api/errorMessages'
import { ApiError, CLIENT_ERROR_CODES, ERROR_CODES, createClientError } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { saveTextFile } from '@/shared/lib/download'
import { Button } from '@/shared/ui/button'
import { DateField } from '@/shared/ui/date-field'
import { toast } from '@/shared/ui/toast'
import { PERIOD_MESSAGES, checkPeriod } from '../lib/bundlePeriod'
import type { PeriodInput } from '../lib/bundlePeriod'

interface Attempt {
  params: { from?: string; to?: string }
  session: SessionScope
}

const ERROR_TEXT = 'text-[12px] leading-[1.5] text-accent'

/** 외부 AI 에 첨부할 프로젝트 합본(.md). 기간을 비우면 전체 기간이다 (계약 §4.4.2) */
export function ProjectBundleDownload({
  workspaceId,
  notesClassName,
}: {
  workspaceId: string
  notesClassName?: string
}) {
  const [period, setPeriod] = useState<PeriodInput>({ from: '', to: '' })
  // 입력 검사는 내려받기를 누른 뒤에만 보인다. 서버가 기간을 거절한 것도 같은 문구다
  const [attempted, setAttempted] = useState(false)
  const [serverRejected, setServerRejected] = useState(false)
  const noticeId = useId()
  const check = checkPeriod(period)

  const download = useMutation({
    mutationFn: ({ params, session }: Attempt) => {
      // 오프라인으로 기다리는 사이 세션이 끝났을 수 있다. 끝난 세션의 요청은 보내지 않는다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return requestMarkdownFile(
        `/workspaces/${encodeURIComponent(workspaceId)}/project-bundle.md`,
        { params, signal: session.signal, fallbackFilename: 'project-bundle.md' },
      )
    },
    onSuccess: (file, { session }) => {
      if (!session.isCurrent()) return
      saveTextFile(file.text, file.filename, 'text/markdown;charset=utf-8')
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      if (error instanceof ApiError && error.code === ERROR_CODES.INVALID_REQUEST) {
        setServerRejected(true)
        return
      }
      const notice = failureNotice(error)
      if (notice !== null)
        toast.show({ title: '프로젝트 합본을 내려받지 못했어요', description: notice })
    },
  })

  const edit = (next: PeriodInput) => {
    setPeriod(next)
    setAttempted(false)
    setServerRejected(false)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (download.isPending) return
    setAttempted(true)
    setServerRejected(false)
    if (check.kind !== 'ok') return
    download.mutate({ params: check.params, session: captureSessionScope() })
  }

  const invalid = attempted && check.kind === 'invalid_date' ? check.fields : null
  const reversed = serverRejected || (attempted && check.kind === 'reversed')

  return (
    <form
      aria-label="프로젝트 합본 내려받기"
      aria-busy={download.isPending}
      className="flex flex-col gap-8"
      onSubmit={submit}
    >
      <div className="flex flex-wrap items-end gap-8">
        <DateField
          size="lg"
          label="시작일"
          placeholder="YYYY-MM-DD"
          calendarLabel="시작일 달력 열기"
          className="w-[180px]"
          value={period.from}
          error={invalid?.from ? PERIOD_MESSAGES.invalidDate : undefined}
          onChange={(from) => edit({ ...period, from })}
        />
        <DateField
          size="lg"
          label="종료일"
          placeholder="YYYY-MM-DD"
          calendarLabel="종료일 달력 열기"
          className="w-[180px]"
          value={period.to}
          error={invalid?.to ? PERIOD_MESSAGES.invalidDate : undefined}
          onChange={(to) => edit({ ...period, to })}
        />
        <Button
          type="submit"
          variant="primary"
          size="xl"
          loading={download.isPending}
          aria-describedby={noticeId}
        >
          {download.isPending ? '내려받는 중…' : '프로젝트 내려받기'}
        </Button>
      </div>
      {reversed ? (
        <p role="alert" className={ERROR_TEXT}>
          {PERIOD_MESSAGES.reversed}
        </p>
      ) : null}
      <div className={`flex flex-col gap-8 ${notesClassName ?? ''}`}>
        {check.kind === 'ok' ? (
          <p className="text-caption text-sub">
            <span className="text-dim">내려받을 기간 ·</span> {check.label}
          </p>
        ) : null}
        <p id={noticeId} className="text-caption text-dim">
          팀원 발언 요약이 들어 있어요. 외부 AI 에 첨부할 때 주의해 주세요.
        </p>
      </div>
    </form>
  )
}
