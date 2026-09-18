import { fetchDto } from '@/shared/test/api'
import type { ExtractionDto } from '@/shared/types/api/extraction'
import { toExtraction } from './model/mapper'

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
