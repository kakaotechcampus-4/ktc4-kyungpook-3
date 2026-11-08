import type { MeetingProgress, MeetingSource, MeetingStatus } from '../model/types'

export type ProcessingStepState = 'done' | 'current' | 'waiting'

export type ProcessingStepKey = 'queue' | 'transcribe' | 'collect' | 'extract'

export interface ProcessingStep {
  key: ProcessingStepKey
  label: string
  state: ProcessingStepState
}

/**
 * 단계와 그 단계를 끝냈다고 보는 `progress` 값(계약 §2.3). 마지막 단계는 `progress` 로 끝내지 않는다 —
 * 서버는 AI 가 넘기기(handoff)를 알릴 때 `extracted` 를 참으로 만들지만, 회의는 `done` 이 될 때까지 아직 정리 중이다 (#483).
 * 캔버스의 네 단계·단계별 소요 시간·경과 시간은 서버가 주지 않아 만들지 않는다 (U4-4)
 */
type StepDefinition = {
  key: ProcessingStepKey
  label: string
  doneWhen: keyof MeetingProgress | null
}

const EXTRACT: StepDefinition = {
  key: 'extract',
  label: '결정사항과 할 일 뽑아내기',
  doneWhen: null,
}

/** 녹음·업로드 회의. AI 가 stt 를 알리면 `audio_merged`, 발화를 저장(sources)하면 `transcribed` 가 참이다 */
const RECORDING_STEPS: readonly StepDefinition[] = [
  { key: 'queue', label: '차례 기다리는 중', doneWhen: 'audioMerged' },
  { key: 'transcribe', label: '음성을 텍스트로 옮기기', doneWhen: 'transcribed' },
  EXTRACT,
]

/** 채팅 회의. 채팅 수집은 단계를 알리지 않는다 — 발화를 저장하면 서버가 앞 두 값을 함께 참으로 만든다 */
const CHAT_STEPS: readonly StepDefinition[] = [
  { key: 'collect', label: '대화 모으기', doneWhen: 'transcribed' },
  EXTRACT,
]

/**
 * 처리 화면·진행 토스트의 단계 표시. 끝난 단계는 `done`, 정리 중이면 끝나지 않은 첫 단계가 `current` 다.
 * 백분율·남은 시간은 계산하지 않는다 — 서버 값이 아닌 숫자를 만들지 않는다.
 * 출처를 모르면 부르지 않는다 — 단계 수가 출처마다 달라 짐작하면 나중에 바뀐다(`useMeetingSources`). `progress` 가 없으면(옛 응답) 모두 아직이다.
 * 완료 회의는 모든 단계가 끝났다
 */
export function processingSteps(
  progress: MeetingProgress | null,
  status: MeetingStatus,
  source: MeetingSource,
): ProcessingStep[] {
  let currentTaken = status !== 'processing'
  return (source === 'chat' ? CHAT_STEPS : RECORDING_STEPS).map(({ key, label, doneWhen }) => {
    if (status === 'done' || (doneWhen !== null && progress?.[doneWhen] === true))
      return { key, label, state: 'done' }
    if (!currentTaken) {
      currentTaken = true
      return { key, label, state: 'current' }
    }
    return { key, label, state: 'waiting' }
  })
}
