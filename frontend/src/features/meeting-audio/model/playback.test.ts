import { initialPlayback, playbackReducer, startSecondsFrom } from './playback'
import type { PlaybackEvent, PlaybackState } from './playback'

const run = (state: PlaybackState, ...events: PlaybackEvent[]) =>
  events.reduce(playbackReducer, state)

const reachable: PlaybackEvent = { type: 'probed', probe: { kind: 'reachable' } }

describe('startSecondsFrom', () => {
  it.each([
    ['165000', 165],
    ['0', 0],
    ['1500', 1.5],
  ])('t=%s 는 %s 초다', (param, seconds) => {
    expect(startSecondsFrom(param)).toBe(seconds)
  })

  it.each([null, '', '-1', '1.5', 'abc', '1e3', '99999999999999999999'])(
    't=%s 는 위치가 없다',
    (param) => {
      expect(startSecondsFrom(param)).toBeNull()
    },
  )
})

describe('playbackReducer', () => {
  it('근거 시각으로 들어오면 그 자리로 옮겨 틀 준비를 하고, 시각이 없으면 틀지 않는다', () => {
    expect(initialPlayback(165).phase).toMatchObject({ kind: 'loading', startAt: 165, play: true })
    expect(initialPlayback(null).phase).toMatchObject({
      kind: 'loading',
      startAt: null,
      play: false,
    })
  })

  it('들을 수 없다는 답이면 이유를 남기고 다시 부르지 않는다', () => {
    const state = run(
      initialPlayback(165),
      { type: 'error', at: 0, playing: false },
      { type: 'probed', probe: { kind: 'unavailable', reason: 'expired' } },
    )
    expect(state).toEqual({ load: 0, phase: { kind: 'unavailable', reason: 'expired' } })
  })

  it('임시 주소가 끝났으면 새 요소로 다시 불러 듣던 자리부터 이어 튼다', () => {
    const state = run(
      initialPlayback(null),
      { type: 'positioned' },
      { type: 'received' },
      { type: 'error', at: 1200.5, playing: true },
      reachable,
    )
    expect(state.load).toBe(1)
    expect(state.phase).toMatchObject({ kind: 'loading', startAt: 1200.5, play: true })
  })

  it('옮기기 전에 실패하면 가려던 근거 시각으로 다시 부른다', () => {
    const state = run(initialPlayback(165), { type: 'error', at: 0, playing: false }, reachable)
    expect(state.phase).toMatchObject({ kind: 'loading', startAt: 165, play: true })
  })

  it('다시 부른 주소가 받기 전에 또 실패하면 더 부르지 않고 실패로 둔다', () => {
    const state = run(
      initialPlayback(null),
      { type: 'error', at: 30, playing: true },
      reachable,
      { type: 'positioned' },
      { type: 'error', at: 30, playing: true },
      reachable,
    )
    expect(state).toEqual({ load: 1, phase: { kind: 'failed', resumeAt: 30, resume: true } })
  })

  it('다시 부른 주소에서 받는 데 성공하면 다음 만료에도 한 번 더 다시 부른다', () => {
    const state = run(
      initialPlayback(null),
      { type: 'error', at: 30, playing: true },
      reachable,
      { type: 'positioned' },
      { type: 'received' },
      { type: 'error', at: 3700, playing: true },
      reachable,
    )
    expect(state.load).toBe(2)
    expect(state.phase).toMatchObject({ kind: 'loading', startAt: 3700, play: true })
  })

  it('녹음 경로를 확인하지 못하면 실패로 두고, 다시 시도하면 그 자리부터 새로 부른다', () => {
    const failed = run(
      initialPlayback(null),
      { type: 'positioned' },
      { type: 'error', at: 42, playing: false },
      { type: 'probed', probe: { kind: 'failed' } },
    )
    expect(failed.phase).toEqual({ kind: 'failed', resumeAt: 42, resume: false })
    const retried = playbackReducer(failed, { type: 'retry' })
    expect(retried.load).toBe(1)
    expect(retried.phase).toMatchObject({ kind: 'loading', startAt: 42, play: false })
  })

  it('확인 중에 온 오류·위치 이벤트는 상태를 바꾸지 않는다', () => {
    const checking = run(initialPlayback(null), { type: 'error', at: 5, playing: false })
    expect(run(checking, { type: 'error', at: 9, playing: true }, { type: 'positioned' })).toBe(
      checking,
    )
  })
})
