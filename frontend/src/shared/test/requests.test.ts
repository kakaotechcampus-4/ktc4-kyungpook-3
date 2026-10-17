import { db } from '@/shared/mock/db'
import { isDashboardRequest, latestDoneExtractionId } from './requests'

/* E-05 — 대시보드 요청 판별이 최신 완료 회의의 추출만 인정한다. 다른 회의·공간의 추출 조회 회귀를 숨기지 않는다 */

const get = (path: string) => ({ method: 'GET', path })

it('최신 완료 회의의 추출 ID 를 모의 db 에서 읽는다 — 정리 중 회의는 아니다', () => {
  // 픽스처의 ws_01: mt_10 정리 중, mt_09(ex_01)·mt_07(ex_00) 완료
  expect(latestDoneExtractionId()).toBe('ex_01')
  db.meetings = db.meetings.filter(({ meeting_id }) => meeting_id !== 'mt_09')
  expect(latestDoneExtractionId()).toBe('ex_00')
  expect(latestDoneExtractionId('ws_02')).toBeNull()
})

it('넘긴 추출 ID 의 조회만 대시보드 요청이다', () => {
  const scope = { extractionId: 'ex_01' }
  expect(isDashboardRequest(get('/extractions/ex_01'), scope)).toBe(true)
  expect(isDashboardRequest(get('/extractions/ex_00'), scope)).toBe(false)
  expect(isDashboardRequest(get('/extractions/ex_01/items/it_01/revert'), scope)).toBe(false)
  expect(isDashboardRequest({ method: 'POST', path: '/extractions/ex_01' }, scope)).toBe(false)
})

it('추출 ID 를 넘기지 않으면 어떤 추출 조회도 대시보드 요청이 아니다', () => {
  expect(isDashboardRequest(get('/extractions/ex_01'))).toBe(false)
  expect(isDashboardRequest(get('/extractions/ex_01'), { extractionId: null })).toBe(false)
})

it('공간 기본값은 ws_01 이고, 다른 공간의 목록 조회는 그 공간을 넘길 때만 인정한다', () => {
  expect(isDashboardRequest(get('/tasks?workspace_id=ws_01'))).toBe(true)
  expect(isDashboardRequest(get('/tasks?workspace_id=ws_04'))).toBe(false)
  expect(isDashboardRequest(get('/tasks?workspace_id=ws_04'), { workspaceId: 'ws_04' })).toBe(true)
  for (const path of [
    '/approvals?workspace_id=ws_01&status=pending',
    '/members?workspace_id=ws_01',
    '/workspaces/ws_01/integrations',
  ])
    expect(isDashboardRequest(get(path))).toBe(true)
})
