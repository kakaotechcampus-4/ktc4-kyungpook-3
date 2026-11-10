import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import { useLocation } from 'react-router'
import {
  dismissProcessingToast,
  dismissSettled,
  meetingDetailQueryOptions,
  useMeetingSources,
  useMeetingTrackerStore,
} from '@/entities/meeting'
import type { Meeting, MeetingSource, SettledMeeting, TrackedMeeting } from '@/entities/meeting'
import { captureSession } from '@/entities/user'
import { useMemberWorkspace } from '@/entities/workspace'
import { paths } from '@/shared/config/routes'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { PinnedToast } from '@/shared/ui/toast'
import { processingSignal } from '../model/processingSignal'
import type { ProcessingSignal, ProcessingSubject } from '../model/processingSignal'
import { ProcessingToastCard } from './ProcessingToastCard'

function keyOf({ workspaceId, meetingId }: TrackedMeeting): string {
  return `${workspaceId}/${meetingId}`
}

function settledSubject(record: SettledMeeting): ProcessingSubject {
  return record.outcome === 'done'
    ? { phase: 'done', title: record.title }
    : { phase: 'failed', title: record.title, failedStage: record.failedStage }
}

/**
 * 추적 중 회의의 지금 모습. 완료는 추적기가 결과를 적기 전 한 번의 그리기에서도 완료로 보여 카드가 다시 마운트되지 않는다.
 * 실패는 끊김 판정(재연결 모달이면 토스트 없음)을 기다려야 해서 추적기가 결과를 적을 때까지 그리지 않는다
 */
function trackedSubject(
  detail: Meeting | undefined,
  source: MeetingSource | null,
): ProcessingSubject | null {
  switch (detail?.status) {
    case 'processing':
    case 'awaiting_speakers':
      return { phase: detail.status, title: detail.title, progress: detail.progress, source }
    case 'done':
      return { phase: 'done', title: detail.title }
    default:
      return null
  }
}

function isWatched(detail: Meeting | undefined): boolean {
  return detail?.status === 'processing' || detail?.status === 'awaiting_speakers'
}

/**
 * 지금 공간의 회의 정리 진행 토스트 (#424). 토스트 자리 맨 아래에 고정된다.
 *
 * - 지금 공간의 회의만 보인다 — 공간마다 정리는 하나다 (D-088). 다른 공간에서 시작한 추적은 그 공간에서 보인다.
 * - 정리 중·화자 지정 대기는 추적기가 polling 하는 상세 캐시를 읽기만 한다(요청을 더하지 않는다). 완료·실패는 추적기가
 *   적은 결과 기록이다 — 같은 회의면 결과가 이긴다.
 * - 그 회의의 처리 화면·화자 지정 화면에서는 숨긴다. 같은 내용을 두 번 보이지 않는다.
 * - 역할에 따라 보이는 것이 다르다(processingSignal). 소속을 아직 모르면 그리지 않는다.
 * - 접기는 카드마다다(ProcessingToastItem). 정리 중은 화면 폭과 상관없이 접힌 알약으로 시작한다 — 평소 본문을 덮지 않는다.
 */
