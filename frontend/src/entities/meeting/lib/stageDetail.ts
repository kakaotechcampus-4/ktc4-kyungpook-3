import type { MeetingProcessing, SttProgress } from '../model/types'
import type { ProcessingStep } from './processingSteps'

/** 지금 단계 옆의 보조 표시. 둘 중 하나는 있다 */
export interface StageDetail {
  stt: SttProgress | null
  elapsedMinutes: number | null
}

/**
 * 처리 화면·진행 토스트의 지금 단계(`step`)에 붙일 진행 수와 경과 (#483). 서버 단계가 지금 단계에 속할 때만이다 — 단계 판정이
 * `progress` 로 서버 단계보다 앞서 갔으면 다른 단계의 경과를 붙이지 않는다. `now` 는 그 응답을 받은 시각이라
 * polling 이 멈추면 경과도 멈춘다. 클라이언트 시계가 서버보다 늦어 음수가 되면 막 시작한 것으로 본다
 */
export function stageDetail(
  processing: MeetingProcessing | null,
  step: Pick<ProcessingStep, 'stages'> | undefined,
  now: number,
): StageDetail | null {
  if (processing?.stage == null || step === undefined) return null
  if (!step.stages.includes(processing.stage)) return null
  const stt = processing.stage === 'stt' ? processing.stt : null
  const startedAt = processing.stageAt === null ? Number.NaN : Date.parse(processing.stageAt)
  const elapsedMinutes = Number.isNaN(startedAt)
    ? null
    : Math.floor(Math.max(0, now - startedAt) / 60_000)
  if (stt === null && elapsedMinutes === null) return null
  return { stt, elapsedMinutes }
}

/** 단위는 전사를 끝낸 입력 음성 트랙 수다(AI #653). 무음·실패 트랙도 끝난 것으로 세어 성공률이 아니다 */
export function sttProgressText({ done, total }: SttProgress): { shown: string; spoken: string } {
  return { shown: `음성 트랙 ${done}/${total}`, spoken: `음성 트랙 ${total}개 중 ${done}개 완료` }
}

export function elapsedText(minutes: number): string {
  if (minutes < 1) return '방금 시작'
  if (minutes < 60) return `${minutes}분째`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}시간째` : `${hours}시간 ${rest}분째`
}
