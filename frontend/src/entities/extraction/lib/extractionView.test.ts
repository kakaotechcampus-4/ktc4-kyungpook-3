import { toExtraction } from '../model/mapper'
import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import { appliedItems, isUnresolved, pendingItems, visibleItems } from './extractionView'

const allOpen = new Set(['ap_01', 'ap_02', 'ap_03'])

it('removes pending approval items entirely for members who cannot review', () => {
  const extraction = toExtraction(extractionFixtures[1])
  expect(appliedItems(extraction).map(({ id }) => id)).toEqual(['it_01', 'it_02', 'it_03'])
  expect(pendingItems(extraction, allOpen).map(({ id }) => id)).toEqual(['it_04', 'it_05', 'it_06'])
  expect(visibleItems(extraction, false).map(({ id }) => id)).toEqual(['it_01', 'it_02', 'it_03'])
  expect(visibleItems(extraction, true)).toHaveLength(6)
})

// 백엔드는 승인을 반영할 때 task_id 만 채우고 approval_id 를 비우지 않는다 (계약 §4.0-②-12).
// approvalId 만 보면 그 항목이 확인 필요에 영원히 남고, D-104 로 일반 팀원에게 계속 숨겨진다
it('treats an approved item as applied even though the backend leaves approval_id set', () => {
  const dto = structuredClone(extractionFixtures[1])
  const resolved = dto.items.find(({ item_id }) => item_id === 'it_04')
  expect(resolved?.approval_id).not.toBeNull()
  resolved!.task_id = 'tk_90' // 승인 반영. approval_id 는 그대로 남는다

  const extraction = toExtraction(dto)
  expect(appliedItems(extraction).map(({ id }) => id)).toContain('it_04')
  // 승인이 닫혔으니 열린 목록에서도 빠진다
  expect(pendingItems(extraction, new Set(['ap_02', 'ap_03'])).map(({ id }) => id)).toEqual([
    'it_05',
    'it_06',
  ])
  // 일반 팀원에게도 보여야 한다 — 이제 확인이 끝난 항목이다
  expect(visibleItems(extraction, false).map(({ id }) => id)).toContain('it_04')
})

// 반려는 extraction_item 을 전혀 건드리지 않는다. 대기 중인 항목과 응답이 완전히 같아서
// isUnresolved 로는 구분되지 않고, 열린 승인 목록과 조인해야만 빠진다 (계약 §3.1)
it('drops a rejected item from the pending list although the item itself never changes', () => {
  const extraction = toExtraction(extractionFixtures[1])
  const rejected = extraction.items.find(({ approvalId }) => approvalId === 'ap_01')!

  // 항목만 보면 대기 중인 것과 구분되지 않는다
  expect(isUnresolved(rejected)).toBe(true)
  expect(rejected.appliedTaskId).toBeNull()

  // ap_01 이 반려돼 열린 목록에서 빠지면 확인 필요에서도 빠진다
  const open = new Set(['ap_02', 'ap_03'])
  expect(pendingItems(extraction, open).map(({ id }) => id)).not.toContain(rejected.id)
  expect(pendingItems(extraction, open).map(({ id }) => id)).toEqual(['it_05', 'it_06'])

  // 일반 팀원에게는 여전히 숨긴다 — 반려됐으니 보여줄 태스크가 없다
  expect(visibleItems(extraction, false).map(({ id }) => id)).not.toContain(rejected.id)
})
