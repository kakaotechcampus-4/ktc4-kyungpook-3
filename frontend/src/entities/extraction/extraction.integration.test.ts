import { fetchDto, jsonRequest } from '@/shared/test/api'
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
  expect(pendingItems(after).map(({ id }) => id)).not.toContain(applied.id)
  expect(visibleItems(after, false).map(({ id }) => id)).toContain(applied.id)
})
