import type { SpeakerSample } from '@/entities/meeting'

export interface PlayingSample {
  label: string
  index: number
}

export function isSameSample(a: PlayingSample | null, b: PlayingSample): boolean {
  return a !== null && a.label === b.label && a.index === b.index
}

export function samplePress(
  playing: PlayingSample | null,
  pressed: PlayingSample,
): 'stop' | 'play' {
  return isSameSample(playing, pressed) ? 'stop' : 'play'
}

/* 프레임 간격(약 16ms)보다 조금 일찍 멈춘다 — 다음 프레임까지 기다리면 다음 화자의 말이 들린다 */
const END_EARLY_SEC = 0.02

export function sampleEnded(sample: SpeakerSample, currentTime: number): boolean {
  return currentTime >= sample.end - END_EARLY_SEC
}

/**
 * 구간 끝까지 남은 실제 시간(ms). 화면 갱신이 멈춘 탭에서도 멈추게 하는 타이머가 쓴다.
 * `timeupdate`(약 250ms 간격)만으로는 0.5초짜리 구간을 넘겨 버린다 (#342)
 */
export function sampleRemainingMs(
  sample: SpeakerSample,
  currentTime: number,
  playbackRate = 1,
): number {
  const remaining =
    (sample.end - END_EARLY_SEC - currentTime) / (playbackRate > 0 ? playbackRate : 1)
  return Math.max(0, Math.round(remaining * 1000))
}
