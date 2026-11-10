import { elapsedText, sttProgressText } from '../lib/stageDetail'
import type { StageDetail } from '../lib/stageDetail'

/** 지금 단계의 `3/5 · 4분째`. 화면 읽기 프로그램은 `5 중 3 완료, 4분째` 로 읽는다 (#483) */
export function StageDetailText({
  detail,
  className,
}: {
  detail: StageDetail
  className?: string
}) {
  const progress = detail.stt === null ? null : sttProgressText(detail.stt)
  return (
    <span className={className}>
      {progress === null ? null : (
        <>
          <span aria-hidden="true">{progress.shown}</span>
          <span className="sr-only">{progress.spoken}</span>
        </>
      )}
      {progress !== null && detail.elapsedMinutes !== null ? (
        <>
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
        </>
      ) : null}
      {detail.elapsedMinutes === null ? null : elapsedText(detail.elapsedMinutes)}
    </span>
  )
}
