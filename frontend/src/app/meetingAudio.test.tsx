import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockInstance } from 'vitest'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { renderApp } from './test/renderApp'

/*
 * #676 회의록의 녹음 재생. 실제 경로 표·MSW handler(302 → 모의 S3, AUDIO_NOT_AVAILABLE)를 그대로 탄다.
 * jsdom 은 미디어를 받지 않는다 — `<audio>` 이벤트는 테스트가 보내고 위치(currentTime)는 테스트가 옮긴다
 */

vi.setConfig({ testTimeout: 10_000 })

let play: MockInstance<HTMLMediaElement['play']>
beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  clearTrackedMeetings()
})

async function openRecording(path: string) {
  renderApp(path)
  return screen.findByRole('region', { name: '회의 녹음' })
}

function player(): HTMLAudioElement {
  const found = screen.getByRole('region', { name: '회의 녹음' }).querySelector('audio')
  if (found === null) throw new Error('audio element missing')
  return found
}

function playingAt(audio: HTMLAudioElement, seconds: number) {
  audio.currentTime = seconds
  Object.defineProperty(audio, 'paused', { configurable: true, value: false })
}

describe('원문 듣기로 들어온 회의록 (#676)', () => {
  it('녹음을 근거 시각으로 옮겨 튼다', async () => {
    await openRecording(paths.meetings('ws_01', 'mt_09', 165_000))
    const audio = player()
    expect(audio).toHaveAttribute('src', '/api/v1/meetings/mt_09/audio')
    expect(audio).toHaveAttribute('controls')
    expect(audio).toHaveAttribute('preload', 'metadata')
    expect(audio).not.toHaveAttribute('crossorigin')
    fireEvent.loadedMetadata(audio)
    expect(audio.currentTime).toBe(165)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('시각 없이 열면 플레이어만 두고 옮기거나 틀지 않는다', async () => {
    await openRecording(paths.meetings('ws_01', 'mt_09'))
    const audio = player()
    fireEvent.loadedMetadata(audio)
    expect(audio.currentTime).toBe(0)
    expect(play).not.toHaveBeenCalled()
  })

  it('녹음이 없는 회의는 근거 시각으로 왔을 때만 안내하고 플레이어를 그리지 않는다', async () => {
    const region = await openRecording(paths.meetings('ws_01', 'mt_07', 30_000))
    expect(region).toHaveTextContent('녹음이 없거나 보관 기간(7일)이 지났어요.')
    expect(region.querySelector('audio')).toBeNull()
  })

  it('녹음이 없는 회의를 그냥 열면 녹음 자리가 없다', async () => {
    renderApp(paths.meetings('ws_01', 'mt_07'))
    await screen.findByRole('heading', { level: 2, name: '2주차 정기회의' })
    expect(screen.queryByRole('region', { name: '회의 녹음' })).toBeNull()
  })
})

describe('재생 중 오류 (#676)', () => {
  it('보관 기간이 지나 404 expired 를 받으면 그 이유를 알리고 플레이어를 거둔다', async () => {
    await openRecording(paths.meetings('ws_01', 'mt_09', 165_000))
    fireEvent.loadedMetadata(player())
    const minutes = db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')
    if (minutes) minutes.audio = null
    fireEvent.error(player())
    expect(await screen.findByText('보관 기간(7일)이 지나 녹음을 들을 수 없어요.')).toHaveRole(
      'status',
    )
    expect(document.querySelector('audio')).toBeNull()
  })

  it('임시 주소가 끝나 실패하면 녹음을 다시 불러 듣던 자리부터 이어 튼다', async () => {
    await openRecording(paths.meetings('ws_01', 'mt_09'))
    const first = player()
    fireEvent.loadedMetadata(first)
    fireEvent.loadedData(first)
    playingAt(first, 1200.5)
    fireEvent.error(first)
    await waitFor(() => expect(player()).not.toBe(first))
    const second = player()
    expect(second).toHaveAttribute('src', '/api/v1/meetings/mt_09/audio')
    fireEvent.loadedMetadata(second)
    expect(second.currentTime).toBe(1200.5)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('다시 부른 주소도 받기 전에 실패하면 불러오지 못했다고 알리고, 다시 시도하면 그 자리부터 부른다', async () => {
    const user = userEvent.setup()
    await openRecording(paths.meetings('ws_01', 'mt_09', 165_000))
    const first = player()
    fireEvent.error(first)
    await waitFor(() => expect(player()).not.toBe(first))
    fireEvent.error(player())
    expect(await screen.findByText('녹음을 불러오지 못했어요.')).toHaveRole('status')
    expect(document.querySelector('audio')).toBeNull()

    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    const retried = player()
    fireEvent.loadedMetadata(retried)
    expect(retried.currentTime).toBe(165)
  })
})
