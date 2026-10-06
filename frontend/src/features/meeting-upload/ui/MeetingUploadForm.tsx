import { useQuery } from '@tanstack/react-query'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useController } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { memberListQueryOptions } from '@/entities/member'
import { paths } from '@/shared/config/routes'
import { useAppForm } from '@/shared/lib/form'
import { confirmLeave, hasPendingLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { ErrorText } from '@/shared/ui/error-text'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { TextField } from '@/shared/ui/text-field'
import { AUDIO_REJECTION_MESSAGE } from '../model/audioFile'
import { fileSeoulDate, toStartedAt } from '../model/meetingDate'
import { meetingUploadSchema, UPLOAD_FORM_MESSAGES } from '../model/uploadSchema'
import type { MeetingUploadValues } from '../model/uploadSchema'
import { selectedFile, useAudioSelection } from '../model/useAudioSelection'
import { useMeetingUpload } from '../model/useMeetingUpload'
import type { MeetingUploadHandlers } from '../model/useMeetingUpload'
import type { NotionBlockReason } from '../model/useUploadEntry'
import { AttendeePicker } from './AttendeePicker'
import { AudioDropzone } from './AudioDropzone'
import { SelectedAudio } from './SelectedAudio'
import { UploadStatus } from './UploadStatus'

export interface MeetingUploadFormProps {
  workspaceId: string
  /** 업로드가 Notion 연동 오류(409)로 막혔다. 화면이 차단 모달을 띄운다 (D-097, D-100) */
  onBlocked: (reason: NotionBlockReason) => void
}

const EMPTY: MeetingUploadValues = { title: '', date: '', attendeeMemberIds: [] }

/* Upload 캔버스 실측 — 카드 22 · 칸 사이 18 · 제목/날짜 14 · 날짜 칸 200px */
const ROOT = 'flex flex-col gap-26'
const FIELDS = 'flex flex-col gap-18 rounded-16 border border-line bg-surface p-22'
const ROW = 'grid grid-cols-[minmax(0px,1fr)_200px] gap-14'
const FOOTER = 'flex items-center justify-between gap-20'
const NOTE = 'text-caption text-dim'

/**
 * 회의 올리기 폼. 녹음 파일 하나 + 제목·날짜·참석자 (D-084~D-087).
 * - 파일을 받으면 제목은 확장자를 포함한 파일 이름, 날짜는 파일 수정 시각의 서울 날짜로 바꾼다. 참석자는 그대로다 (U3-5)
 * - 파일을 고른 뒤부터 떠나려 하면 기존 이탈 확인을 묻는다. 202 를 받으면 입력과 파일을 놓고 묻지 않고 간다 (U3-9)
 * - 제출은 한 번에 하나다. 보내는 동안 입력을 잠그고 다시 보내지 않는다 (U3-8)
 */
export function MeetingUploadForm({ workspaceId, onBlocked }: MeetingUploadFormProps) {
  const navigate = useNavigate()
  const members = useQuery(memberListQueryOptions(workspaceId))
  const { form, submit } = useAppForm(meetingUploadSchema, EMPTY)
  const { errors } = form.formState
  const attendees = useController({ control: form.control, name: 'attendeeMemberIds' })
  const [fileRequired, setFileRequired] = useState(false)
  const browseRef = useRef<HTMLButtonElement>(null)
  const fileErrorId = useId()

  const onReady = useCallback(
    (file: File) => {
      form.setValue('title', file.name)
      form.setValue('date', fileSeoulDate(file.lastModified))
      form.clearErrors(['title', 'date'])
    },
    [form],
  )
  const audio = useAudioSelection(onReady)
  const file = selectedFile(audio.selection)
  const unsaved = useUnsavedChanges(file !== null || form.formState.isDirty)

  const handlers = useMemo<MeetingUploadHandlers>(() => {
    /**
     * 입력과 파일 참조를 놓고 확인 없이 옮긴다 — 지킬 입력이 더 없다.
     * 보내는 동안 다른 곳으로 가려다 이탈 확인에 붙잡혀 있었으면 처리 화면이 아니라 그 이동을 마저 한다.
     * 확인이 물은 것은 입력을 버릴지였고 이제 버릴 입력이 없다. 응답이 확인보다 먼저 오든 늦게 오든 가는 곳이 같다.
     */
    const leave = (to: string) => {
      unsaved.release()
      audio.clear()
      form.reset(EMPTY)
      if (hasPendingLeave()) confirmLeave()
      else void navigate(to, { replace: true })
    }
    return {
      onAccepted: (meetingId) => leave(paths.meetingProcessing(workspaceId, meetingId)),
      onProcessing: (meetingId) => leave(paths.meetingProcessing(workspaceId, meetingId)),
      onBlocked,
    }
  }, [unsaved, audio, form, navigate, workspaceId, onBlocked])
  const upload = useMeetingUpload(workspaceId, handlers)
  const locked = upload.pending

  const send = submit(async (values) => {
    if (audio.selection.kind !== 'ready') return
    const { file: ready } = audio.selection
    await upload.upload({
      file: ready,
      title: values.title,
      startedAt: toStartedAt(ready.lastModified, values.date),
      attendeeMemberIds: values.attendeeMemberIds,
    })
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (locked) return
    if (audio.selection.kind !== 'ready') {
      // 파일이 없거나 받지 않은 파일이다. 다른 칸의 안내도 함께 보이고 포커스는 파일 선택으로 간다
      if (audio.selection.kind === 'empty') setFileRequired(true)
      void form.trigger().then(() => browseRef.current?.focus())
      return
    }
    void send(event)
  }

  const fileError =
    audio.selection.kind === 'rejected'
      ? AUDIO_REJECTION_MESSAGE[audio.selection.reason]
      : upload.failure?.kind === 'file'
        ? upload.failure.message
        : fileRequired && audio.selection.kind === 'empty'
          ? UPLOAD_FORM_MESSAGES.fileRequired
          : null

  const selectFiles = (files: File[]) => {
    upload.clearFailure()
    setFileRequired(false)
    audio.select(files)
  }

  return (
    <form className={ROOT} noValidate onSubmit={onSubmit} aria-busy={locked || undefined}>
      <FormErrorPanel message={upload.failure?.kind === 'form' ? upload.failure.message : null} />

      <div className="flex flex-col gap-10">
        <AudioDropzone
          onFiles={selectFiles}
          disabled={locked}
          buttonRef={browseRef}
          errorId={fileError === null ? undefined : fileErrorId}
        />
        {file === null || audio.selection.kind === 'empty' ? null : (
          <SelectedAudio
            selection={{ ...audio.selection, file }}
            disabled={locked}
            onRemove={() => {
              upload.clearFailure()
              audio.clear()
            }}
          />
        )}
        {fileError === null ? null : <ErrorText id={fileErrorId}>{fileError}</ErrorText>}
      </div>

      <fieldset className={FIELDS} disabled={locked}>
        <legend className="sr-only">회의 정보</legend>
        <div className={ROW}>
          <TextField label="회의 제목" error={errors.title?.message} {...form.register('title')} />
          <TextField
            label="회의 날짜"
            type="date"
            error={errors.date?.message}
            {...form.register('date')}
          />
        </div>
        {members.data !== undefined ? (
          <AttendeePicker
            members={members.data}
            value={attendees.field.value}
            onChange={(next) => attendees.field.onChange(next)}
            triggerRef={attendees.field.ref}
            error={errors.attendeeMemberIds?.message}
            disabled={locked}
          />
        ) : members.isError ? (
          <QueryErrorState
            error={members.error}
            onRetry={() => void members.refetch()}
            title="팀원 목록을 불러오지 못했어요"
          />
        ) : (
          <div aria-busy="true">
            <Skeleton lines={2} />
          </div>
        )}
      </fieldset>

      <UploadStatus phase={upload.phase} recovering={upload.recovering} />

      <div className={FOOTER}>
        <p className={NOTE}>
          회의록과 확실한 태스크는 바로 Notion에 반영하고, 확인이 필요한 항목은 승인한 뒤 반영해요.
        </p>
        <Button
          type="submit"
          variant="primary"
          size="xl"
          loading={locked}
          disabled={audio.selection.kind === 'checking'}
          endIcon={<Icon name="arrow-right" />}
        >
          정리 시작하기
        </Button>
      </div>
    </form>
  )
}
