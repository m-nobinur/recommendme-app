import type { AgentType, MemoryLayer, RiskLevel, TriggerType } from './types'

export interface AgentLLMConfig {
  model: string
  temperature: number
  maxTokens: number
}

export interface AgentMemoryConfig {
  readLayers: MemoryLayer[]
  writeAgentMemories: boolean
  maxMemoriesPerQuery: number
}

export interface AgentGuardrailsConfig {
  allowedActions: string[]
  maxActionsPerRun: number
  riskOverrides: Record<string, RiskLevel>
  requireApprovalAbove: RiskLevel
}

export interface AgentSchedulingConfig {
  cronSchedule?: string
  batchSize: number
  cooldownMinutes: number
}

export interface AgentConfig {
  agentType: AgentType
  displayName: string
  description: string
  defaultRiskLevel: RiskLevel
  triggerType: TriggerType

  llm: AgentLLMConfig
  memory: AgentMemoryConfig
  guardrails: AgentGuardrailsConfig
  scheduling: AgentSchedulingConfig
}

export const DEFAULT_LLM_CONFIG: AgentLLMConfig = {
  model: 'openai/gpt-4o-mini',
  temperature: 0,
  maxTokens: 2000,
}

export const DEFAULT_MEMORY_CONFIG: AgentMemoryConfig = {
  readLayers: ['business', 'agent'],
  writeAgentMemories: true,
  maxMemoriesPerQuery: 10,
}

export const DEFAULT_GUARDRAILS_CONFIG: AgentGuardrailsConfig = {
  allowedActions: [],
  maxActionsPerRun: 10,
  riskOverrides: {},
  requireApprovalAbove: 'high',
}

export const DEFAULT_SCHEDULING_CONFIG: AgentSchedulingConfig = {
  batchSize: 20,
  cooldownMinutes: 30,
}
