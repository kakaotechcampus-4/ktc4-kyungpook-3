import type { RequestHandler } from 'msw'
import { authHandlers } from './auth'
import { consentHandlers } from './consent'
import { passwordResetHandlers } from './passwordReset'
import { signupCodeHandlers } from './signupCode'
import { memberHandlers } from './member'
import { workspaceHandlers } from './workspace'
import { integrationHandlers } from './integration'
import { meetingHandlers } from './meeting'
import { speakerHandlers } from './speaker'
import { minutesHandlers } from './minutes'
import { markdownFileHandlers } from './markdownFiles'
import { extractionHandlers } from './extraction'
import { taskHandlers } from './task'
import { approvalHandlers } from './approval'
import { messageHandlers } from './message'
import { messageSettingsHandlers } from './messageSettings'
import { notificationHandlers } from './notification'
import { invitationHandlers } from './invitation'
import { withdrawalHandlers } from './withdrawal'

/** Entity handler modules are accumulated here for the common browser and test server. */
export const handlers: RequestHandler[] = [
  ...authHandlers,
  ...consentHandlers,
  ...withdrawalHandlers,
  ...passwordResetHandlers,
  ...signupCodeHandlers,
  ...workspaceHandlers,
  ...memberHandlers,
  ...integrationHandlers,
  ...meetingHandlers,
  ...speakerHandlers,
  ...minutesHandlers,
  ...markdownFileHandlers,
  ...extractionHandlers,
  ...taskHandlers,
  ...approvalHandlers,
  ...messageHandlers,
  ...messageSettingsHandlers,
  ...notificationHandlers,
  ...invitationHandlers,
]
