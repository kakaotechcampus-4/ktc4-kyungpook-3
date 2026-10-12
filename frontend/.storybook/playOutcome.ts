import {
  PLAY_FUNCTION_THREW_EXCEPTION,
  STORY_ERRORED,
  STORY_FINISHED,
  STORY_THREW_EXCEPTION,
  UNHANDLED_ERRORS_WHILE_PLAYING,
} from 'storybook/internal/core-events'
import type { StoryFinishedPayload } from 'storybook/internal/core-events'
import { addons } from 'storybook/preview-api'

/*
 * 스토리의 play 결과를 iframe 의 `window.__storyPlay` 에 남긴다 — e2e/storybook/stories.sb.ts 가 읽는다 (U6 r2, M01).
 * Storybook 은 기본값 `throwPlayFunctionExceptions: false` 라 play 안의 단언이 던져도 오류를 채널과 console 로만 내보내고
 * 렌더 단계를 끝까지(`finished`) 진행한다. 단계만으로는 깨진 play 를 통과로 본다. 그래서 오류를 알리는 채널 이벤트를 모은다:
 * - playFunctionThrewException — play 가 던졌다(단언 실패 포함)
 * - unhandledErrorsWhilePlaying — play 중 잡히지 않은 오류
 * - storyThrewException·storyErrored — 렌더 자체가 실패했다
 * - storyFinished — 끝났다. status 가 `error` 면(위 이벤트 없이도) 실패다
 * 스토리 화면은 바꾸지 않는다 — 오류 표시는 Storybook 기본 그대로다.
 */

export interface StoryPlay {
  storyId: string
  finished: boolean
  errors: string[]
}

declare global {
  interface Window {
    __storyPlay?: StoryPlay
  }
}

interface SerializedError {
  name?: string
  message?: string
}

const describe = (error: SerializedError) =>
  [error.name, error.message].filter(Boolean).join(': ') || JSON.stringify(error)

let watched: ReturnType<typeof addons.getChannel> | null = null

/** 로더에서 부른다 — 이 스토리의 결과를 처음 상태로 두고, 채널 구독은 한 번만 건다 */
export function watchStoryPlay(storyId: string) {
  window.__storyPlay = { storyId, finished: false, errors: [] }
  const channel = addons.getChannel()
  if (watched === channel) return
  watched = channel
  const record = (message: string) => window.__storyPlay?.errors.push(message)
  channel.on(PLAY_FUNCTION_THREW_EXCEPTION, (error: SerializedError) =>
    record(`play: ${describe(error)}`),
  )
  channel.on(UNHANDLED_ERRORS_WHILE_PLAYING, (errors: SerializedError[]) =>
    errors.forEach((error) => record(`unhandled: ${describe(error)}`)),
  )
  channel.on(STORY_THREW_EXCEPTION, (error: SerializedError) =>
    record(`render: ${describe(error)}`),
  )
  channel.on(STORY_ERRORED, ({ title }: { title: string }) => record(`render: ${title}`))
  channel.on(STORY_FINISHED, ({ storyId: finishedId, status }: StoryFinishedPayload) => {
    const play = window.__storyPlay
    if (play?.storyId !== finishedId) return
    if (status === 'error' && play.errors.length === 0) play.errors.push('finished: error')
    play.finished = true
  })
}
