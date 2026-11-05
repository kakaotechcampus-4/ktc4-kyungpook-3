import type { RequestHandler } from 'msw'
import { authHandlers } from './auth'
import { memberHandlers } from './member'
import { workspaceHandlers } from './workspace'
import { integrationHandlers } from './integration'
import { meetingHandlers } from './meeting'
import { speakerHandlers } from './speaker'
import { minutesHandlers } from './minutes'
import { extractionHandlers } from './extraction'
import { taskHandlers } from './task'
import { approvalHandlers } from './approval'
import { messageHandlers } from './message'
import { notificationHandlers } from './notification'
import { invitationHandlers } from './invitation'

/** Entity handler modules are accumulated here for the common browser and test server. */
export const handlers: RequestHandler[] = [
  ...authHandlers,
  ...workspaceHandlers,
  ...memberHandlers,
  ...integrationHandlers,
  ...meetingHandlers,
  ...speakerHandlers,
  ...minutesHandlers,
  ...extractionHandlers,
  ...taskHandlers,
  ...approvalHandlers,
  ...messageHandlers,
  ...notificationHandlers,
  ...invitationHandlers,
]
