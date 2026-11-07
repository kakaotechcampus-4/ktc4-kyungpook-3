import { http } from 'msw'
import { ApiError, createClientError, CLIENT_ERROR_CODES } from '@/shared/api/errors'
import { fail } from '@/shared/mock/envelope'
import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import { server } from '@/shared/mock/server'
import { toExtraction } from '../model/mapper'
import { revertAutoItem, toAutoItemRevertRejection } from './revertAutoItem'

function conflict(details: Record<string, unknown> | null): ApiError {
  return new ApiError({ code: 'AUTO_TASK_NOT_REVERTIBLE', message: 'x', details }, 409)
}

describe('revertAutoItem', () => {
  it('본문 없이 POST 하고 응답을 도메인 값으로 바꾼다', async () => {
    await expect(revertAutoItem('ex_01', 'it_01')).resolves.toEqual({
      itemId: 'it_01',
      revertedTaskId: 'tk_01',
      approvalId: 'ap_90',
      revertedAt: expect.any(String) as string,
    })
  })

  it('경로 칸을 인코딩한다', async () => {
    let seen = ''
    server.use(
      http.post('/api/v1/extractions/:extractionId/items/:itemId/revert', ({ request }) => {
        seen = new URL(request.url).pathname
        return fail('EXTRACTION_NOT_FOUND', 'x', 404)
      }),
    )
    await expect(revertAutoItem('ex/1', 'it 1')).rejects.toBeInstanceOf(ApiError)
    expect(seen).toBe('/api/v1/extractions/ex%2F1/items/it%201/revert')
  })
})

describe('toAutoItemRevertRejection', () => {
  it.each([
    ['task_changed', { task_id: 'tk_01', task_version: 3 }, { taskId: 'tk_01', approvalId: null }],
    [
      'pending_approval',
      { task_id: 'tk_02', approval_id: 'ap_05' },
      { taskId: 'tk_02', approvalId: 'ap_05' },
    ],
    ['already_reverted', {}, { taskId: null, approvalId: null }],
    ['not_auto_created', {}, { taskId: null, approvalId: null }],
    ['task_missing', { task_id: 'tk_09' }, { taskId: 'tk_09', approvalId: null }],
  ])('%s', (reason, extra, expected) => {
    expect(toAutoItemRevertRejection(conflict({ item_id: 'it_01', reason, ...extra }))).toEqual({
      reason,
      ...expected,
    })
  })

  it('모르는 사유·빈 details 는 unknown 이다', () => {
    expect(toAutoItemRevertRejection(conflict({ reason: 'future' }))?.reason).toBe('unknown')
    expect(toAutoItemRevertRejection(conflict(null))?.reason).toBe('unknown')
  })

  it('다른 실패는 거절이 아니다', () => {
    expect(
      toAutoItemRevertRejection(
        new ApiError({ code: 'FORBIDDEN', message: 'x', details: null }, 403),
      ),
    ).toBeNull()
    expect(
      toAutoItemRevertRejection(
        new ApiError({ code: 'APPROVAL_CONFLICT', message: 'x', details: null }, 409),
      ),
    ).toBeNull()
    expect(
      toAutoItemRevertRejection(createClientError(CLIENT_ERROR_CODES.NETWORK_ERROR)),
    ).toBeNull()
    expect(toAutoItemRevertRejection(new Error('x'))).toBeNull()
  })
})

describe('추출 매퍼 — 되돌림 필드', () => {
  it('reverted_at·approval_status 를 옮긴다', () => {
    const dto = structuredClone(extractionFixtures[1])
    Object.assign(dto.items[0], {
      task_id: null,
      approval_id: 'ap_90',
      approval_status: 'pending',
      reverted_at: '2026-09-18T00:00:00Z',
    })
    expect(toExtraction(dto).items[0]).toMatchObject({
      gate: 'auto',
      appliedTaskId: null,
      approvalId: 'ap_90',
      approvalStatus: 'pending',
      revertedAt: '2026-09-18T00:00:00Z',
    })
  })

  it('필드가 없던 응답과 모르는 승인 상태는 null 로 둔다', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const dto = structuredClone(extractionFixtures[1]) as unknown as {
        items: Record<string, unknown>[]
      }
      delete dto.items[0].reverted_at
      delete dto.items[0].approval_status
      dto.items[3].approval_status = 'future'
      const items = toExtraction(dto as never).items
      expect(items[0]).toMatchObject({ revertedAt: null, approvalStatus: null })
      expect(items[3].approvalStatus).toBeNull()
      expect(warning).toHaveBeenCalled()
    } finally {
      warning.mockRestore()
    }
  })
})
