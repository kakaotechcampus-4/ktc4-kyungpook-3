import { meetingFailure, processingSteps } from '@/entities/meeting'
import type { MeetingProgress, ProcessingStep, ProcessingStepState } from '@/entities/meeting'
import type { Role } from '@/shared/types/common'
import { PROCESSING_DONE_TITLE, PROCESSING_FAILED_TITLE, SPEAKERS_NEEDED_TITLE } from './notices'

/** 진행 토스트가 보는 회의 하나. 정리 중·대기는 상세 캐시에서, 완료·실패는 끝난 결과 기록에서 온다 (#424) */
export type ProcessingSubject =
  | { phase: 'processing' | 'awaiting_speakers'; title: string; progress: MeetingProgress | null }
  | { phase: 'done'; title: string }
  | { phase: 'failed'; title: string; failedStage: string | null }

type Phase = ProcessingSubject['phase']

export type ProcessingSignal =
  | {
      kind: 'processing'
      title: string
      sentence: string
      steps: ProcessingStepState[]
      doneCount: number
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

/** 처리 화면의 단계와 같은 순서다. 지금 단계가 없는 정리 중(옛 응답·세 단계 모두 끝)은 마지막 단계 문장이다 */
const STAGE_SENTENCES: Record<ProcessingStep['key'], string> = {
  audioMerged: '음성 파일을 준비하고 있어요',
  transcribed: '음성을 텍스트로 옮기고 있어요',
  extracted: '결정사항과 할 일을 뽑고 있어요',
}

const WAITING_SENTENCE = '화자 지정을 기다리고 있어요'

function progressSignal(
  subject: Extract<ProcessingSubject, { phase: 'processing' | 'awaiting_speakers' }>,
  waiting: boolean,
): ProcessingSignal {
  const steps = processingSteps(subject.progress, subject.phase)
  const current = steps.find(({ state }) => state === 'current')
  return {
    kind: 'processing',
    title: subject.title,
    sentence: waiting ? WAITING_SENTENCE : STAGE_SENTENCES[current?.key ?? 'extracted'],
    steps: steps.map(({ state }) => state),
    doneCount: steps.filter(({ state }) => state === 'done').length,
  }
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
        description: meetingFailure(subject.failedStage).description,
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
