import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, within } from 'storybook/test'
import { LoginForm, SignupForm } from '@/features/auth'
import { AuthShell } from './AuthShell'

/* 로그인·회원가입 폼 (M4 ①). MSW 가 실제 request 경로로 답한다. 비로그인 시나리오에서 시작한다 */

const LOGIN_ASIDE = {
  pose: 'idle',
  title: '한 번의 클릭으로, 매니저가 정리합니다',
  description: '들어오시면 정리해 둔 회의부터 이어서 확인하실 수 있어요.',
  caption: "Manager's Manager",
} as const

function Login() {
  return (
    <AuthShell title="Manager's Manager" formLabel="로그인" aside={LOGIN_ASIDE}>
      <LoginForm />
    </AuthShell>
  )
}

const meta = {
  title: 'M4 폼/로그인·회원가입',
  component: Login,
  parameters: { scenario: 'signed-out', route: '/login' },
} satisfies Meta<typeof Login>

export default meta
type Story = StoryObj<typeof meta>

/** Google 로그인과 `비밀번호를 잊으셨나요?` 는 비활성이다 (D-005, D-007) */
export const 로그인_기본: Story = {}

/** 형식 오류는 입력 아래, 첫 오류 칸으로 포커스 (D-142) */
export const 로그인_입력_오류: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('이메일'), 'pm')
    await userEvent.click(canvas.getByRole('button', { name: '로그인' }))
    await expect(await canvas.findByText('이메일 형식으로 입력해 주세요.')).toBeInTheDocument()
  },
}

/** 잘못된 자격 증명은 폼 상단 비필드 오류다 */
export const 로그인_서버_오류: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('이메일'), 'pm@example.com')
    await userEvent.type(canvas.getByLabelText('비밀번호'), 'wrong')
    await userEvent.click(canvas.getByRole('button', { name: '로그인' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent('올바르지 않아요')
  },
}

/** 제출 중 — 버튼이 비활성·aria-busy 라 다시 제출할 수 없다 */
export const 로그인_제출_중: Story = {
  parameters: {
    msw: [
      http.post('/api/v1/auth/login', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('이메일'), 'pm@example.com')
    await userEvent.type(canvas.getByLabelText('비밀번호'), 'mock-password')
    await userEvent.click(canvas.getByRole('button', { name: '로그인' }))
    await expect(canvas.getByRole('button', { name: '로그인' })).toBeDisabled()
  },
}

function Signup() {
  return (
    <AuthShell
      title="계정 만들기"
      formLabel="회원가입"
      aside={{
        pose: 'squint',
        title: "계정을 만들고 Manager's Manager를 시작해보세요",
        description: '팀을 관리하는 분만 계정을 만들면 돼요.',
        caption: '5분이면 연결까지 끝납니다',
      }}
    >
      <SignupForm />
    </AuthShell>
  )
}

/** 강도 표시·약관 동의는 없다 — 규칙 안내 한 줄만 (docs/impl-decision/2026-09-29-signup-scope.md) */
export const 회원가입_기본: Story = { render: () => <Signup />, parameters: { route: '/signup' } }

/** 서버 필드 오류는 setError 로 그 칸 아래에 뜬다 */
export const 회원가입_중복_이메일: Story = {
  render: () => <Signup />,
  parameters: { route: '/signup' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('이름'), '최진호')
    await userEvent.type(canvas.getByLabelText('이메일'), 'pm@example.com')
    await userEvent.type(canvas.getByLabelText('비밀번호'), 'pass1234')
    await userEvent.click(canvas.getByRole('button', { name: '계정 만들기' }))
    await expect(await canvas.findByText('이미 가입된 이메일이에요.')).toBeInTheDocument()
  },
}
