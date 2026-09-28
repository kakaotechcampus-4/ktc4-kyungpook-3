import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import { toExtraction } from './mapper'

it('maps gates and exclusive identifiers with raw assignee fallback', () => {
  const extraction = toExtraction(extractionFixtures[1])
  expect(extraction).toMatchObject({ id: 'ex_01', meetingId: 'mt_09' })
  expect(extraction.items[0]).toMatchObject({
    id: 'it_01',
    assigneeMemberId: 'mb_01',
    assigneeLabel: '김서연',
    appliedTaskId: 'tk_01',
    approvalId: null,
    evidence: { atMs: 125000 },
  })
  expect(extraction.items[3]).toMatchObject({
    gate: 'hold',
    assigneeMemberId: null,
    assigneeLabel: '민수',
    appliedTaskId: null,
    approvalId: 'ap_01',
    dueDate: null,
  })
  for (const item of extraction.items) {
    expect(item.appliedTaskId !== null).toBe(item.gate === 'auto')
    expect(item.approvalId !== null).toBe(item.gate !== 'auto')
  }
})

it('preserves absent evidence and falls back when assignee names and raw are absent', () => {
  const dto = structuredClone(extractionFixtures[1])
  dto.items[0].assignee = {
    raw: null,
    member_id: null,
    display_name: null,
    confidence: 0,
    needs_check: true,
  }
  dto.items[0].evidence = { quote: null, speaker: null, at_ms: null }
  expect(toExtraction(dto).items[0]).toMatchObject({
    assigneeLabel: '',
    evidence: { quote: null, speaker: null, atMs: null },
  })
})

it('uses a conservative unknown gate fallback with a development warning', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const dto = structuredClone(extractionFixtures[1])
    dto.items[0].gate = 'future'
    expect(toExtraction(dto).items[0].gate).toBe('hold')
    expect(warning).toHaveBeenCalled()
  } finally {
    warning.mockRestore()
  }
})
