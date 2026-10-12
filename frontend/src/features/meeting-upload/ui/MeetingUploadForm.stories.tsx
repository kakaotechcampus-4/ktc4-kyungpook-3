import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'
import { AUDIO_REJECTION_MESSAGE } from '../model/audioFile'
import { UPLOAD_FORM_MESSAGES } from '../model/uploadSchema'
import { MeetingUploadForm } from './MeetingUploadForm'
import { UploadStatus } from './UploadStatus'

/*
 * 회의 올리기 폼 (M5 U3). PM 이 ws_01 에 올리는 상태(`meeting-instant`)에서 시작한다.
 * 파일은 스토리가 메모리에서 만든 1초짜리 WAV 다 — 브라우저가 길이를 읽어야 폼이 받는다(U3-4).
 * 진입 판정(정리 중·Notion 차단)은 페이지가 한다 — 차단 모달은 `M5 회의/Notion 차단 모달` 스토리에 있다.
 */

/** 1초 · 8 kHz · 8비트 모노 PCM WAV. e2e/fixtures/short-meeting.wav 와 같은 모양이다 */
function shortWav(name = '주간 회의.wav'): File {
  const rate = 8000
  const bytes = new Uint8Array(44 + rate)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) =>
    Array.from(text).forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + rate, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 모노
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  ascii(36, 'data')
  view.setUint32(40, rate, true)
  bytes.fill(128, 44)
  // 2026-09-18 09:30 서울 — 날짜 칸 기본값이 이 날이다
  return new File([bytes], name, { type: 'audio/wav', lastModified: Date.UTC(2026, 8, 18, 0, 30) })
}

/**
 * 파일을 칸에 끌어다 놓는다. 진짜 `DataTransfer` 를 실은 브라우저 이벤트를 보낸다 — `fireEvent.drop` 은 평범한 객체를
 * `DragEvent` 생성자에 넘겨 브라우저(Chromium)가 `Failed to convert value to 'DataTransfer'` 로 거부한다(jsdom 에서만 된다)
 */
function dropFiles(canvasElement: HTMLElement, files: File[]) {
  const zone = within(canvasElement).getByTestId('audio-dropzone')
  const dataTransfer = new DataTransfer()
  for (const file of files) dataTransfer.items.add(file)
  for (const type of ['dragenter', 'drop'])
    zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
}

/**
 * 파일을 받고(길이를 읽고) 참석자 한 명을 고른다.
 * `추가` 는 팀원 목록 조회가 끝나야 그려진다 — 파일 길이와 따로 기다린다 (U6 r2)
 */
async function fillForm(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  dropFiles(canvasElement, [shortWav()])
  await expect(await canvas.findByText(/^00:01 · /)).toBeInTheDocument()
  await userEvent.click(await canvas.findByRole('button', { name: '추가' }))
  await userEvent.click(await within(document.body).findByRole('menuitem', { name: '박민수' }))
  await expect(await canvas.findByRole('button', { name: '박민수 빼기' })).toBeInTheDocument()
}

const hang = async () => {
  await delay('infinite')
}

const meta = {
  title: 'M5 회의/올리기',
  component: MeetingUploadForm,
  args: { workspaceId: 'ws_01', onBlocked: fn() },
  parameters: { scenario: 'meeting-instant', route: '/workspaces/ws_01/meetings/upload' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[700px] px-24 py-48">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MeetingUploadForm>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

/**
 * 파일을 끌고 들어온 동안 — 칸의 테두리만 먹으로 바뀐다.
 * 브라우저에서는 이벤트가 React 상태를 바꾼 뒤 다시 그리기까지 한 박자 늦다 — 바뀐 표식을 기다린다 (U6 r2)
 */
export const 드래그_중: Story = {
  play: async ({ canvasElement }) => {
    const zone = within(canvasElement).getByTestId('audio-dropzone')
    await fireEvent.dragEnter(zone)
    await waitFor(() => expect(zone).toHaveAttribute('data-dragging', 'true'))
    await expect(zone).toHaveClass('border-ink')
  },
}

/** 받지 않는 형식 — 칸 아래 안내, 제출은 파일 선택으로 돌아간다 */
export const 파일_오류: Story = {
  play: async ({ canvasElement }) => {
    dropFiles(canvasElement, [new File(['memo'], '회의 메모.txt', { type: 'text/plain' })])
    await expect(
      await within(canvasElement).findByText(AUDIO_REJECTION_MESSAGE.format),
    ).toBeInTheDocument()
  },
}

/** 여러 파일을 한 번에 — 하나만 받는다 */
export const 여러_파일_오류: Story = {
  play: async ({ canvasElement }) => {
    dropFiles(canvasElement, [shortWav('a.wav'), shortWav('b.wav')])
    await expect(
      await within(canvasElement).findByText(AUDIO_REJECTION_MESSAGE.multiple),
    ).toBeInTheDocument()
  },
}

/** 아무것도 없이 제출 — 파일·참석자 안내가 함께 보이고 포커스는 파일 선택으로 간다 */
export const 입력_오류: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: '정리 시작하기' }))
    await expect(await canvas.findByText(UPLOAD_FORM_MESSAGES.fileRequired)).toBeInTheDocument()
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: '컴퓨터에서 찾기' })).toHaveFocus(),
    )
  },
}

/** 파일을 받았다 — 제목은 파일 이름, 날짜는 파일 수정일(서울) */
export const 파일_선택됨: Story = {
  play: async ({ canvasElement }) => {
    await fillForm(canvasElement)
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('회의 제목')).toHaveValue('주간 회의.wav')
    await expect(canvas.getByLabelText('회의 날짜')).toHaveValue('2026-09-18')
  },
}

/** 보내는 중 — 서버가 답하지 않는다. 입력이 잠기고 전송 상태가 보인다 */
export const 전송_중: Story = {
  parameters: {
    msw: [http.post('/api/v1/workspaces/:workspaceId/meetings/upload', hang)],
  },
  play: async ({ canvasElement }) => {
    await fillForm(canvasElement)
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: '정리 시작하기' }))
    await expect(await canvas.findByRole('status')).toBeInTheDocument()
    await expect(canvas.getByRole('group', { name: '회의 정보' })).toBeDisabled()
    await expect(canvas.getByRole('button', { name: '정리 시작하기' })).toBeDisabled()
  },
}

/*
 * 전송 상태 한 줄 (U3-7). 실제 전송률은 브라우저가 몸통을 보내는 속도라 스토리에서 멈춰 세울 수 없다 — 단계별로 그린다.
 */

/** 전체 크기를 안다 — 백분율 막대 */
export const 전송률: Story = {
  render: () => <UploadStatus phase={{ kind: 'sending', percent: 42 }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
  },
}

/** 전체 크기를 모른다 — 값 없는 막대(불확정) */
export const 전송률_불확정: Story = {
  render: () => <UploadStatus phase={{ kind: 'sending', percent: null }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('progressbar')).not.toHaveAttribute(
      'aria-valuenow',
    )
  },
}

/** 다 보냈다 — 100% 여도 끝이 아니다. 서버의 202 를 기다린다 */
export const 서버_대기: Story = {
  render: () => <UploadStatus phase={{ kind: 'waiting' }} />,
}

/** 응답을 잃어 회의 목록으로 결과를 확인하는 중 (U3-8) */
export const 결과_확인_중: Story = {
  render: () => <UploadStatus phase={null} recovering />,
}
