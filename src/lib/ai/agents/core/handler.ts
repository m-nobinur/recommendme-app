import type { AgentConfig } from './config'
import type {
  ActionResult,
  AgentAction,
  AgentContext,
  AgentPlan,
  AgentType,
  LoadContextParams,
  PlanPrompt,
} from './types'

/**
 * Abstract handler interface for all agents.
 *
 * Each method maps to a step in the execution pipeline and, in the future,
 * to a LangGraph StateGraph node. Implement this interface to create a new
 * agent type.
 *
 * Pipeline: loadContext -> buildPlanPrompt -> validatePlan -> executeAction -> learn
 */
export interface AgentHandler {
  readonly agentType: AgentType
  readonly config: AgentConfig

  /** Gather the data this agent needs (leads, appointments, memories, etc.) */
  loadContext(params: LoadContextParams): Promise<AgentContext>

  /** Build the system + user prompt pair for LLM planning */
  buildPlanPrompt(context: AgentContext): PlanPrompt

  /** Parse and validate raw LLM JSON output into a typed AgentPlan */
  validatePlan(raw: unknown): AgentPlan

  /** Execute a single planned action against the data layer */
  executeAction(action: AgentAction, context: AgentContext): Promise<ActionResult>

  /** Post-execution: record learnings in agent memory */
  learn(context: AgentContext, results: ActionResult[]): Promise<void>
}
