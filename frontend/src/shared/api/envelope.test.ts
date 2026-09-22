import { unwrap } from './envelope'
import { ApiError } from './errors'

it('성공 봉투의 데이터를 반환한다', () => {
  expect(unwrap({ data: { items: [], total: 0 }, error: null }, 200)).toEqual({
    items: [],
    total: 0,
  })
})

it('오류 코드와 HTTP 상태, 상세 정보를 보존한다', () => {
  try {
    unwrap(
      {
        data: null,
        error: {
          code: 'TASK_NOT_FOUND',
          message: '태스크가 없습니다.',
          details: { task_id: 'missing' },
        },
      },
      404,
    )
    expect.unreachable('오류 봉투는 예외를 던져야 한다')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      code: 'TASK_NOT_FOUND',
      status: 404,
      details: { task_id: 'missing' },
    })
  }
})
