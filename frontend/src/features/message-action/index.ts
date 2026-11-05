export {
  KNOWN_FAILURES,
  TIME_PASSED_LOCK,
  TIME_PASSED_MESSAGE,
  TIME_PASSED_TITLE,
  approveNotice,
  cancelNotice,
  mergeNotice,
} from './lib/actionMessages'
export type { KnownFailure } from './lib/actionMessages'
export { actionTarget, useMessageAction } from './model/useMessageAction'
export type { MessageActionControl, MessageActionFailure } from './model/useMessageAction'
export { ActionFailure } from './ui/ActionFailure'
