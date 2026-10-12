import type { MeetingProgress, MeetingStatus } from '../model/types'

export type ProcessingStepState = 'done' | 'current' | 'waiting'

export interface ProcessingStep {
  key: keyof MeetingProgress
  label: string
  state: ProcessingStepState
}

/**
 * 서버의 `progress` 세 값 순서 그대로다 (계약 §2.3). 화면 단계는 이 셋뿐이다 —
 * 캔버스의 네 단계·단계별 소요 시간·경과 시간은 서버가 주지 않아 만들지 않는다 (U4-4)
 */
const STEPS: readonly { key: keyof MeetingProgress; label: string }[] = [
  { key: 'audioMerged', label: '음성 파일 준비하기' },
  { key: 'transcribed', label: '음성을 텍스트로 옮기기' },
  { key: 'extracted', label: '결정사항과 할 일 뽑아내기' },
]

export const PROCESSING_STEP_COUNT = STEPS.length

/**
 * 처리 화면의 단계 표시. 끝난 단계는 `done`, 정리 중이면 끝나지 않은 첫 단계가 `current` 다.
 * 백분율·남은 시간은 계산하지 않는다 — 서버 값이 아닌 숫자를 만들지 않는다.
 * `progress` 가 없으면(옛 응답) 모두 아직이다. 완료 회의는 세 단계 모두 끝난 것으로 본다.
 */
export function processingSteps(
  progress: MeetingProgress | null,
  status: MeetingStatus,
): ProcessingStep[] {
  let currentTaken = status !== 'processing'
  return STEPS.map(({ key, label }) => {
    if (status === 'done' || progress?.[key] === true) return { key, label, state: 'done' }
    if (!currentTaken) {
      currentTaken = true
      return { key, label, state: 'current' }
    }
    return { key, label, state: 'waiting' }
  })
}
