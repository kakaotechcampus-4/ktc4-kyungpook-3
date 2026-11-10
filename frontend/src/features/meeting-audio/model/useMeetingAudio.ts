import { useEffect, useReducer } from 'react'
import type { SyntheticEvent } from 'react'
import { probeMeetingAudio } from '@/entities/meeting'
import { initialPlayback, playbackReducer } from './playback'
import type { PlaybackPhase } from './playback'

type AudioEvent = SyntheticEvent<HTMLAudioElement>

export interface MeetingAudio {
  phase: PlaybackPhase
  /** `<audio>` 의 key. 바뀌면 새 요소가 녹음 경로를 다시 부른다 */
  load: number
  onLoadedMetadata: (event: AudioEvent) => void
  onReceived: () => void
  onError: (event: AudioEvent) => void
  retry: () => void
}

/** 상태 전이는 playback.ts 가 정하고, 여기서는 `<audio>` 이벤트와 녹음 경로 확인만 잇는다 */
export function useMeetingAudio(meetingId: string, startAt: number | null): MeetingAudio {
  const [state, dispatch] = useReducer(playbackReducer, startAt, initialPlayback)
  const { phase, load } = state

  const checking = phase.kind === 'checking'
  useEffect(() => {
    if (!checking) return
    const controller = new AbortController()
    void probeMeetingAudio(meetingId, controller.signal).then((probe) => {
      if (!controller.signal.aborted) dispatch({ type: 'probed', probe })
    })
    return () => controller.abort()
  }, [checking, load, meetingId])

  return {
    phase,
    load,
    onLoadedMetadata: ({ currentTarget: audio }) => {
      if (phase.kind !== 'loading') return
      if (phase.startAt !== null) audio.currentTime = phase.startAt
      // 주소로 바로 들어오면 자동 재생이 막힌다. 그때는 옮겨 둔 자리에서 사용자가 튼다
      if (phase.play) audio.play().catch(() => {})
      dispatch({ type: 'positioned' })
    },
    onReceived: () => dispatch({ type: 'received' }),
    onError: ({ currentTarget: audio }) =>
      dispatch({ type: 'error', at: audio.currentTime, playing: !audio.paused }),
    retry: () => dispatch({ type: 'retry' }),
  }
}
