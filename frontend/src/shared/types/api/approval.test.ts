import { ApiError } from '@/shared/api/errors'
import { approvalFixtures } from '@/shared/mock/fixtures/approval'
import { applyScenario } from '@/shared/mock/scenarios'
import type { MockScenario } from '@/shared/mock/scenarios'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import {
  approvalAlreadyResolvedDetailsSchema,
  approvalChangedDetailsSchema,
  approvalConflictDetailsSchema,
  approvalListSchema,
  approvalSchema,
} from './approval'

const valid = approvalFixtures[0]

describe('승인 스키마', () => {
  it('서버가 덧붙인 모르는 필드는 버리고, payload 의 모르는 키는 남긴다', () => {
    const parsed = approvalSchema.parse({
      ...valid,
      total: 3,
      payload: { ...valid.payload, future_key: 1 },
    })
    expect(parsed).not.toHaveProperty('total')
    expect(parsed.payload.future_key).toBe(1)
  })

  it('payload_version·alias_candidate·alias_text 가 빠진 옛 응답도 읽는다', () => {
    const legacy: Partial<typeof valid> = { ...valid }
    delete legacy.payload_version
    delete legacy.alias_candidate
    delete legacy.alias_text
    expect(approvalSchema.safeParse(legacy).success).toBe(true)
  })

  it('모르는 종류는 거절하지 않는다. 화면이 지원하지 않는 요청으로 읽는다', () => {
    expect(approvalSchema.safeParse({ ...valid, type: 'future_kind' }).success).toBe(true)
  })

  it.each([
    ['모르는 상태', { status: 'archived' }],
    ['null 상태', { status: null }],
    ['문자열 별칭 후보 여부', { alias_candidate: 'true' }],
    ['숫자 지문', { payload_version: 7 }],
    ['배열 payload', { payload: [] }],
    ['필수 필드 누락', { created_at: undefined }],
  ])('%s 는 읽지 않는다', (_, patch) => {
    expect(approvalSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  it.each([
    ['null 보완 값', null],
    ['null 제목', { task_title: null }],
    ['숫자 담당자', { assignee_member_id: 1 }],
    ['불리언 마감', { due_date: false }],
    ['null 상태', { status: null }],
    ['모르는 상태', { status: 'invalid' }],
    ['숫자 마감', { due_date: 2 }],
  ])('저장된 보완 값(task_overrides)이 %s 면 읽지 않는다', (_, overrides) => {
    const result = approvalSchema.safeParse({
      ...valid,
      payload: { ...valid.payload, task_overrides: overrides },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path.slice(0, 2)).toEqual(['payload', 'task_overrides'])
  })

  it.each([
    ['배열이 아닌 합쳐진 항목', { merged_items: 'it_21' }],
    ['객체가 아닌 합쳐진 항목', { merged_items: ['it_21'] }],
    ['숫자 담당 항목', { assignee_item_id: 21 }],
  ])('%s 는 읽지 않는다 (#512)', (_, patch) => {
    expect(
      approvalSchema.safeParse({ ...valid, payload: { ...valid.payload, ...patch } }).success,
    ).toBe(false)
  })

  describe('전사 오인식 의심은 표시만 하므로 응답을 막지 않는다 (#643, D-184)', () => {
    const parse = (patch: Record<string, unknown>) =>
      approvalSchema.parse({ ...valid, payload: { ...valid.payload, ...patch } }).payload
        .asr_suspects

    it('항목의 글자·출처·후보를 읽고, 후보가 없으면 빈 목록이다', () => {
      expect(
        parse({
          asr_suspects: [
            { word: '애포', source: 'title', candidates: ['배포'] },
            { word: '', source: 'check_failed' },
          ],
        }),
      ).toEqual([
        { word: '애포', source: 'title', candidates: ['배포'] },
        { word: '', source: 'check_failed', candidates: [] },
      ])
    })

    it('null·빈 목록은 그대로, 키가 없으면 없다', () => {
      expect(parse({ asr_suspects: null })).toBeNull()
      expect(parse({ asr_suspects: [] })).toEqual([])
      const payload: Record<string, unknown> = { ...valid.payload }
      delete payload.asr_suspects
      expect(approvalSchema.parse({ ...valid, payload }).payload).not.toHaveProperty('asr_suspects')
    })

    it.each([
      ['글자', 'misheard'],
      ['숫자', 3],
      ['객체', { word: '애포' }],
    ])('목록이 아닌 %s 값은 null 로 읽는다', (_, value) => {
      expect(parse({ asr_suspects: value })).toBeNull()
    })

    it('모양이 틀린 항목만 null 이 되고 나머지는 읽는다', () => {
      expect(
        parse({
          asr_suspects: [
            { word: 3, source: 'title', candidates: [] },
            'oops',
            { word: '애포', source: 'evidence', candidates: ['배포', 2] },
          ],
        }),
      ).toEqual([null, null, { word: '애포', source: 'evidence', candidates: [] }])
    })
  })

  it('합쳐진 항목이 없거나 null 이면 합쳐지지 않은 카드로 읽는다', () => {
    expect(approvalSchema.safeParse({ ...valid, payload: { merged_items: null } }).success).toBe(
      true,
    )
  })
})

describe('승인 처리 409 details', () => {
  const conflict = {
    approval_id: 'ap_04',
    task_id: 'tk_01',
    task_version: 2,
    conflicts: [{ field: 'status', base: 'todo', current: 'blocked', proposed: 'done' }],
  }

  it.each([
    ['정수가 아닌 버전', { task_version: 2.5 }],
    ['0 버전', { task_version: 0 }],
    ['field 없는 항목', { conflicts: [{ base: 1, current: 2, proposed: 3 }] }],
    ['current 없는 항목', { conflicts: [{ field: 'status', base: 1, proposed: 3 }] }],
  ])('충돌 details 가 %s 면 읽지 않는다', (_, patch) => {
    expect(approvalConflictDetailsSchema.safeParse({ ...conflict, ...patch }).success).toBe(false)
  })

  it('비교한 값이 null 이어도 충돌 항목이다', () => {
    expect(
      approvalConflictDetailsSchema.safeParse({
        ...conflict,
        conflicts: [{ field: 'due_date', base: null, current: null, proposed: '2026-10-01' }],
      }).success,
    ).toBe(true)
  })
})

/** handler 의 409 를 받아 details 를 돌려준다 */
async function failure(path: string, body: unknown): Promise<{ code: string; details: unknown }> {
  try {
    await fetchDto(path, jsonRequest('PATCH', body))
  } catch (error) {
    if (error instanceof ApiError) return { code: error.code, details: error.details }
    throw error
  }
  throw new Error(`${path} did not fail`)
}

describe('MSW 픽스처가 같은 스키마를 따른다', () => {
  it('승인 픽스처', () => {
    for (const approval of approvalFixtures) expect(approvalSchema.parse(approval)).toBeDefined()
  })

  it.each<MockScenario | null>([
    null,
    'approval-needs-input',
    'approval-resolved',
    'approval-rejected',
    'approval-conflict',
    'approval-scope',
    'approval-chat',
    'approval-merged',
    'reply-judgment',
  ])('%s 상태에서 handler 가 내는 목록·상세', async (scenario) => {
    if (scenario !== null) applyScenario(scenario)
    const pending = approvalListSchema.parse(
      await fetchDto('/approvals', { params: { workspace_id: 'ws_01', status: 'pending' } }),
    )
    const all = approvalListSchema.parse(
      await fetchDto('/approvals', { params: { workspace_id: 'ws_01' } }),
    )
    expect(all.items.length).toBeGreaterThanOrEqual(pending.items.length)
    for (const { approval_id } of all.items)
      approvalSchema.parse(await fetchDto(`/approvals/${approval_id}`))
  })

  it('handler 가 승인·반려에 돌려주는 승인', async () => {
    approvalSchema.parse(
      await fetchDto('/approvals/ap_01', jsonRequest('PATCH', { status: 'approved' })),
    )
    approvalSchema.parse(
      await fetchDto('/approvals/ap_02', jsonRequest('PATCH', { status: 'rejected' })),
    )
  })

  it('handler 의 409 충돌·바뀜·이미 처리됨 details', async () => {
    applyScenario('approval-conflict')
    const conflict = await failure('/approvals/ap_04', { status: 'approved' })
    expect(conflict.code).toBe('APPROVAL_CONFLICT')
    approvalConflictDetailsSchema.parse(conflict.details)

    applyScenario('approval-merged-after-view')
    const seen = approvalSchema.parse(await fetchDto('/approvals/ap_03')).payload_version
    const changed = await failure('/approvals/ap_03', { status: 'rejected', payload_version: seen })
    expect(changed.code).toBe('APPROVAL_CHANGED')
    approvalChangedDetailsSchema.parse(changed.details)

    await fetchDto('/approvals/ap_01', jsonRequest('PATCH', { status: 'rejected' }))
    const resolved = await failure('/approvals/ap_01', { status: 'rejected' })
    expect(resolved.code).toBe('APPROVAL_ALREADY_RESOLVED')
    approvalAlreadyResolvedDetailsSchema.parse(resolved.details)
  })
})
