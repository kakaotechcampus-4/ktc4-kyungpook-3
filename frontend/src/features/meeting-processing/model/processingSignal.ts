import { meetingFailure, processingSteps, stageDetail } from '@/entities/meeting'
import type {
  MeetingProcessing,
  MeetingProgress,
  MeetingSource,
  ProcessingStepKey,
  ProcessingStepState,
  StageDetail,
} from '@/entities/meeting'
import type { Role } from '@/shared/types/common'
import { PROCESSING_DONE_TITLE, PROCESSING_FAILED_TITLE, SPEAKERS_NEEDED_TITLE } from './notices'

/**
 * 진행 토스트가 보는 회의 하나. 정리 중·대기는 상세 캐시에서, 완료·실패는 끝난 결과 기록에서 온다 (#424).
 * `source` 는 상세에 없어 목록 요약에서 온다. 모르면 null — 단계 칸·수 없이 보인다 (#483).
 * `observedAt` 은 상세 응답을 마지막으로 받은 시각이다 — 지금 단계의 경과를 이 시각까지로 센다
 */
export type ProcessingSubject =
  | {
      phase: 'processing' | 'awaiting_speakers'
      title: string
      progress: MeetingProgress | null
      processing: MeetingProcessing | null
      observedAt: number
      source: MeetingSource | null
    }
  | { phase: 'done'; title: string }
  | { phase: 'failed'; title: string; failedStage: string | null }

type Phase = ProcessingSubject['phase']

export type ProcessingSignal =
  | {
      kind: 'processing'
      title: string
      sentence: string
      /** 출처를 모르면 null — 단계 수를 정하지 않는다 */
      steps: ProcessingStepState[] | null
      doneCount: number | null
      /** 지금 단계의 진행 수·경과. 출처를 모르거나 화자 지정을 기다리면 null */
      detail: StageDetail | null
    }
  | { kind: 'speakers'; title: string }
  | { kind: 'done'; title: string }
  | { kind: 'failed'; title: string; description: string }

/** `waiting` 은 팀원이 보는 화자 지정 대기 — 모양은 정리 중이고 문장만 다르다 */
type View = 'processing' | 'waiting' | 'speakers' | 'done' | 'failed'

/**
 * 역할 × 단계로 무엇을 보일지 (#424 규칙 3). 팀원은 할 일이 없는 화자 지정·실패를 받지 않는다 —
 * 대기는 정리 중 모양으로 보이고, 실패하면 조용히 사라진다
 */
const VIEWS: Record<Role, Record<Phase, View | null>> = {
  pm: { processing: 'processing', awaiting_speakers: 'speakers', done: 'done', failed: 'failed' },
  member: { processing: 'processing', awaiting_speakers: 'waiting', done: 'done', failed: null },
}

/** 처리 화면의 단계마다 하나다. 지금 단계가 없는 정리 중은 마지막 단계 문장이다 */
const STAGE_SENTENCES: Record<ProcessingStepKey, string> = {
  queue: '차례를 기다리고 있어요',
  transcribe: '음성을 텍스트로 옮기고 있어요',
  collect: '대화를 모으고 있어요',
  extract: '결정사항과 할 일을 뽑고 있어요',
}

const WAITING_SENTENCE = '화자 지정을 기다리고 있어요'

/** 출처를 몰라 지금 단계를 말할 수 없을 때 */
const UNKNOWN_STAGE_SENTENCE = '회의를 정리하고 있어요'

function progressSignal(
  subject: Extract<ProcessingSubject, { phase: 'processing' | 'awaiting_speakers' }>,
  waiting: boolean,
): ProcessingSignal {
  if (subject.source === null)
    return {
      kind: 'processing',
      title: subject.title,
      sentence: waiting ? WAITING_SENTENCE : UNKNOWN_STAGE_SENTENCE,
      steps: null,
      doneCount: null,
      detail: null,
    }
  const steps = processingSteps(subject.progress, subject.phase, subject.source)
  const current = steps.find(({ state }) => state === 'current')
  return {
    kind: 'processing',
    title: subject.title,
    sentence: waiting ? WAITING_SENTENCE : STAGE_SENTENCES[current?.key ?? 'extract'],
    steps: steps.map(({ state }) => state),
    doneCount: steps.filter(({ state }) => state === 'done').length,
    detail: waiting ? null : stageDetail(subject.processing, current?.key, subject.observedAt),
  }
}

/**
 * 실패 카드의 제목은 늘 「회의를 정리하지 못했어요」다. 안내 문구가 그 문장으로 시작하면 설명에서 빼고, 사유별 안내 문장은 남긴다.
 * `meetingFailure` 문구는 처리 화면·회의록도 쓰므로 거기서 바꾸지 않는다 (#424)
 */
function withoutTitleSentence(description: string): string {
  const repeated = `${PROCESSING_FAILED_TITLE}.`
  return description.startsWith(repeated) ? description.slice(repeated.length).trim() : description
}

/** 이 사람에게 보일 토스트. 보일 것이 없으면 null */
export function processingSignal(subject: ProcessingSubject, role: Role): ProcessingSignal | null {
  const view = VIEWS[role][subject.phase]
  if (view === null) return null
  switch (subject.phase) {
    case 'processing':
    case 'awaiting_speakers':
      if (view === 'speakers') return { kind: 'speakers', title: subject.title }
      return progressSignal(subject, view === 'waiting')
    case 'done':
      return { kind: 'done', title: subject.title }
    case 'failed':
      return {
        kind: 'failed',
        title: subject.title,
        description: withoutTitleSentence(meetingFailure(subject.failedStage).description),
      }
  }
}

/** 화면 읽기 프로그램에 알릴 문장. 단계가 바뀔 때만 달라진다 — 진행 수는 넣지 않는다 */
export function signalAnnouncement(signal: ProcessingSignal): string {
  switch (signal.kind) {
    case 'processing':
      return signal.sentence
    case 'speakers':
      return SPEAKERS_NEEDED_TITLE
    case 'done':
      return PROCESSING_DONE_TITLE
    case 'failed':
      return PROCESSING_FAILED_TITLE
  }
}
