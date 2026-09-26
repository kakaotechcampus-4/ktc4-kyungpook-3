import type { RequestHandler } from 'msw'
import { authHandlers } from './auth'
import { memberHandlers } from './member'
import { workspaceHandlers } from './workspace'
import { integrationHandlers } from './integration'
import { meetingHandlers } from './meeting'
import { minutesHandlers } from './minutes'
import { extractionHandlers } from './extraction'
import { taskHandlers } from './task'
import { approvalHandlers } from './approval'

/** Entity handler modules are accumulated here for the common browser and test server. */
export const handlers: RequestHandler[] = [
  ...authHandlers,
  ...workspaceHandlers,
  ...memberHandlers,
  ...integrationHandlers,
  ...meetingHandlers,
  ...minutesHandlers,
  ...extractionHandlers,
  ...taskHandlers,
  ...approvalHandlers,
]
