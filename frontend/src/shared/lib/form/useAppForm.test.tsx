import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { z } from 'zod'
import { deferred } from '@/shared/test/deferred'
import { FORM_POLICY, useAppForm } from './useAppForm'

const schema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.'),
  email: z.email('이메일 형식으로 입력해 주세요.'),
})

function TestForm({ onValid }: { onValid: (values: z.infer<typeof schema>) => Promise<void> }) {
  const { form, submit } = useAppForm(schema, { name: '', email: '' })
  const {
    register,
    formState: { errors, isSubmitting },
  } = form
  return (
    <form noValidate aria-label="시험 폼" onSubmit={(event) => void submit(onValid)(event)}>
      <label htmlFor="name">이름</label>
      <input id="name" {...register('name')} />
      {errors.name ? <p role="alert">{errors.name.message}</p> : null}
      <label htmlFor="email">이메일</label>
      <input id="email" {...register('email')} />
      {errors.email ? <p role="alert">{errors.email.message}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        보내기
      </button>
    </form>
  )
}

describe('폼 공통 정책 (D-142)', () => {
  it('onTouched · 변경 시 재검증 · 첫 오류 포커스다', () => {
    expect(FORM_POLICY).toEqual({
      mode: 'onTouched',
      reValidateMode: 'onChange',
      shouldFocusError: true,
    })
  })

  it('처음 입력하는 동안에는 오류가 없고 첫 blur 에서 검사한다', async () => {
    render(<TestForm onValid={() => Promise.resolve()} />)
    const email = screen.getByLabelText('이메일')
    await userEvent.type(email, 'abc')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 형식으로 입력해 주세요.')
  })

  it('한 번 만진 칸은 값이 바뀔 때마다 다시 검사한다', async () => {
    render(<TestForm onValid={() => Promise.resolve()} />)
    const email = screen.getByLabelText('이메일')
    await userEvent.type(email, 'abc')
    await userEvent.tab()
    await screen.findByRole('alert')

    await userEvent.type(email, '@example.com')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('제출하면 모든 칸을 검사하고 첫 오류 칸으로 포커스를 옮긴다', async () => {
    const onValid = vi.fn(() => Promise.resolve())
    render(<TestForm onValid={onValid} />)
    await userEvent.click(screen.getByRole('button', { name: '보내기' }))

    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(screen.getByLabelText('이름')).toHaveFocus()
    expect(onValid).not.toHaveBeenCalled()
  })

  it('앞 제출이 끝나기 전의 제출은 무시한다 — 버튼이 비활성이 되기 전의 연타도 막는다', async () => {
    const gate = deferred()
    const onValid = vi.fn(() => gate.promise)
    render(<TestForm onValid={onValid} />)
    await userEvent.type(screen.getByLabelText('이름'), '최진호')
    await userEvent.type(screen.getByLabelText('이메일'), 'pm@example.com')

    const form = screen.getByRole('form', { name: '시험 폼' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(onValid).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled()

    gate.resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: '보내기' })).toBeEnabled())
    // 끝난 뒤에는 다시 제출할 수 있다
    fireEvent.submit(form)
    await waitFor(() => expect(onValid).toHaveBeenCalledTimes(2))
  })

  it('스키마가 다듬은 값을 handler 에 넘긴다', async () => {
    const onValid = vi.fn(() => Promise.resolve())
    render(<TestForm onValid={onValid} />)
    await userEvent.type(screen.getByLabelText('이름'), '  최진호  ')
    await userEvent.type(screen.getByLabelText('이메일'), 'pm@example.com')
    await userEvent.click(screen.getByRole('button', { name: '보내기' }))
    await waitFor(() =>
      expect(onValid).toHaveBeenCalledWith(
        { name: '최진호', email: 'pm@example.com' },
        expect.anything(),
      ),
    )
  })
})
