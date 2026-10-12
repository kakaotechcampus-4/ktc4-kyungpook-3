import { toApproval } from '@/entities/approval'
import { toExtraction } from '@/entities/extraction'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import { extractedTasks } from './extractedTasks'

const ids = (items: readonly { id: string }[]) => items.map(({ id }) => id)

describe('extractedTasks (U5-5)', () => {
  it('반영은 task_id 가 있는 항목, 확인 필요는 대기 승인과 이어진 항목이다 — 빠진 값으로 이유를 만든다', () => {
    const extraction = toExtraction(extractionFixtures[1])
    const { applied, pending } = extractedTasks(extraction, approvalFixtures.map(toApproval))

    expect(ids(applied)).toEqual(['it_01', 'it_02', 'it_03'])
    expect(pending?.map(({ item, approvalId, reason }) => [item.id, approvalId, reason])).toEqual([
      ['it_04', 'ap_01', '담당자와 마감을 정해야 해요'],
      ['it_05', 'ap_02', '마감을 정해야 해요'],
      ['it_06', 'ap_03', '담당자를 정해야 해요'],
    ])
  })

  it('승인된 항목은 반영에만 한 번 있고, 반려된 항목은 어디에도 없다', () => {
    const dto = structuredClone(extractionFixtures[1])
    // 승인: 백엔드는 task_id 를 채우고 approval_id 를 비우지 않는다 (계약 §4.0-②-12)
    dto.items.find(({ item_id }) => item_id === 'it_05')!.task_id = 'tk_90'
    // 반려: 항목은 그대로다. 대기 목록에서만 빠진다
    const open = approvalFixtures
      .filter(({ approval_id }) => approval_id === 'ap_01')
      .map(toApproval)

    const { applied, pending } = extractedTasks(toExtraction(dto), open)

    expect(ids(applied)).toEqual(['it_01', 'it_02', 'it_03', 'it_05'])
    expect(pending?.map(({ item }) => item.id)).toEqual(['it_04'])
    const shown = [...ids(applied), ...(pending ?? []).map(({ item }) => item.id)]
    expect(shown.filter((id) => id === 'it_05')).toHaveLength(1)
    expect(shown).not.toContain('it_06')
  })

  it('승인 목록이 없으면(일반 팀원) 확인 필요를 만들지 않는다', () => {
    const { applied, pending } = extractedTasks(toExtraction(extractionFixtures[1]), null)

    expect(ids(applied)).toEqual(['it_01', 'it_02', 'it_03'])
    expect(pending).toBeNull()
  })
})
