import { fetchDto } from '@/shared/test/api'
import { db, resetDb } from './db'
import { restoreDb, saveDb } from './persistence'
import { setMockRole } from './sessions'

it.each([undefined, false])('삭제 준비가 확인되지 않은 회의는 직접 요청도 거절한다 (%s)', async (available) => {
  const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_09')
  if (!meeting) throw new Error('meeting fixture is missing')
  meeting.deletion_available = available
  const before = structuredClone(db.meetings)
  await expect(fetchDto('/meetings/mt_09', { method: 'DELETE' })).rejects.toMatchObject({
    status: 409,
    code: 'MEETING_LINEAGE_UNVERIFIED',
  })
  expect(db.meetings).toEqual(before)
  expect(db.meetingDeletions).toEqual([])
})

it('삭제는 같은 receipt를 반환하며 새로고침 후에도 원문은 410, 태스크는 남는다', async () => {
  const before = structuredClone(db.tasks)
  const receipt = await fetchDto('/meetings/mt_09', { method: 'DELETE' })
  expect(await fetchDto('/meetings/mt_09', { method: 'DELETE' })).toEqual(receipt)
  expect(await fetchDto('/meetings/mt_09/deletion')).toEqual(receipt)
  saveDb(sessionStorage)
  resetDb()
  expect(restoreDb(sessionStorage)).toBe(true)
  expect(db.tasks).toEqual(before)
  await expect(fetchDto('/meetings/mt_09/minutes')).rejects.toMatchObject({
    status: 410,
    code: 'MEETING_DELETED',
  })
  const task = await fetchDto<{ meeting_id: string; meeting_deleted: boolean }>('/tasks/tk_01')
  expect(task).toMatchObject({ meeting_id: 'mt_09', meeting_deleted: true })
  sessionStorage.clear()
})

it('정리 중 회의는 409로 거절하고 상태를 변경하지 않는다', async () => {
  await expect(fetchDto('/meetings/mt_10', { method: 'DELETE' })).rejects.toMatchObject({
    status: 409,
    code: 'MEETING_DELETE_BLOCKED',
    details: { status: 'processing' },
  })
  expect(db.meetingDeletions).toEqual([])
  expect(db.meetings.some(({ meeting_id }) => meeting_id === 'mt_10')).toBe(true)
})

it('팀원의 직접 DELETE는 403이고 없는 ID는 404다', async () => {
  setMockRole('member', 'ws_01')
  await expect(fetchDto('/meetings/mt_09', { method: 'DELETE' })).rejects.toMatchObject({
    status: 403,
  })
  await expect(fetchDto('/meetings/absent', { method: 'DELETE' })).rejects.toMatchObject({
    status: 404,
  })
  expect(db.meetingDeletions).toEqual([])
})
