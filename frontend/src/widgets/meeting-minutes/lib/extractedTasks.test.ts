import { toApproval } from '@/entities/approval'
import { toExtraction } from '@/entities/extraction'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ExtractionDto } from '@/shared/types/api/extraction'
import { extractedTasks } from './extractedTasks'

const ids = (items: readonly { id: string }[]) => items.map(({ id }) => id)

type EditStatus = 'pending' | 'approved' | 'rejected'

// 백엔드 수정 항목처럼 task_id 는 승인 전에도 수정 대상 태스크다. 반영 여부는 approval_status 로만 알 수 있다 (#419)
function withEditProposal(status: EditStatus): { dto: ExtractionDto; approval: ApprovalDto } {
  const dto = structuredClone(extractionFixtures[1])
  dto.items.push({
    ...structuredClone(dto.items[4]),
    item_id: 'it_08',
    task: { title: '로그인 API 연동', confidence: 0.9 },
    gate: 'review',
    task_id: 'tk_01',
    approval_id: 'ap_08',
    approval_status: status,
  })
  const approval: ApprovalDto = {
    approval_id: 'ap_08',
    workspace_id: 'ws_01',
    type: 'task_update',
    payload: {
      status: 'done',
      base_values: { status: 'todo' },
      base_title: '로그인 API 연동',
      task_title: '로그인 API 연동',
      extraction_item_id: 'it_08',
      meeting_id: 'mt_09',
      gate: 'review',
    },
    related_task_id: 'tk_01',
    requested_by: null,
    status,
    resolved_by: null,
    created_at: '2026-09-17T03:00:00Z',
    resolved_at: null,
  }
  return { dto, approval }
}

function openApprovals(...extra: ApprovalDto[]) {
  return [...approvalFixtures, ...extra]
    .filter(({ status }) => status === 'pending')
    .map(toApproval)
}

describe('extractedTasks (U5-5)', () => {
  it('반영은 태스크가 반영된 항목, 확인 필요는 대기 승인과 이어진 항목이다 — 빠진 값으로 이유를 만든다', () => {
    const extraction = toExtraction(extractionFixtures[1])
    const { applied, pending } = extractedTasks(extraction, approvalFixtures.map(toApproval))

    expect(ids(applied)).toEqual(['it_01', 'it_02', 'it_03'])
    expect(pending?.map(({ item, approvalId, reason }) => [item.id, approvalId, reason])).toEqual([
      ['it_04', 'ap_01', '담당자와 마감을 정해야 해요'],
      ['it_05', 'ap_02', '마감을 정해야 해요'],
      ['it_06', 'ap_03', '담당자를 정해야 해요'],
    ])
  })

  it('승인된 생성 항목은 반영에만 한 번 있고, 반려된 항목은 어디에도 없다', () => {
    const dto = structuredClone(extractionFixtures[1])
    // 승인: 백엔드는 task_id 를 채우고 approval_id 를 비우지 않는다 (계약 §4.0-②-12)
    Object.assign(
      dto.items.find(({ item_id }) => item_id === 'it_05')!,
      {
        task_id: 'tk_90',
        approval_status: 'approved',
      },
    )
    // 반려: task_id 는 그대로 비어 있다
    dto.items.find(({ item_id }) => item_id === 'it_06')!.approval_status = 'rejected'
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

  describe('수정 제안 (#419)', () => {
    it('승인 대기면 대상 태스크가 있어도 확인 필요에 있고 반영에는 없다', () => {
      const { dto, approval } = withEditProposal('pending')

      const { applied, pending } = extractedTasks(toExtraction(dto), openApprovals(approval))

      expect(ids(applied)).not.toContain('it_08')
      expect(
        pending?.map(({ item, approvalId, reason }) => [item.id, approvalId, reason]),
      ).toContainEqual(['it_08', 'ap_08', '내용을 확인해야 해요'])
    })

    it('반려되면 반영에도 확인 필요에도 없다', () => {
      const { dto, approval } = withEditProposal('rejected')

      const { applied, pending } = extractedTasks(toExtraction(dto), openApprovals(approval))

      expect(ids(applied)).not.toContain('it_08')
      expect(pending?.map(({ item }) => item.id)).not.toContain('it_08')
    })

    it('반려 뒤 대기 목록이 아직 갱신되지 않았어도 확인 필요에 남지 않는다', () => {
      const { dto, approval } = withEditProposal('rejected')
      const stale = openApprovals({ ...approval, status: 'pending' })

      const { applied, pending } = extractedTasks(toExtraction(dto), stale)

      expect(ids(applied)).not.toContain('it_08')
      expect(pending?.map(({ item }) => item.id)).toEqual(['it_04', 'it_05', 'it_06'])
    })

    it('승인되면 반영으로 옮겨 간다', () => {
      const { dto, approval } = withEditProposal('approved')

      const { applied, pending } = extractedTasks(toExtraction(dto), openApprovals(approval))

      expect(ids(applied)).toEqual(['it_01', 'it_02', 'it_03', 'it_08'])
      expect(pending?.map(({ item }) => item.id)).not.toContain('it_08')
    })

    it('일반 팀원에게 승인 대기 수정 제안을 반영으로 보이지 않는다', () => {
      const { dto } = withEditProposal('pending')

      const { applied } = extractedTasks(toExtraction(dto), null)

      expect(ids(applied)).toEqual(['it_01', 'it_02', 'it_03'])
    })
  })
})
