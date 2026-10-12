import { Icon } from '@/shared/ui/icon'
import { formatAudioDuration, formatAudioSize } from '../lib/formatAudio'
import type { AudioSelection } from '../model/useAudioSelection'

export interface SelectedAudioProps {
  selection: Exclude<AudioSelection, { kind: 'empty' }> & { file: File }
  onRemove: () => void
  disabled?: boolean
}

/* Upload 캔버스의 고른 파일 카드. 지금 봐야 하는 카드라 강조 테두리 한 겹이다 */
const CARD = 'flex items-center gap-14 rounded-16 border border-line-strong bg-surface px-18 py-15'
const ICON_BOX =
  'inline-flex h-36 w-36 shrink-0 items-center justify-center rounded-10 bg-surface-sunken text-ink'
const NAME = 'text-body font-semibold break-all text-ink'
const META = 'text-meta text-dim tabular-nums'
const REMOVE =
  'inline-flex h-36 w-36 shrink-0 items-center justify-center rounded-9 text-dim hover:bg-control disabled:text-line-strong'

function metaOf(selection: SelectedAudioProps['selection']): string {
  const size = formatAudioSize(selection.file.size)
  switch (selection.kind) {
    case 'checking':
      return `${size} · 길이를 확인하고 있어요`
    case 'ready':
      return `${formatAudioDuration(selection.durationMs)} · ${size}`
    case 'rejected':
      return size
  }
}

/** 고른 파일 한 줄. 이름·길이·크기와 `파일 제거` */
export function SelectedAudio({ selection, onRemove, disabled = false }: SelectedAudioProps) {
  return (
    <div className={CARD}>
      <span className={ICON_BOX}>
        <Icon name="mic" size={18} />
      </span>
      <div className="flex min-w-[0px] flex-1 flex-col gap-3">
        <span className={NAME}>{selection.file.name}</span>
        <span className={META}>{metaOf(selection)}</span>
      </div>
      <button
        type="button"
        aria-label="파일 제거"
        className={REMOVE}
        disabled={disabled}
        onClick={onRemove}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}
