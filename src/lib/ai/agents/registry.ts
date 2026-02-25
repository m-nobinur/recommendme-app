import type { AgentHandler } from './core/handler'
import type { AgentType } from './core/types'
import { FollowupHandler } from './followup/handler'

type HandlerFactory = () => AgentHandler

const AGENT_REGISTRY: Record<AgentType, HandlerFactory> = {
  followup: () => new FollowupHandler(),
  reminder: () => {
    throw new Error('Reminder agent not yet implemented')
  },
  invoice: () => {
    throw new Error('Invoice agent not yet implemented')
  },
  sales: () => {
    throw new Error('Sales agent not yet implemented')
  },
}

export function getAgentHandler(agentType: AgentType): AgentHandler {
  const factory = AGENT_REGISTRY[agentType]
  if (!factory) {
    throw new Error(`Unknown agent type: ${agentType}`)
  }
  return factory()
}

export function getRegisteredAgentTypes(): AgentType[] {
  return Object.keys(AGENT_REGISTRY) as AgentType[]
}

export function isAgentImplemented(agentType: AgentType): boolean {
  try {
    AGENT_REGISTRY[agentType]()
    return true
  } catch {
    return false
  }
}
