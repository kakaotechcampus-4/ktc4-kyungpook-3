import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  findProcessingMeeting,
  meetingListQueryOptions,
  trackMeeting,
  uploadMeeting,
} from '@/entities/meeting'
import type { UploadMeetingInput } from '@/entities/meeting'
import { captureSession } from '@/entities/user'
import type { UploadProgress } from '@/shared/api/client'
import { fetchFresh } from '@/shared/api/fetchFresh'
import { useLivePathname } from '@/shared/lib/live-pathname'
import { classifyUploadError, UPLOAD_LOST_MESSAGE } from './uploadOutcome'
import { toUploadPhase } from './uploadPhase'
import type { UploadPhase } from './uploadPhase'
import type { NotionBlockReason } from './useUploadEntry'

/** mutation 변수 — 원본 파일을 뺀 업로드 입력 */
type UploadFields = Omit<UploadMeetingInput, 'file'>

/** 업로드 한 번을 시작한 세션·화면에 아직 있나 */
interface UploadScope {
  stillHere: () => boolean
  isCurrentSession: () => boolean
}

export interface MeetingUploadHandlers {
  /** 202 — 서버가 받아 정리를 시작했다. 화면은 입력을 놓고 처리 화면으로 간다 */
  onAccepted: (meetingId: string) => void
  /** 이미 정리 중인 회의가 있다 — 409 또는 응답을 잃은 뒤 목록에서 찾았다 */
  onProcessing: (meetingId: string) => void
  /** Notion 연동 오류 — 차단 모달 흐름 (D-097, D-100) */
  onBlocked: (reason: NotionBlockReason) => void
}

/** 폼에 보일 실패. 파일 칸 아래(`file`) 또는 폼 상단(`form`) */
export interface UploadFormFailure {
  kind: 'file' | 'form'
  message: string
}

export interface MeetingUpload {
  upload: (input: UploadMeetingInput) => Promise<void>
  /** 보내는 중이거나, 응답을 잃어 목록을 다시 보는 중 */
  pending: boolean
  /** 응답을 잃어 목록을 다시 보는 중 */
  recovering: boolean
  /** 보내는 중의 단계. 보내고 있지 않으면 null */
  phase: UploadPhase | null
  failure: UploadFormFailure | null
  clearFailure: () => void
}

/**
 * 회의 업로드 한 번. 다시 보내지 않는다 — mutation retry 0, 앞 제출이 끝나기 전의 제출은 폼이 막는다 (U3-8).
 *
 * 202 를 받으면 그 회의를 정리 추적 대상으로 등록하고 목록 캐시를 무효화한다. 이 둘은 mutation 자체에 걸어
 * 응답 전에 화면을 떠났어도 일어난다 — 앱 계층의 추적기(U4)가 등록 지점에서 받아 간다.
 * 화면 이동(`onAccepted` 등)은 이 화면이 아직 있을 때만 한다 — 떠난 사용자를 끌고 오지 않는다.
 * 「아직 있나」는 마운트 여부에 더해 라우터 기록의 지금 경로로 본다. 이탈 확인에서 나가기를 고른 이동이 지연 로드 화면을
 * 기다리는 중이면 폼이 아직 그려져 있어도 떠난 것이다 (U4 r1 M01 과 같은 경합).
 * 보내는 동안 세션이 끝났으면(로그아웃·만료) 응답의 뒷처리를 모두 버린다 — 추적 등록·캐시 무효화·이동·안내.
 * 다음 사용자의 추적기가 이전 사용자의 회의를 묻지 않는다 (U4 r1 M02 와 같은 경합).
 *
 * 응답을 잃으면(네트워크 오류) 서버가 받았는지 모른다. 목록을 새로 받아 정리 중 회의가 있으면 그 처리 화면으로,
 * 없으면 다시 올리라고 안내한다. 같은 파일을 자동으로 다시 보내지 않는다.
 *
 * 원본 파일은 mutation 변수에 넣지 않는다. 변수는 끝난 뒤에도 MutationCache 에 `gcTime`(기본 5분) 동안 남는다 —
 * 최대 200 MiB 를 처리 화면까지 붙들게 된다 (U3-9). 파일은 보낼 때 한 번 꺼내 그 요청만 쥐고, 요청이 끝나면 놓인다.
 */
