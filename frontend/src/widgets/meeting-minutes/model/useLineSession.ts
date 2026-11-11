import { useRef, useState } from 'react'
import type { TranscriptLine } from '@/entities/minutes'
import type { EditActions } from '@/features/minutes-edit'
import { guardLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes'

/** 지금 고치는 줄 하나. 열 때마다 `id` 가 바뀌어, 같은 줄을 다시 열어도 앞의 고치기와 구별된다 */
interface LineSession {
  id: number
  seq: number
  draft: string
}

type LineEdit = EditActions<{ seq: number; text: string | null }>

/**
 * 전사문에서 어느 줄을 고치는지와 그 초안을 한 곳에서 쥔다 (#551, D-192).
 * - 다른 줄을 열기 전에, 바꾼 초안이 있으면 이탈 확인을 거친다
 * - 저장·취소의 닫기는 그 고치기가 아직 열려 있을 때만 닫는다. 늦게 끝난 앞 줄의 저장이 새로 연 줄을 닫지 않는다
 * - 원문으로 되돌리기는 그 줄의 고치기를 먼저 닫는다. 바꾼 초안이 있으면 묻고, 남은 초안이 되돌린 문장을 다시 덮지 않는다
 * 늦게 끝나는 콜백이 지금 값을 읽도록 렌더 값과 같은 것을 ref 에도 둔다
 */
export function useLineSession(transcript: readonly TranscriptLine[], edit: LineEdit) {
  const [session, setSession] = useState<LineSession | null>(null)
  const current = useRef<LineSession | null>(null)
  const lastId = useRef(0)
  const set = (next: LineSession | null) => {
    current.current = next
    setSession(next)
  }
  const textOf = (seq: number) => transcript.find((line) => line.seq === seq)?.text ?? ''
  const dirty = session !== null && session.draft !== textOf(session.seq)
  useUnsavedChanges(dirty)

  return {
    draftOf: (seq: number | null) =>
      session !== null && session.seq === seq ? session.draft : null,
    open: (seq: number) =>
      guardLeave(() => {
        lastId.current += 1
        set({ id: lastId.current, seq, draft: textOf(seq) })
      }),
    /** 지금 열린 고치기에 묶인 닫기. 그 사이 다른 고치기가 열렸으면 아무것도 하지 않고 false */
    closerOf: (seq: number | null) => {
      const id = session !== null && session.seq === seq ? session.id : null
      return () => {
        if (id === null || current.current?.id !== id) return false
        set(null)
        return true
      }
    },
    setDraft: (draft: string) => {
      if (current.current !== null) set({ ...current.current, draft })
    },
    revert: (seq: number, done: (idle: boolean) => void) => {
      const run = () => {
        if (current.current?.seq === seq) set(null)
        edit.save({ seq, text: null }, () => done(current.current === null))
      }
      if (session?.seq === seq && dirty) guardLeave(run)
      else run()
    },
  }
}
