import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordField } from './PasswordField'

function renderField(onSubmit = vi.fn()) {
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <PasswordField
        tone="auth"
        label="비밀번호"
        showLabel="비밀번호 보기"
        hideLabel="비밀번호 숨기기"
        error="비밀번호를 입력해 주세요."
      />
    </form>,
  )
  return onSubmit
}

describe('PasswordField', () => {
  it('보기 토글이 입력 종류·이름·눌림 상태를 함께 바꾼다', async () => {
    const onSubmit = renderField()
    const input = screen.getByLabelText('비밀번호')
    expect(input).toHaveAttribute('type', 'password')

    await userEvent.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '비밀번호 숨기기' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: '비밀번호 숨기기' }))
    expect(input).toHaveAttribute('type', 'password')
    // 토글은 제출 버튼이 아니다
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('오류를 입력 아래에 두고 aria-describedby · aria-invalid 로 잇는다', () => {
    renderField()
    const input = screen.getByLabelText('비밀번호')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('비밀번호를 입력해 주세요.')
  })
})
