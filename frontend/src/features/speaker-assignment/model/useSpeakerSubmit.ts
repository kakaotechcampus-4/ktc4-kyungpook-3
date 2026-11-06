import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import {
  assignSpeakers,
  meetingKeys,
  speakerViewQueryOptions,
  trackMeeting,
} from '@/entities/meeting'
import { memberListQueryOptions } from '@/entities/member'
import { captureSession } from '@/entities/user'
import { paths } from '@/shared/config/routes'
import { useLivePathname } from '@/shared/lib/live-pathname'
import { hasPendingLeave, useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { toSubmitRejection } from './submitRejection'
import type { SubmitRejection } from './submitRejection'

export interface SpeakerSubmit {
  pending: boolean
  /** 마지막 제출이 받아들여지지 않은 이유. 다시 내면 지운다 */
  rejection: SubmitRejection | null
  /** 받아들여지지 않으면 그 이유를 돌려준다. 받아들여졌거나 이미 내는 중이면 null */
  submit: (mapping: Record<string, string | null>) => Promise<SubmitRejection | null>
}

/**
 * 지정 제출. 받아들여지면 추적에 등록하고, 아직 이 회의의 지정 화면에 있으면 처리 화면으로 바꿔 간다 — 그 뒤
 * done·failed 는 앱 추적기가 잇는다. 기다리는 사이 다른 화면으로 갔거나 이탈 확인 중이면 옮기지 않는다.
 * 「있나」는 라우터 기록의 지금 경로로 본다(useLivePathname). 이 훅의 커밋된 경로는 늘 지정 화면이고 떠나면 그 값에
 * 멈춰 있어 판정을 바꾸지 못한다.
 * 받아들여지지 않으면 이유에 맞게 다시 받는다. 같은 지정을 다시 내도 200 이라(계약 §2.3.1) 응답 유실 뒤 다시 내도 된다.
 * 응답을 기다리는 사이 세션이 끝났으면 그 결과로 아무것도 하지 않는다
 */
export function useSpeakerSubmit(workspaceId: string, meetingId: string): SpeakerSubmit {
  const queryClient = useQueryClient()
  const navigate = useGuardedNavigate()
  const livePathname = useLivePathname()
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [rejection, setRejection] = useState<SubmitRejection | null>(null)

  const refetchAfter = useCallback(
    (reason: SubmitRejection) => {
      const view = speakerViewQueryOptions(workspaceId, meetingId).queryKey
      switch (reason.kind) {
        case 'labelsChanged':
          return queryClient.invalidateQueries({ queryKey: view })
        case 'inactiveMembers':
          void queryClient.invalidateQueries({
            queryKey: memberListQueryOptions(workspaceId).queryKey,
          })
          return queryClient.invalidateQueries({ queryKey: view })
        case 'expired':
        case 'alreadyMoved':
          return queryClient.invalidateQueries({ queryKey: meetingKeys(workspaceId) })
        default:
          return undefined
      }
    },
    [meetingId, queryClient, workspaceId],
  )

  const submit = useCallback(
    async (mapping: Record<string, string | null>) => {
      if (inFlight.current) return null
      inFlight.current = true
      setPending(true)
      setRejection(null)
      const isCurrentSession = captureSession()
      try {
        await assignSpeakers(meetingId, mapping)
      } catch (error) {
        if (!isCurrentSession()) return null
        const reason = toSubmitRejection(error)
        setRejection(reason)
        void refetchAfter(reason)
        return reason
      } finally {
        inFlight.current = false
        setPending(false)
      }
      if (!isCurrentSession()) return null
      trackMeeting({ workspaceId, meetingId })
      const stillHere =
        !hasPendingLeave() && livePathname() === paths.meetingSpeakers(workspaceId, meetingId)
      if (stillHere) navigate(paths.meetingProcessing(workspaceId, meetingId), { replace: true })
      void queryClient.invalidateQueries({ queryKey: meetingKeys(workspaceId) })
      return null
    },
    [livePathname, meetingId, navigate, queryClient, refetchAfter, workspaceId],
  )

  return { pending, rejection, submit }
}
