import { TIME_PASSED_LOCK } from '@/features/message-action'
import { NO_DRAFT, liveDraft, lockReason, normalizeNote } from './reviewDraft'

it('열린 것이 있으면 그 이유로 잠그고, 없을 때만 지난 시각의 잠금 이유를 쓴다', () => {
  expect(lockReason(NO_DRAFT, false)).toBeNull()
  expect(lockReason(NO_DRAFT, true)).toBe(TIME_PASSED_LOCK)
  expect(lockReason({ kind: 'note', reminderId: 'rm_02' }, true)).toBe(
    '고친 메모를 저장하거나 취소한 뒤에 보낼 수 있어요.',
  )
  expect(lockReason({ kind: 'remove', reminderId: 'rm_02' }, false)).toBe(
    '태스크를 뺄지 정한 뒤에 보낼 수 있어요.',
  )
})

it('다시 받은 묶음에 없는 태스크의 메모·빼기는 닫힌 것으로 본다', () => {
  const note = { kind: 'note', reminderId: 'rm_02' } as const
  expect(liveDraft(note, ['rm_02', 'rm_03'])).toBe(note)
  expect(liveDraft(note, ['rm_03'])).toBe(NO_DRAFT)
  expect(liveDraft({ kind: 'body' }, [])).toEqual({ kind: 'body' })
})

it('메모는 앞뒤 공백을 떼고, 비면 지운다(null)', () => {
  expect(normalizeNote('  시안 3차  ')).toBe('시안 3차')
  expect(normalizeNote('   ')).toBeNull()
})