export function useMeetingUpload(
  workspaceId: string,
  handlers: MeetingUploadHandlers,
): MeetingUpload {
  const queryClient = useQueryClient()
  const livePathname = useLivePathname()
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [failure, setFailure] = useState<UploadFormFailure | null>(null)
  const [recovering, setRecovering] = useState(false)
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  }, [handlers])
  // 보낼 파일. mutationFn 이 꺼내 가면서 비운다 — 캐시에 남는 변수에는 파일이 없다
  const outgoingFile = useRef<File | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (fields: UploadFields) => {
      const file = outgoingFile.current
      outgoingFile.current = null
      if (file === null) return Promise.reject(new Error('upload started without a file'))
      return uploadMeeting(
        workspaceId,
        { ...fields, file },
        {
          onProgress: (next) => {
            if (mounted.current) setProgress(next)
          },
        },
      )
    },
    retry: 0,
    // 보내기 시작한 세션. 응답이 왔을 때 세션이 바뀌었으면 등록하지 않는다
    onMutate: () => ({ isCurrentSession: captureSession() }),
    onSuccess: (result, _fields, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      trackMeeting({ workspaceId, meetingId: result.id })
      void queryClient.invalidateQueries({
        queryKey: meetingListQueryOptions(workspaceId).queryKey,
      })
    },
  })

  /** 응답을 잃었다. 목록에서 정리 중 회의를 찾는다 — 방금 보낸 것이 받아졌거나 다른 정리가 먼저였다 */
  const recover = useCallback(
    async ({ stillHere, isCurrentSession }: UploadScope) => {
      setRecovering(true)
      try {
        // 응답을 잃은 **뒤의** 목록으로 판정한다 (fetchFresh). 잃기 전에 출발한 공유 목록 조회의 답(정리 중 없음)은 쓰지 않고
        // (U4 r3 M05), 마지막 구독(업로드 화면·공간의 발견)이 내려가 취소된 채 돌아온 들어올 때의 목록은 답으로 치지 않고
        // 다시 묻는다 (U4 r2 M03 과 같은 함정). 목록 캐시에 쓰는 것은 그 공유 Query 하나다 (U4 r4 M06).
        // 세션이 끝났으면 취소로 끝난다(아래 catch)
        const latest = await fetchFresh(queryClient, meetingListQueryOptions(workspaceId))
        if (!isCurrentSession()) return
        const processing = findProcessingMeeting(latest)
        if (processing !== null) {
          trackMeeting({ workspaceId, meetingId: processing.id })
          if (stillHere()) handlersRef.current.onProcessing(processing.id)
          return
        }
      } catch {
        // 목록도 받지 못했다 — 아래 안내로 간다
      } finally {
        if (mounted.current) setRecovering(false)
      }
      if (mounted.current && isCurrentSession())
        setFailure({ kind: 'form', message: UPLOAD_LOST_MESSAGE })
    },
    [queryClient, workspaceId],
  )

  const upload = useCallback(
    async (input: UploadMeetingInput) => {
      setFailure(null)
      setProgress(null)
      const { file, ...fields } = input
      outgoingFile.current = file
      // 보내기 시작한 세션과 화면. 응답이 왔을 때 둘 다 그대로일 때만 이 화면에서 이어 간다
      const isCurrentSession = captureSession()
      const startedAt = livePathname()
      const stillHere = () => mounted.current && isCurrentSession() && livePathname() === startedAt
      let meetingId: string
      try {
        meetingId = (await mutateAsync(fields)).id
      } catch (error) {
        const outcome = classifyUploadError(error)
        // 세션이 끝나 취소됐거나 401 이었다. 그 업로드의 뒷처리는 없다
        if (!isCurrentSession()) return
        if (!mounted.current && outcome.kind !== 'lost') return
        switch (outcome.kind) {
          case 'processing':
            trackMeeting({ workspaceId, meetingId: outcome.meetingId })
            if (stillHere()) handlersRef.current.onProcessing(outcome.meetingId)
            return
          case 'blocked':
            if (stillHere()) handlersRef.current.onBlocked(outcome.reason)
            return
          case 'file':
          case 'form':
            setFailure({ kind: outcome.kind, message: outcome.message })
            return
          case 'lost':
            await recover({ stillHere, isCurrentSession })
            return
          default:
            return
        }
      }
      if (stillHere()) handlersRef.current.onAccepted(meetingId)
    },
    [livePathname, mutateAsync, recover, workspaceId],
  )

  return {
    upload,
    pending: isPending || recovering,
    recovering,
    phase: isPending ? toUploadPhase(progress) : null,
    failure,
    clearFailure: useCallback(() => setFailure(null), []),
  }
}
