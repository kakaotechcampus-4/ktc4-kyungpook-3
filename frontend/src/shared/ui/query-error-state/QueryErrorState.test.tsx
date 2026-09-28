import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError, CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import { QueryErrorState } from './QueryErrorState'

describe('QueryErrorState', () => {
  it('오류 코드 문구와 다시 시도를 보여 준다 — 서버 message 는 숨긴다', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <QueryErrorState
        error={
          new ApiError(
            { code: 'FORBIDDEN', message: 'Forbidden: member check failed', details: null },
            403,
          )
        }
        onRetry={onRetry}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('정보를 불러오지 못했어요')
    expect(alert).toHaveTextContent('접근 권한이 없어요.')
    expect(alert).not.toHaveTextContent('member check failed')

    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('취소는 실패가 아니라서 그리지 않는다', () => {
    const { container } = render(
      <QueryErrorState
        error={createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)}
        onRetry={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