export function ProcessingToast({ workspaceId }: { workspaceId: string }) {
  const tracked = useMeetingTrackerStore((state) => state.meetings)
  const settled = useMeetingTrackerStore((state) => state.settled)
  const dismissed = useMeetingTrackerStore((state) => state.dismissed)
  const role = useMemberWorkspace(workspaceId)?.role
  const { pathname } = useLocation()

  const settledHere = settled.filter((record) => record.workspaceId === workspaceId)
  const trackedHere = tracked.filter(
    (meeting) =>
      meeting.workspaceId === workspaceId &&
      !settledHere.some((record) => keyOf(record) === keyOf(meeting)),
  )
  // 추적기가 polling 한다. 여기서는 같은 캐시를 구독만 한다
  const details = useQueries({
    queries: trackedHere.map(({ meetingId }) => ({
      ...meetingDetailQueryOptions(workspaceId, meetingId),
      enabled: false,
    })),
  })

  // 단계 목록은 회의 출처마다 다르다(#483). 출처는 상세에 없어 발견과 같은 목록 캐시에서 읽고, 정리 중 회의가 목록에 없으면
  // 한 번 새로 받는다. 모르는 동안 카드는 단계 수 없이 보인다
  const sourceOf = useMeetingSources(
    workspaceId,
    trackedHere
      .filter((_, index) => isWatched(details[index]?.data))
      .map(({ meetingId }) => meetingId),
  )

  if (role === undefined) return null
  const items: { meeting: TrackedMeeting; signal: ProcessingSignal }[] = []
  const add = (meeting: TrackedMeeting, subject: ProcessingSubject | null) => {
    if (subject === null) return
    if (
      (subject.phase === 'processing' || subject.phase === 'awaiting_speakers') &&
      dismissed.includes(keyOf(meeting))
    )
      return
    const hidden =
      pathname === paths.meetingProcessing(meeting.workspaceId, meeting.meetingId) ||
      pathname === paths.meetingSpeakers(meeting.workspaceId, meeting.meetingId)
    const signal = hidden ? null : processingSignal(subject, role)
    if (signal !== null) items.push({ meeting, signal })
  }
  settledHere.forEach((record) => add(record, settledSubject(record)))
  trackedHere.forEach((meeting, index) =>
    add(meeting, trackedSubject(details[index]?.data, sourceOf(meeting.meetingId))),
  )
  if (items.length === 0) return null

  return (
    <PinnedToast>
      {items.map(({ meeting, signal }) => (
        <ProcessingToastItem key={keyOf(meeting)} meeting={meeting} signal={signal} />
      ))}
    </PinnedToast>
  )
}

/**
 * 카드 하나의 접힘. 상태(정리 중·화자 지정 필요·완료·실패)가 바뀌면 펼친다 — 정리 중의 단계 진행은 상태 변화가 아니다.
 * 정리 중으로 처음 보이면 알약이고, 화자 지정 필요·완료·실패는 펼쳐 보인다. 고른 접힘은 카드가 보이는 동안만이다 —
 * 기기에 「펼침」을 기억하면 한 번 펼쳐 본 사람에게 평소 본문을 덮는 카드가 돌아온다
 */
function ProcessingToastItem({
  meeting,
  signal,
}: {
  meeting: TrackedMeeting
  signal: ProcessingSignal
}) {
  const [fold, setFold] = useState(() => ({
    kind: signal.kind,
    collapsed: signal.kind === 'processing',
  }))
  if (fold.kind !== signal.kind) setFold({ kind: signal.kind, collapsed: false })
  const collapsed = fold.kind === signal.kind && fold.collapsed
  const onCollapsedChange = (next: boolean) => {
    setFold({ kind: signal.kind, collapsed: next })
  }
  const { workspaceId, meetingId } = meeting
  // 토스트가 처음 보인 세션. 세션이 끝난 뒤 누른 이동은 다음 계정으로 가지 않는다
  const [isCurrentSession] = useState(() => captureSession())
  const navigate = useGuardedNavigate()
  const go = (to: string) => {
    if (isCurrentSession()) navigate(to)
  }

  return (
    <ProcessingToastCard
      signal={signal}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      onOpenProcessing={() => go(paths.meetingProcessing(workspaceId, meetingId))}
      onAssignSpeakers={() => go(paths.meetingSpeakers(workspaceId, meetingId))}
      onOpenMinutes={() => {
        if (!isCurrentSession()) return
        dismissSettled(meeting)
        go(paths.meetings(workspaceId, meetingId))
      }}
      onDismiss={() => {
        if (!isCurrentSession()) return
        if (signal.kind === 'processing' || signal.kind === 'speakers') {
          dismissProcessingToast(meeting)
        } else {
          dismissSettled(meeting)
        }
      }}
    />
  )
}
