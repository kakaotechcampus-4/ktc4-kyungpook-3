import type { MockInstance } from 'vitest'
import { z } from 'zod'
import { errorMessage } from './errorMessages'
import { ApiError } from './errors'
import { formatResponsePath, parseResponse } from './parseResponse'
import { isRetryableError } from './queryClient'

const schema = z.object({
  items: z.array(
    z.object({ id: z.string(), status: z.enum(['todo', 'done']), version: z.number().int() }),
  ),
})

function caught(run: () => unknown): ApiError {
  try {
    run()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('did not throw')
}

let warning: MockInstance<typeof console.warn>
beforeEach(() => {
  warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warning.mockRestore())

it('정상 응답은 스키마가 읽은 값을 돌려주고 경고하지 않는다', () => {
  const data = { items: [{ id: 'a', status: 'todo', version: 1, extra: true }] }
  expect(parseResponse(schema, data, 'task')).toEqual({
    items: [{ id: 'a', status: 'todo', version: 1 }],
  })
  expect(warning).not.toHaveBeenCalled()
})

it.each([
  ['필수 필드 누락', { items: [{ id: 'a', status: 'todo' }] }, 'items[0].version'],
  ['타입 오류', { items: [{ id: 'a', status: 'todo', version: 1.5 }] }, 'items[0].version'],
  [
    '목록 한 건의 모르는 상태',
    {
      items: [
        { id: 'a', status: 'todo', version: 1 },
        { id: 'b', status: 'future', version: 1 },
      ],
    },
    'items[1].status',
  ],
  ['응답 전체가 다른 모양', null, ''],
])('%s는 entity 와 필드 경로를 담은 INVALID_RESPONSE 다', (_, data, path) => {
  const error = caught(() => parseResponse(schema, data, 'task'))
  expect(error).toMatchObject({
    kind: 'invalid_response',
    code: 'INVALID_RESPONSE',
    status: 0,
    details: { entity: 'task', path },
  })
  expect(errorMessage(error)).toBe('응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.')
  expect(isRetryableError(error)).toBe(false)
})

it('오류의 메시지와 details 에는 받은 값이 없고, 개발 모드 경고에만 경로와 값이 있다', () => {
  const data = { items: [{ id: 'a', status: 'secret-status', version: 1 }] }
  const error = caught(() => parseResponse(schema, data, 'task'))
  expect(JSON.stringify([error.message, error.details])).not.toContain('secret-status')
  expect(warning).toHaveBeenCalledTimes(1)
  expect(warning.mock.calls[0]).toEqual([
    'Invalid task response',
    [expect.objectContaining({ path: 'items[0].status', value: 'secret-status' })],
  ])
})

it('경로는 배열 칸을 대괄호로, 객체 칸을 점으로 잇는다', () => {
  expect(formatResponsePath(['items', 3, 'changes', 0, 'field'])).toBe('items[3].changes[0].field')
  expect(formatResponsePath([2, 'id'])).toBe('[2].id')
  expect(formatResponsePath([])).toBe('')
})
