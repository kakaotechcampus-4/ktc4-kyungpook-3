import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest } from './api'

it('fetch 를 직접 부르지 않고 공통 클라이언트를 탄다', async () => {
  const spy = vi.spyOn(globalThis, 'fetch')
  try {
    await fetchDto('/workspaces')
    expect(spy).not.toHaveBeenCalled()
  } finally {
    spy.mockRestore()
  }
})

it('204 를 undefined 로 받는다 — 빈 본문을 JSON 으로 읽지 않는다', async () => {
  await expect(
    fetchDto('/workspaces/ws_01/integrations/discord', { method: 'DELETE' }),
  ).resolves.toBeUndefined()
})

it('오류를 공통 클라이언트와 같은 ApiError 로 던진다', async () => {
  const error = await fetchDto(
    '/approvals/ap_01',
    jsonRequest('PATCH', { status: 'approved' }),
  ).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ kind: 'http', code: 'INVALID_REQUEST', status: 400 })
})
