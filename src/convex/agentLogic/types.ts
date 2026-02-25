export const AGENT_TYPES = ['followup', 'reminder', 'invoice', 'sales'] as const
export type AgentType = (typeof AGENT_TYPES)[number]

export const RISK_LEVELS = ['low', 'medium', 'high'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

export const TRIGGER_TYPES = ['cron', 'event', 'manual'] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

export const MEMORY_LAYERS = ['platform', 'niche', 'business', 'agent'] as const
export type MemoryLayer = (typeof MEMORY_LAYERS)[number]

export const EXECUTION_STATUSES = [
  'pending',
  'loading_context',
  'planning',
  'risk_assessing',
  'executing',
  'awaiting_approval',
  'completed',
  'failed',
  'skipped',
] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export interface AgentAction {
  type: string
  target: string
  params: Record<string, unknown>
  riskLevel: RiskLevel
  reasoning: string
}

export interface AgentPlan {
  actions: AgentAction[]
  summary: string
  reasoning: string
}

export interface ActionResult {
  action: AgentAction
  success: boolean
  message: string
  data?: Record<string, unknown>
  error?: string
  durationMs: number
}

export interface PlanPrompt {
  system: string
  user: string
}

export interface LeadSummary {
  id: string
  name: string
  status: string
  phone?: string
  email?: string
  value?: number
  tags: string[]
  notes?: string
  lastContact?: number
  daysSinceContact: number
}

export interface AppointmentSummary {
  id: string
  leadName: string
  date: string
  time: string
  title?: string
  status: string
}

export interface AgentMemorySummary {
  id: string
  category: string
  content: string
  confidence: number
  successRate: number
  useCount: number
}

export interface AgentContext {
  organizationId: string
  userId: string
  agentType: AgentType
  executionId?: string
  leads: LeadSummary[]
  appointments: AppointmentSummary[]
  agentMemories: AgentMemorySummary[]
  businessContext: string[]
  timestamp: number
}

export interface RiskAssessment {
  overallRisk: RiskLevel
  actionAssessments: Array<{
    action: AgentAction
    assessedRisk: RiskLevel
    approved: boolean
    reason?: string
  }>
}

export interface ExecutionSummary {
  executionId: string
  agentType: AgentType
  organizationId: string
  status: ExecutionStatus
  actionsPlanned: number
  actionsExecuted: number
  actionsSkipped: number
  durationMs: number
  error?: string
}
