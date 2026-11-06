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
  // 승인 반영. approval_id 는 그대로 남고 approval_status 가 approved 가 된다
  Object.assign(resolved!, { task_id: 'tk_90', approval_status: 'approved' })

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

// 반려는 extraction_item 을 건드리지 않는다. 응답에서는 approval_status 만 rejected 로 바뀐다
it('drops a rejected item from the pending list and keeps it hidden from members', () => {
  const dto = structuredClone(extractionFixtures[1])
  dto.items.find(({ approval_id }) => approval_id === 'ap_01')!.approval_status = 'rejected'
  const extraction = toExtraction(dto)
  const rejected = extraction.items.find(({ approvalId }) => approvalId === 'ap_01')!

  expect(isUnresolved(rejected)).toBe(true)
  expect(rejected.appliedTaskId).toBeNull()

  // ap_01 이 반려돼 열린 목록에서 빠지면 확인 필요에서도 빠진다
  const open = new Set(['ap_02', 'ap_03'])
  expect(pendingItems(extraction, open).map(({ id }) => id)).not.toContain(rejected.id)
  expect(pendingItems(extraction, open).map(({ id }) => id)).toEqual(['it_05', 'it_06'])

  // 일반 팀원에게는 여전히 숨긴다 — 반려됐으니 보여줄 태스크가 없다
  expect(visibleItems(extraction, false).map(({ id }) => id)).not.toContain(rejected.id)
})

// 수정 항목은 승인 전에도 task_id 가 수정 대상 태스크다. 반영 여부는 approval_status 로 본다 (#419)
describe('edit proposal', () => {
  function withEdit(status: 'pending' | 'approved' | 'rejected') {
    const dto = structuredClone(extractionFixtures[1])
    dto.items.push({
      ...structuredClone(dto.items[4]),
      item_id: 'it_08',
      gate: 'review',
      task_id: 'tk_01',
      approval_id: 'ap_08',
      approval_status: status,
    })
    return toExtraction(dto)
  }
  const open = new Set([...allOpen, 'ap_08'])

  it('is pending, not applied, and hidden from members while its approval waits', () => {
    const extraction = withEdit('pending')

    expect(appliedItems(extraction).map(({ id }) => id)).not.toContain('it_08')
    expect(pendingItems(extraction, open).map(({ id }) => id)).toContain('it_08')
    expect(visibleItems(extraction, false).map(({ id }) => id)).not.toContain('it_08')
    expect(visibleItems(extraction, true).map(({ id }) => id)).toContain('it_08')
  })

  it('is neither applied nor pending once rejected', () => {
    const extraction = withEdit('rejected')

    expect(appliedItems(extraction).map(({ id }) => id)).not.toContain('it_08')
    expect(pendingItems(extraction, allOpen).map(({ id }) => id)).not.toContain('it_08')
    expect(visibleItems(extraction, false).map(({ id }) => id)).not.toContain('it_08')
  })

  // 반려 뒤 추출만 다시 받고 대기 목록 재조회가 늦거나 실패하면 그 ID 가 남아 있다
  it('stays out of the pending list once rejected even if a stale pending list still has its approval', () => {
    const extraction = withEdit('rejected')

    expect(pendingItems(extraction, open).map(({ id }) => id)).not.toContain('it_08')
  })

  it('is applied and visible to members once approved', () => {
    const extraction = withEdit('approved')

    expect(appliedItems(extraction).map(({ id }) => id)).toContain('it_08')
    expect(pendingItems(extraction, open).map(({ id }) => id)).not.toContain('it_08')
    expect(visibleItems(extraction, false).map(({ id }) => id)).toContain('it_08')
  })
})
