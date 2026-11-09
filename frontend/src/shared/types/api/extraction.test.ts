import { ApiError } from '@/shared/api/errors'
import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import { applyScenario } from '@/shared/mock/scenarios'
import { fetchDto } from '@/shared/test/api'
import {
  autoTaskNotRevertibleDetailsSchema,
  extractionItemRevertSchema,
  extractionSchema,
} from './extraction'

const extraction = extractionFixtures[1]
const item = extraction.items[0]
const withItem = (patch: Record<string, unknown>) => ({
  ...extraction,
  items: [{ ...item, ...patch }],
})

describe('추출 스키마', () => {
  it('확신도·needs_check·별칭 후보는 화면이 읽지 않아 보지 않는다. 서버가 null 확신도를 줘도 읽는다', () => {
    const parsed = extractionSchema.parse(
      withItem({
        confidence: null,
        task: { title: item.task.title, confidence: null },
        alias_candidate: 'no',
      }),
    )
    expect(parsed.items[0]).not.toHaveProperty('confidence')
    expect(parsed.items[0]).not.toHaveProperty('alias_candidate')
  })

  it('모르는 판단·승인 상태는 거절하지 않는다. mapper 가 보수 폴백으로 읽는다', () => {
    expect(
      extractionSchema.safeParse(withItem({ gate: 'later', approval_status: 'expired' })).success,
    ).toBe(true)
  })

  it('reverted_at·approval_status 가 빠진 옛 응답도 읽는다', () => {
    const legacy: Partial<typeof item> = { ...item }
    delete legacy.reverted_at
    delete legacy.approval_status
    expect(extractionSchema.safeParse({ ...extraction, items: [legacy] }).success).toBe(true)
  })

  it.each([
    ['null 판단', { gate: null }],
    ['숫자 승인 상태', { approval_status: 1 }],
    ['제목이 없는 할 일', { task: {} }],
    ['글자가 아닌 근거 시각', { evidence: { ...item.evidence, at_ms: '00:12' } }],
    ['담당자 누락', { assignee: undefined }],
  ])('%s 항목은 읽지 않는다', (_, patch) => {
    const result = extractionSchema.safeParse(withItem(patch))
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path.slice(0, 2)).toEqual(['items', 0])
  })
})

describe('되돌리기 409 details', () => {
  it('사유가 글자가 아니거나 ID 모양이 틀리면 없는 것으로 읽는다', () => {
    expect(
      autoTaskNotRevertibleDetailsSchema.parse({ reason: 3, task_id: 7, approval_id: 'ap_05' }),
    ).toEqual({ reason: '', task_id: undefined, approval_id: 'ap_05' })
  })
})

describe('MSW 픽스처가 같은 스키마를 따른다', () => {
  it('추출 픽스처', () => {
    for (const fixture of extractionFixtures) extractionSchema.parse(fixture)
  })

  it('handler 의 되돌리기 응답과 409 details', async () => {
    applyScenario('dashboard-revert-rejected')
    const path = (itemId: string) => `/extractions/ex_01/items/${itemId}/revert`
    extractionItemRevertSchema.parse(await fetchDto(path('it_03'), { method: 'POST' }))

    const rejected = await fetchDto(path('it_02'), { method: 'POST' }).catch((error: unknown) => {
      if (error instanceof ApiError) return error
      throw error
    })
    expect(rejected).toBeInstanceOf(ApiError)
    expect(autoTaskNotRevertibleDetailsSchema.parse((rejected as ApiError).details)).toEqual({
      reason: 'pending_approval',
      task_id: 'tk_02',
      approval_id: 'ap_05',
    })
    extractionSchema.parse(await fetchDto('/extractions/ex_01'))
  })
})
