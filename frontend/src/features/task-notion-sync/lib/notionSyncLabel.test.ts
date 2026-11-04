import type { Task } from '@/entities/task'
import { notionSyncRefetchInterval } from '../model/useTaskNotionSync'
import { NOTION_SYNC_POLL_MS, notionSyncLabel } from './notionSyncLabel'

describe('Notion 반영 문구는 상태만 따른다 (계획 §4-7)', () => {
  it.each([
    ['pending', '반영 중'],
    ['synced', '반영됨'],
    ['failed', '반영 실패'],
    [null, '반영 상태 없음'],
  ] as const)('%s → %s', (status, label) => {
    expect(notionSyncLabel(status)).toBe(label)
  })
})

describe('반영 중 polling 간격 (계획 §4-8, #236)', () => {
  const task = (notionSyncStatus: Task['notionSyncStatus']) => ({ notionSyncStatus }) as Task
  const failure = new Error('boom')

  it('조회가 ready 이면서 pending 인 동안만 3초다', () => {
    expect(NOTION_SYNC_POLL_MS).toBe(3_000)
    expect(notionSyncRefetchInterval({ state: { data: task('pending'), error: null } })).toBe(3_000)
  })

  it.each([['synced'], ['failed'], [null]] as const)('%s 이면 멈춘다', (status) => {
    expect(notionSyncRefetchInterval({ state: { data: task(status), error: null } })).toBe(false)
  })

  it('loading·error·refreshFailed 면 멈춘다 — 이전 데이터가 pending 이어도', () => {
    expect(notionSyncRefetchInterval({ state: { data: undefined, error: null } })).toBe(false)
    expect(notionSyncRefetchInterval({ state: { data: undefined, error: failure } })).toBe(false)
    expect(notionSyncRefetchInterval({ state: { data: task('pending'), error: failure } })).toBe(
      false,
    )
  })
})
