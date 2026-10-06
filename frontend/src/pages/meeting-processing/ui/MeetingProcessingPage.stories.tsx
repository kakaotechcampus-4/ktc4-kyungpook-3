import type { Meta, StoryObj } from '@storybook/react-vite'
import { http } from 'msw'
import { Route, Routes } from 'react-router'
import { expect, within } from 'storybook/test'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { completeMeeting, failMeeting } from '@/shared/mock/meetingFlow'
import { MeetingProcessingPage } from './MeetingProcessingPage'

/*
 * 회의 정리 중 (M5 U4). ws_01 의 정리 중 회의 mt_10 을 연다. 시나리오의 흐름 방식이 manual 이라 상세를 다시 물어도
 * 단계가 그대로다 — 스토리마다 `progress` 를 직접 정한다. polling·토스트·이동은 앱 계층 추적기가 하므로 여기엔 없다.
 * 상세를 받기 전에도 `정리 상태를 불러오는 중이에요` status 가 있다 — 제목이 나온 뒤에 단계 문구를 읽는다 (U6 r2).
 */

const PATH = '/workspaces/ws_01/meetings/mt_10/processing'

/** mt_10 의 서버 `progress` 를 정한다 */
function progressOf(audio_merged: boolean, transcribed: boolean, extracted: boolean) {
  return () => {
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')
    if (meeting) meeting.progress = { audio_merged, transcribed, extracted }
  }
}

function Page() {
  return (
    <Routes>
      <Route
        path="/workspaces/:workspaceId/meetings/:meetingId/processing"
        element={<MeetingProcessingPage />}
      />
    </Routes>
  )
}

const meta = {
  title: 'M5 회의/처리',
  component: Page,
  parameters: { scenario: 'single-workspace', route: PATH },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

/** 갓 올린 회의 — 첫 단계가 진행 중 */
export const 단계_0: Story = {
  parameters: { setup: progressOf(false, false, false) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: '정리하고 있어요' }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('status')).toHaveTextContent('0 / 3 단계 완료')
  },
}

/** 오디오를 합쳤다 — 둘째 단계가 진행 중 (픽스처 그대로) */
export const 단계_1: Story = {
  parameters: { setup: progressOf(true, false, false) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: '정리하고 있어요' }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('status')).toHaveTextContent('1 / 3 단계 완료')
  },
}

export const 단계_2: Story = {
  parameters: { setup: progressOf(true, true, false) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: '정리하고 있어요' }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('status')).toHaveTextContent('2 / 3 단계 완료')
  },
}

/** 세 단계를 다 했지만 서버가 아직 완료로 바꾸지 않았다 — 완료가 아니다 */
export const 단계_3: Story = {
  parameters: { setup: progressOf(true, true, true) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: '정리하고 있어요' }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('status')).toHaveTextContent('3 / 3 단계 완료')
  },
}

/** 상태를 처음부터 받지 못했다 — 정리 실패가 아니라 다시 시도다. 다시 시도하지 않는 오류(400)로 바로 보인다 */
export const 불러오기_오류: Story = {
  parameters: {
    msw: [http.get('/api/v1/meetings/:meetingId', () => fail('INVALID_REQUEST', 'x', 400))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    await expect(canvas.getByRole('status')).toHaveTextContent('정리 상태를 불러오지 못했어요')
  },
}

export const 완료: Story = {
  parameters: { setup: () => void completeMeeting('mt_10') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: '정리가 끝났어요' }),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: '회의록 보기' })).toHaveAttribute(
      'href',
      '/workspaces/ws_01/meetings/mt_10',
    )
  },
}

export const 실패: Story = {
  parameters: { setup: () => void failMeeting('mt_10') },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('heading', { name: '회의를 정리하지 못했어요' }),
    ).toBeInTheDocument()
  },
}

/** 없는 회의·볼 수 없는 회의 (403·404) */
export const 볼_수_없음: Story = {
  parameters: {
    msw: [http.get('/api/v1/meetings/:meetingId', () => fail('MEETING_NOT_FOUND', 'x', 404))],
  },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('heading', { name: '이 회의를 볼 수 없어요' }),
    ).toBeInTheDocument()
  },
}
