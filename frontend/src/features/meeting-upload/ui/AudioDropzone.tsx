import { useRef, useState } from 'react'
import type { DragEvent, Ref } from 'react'
import { Icon } from '@/shared/ui/icon'
import { AUDIO_ACCEPT } from '../model/audioFile'

export interface AudioDropzoneProps {
  /** 끌어다 놓거나 고른 파일들. 여러 개도 그대로 넘긴다 — 판정은 받는 쪽이 한다 */
  onFiles: (files: File[]) => void
  disabled?: boolean
  /** `컴퓨터에서 찾기` 버튼. 파일 없이 제출하면 폼이 여기로 포커스를 옮긴다 */
  buttonRef?: Ref<HTMLButtonElement>
  /** 칸 아래 오류 문구의 id */
  errorId?: string
}

/* Upload 캔버스 실측. 끌어다 놓는 동안은 테두리만 먹으로 바꾼다 — 면·그림자는 바꾸지 않는다 */
const ZONE =
  'flex flex-col items-center gap-14 rounded-16 border bg-surface-sunken px-32 py-44 text-center'
const ZONE_IDLE = 'border-line'
const ZONE_DRAGGING = 'border-ink'
const ICON_BOX =
  'inline-flex h-48 w-48 items-center justify-center rounded-9 border border-input-border bg-surface text-sub'
const HEADLINE = 'text-[15px] font-semibold text-ink'
const SUBLINE = 'text-control font-normal text-dim'
const BROWSE =
  'cursor-pointer text-ink underline underline-offset-3 disabled:cursor-default disabled:text-faint'
const LIMITS = 'text-meta text-dim tabular-nums'

/**
 * 녹음 파일을 끌어다 놓는 칸과 `컴퓨터에서 찾기`. 키보드는 버튼으로 파일 선택 창을 연다.
 * 파일 입력은 화면에서 감춘다 — 버튼이 대신 연다. 같은 파일을 다시 골라도 바뀜이 오도록 값을 비운다.
 */
export function AudioDropzone({
  onFiles,
  disabled = false,
  buttonRef,
  errorId,
}: AudioDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!disabled) setDragging(true)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    onFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      data-testid="audio-dropzone"
      data-dragging={dragging || undefined}
      className={`${ZONE} ${dragging ? ZONE_DRAGGING : ZONE_IDLE}`}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <span className={ICON_BOX}>
        <Icon name="upload" size={22} />
      </span>
      <div className="flex flex-col items-center gap-5">
        <p className={HEADLINE}>파일을 여기로 끌어다 놓으세요</p>
        <p className={SUBLINE}>
          또는{' '}
          <button
            ref={buttonRef}
            type="button"
            className={BROWSE}
            disabled={disabled}
            aria-describedby={errorId}
            onClick={() => inputRef.current?.click()}
          >
            컴퓨터에서 찾기
          </button>
        </p>
      </div>
      <p className={LIMITS}>mp3 · wav · m4a · ogg · webm — 최대 200 MiB · 2시간</p>
      <input
        ref={inputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        aria-label="녹음 파일"
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
    </div>
  )
}
