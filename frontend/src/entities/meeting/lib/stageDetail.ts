import type { MeetingProcessing, ProcessingStage, SttProgress } from '../model/types'
import type { ProcessingStepKey } from './processingSteps'

/**
 * 화면 단계마다 그 단계에 속하는 서버 단계. 단계 판정(`progress`)이 데이터로 서버 단계보다 앞서 갔으면
 * 서버 단계가 화면의 지금 단계에 속하지 않는다 — 그때는 다른 단계의 경과를 붙이지 않는다
 */
const STEP_STAGES: Record<ProcessingStepKey, readonly ProcessingStage[]> = {
  queue: [],
  transcribe: ['stt'],
  collect: [],
  extract: ['sources', 'extract', 'handoff'],
}

/** 지금 단계 옆의 보조 표시. 둘 중 하나는 있다 */
export interface StageDetail {
  stt: SttProgress | null
  elapsedMinutes: number | null
}

/**
 * 처리 화면·진행 토스트의 지금 단계(`step`)에 붙일 진행 수와 경과 (#483). `now` 는 그 응답을 받은 시각이라
 * polling 이 멈추면 경과도 멈춘다. 클라이언트 시계가 서버보다 늦어 음수가 되면 막 시작한 것으로 본다
 */
export function stageDetail(
  processing: MeetingProcessing | null,
  step: ProcessingStepKey | undefined,
  now: number,
): StageDetail | null {
  if (processing?.stage == null || step === undefined) return null
  if (!STEP_STAGES[step].includes(processing.stage)) return null
  const stt = processing.stage === 'stt' ? processing.stt : null
  const startedAt = processing.stageAt === null ? Number.NaN : Date.parse(processing.stageAt)
  const elapsedMinutes = Number.isNaN(startedAt)
    ? null
    : Math.floor(Math.max(0, now - startedAt) / 60_000)
  if (stt === null && elapsedMinutes === null) return null
  return { stt, elapsedMinutes }
}

/** 진행 단위(트랙·STT 조각)를 아직 정하지 않아 단위를 말하지 않는다. 정하면 이 문구만 바꾼다 */
export function sttProgressText({ done, total }: SttProgress): { shown: string; spoken: string } {
  return { shown: `${done}/${total}`, spoken: `${total} 중 ${done} 완료` }
}

export function elapsedText(minutes: number): string {
  if (minutes < 1) return '방금 시작'
  if (minutes < 60) return `${minutes}분째`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}시간째` : `${hours}시간 ${rest}분째`
}
