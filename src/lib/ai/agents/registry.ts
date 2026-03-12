import type { AgentHandler } from './core/handler'
import type { AgentType } from './core/types'
import { FollowupHandler } from './followup/handler'
import { InvoiceHandler } from './invoice/handler'
import { ReminderHandler } from './reminder/handler'
import { SalesHandler } from './sales/handler'

type HandlerFactory = () => AgentHandler

const AGENT_REGISTRY: Record<AgentType, HandlerFactory> = {
  followup: () => new FollowupHandler(),
  reminder: () => new ReminderHandler(),
  invoice: () => new InvoiceHandler(),
  sales: () => new SalesHandler(),
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
