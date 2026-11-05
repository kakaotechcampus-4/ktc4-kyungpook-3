import { sampleEnded, samplePress, sampleRemainingMs } from './samplePlayback'

const short = { start: 70.3, end: 71.1 }

it('같은 샘플을 다시 누르면 멈추고, 다른 샘플은 그 구간을 튼다', () => {
  const playing = { label: 'SPEAKER_00', index: 1 }
  expect(samplePress(playing, { label: 'SPEAKER_00', index: 1 })).toBe('stop')
  expect(samplePress(playing, { label: 'SPEAKER_00', index: 0 })).toBe('play')
  expect(samplePress(playing, { label: 'SPEAKER_01', index: 1 })).toBe('play')
  expect(samplePress(null, playing)).toBe('play')
})

it('0.8초 구간도 끝에 닿으면 멈춘다. 지나친 위치도 끝이다', () => {
  expect(sampleEnded(short, 70.3)).toBe(false)
  expect(sampleEnded(short, 71.0)).toBe(false)
  expect(sampleEnded(short, 71.09)).toBe(true)
  expect(sampleEnded(short, 75)).toBe(true)
})

it('남은 시간은 재생 속도를 따르고 음수가 되지 않는다', () => {
  expect(sampleRemainingMs(short, 70.3)).toBe(780)
  expect(sampleRemainingMs(short, 70.3, 2)).toBe(390)
  expect(sampleRemainingMs(short, 72)).toBe(0)
  expect(sampleRemainingMs(short, 70.3, 0)).toBe(780)
})
