import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { SpeakerSample } from '@/entities/meeting'
import { isSameSample, sampleEnded, samplePress, sampleRemainingMs } from './samplePlayback'
import type { PlayingSample } from './samplePlayback'

export interface SamplePlayer {
  playing: PlayingSample | null
  failed: boolean
  toggle: (key: PlayingSample, sample: SpeakerSample) => void
  isPlaying: (key: PlayingSample) => boolean
}

/**
 * 화면에 하나 있는 `<audio>` 로 샘플 구간만 들려준다. 서버는 구간을 자르지 않는다 (계약 §2.3.1).
 * 끝은 화면 갱신마다 확인하고, 갱신이 멈춘 탭에서도 멈추도록 남은 시간 타이머를 함께 건다.
 */
export function useSamplePlayer(audioRef: RefObject<HTMLAudioElement | null>): SamplePlayer {
  const [playing, setPlaying] = useState<PlayingSample | null>(null)
  const [failed, setFailed] = useState(false)
  const latestPlay = useRef(0)
  const isStale = (play: number) => latestPlay.current !== play
  const watchers = useRef<{ frame: number | null; timer: number | null }>({
    frame: null,
    timer: null,
  })

  const unwatch = useCallback(() => {
    const { frame, timer } = watchers.current
    if (frame !== null) cancelAnimationFrame(frame)
    if (timer !== null) window.clearTimeout(timer)
    watchers.current = { frame: null, timer: null }
  }, [])

  const stop = useCallback(() => {
    latestPlay.current += 1
    unwatch()
    audioRef.current?.pause()
    setPlaying(null)
  }, [audioRef, unwatch])

  const watch = useCallback(
    (audio: HTMLAudioElement, sample: SpeakerSample, current: number) => {
      const check = () => {
        if (isStale(current)) return
        if (sampleEnded(sample, audio.currentTime)) stop()
        else schedule()
      }
      const schedule = () => {
        unwatch()
        watchers.current = {
          frame: requestAnimationFrame(check),
          timer: window.setTimeout(
            check,
            sampleRemainingMs(sample, audio.currentTime, audio.playbackRate),
          ),
        }
      }
      schedule()
    },
    [stop, unwatch],
  )

  const toggle = useCallback(
    (key: PlayingSample, sample: SpeakerSample) => {
      const audio = audioRef.current
      if (audio === null || failed) return
      if (samplePress(playing, key) === 'stop') {
        stop()
        return
      }
      latestPlay.current += 1
      const current = latestPlay.current
      unwatch()
      audio.pause()
      audio.currentTime = sample.start
      setPlaying(key)
      audio.play().then(
        () => {
          if (!isStale(current)) watch(audio, sample, current)
        },
        () => {
          // 자동 재생 막힘·다른 재생으로 끊김. 이 재생이 아직 지금 것일 때만 버튼을 되돌린다
          if (!isStale(current)) stop()
        },
      )
    },
    [audioRef, failed, playing, stop, unwatch, watch],
  )

  useEffect(() => {
    const audio = audioRef.current
    if (audio === null) return
    const onError = () => {
      setFailed(true)
      stop()
    }
    audio.addEventListener('error', onError)
    audio.addEventListener('ended', stop)
    return () => {
      audio.removeEventListener('error', onError)
      audio.removeEventListener('ended', stop)
      unwatch()
      audio.pause()
    }
  }, [audioRef, stop, unwatch])

  return {
    playing,
    failed,
    toggle,
    isPlaying: useCallback((key: PlayingSample) => isSameSample(playing, key), [playing]),
  }
}
