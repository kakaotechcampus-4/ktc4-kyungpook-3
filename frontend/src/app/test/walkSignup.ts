import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '@/shared/mock/db'
import { usernameFromEmail } from '@/shared/mock/sessions'

export async function agreeToPolicies(): Promise<void> {
  for (const name of ['[필수] 이용약관 동의', '[필수] 개인정보처리방침 동의']) {
    const checkbox = await screen.findByRole('checkbox', { name })
    if (!(checkbox instanceof HTMLInputElement)) throw new Error('consent must be an input')
    if (!checkbox.checked) await userEvent.click(checkbox)
  }
}

/** 모의 메일함의 마지막 코드를 넣는다 */
export async function enterMailedCode(): Promise<void> {
  const input = await screen.findByLabelText('인증 코드')
  const mail = db.signupVerification.outbox.at(-1)
  if (!mail) throw new Error('no signup mail')
  await userEvent.type(input, mail.code)
  await userEvent.click(screen.getByRole('button', { name: '코드 확인' }))
}

/** 아이디를 넣고 중복 확인을 마친다. 쓸 수 있다는 답을 기다린다 */
export async function confirmUsername(username: string): Promise<void> {
  const field = await screen.findByLabelText('아이디')
  await userEvent.clear(field)
  await userEvent.type(field, username)
  await userEvent.click(screen.getByRole('button', { name: '중복 확인' }))
  await screen.findByText('사용할 수 있는 아이디예요.')
}

/**
 * 이메일 → 코드 → 프로필을 화면으로 끝까지 밟고 `계정 만들기` 를 누른다.
 * 아이디를 주지 않으면 이메일 앞부분으로 만든다(BE 가 기존 계정에 채우는 규칙)
 */
export async function walkSignup(values: {
  name: string
  email: string
  password: string
  username?: string
}): Promise<void> {
  await userEvent.type(screen.getByLabelText('이메일'), values.email)
  await userEvent.click(screen.getByRole('button', { name: '인증 코드 받기' }))
  await enterMailedCode()
  await confirmUsername(values.username ?? usernameFromEmail(values.email))
  await userEvent.type(screen.getByLabelText('이름'), values.name)
  await userEvent.type(screen.getByLabelText('비밀번호'), values.password)
  await agreeToPolicies()
  await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
}
