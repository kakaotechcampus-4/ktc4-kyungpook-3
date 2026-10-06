import type { UploadPhase } from '../model/uploadPhase'

export interface UploadStatusProps {
  phase: UploadPhase | null
  /** 응답을 잃어 회의 목록을 다시 보는 중 */
  recovering?: boolean
}

const ROOT = 'flex flex-col gap-8'
const TEXT = 'text-body text-sub tabular-nums'
const TRACK = 'h-4 w-full overflow-hidden rounded-999 bg-control'
const FILL = 'h-full rounded-999 bg-ink'
/* 불확정 — 크기를 모르니 채움 폭이 뜻을 갖지 않는다. 트랙 전체를 옅은 면으로 둔다(전환 없음, design-system §5) */
const FILL_UNKNOWN = 'h-full w-full rounded-999 bg-line-strong'

/**
 * 전송률과 서버 단계를 나눠 보여 준다 (U3-7). 보내는 중은 진행 막대, 다 보낸 뒤에는 서버를 기다린다는 문구다.
 * 전체 크기를 모르면 막대에 값을 주지 않는다 — 스크린리더가 불확정 진행으로 읽는다.
 */
export function UploadStatus({ phase, recovering = false }: UploadStatusProps) {
  if (recovering) {
    return (
      <div role="status" className={ROOT}>
        <p className={TEXT}>올린 결과를 확인하고 있어요.</p>
      </div>
    )
  }
  if (phase === null) return null
  if (phase.kind === 'waiting') {
    return (
      <div role="status" className={ROOT}>
        <p className={TEXT}>파일을 다 보냈어요. 정리를 시작하는 중이에요.</p>
      </div>
    )
  }
  const { percent } = phase
  return (
    <div role="status" className={ROOT}>
      <p className={TEXT}>
        {percent === null ? '파일을 보내는 중이에요.' : `파일을 보내는 중이에요 · ${percent}%`}
      </p>
      <div
        role="progressbar"
        aria-label="파일 전송"
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent ?? undefined}
        className={TRACK}
      >
        {percent === null ? (
          <div className={FILL_UNKNOWN} />
        ) : (
          <div className={FILL} style={{ width: `${percent}%` }} />
        )}
      </div>
    </div>
  )
}
