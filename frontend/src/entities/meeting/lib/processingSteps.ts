import type {
  MeetingProcessing,
  MeetingProgress,
  MeetingSource,
  MeetingStatus,
  ProcessingStage,
} from '../model/types'

export type ProcessingStepState = 'done' | 'current' | 'waiting'

export type ProcessingStepKey =
  'queue' | 'transcribe' | 'collect' | 'organize' | 'extract' | 'deliver'

export interface ProcessingStep {
  key: ProcessingStepKey
  label: string
  state: ProcessingStepState
  /** 이 단계에 속하는 서버 단계. 지금 단계의 진행 수·경과는 서버 단계가 여기 있을 때만 붙인다(`stageDetail`) */
  stages: readonly ProcessingStage[]
}

/**
 * 단계와 그 단계를 끝냈다고 보는 `progress` 값(계약 §2.3). 마지막 단계는 `progress` 로 끝내지 않는다 —
 * 서버는 AI 가 넘기기(handoff)를 알릴 때 `extracted` 를 참으로 만들지만, 회의는 `done` 이 될 때까지 아직 정리 중이다 (#483).
 * 단계별 소요 시간·백분율은 서버가 주지 않아 만들지 않는다 (U4-4)
 */
type StepDefinition = {
  key: ProcessingStepKey
  label: string
  stages: readonly ProcessingStage[]
  doneWhen: keyof MeetingProgress | null
}

const QUEUE: StepDefinition = {
  key: 'queue',
  label: '차례 기다리는 중',
  stages: [],
  doneWhen: 'audioMerged',
}
const TRANSCRIBE: StepDefinition = {
  key: 'transcribe',
  label: '음성을 텍스트로 옮기기',
  stages: ['stt'],
  doneWhen: 'transcribed',
}
const EXTRACT_LABEL = '결정사항과 할 일 뽑아내기'
/** 서버 단계를 나눠 보이지 않는 목록의 마지막 단계. sources·extract·handoff 가 모두 여기 속한다 */
const WHOLE_EXTRACT: StepDefinition = {
  key: 'extract',
  label: EXTRACT_LABEL,
  stages: ['sources', 'extract', 'handoff'],
  doneWhen: null,
}

/**
 * 서버가 처리 단계를 알리는 녹음·업로드 회의. 서버 단계와 1:1 이라 단계가 바뀌면 화면 단계도 바뀌고, 경과는 그 단계 기준이다.
 * `progress` 는 서버 `_compute_progress` 처럼 stage 순위(stt 1, sources 2, extract 3, handoff 4)와 같은 자리에서 참이 된다
 */
const STAGED_RECORDING_STEPS: readonly StepDefinition[] = [
  QUEUE,
  TRANSCRIBE,
  { key: 'organize', label: '회의록 정리하기', stages: ['sources'], doneWhen: 'extracted' },
  { key: 'extract', label: EXTRACT_LABEL, stages: ['extract'], doneWhen: 'extracted' },
  { key: 'deliver', label: '정리 결과 보내기', stages: ['handoff'], doneWhen: null },
]

/** `processing` 을 주지 않는 #542 전 서버. `progress` 만으로는 sources·extract·handoff 를 가를 수 없어 한 단계다 */
const LEGACY_RECORDING_STEPS: readonly StepDefinition[] = [QUEUE, TRANSCRIBE, WHOLE_EXTRACT]

/** 채팅 회의. 채팅 수집은 단계를 알리지 않는다 — 발화를 저장하면 서버가 앞 두 값을 함께 참으로 만든다 */
const CHAT_STEPS: readonly StepDefinition[] = [
  { key: 'collect', label: '대화 모으기', stages: [], doneWhen: 'transcribed' },
  WHOLE_EXTRACT,
]

/**
 * 단계 목록과 단계 판정에 쓸 서버 단계. 채팅 회의는 `processing` 을 단계 판정에 쓰지 않는다.
 * 녹음 회의는 유효한 `processing` 이 있으면(보고 전 stage null 포함) 다섯 단계다 — 보고 전을 세 단계로 두면 첫 보고 때 목록이 바뀐다.
 * 화자 지정 대기도 다섯 단계다 — 서버는 정리 중일 때만 `processing` 을 줘서, 세 단계로 두면 대기를 오갈 때 목록이 바뀐다.
 * 모르는 stage 는 매퍼가 `processing` 째 null 로 내려 세 단계가 된다
 */
function stepList(
  source: MeetingSource,
  status: MeetingStatus,
  processing: MeetingProcessing | null,
): { definitions: readonly StepDefinition[]; stage: ProcessingStage | null } {
  if (source === 'chat') return { definitions: CHAT_STEPS, stage: null }
  if (status === 'awaiting_speakers') return { definitions: STAGED_RECORDING_STEPS, stage: null }
  if (processing === null) return { definitions: LEGACY_RECORDING_STEPS, stage: null }
  return { definitions: STAGED_RECORDING_STEPS, stage: processing.stage }
}

/**
 * 처리 화면·진행 토스트의 단계 표시. 지금 단계는 서버 단계와 `progress` 중 더 앞선 쪽이다 — 데이터가 이미 있으면 단계 보고가
 * 늦어도 그쪽을 믿는다. 그 앞은 끝났고, 정리 중이면 그 단계가 `current` 다.
 * 백분율·남은 시간은 계산하지 않는다 — 서버 값이 아닌 숫자를 만들지 않는다.
 * 출처를 모르면 부르지 않는다 — 단계 수가 출처마다 달라 짐작하면 나중에 바뀐다(`useMeetingSources`). `progress` 가 없으면(옛 응답) 모두 아직이다.
 * 완료 회의는 모든 단계가 끝났다
 */
export function processingSteps(
  progress: MeetingProgress | null,
  status: MeetingStatus,
  source: MeetingSource,
  processing: MeetingProcessing | null,
): ProcessingStep[] {
  const { definitions, stage } = stepList(source, status, processing)
  const stageRank = definitions.findIndex(({ stages }) => stage !== null && stages.includes(stage))
  const progressRank = definitions.reduce(
    (rank, { doneWhen }, index) =>
      doneWhen !== null && progress?.[doneWhen] === true ? index + 1 : rank,
    0,
  )
  const rank = Math.max(stageRank, progressRank)
  return definitions.map(({ key, label, stages }, index) => {
    const state: ProcessingStepState =
      status === 'done' || index < rank
        ? 'done'
        : index === rank && status === 'processing'
          ? 'current'
          : 'waiting'
    return { key, label, state, stages }
  })
}
