export type { FollowupAgentSettings } from './config'
export { DEFAULT_FOLLOWUP_SETTINGS, FOLLOWUP_CONFIG } from './config'
export { FollowupHandler } from './handler'
export type {
  FollowupAppointmentData,
  FollowupLeadData,
  FollowupMemoryData,
} from './prompt'
export { buildFollowupUserPrompt, FOLLOWUP_SYSTEM_PROMPT } from './prompt'
export { executeFollowupAction, FOLLOWUP_ACTIONS } from './tools'
