import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { checkAudioDuration, checkAudioFiles } from './audioFile'
import type { AudioRejection } from './audioFile'
import { readAudioDuration } from './audioDuration'

/**
 * 고른 녹음 파일. 원본 `File` 은 이 컴포넌트 상태에만 있다 — store·Web Storage 에 두지 않는다 (G5).
 * - `checking`: 형식·크기는 통과했고 길이를 읽는 중
 * - `ready`: 올릴 수 있다
 * - `rejected`: 받지 않았다. 파일이 여럿이었으면 `file` 이 null 이다
 */
export type AudioSelection =
  | { kind: 'empty' }
  | { kind: 'checking'; file: File }
  | { kind: 'ready'; file: File; durationMs: number }
  | { kind: 'rejected'; file: File | null; reason: AudioRejection }

export interface AudioSelectionHandle {
  selection: AudioSelection
  /** 고르거나 끌어다 놓은 파일들. 비었으면(선택 창 취소) 아무것도 바꾸지 않는다 */
  select: (files: readonly File[]) => void
  /** 파일을 뺀다. 읽던 길이 결과는 버린다 */
  clear: () => void
}

/**
 * 파일 하나를 검사해 받는다. 형식·크기는 바로, 길이는 브라우저가 읽은 뒤 판정한다.
 * 읽는 사이에 다른 파일로 바꾸면 앞 파일의 결과는 버린다 — 늦게 끝난 앞 판정이 새 파일을 덮지 않는다.
 * `onReady` 는 파일을 받을 때 한 번 부른다. 폼이 제목·날짜 기본값을 그 파일로 바꾼다 (U3-5).
 */
export function useAudioSelection(onReady: (file: File) => void): AudioSelectionHandle {
  const [selection, setSelection] = useState<AudioSelection>({ kind: 'empty' })
  const ticket = useRef(0)
  const onReadyRef = useRef(onReady)
  useLayoutEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  const select = useCallback((files: readonly File[]) => {
    const check = checkAudioFiles(files)
    if (check === null) return
    ticket.current += 1
    const mine = ticket.current
    if (!check.ok) {
      setSelection({
        kind: 'rejected',
        file: files.length === 1 ? files[0] : null,
        reason: check.reason,
      })
      return
    }
    const { file } = check
    setSelection({ kind: 'checking', file })
    void readAudioDuration(file).then((durationMs) => {
      if (mine !== ticket.current) return
      const rejection = checkAudioDuration(durationMs)
      if (rejection !== null || durationMs === null) {
        setSelection({ kind: 'rejected', file, reason: rejection ?? 'unreadable' })
        return
      }
      setSelection({ kind: 'ready', file, durationMs })
      onReadyRef.current(file)
    })
  }, [])

  const clear = useCallback(() => {
    ticket.current += 1
    setSelection({ kind: 'empty' })
  }, [])

  return { selection, select, clear }
}

/** 고른 파일. 받지 않은 여러 파일이면 null */
export function selectedFile(selection: AudioSelection): File | null {
  return selection.kind === 'empty' ? null : selection.file
}
