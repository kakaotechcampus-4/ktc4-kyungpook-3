import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ExtractionDto } from '@/shared/types/api/extraction'
import { toExtraction } from './model/mapper'
import { appliedItems, pendingItems, visibleItems } from './lib/extractionView'

it('maps the six gated items without inventing pending tasks', async () => {
  const extraction = toExtraction(await fetchDto<ExtractionDto>('/extractions/ex_01'))
  expect(extraction.items.map(({ appliedTaskId }) => appliedTaskId).filter(Boolean)).toEqual([
    'tk_01',
    'tk_02',
    'tk_03',
  ])
  expect(extraction.items.map(({ approvalId }) => approvalId).filter(Boolean)).toEqual([
    'ap_01',
    'ap_02',
    'ap_03',
  ])
  expect(toExtraction(await fetchDto<ExtractionDto>('/extractions/ex_00')).items).toEqual([])
  await expect(fetchDto('/extractions/missing')).rejects.toMatchObject({
    code: 'EXTRACTION_NOT_FOUND',
    status: 404,
  })
})

// 승인을 반영하면 백엔드가 이 항목의 task_id 를 채우되 approval_id 는 비우지 않는다
// (계약 §3.1, §4.0-②-12). 그 상태에서도 화면이 반영됨으로 읽고 일반 팀원에게 보여야 한다
it('moves an approved item out of the pending list even though approval_id stays set', async () => {
  const before = toExtraction(await fetchDto<ExtractionDto>('/extractions/ex_01'))
  const target = before.items.find(({ approvalId }) => approvalId === 'ap_01')!
  expect(target.appliedTaskId).toBeNull()
  expect(visibleItems(before, false).map(({ id }) => id)).not.toContain(target.id)

  await fetchDto(
    '/approvals/ap_01',
    jsonRequest('PATCH', { status: 'approved', resolved_by: 'mb_01' }),
  )

  const after = toExtraction(await fetchDto<ExtractionDto>('/extractions/ex_01'))
  const applied = after.items.find(({ id }) => id === target.id)!
  expect(applied.appliedTaskId).toBe('tk_90')
  expect(applied.approvalId).toBe('ap_01') // 실 백엔드와 같게 비우지 않는다

  expect(appliedItems(after).map(({ id }) => id)).toContain(applied.id)
  expect(pendingItems(after, await openApprovalIds()).map(({ id }) => id)).not.toContain(applied.id)
  expect(visibleItems(after, false).map(({ id }) => id)).toContain(applied.id)
})

/** PM 화면이 만드는 것과 같다 — GET /approvals?status=pending 의 ID 집합 */
async function openApprovalIds(): Promise<ReadonlySet<string>> {
  const pending = await fetchDto<ListDto<ApprovalDto>>(
    '/approvals?workspace_id=ws_01&status=pending',
  )
  return new Set(pending.items.map(({ approval_id }) => approval_id))
}

// 반려는 extraction_item 을 전혀 건드리지 않는다. 항목만 보면 대기와 구분되지 않고,
// 열린 승인 목록과 조인해야만 확인 필요에서 빠진다 (계약 §3.1, §4.0-②-12)
it('drops a rejected item from the pending list even though the item never changes', async () => {
  await fetchDto(
    '/approvals/ap_01',
    jsonRequest('PATCH', { status: 'rejected', resolved_by: 'mb_01' }),
  )

  const extraction = toExtraction(await fetchDto<ExtractionDto>('/extractions/ex_01'))
  const rejected = extraction.items.find(({ approvalId }) => approvalId === 'ap_01')!
  expect(rejected.appliedTaskId).toBeNull() // 반려는 태스크를 만들지 않는다

  expect(pendingItems(extraction, await openApprovalIds()).map(({ id }) => id)).not.toContain(
    rejected.id,
  )
  // 일반 팀원에게는 계속 숨긴다 — 보여줄 태스크가 없다
  expect(visibleItems(extraction, false).map(({ id }) => id)).not.toContain(rejected.id)
})
