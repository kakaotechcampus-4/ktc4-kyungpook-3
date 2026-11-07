export {
  KNOWN_FAILURES,
  NOTE_SAVED_NOTICE,
  TIME_PASSED_LOCK,
  TIME_PASSED_MESSAGE,
  TIME_PASSED_TITLE,
  approveNotice,
  attributeNotice,
  cancelNotice,
  mergeNotice,
  removeTaskNotice,
} from './lib/actionMessages'
export type { KnownFailure } from './lib/actionMessages'
export { actionTarget, useMessageAction } from './model/useMessageAction'
export type { MessageActionControl, MessageActionFailure } from './model/useMessageAction'
export { ActionFailure } from './ui/ActionFailure'
