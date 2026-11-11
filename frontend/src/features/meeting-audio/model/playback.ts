import type { AudioProbe, AudioUnavailableReason } from '@/entities/meeting'

/*
 * 회의록의 녹음 재생 (#676). `<audio src="/meetings/{id}/audio">` 하나로 틀고, 서버가 S3 임시 주소(1시간)로 302 한다.
 * 재생이 실패하면 녹음 경로에 다시 물어 들을 수 없는지(404), 임시 주소만 끝났는지(302) 가른다.
 * 임시 주소가 끝났으면 `<audio>` 를 새로 만들어 같은 경로를 다시 부르고 그 위치로 돌아간다.
 */

export type PlaybackPhase =
  /** 녹음 경로를 불렀다. 메타데이터가 오면 `startAt` 초로 옮기고 `play` 면 튼다 */
  | { kind: 'loading'; startAt: number | null; play: boolean; reloaded: boolean }
  | { kind: 'ready'; reloaded: boolean }
  /** 재생 오류 뒤 녹음 경로에 다시 묻는 중이다 */
  | { kind: 'checking'; resumeAt: number; resume: boolean; reloaded: boolean }
  /** 다시 불러도 들을 수 없다. 모르는 이유는 null 이다 */
  | { kind: 'unavailable'; reason: AudioUnavailableReason | null }
  /** 불러오지 못했다. 사용자가 다시 시도하면 그 위치부터 다시 부른다 */
  | { kind: 'failed'; resumeAt: number; resume: boolean }

/**
 * `load` 는 `<audio>` 를 몇 번째로 만들었는지다. 늘면 화면이 새 요소로 갈아 끼워 녹음 경로를 다시 부른다.
 * `reloaded` 는 이번 주소가 자동으로 다시 부른 것인지다 — 받기에 성공하기 전에 또 실패하면 다시 부르지 않고 `failed` 다
 */
export interface PlaybackState {
  load: number
  phase: PlaybackPhase
}

export type PlaybackEvent =
  /** 메타데이터가 와서 시작 위치를 적용했다 (`loadedmetadata`) */
  | { type: 'positioned' }
  /** 이 주소에서 실제로 받았다 (`loadeddata`·`playing`). 자동 다시 부르기를 한 번 더 쓸 수 있다 */
  | { type: 'received' }
  /** `<audio>` 의 `error`. 그때의 위치와 재생 중이었는지 */
  | { type: 'error'; at: number; playing: boolean }
  | { type: 'probed'; probe: AudioProbe }
  | { type: 'retry' }

/** 회의록 주소의 `t`(ms)를 녹음 위치(초)로 읽는다. 0 이상의 정수가 아니면 위치가 없는 것이다 */
export function startSecondsFrom(param: string | null): number | null {
  if (param === null || !/^\d+$/.test(param)) return null
  const ms = Number(param)
  return Number.isSafeInteger(ms) ? ms / 1000 : null
}

export function initialPlayback(startAt: number | null): PlaybackState {
  return { load: 0, phase: { kind: 'loading', startAt, play: startAt !== null, reloaded: false } }
}

function reload(
  state: PlaybackState,
  startAt: number,
  play: boolean,
  reloaded: boolean,
): PlaybackState {
  return { load: state.load + 1, phase: { kind: 'loading', startAt, play, reloaded } }
}

export function playbackReducer(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  const { phase } = state
  switch (event.type) {
    case 'positioned':
      return phase.kind === 'loading'
        ? { ...state, phase: { kind: 'ready', reloaded: phase.reloaded } }
        : state
    case 'received':
      return phase.kind === 'loading' || phase.kind === 'ready'
        ? { ...state, phase: { kind: 'ready', reloaded: false } }
        : state
    case 'error':
      if (phase.kind === 'loading')
        // 옮기기 전에 실패했으면 가려던 위치와 재생 여부를 그대로 넘긴다
        return {
          ...state,
          phase: {
            kind: 'checking',
            resumeAt: phase.startAt ?? event.at,
            resume: phase.play || event.playing,
            reloaded: phase.reloaded,
          },
        }
      if (phase.kind === 'ready')
        return {
          ...state,
          phase: {
            kind: 'checking',
            resumeAt: event.at,
            resume: event.playing,
            reloaded: phase.reloaded,
          },
        }
      return state
    case 'probed': {
      if (phase.kind !== 'checking') return state
      const { probe } = event
      if (probe.kind === 'unavailable')
        return { ...state, phase: { kind: 'unavailable', reason: probe.reason } }
      if (probe.kind === 'reachable' && !phase.reloaded)
        return reload(state, phase.resumeAt, phase.resume, true)
      return {
        ...state,
        phase: { kind: 'failed', resumeAt: phase.resumeAt, resume: phase.resume },
      }
    }
    case 'retry':
      return phase.kind === 'failed' ? reload(state, phase.resumeAt, phase.resume, false) : state
  }
}
