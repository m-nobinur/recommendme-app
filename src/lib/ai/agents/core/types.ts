import type { ConvexHttpClient } from 'convex/browser'

export type {
  ActionResult,
  AgentAction,
  AgentContext,
  AgentMemorySummary,
  AgentPlan,
  AgentType,
  AppointmentSummary,
  ExecutionStatus,
  ExecutionSummary,
  InvoiceSummary,
  LeadSummary,
  MemoryLayer,
  PlanPrompt,
  RiskAssessment,
  RiskLevel,
  TriggerType,
} from '@convex/agentLogic/types'

export {
  AGENT_TYPES,
  EXECUTION_STATUSES,
  MEMORY_LAYERS,
  RISK_LEVELS,
  TRIGGER_TYPES,
} from '@convex/agentLogic/types'

export interface LoadContextParams {
  organizationId: string
  userId: string
  convex: ConvexHttpClient
  executionId?: string
}
