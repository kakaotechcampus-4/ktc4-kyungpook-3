/**
 * 타임라인 재생. 멈춰 있으면(`idle`) 모든 노드를 보인다. 재생하면 아무것도 없는 데서 시작해 나온 순서대로
 * 틱마다 하나씩 더하고, 다 보이면 멈춘 상태로 돌아간다
 */
export type Replay = { phase: 'idle' } | { phase: 'playing'; shown: number }

export type ReplayEvent = { type: 'play' } | { type: 'stop' } | { type: 'tick'; total: number }

export const REPLAY_IDLE: Replay = { phase: 'idle' }

export function replayReducer(replay: Replay, event: ReplayEvent): Replay {
  switch (event.type) {
    case 'play':
      return { phase: 'playing', shown: 0 }
    case 'stop':
      return REPLAY_IDLE
    case 'tick':
      if (replay.phase === 'idle') return replay
      return replay.shown + 1 >= event.total
        ? REPLAY_IDLE
        : { phase: 'playing', shown: replay.shown + 1 }
  }
}

/** 지금 보이는 노드 수. 노드는 나온 순서라 앞에서부터 이만큼이다 */
export function shownCount(replay: Replay, total: number): number {
  return replay.phase === 'idle' ? total : Math.min(replay.shown, total)
}

/** 재생이 노드 수와 상관없이 6초 안팎에 끝나게 한 칸 간격을 정한다. 너무 빠르거나 느리지 않게 자른다 */
export function replayIntervalMs(total: number): number {
  return Math.min(500, Math.max(30, 6000 / Math.max(total, 1)))
}
