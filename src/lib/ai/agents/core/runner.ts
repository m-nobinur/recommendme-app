import type { ConvexHttpClient } from 'convex/browser'
import { validatePlan as applyGuardrails } from './guardrails'
import type { AgentHandler } from './handler'
import { loadAgentMemories, loadBusinessContext } from './memory'
import { assessPlan } from './risk'
import type { ActionResult, ExecutionStatus, ExecutionSummary } from './types'

interface RunnerCallbacks {
  onStatusChange?: (status: ExecutionStatus) => Promise<void>
}

/**
 * Run a full agent pipeline: loadContext -> plan -> risk -> execute -> learn.
 *
 * This is the linear orchestrator. When LangGraph is added, this function
 * is replaced by a StateGraph where each step is a graph node calling the
 * same handler methods.
 */
export async function runAgentPipeline(
  handler: AgentHandler,
  organizationId: string,
  userId: string,
  convex: ConvexHttpClient,
  executionId: string,
  callbacks?: RunnerCallbacks
): Promise<ExecutionSummary> {
  const startTime = Date.now()
  const { config } = handler

  const updateStatus = async (next: ExecutionStatus) => {
    await callbacks?.onStatusChange?.(next)
  }

  try {
    await updateStatus('loading_context')
    const context = await handler.loadContext({ organizationId, userId, convex, executionId })

    if (config.memory.readLayers.includes('agent')) {
      const agentMem = await loadAgentMemories(
        convex,
        organizationId,
        handler.agentType,
        config.memory.maxMemoriesPerQuery
      )
      context.agentMemories = [...context.agentMemories, ...agentMem]
    }

    if (config.memory.readLayers.includes('business') && context.businessContext.length === 0) {
      context.businessContext = await loadBusinessContext(convex, organizationId)
    }

    if (context.leads.length === 0) {
      await updateStatus('skipped')
      return buildSummary(executionId, handler, organizationId, 'skipped', 0, 0, 0, startTime)
    }

    await updateStatus('planning')
    const prompt = handler.buildPlanPrompt(context)

    void prompt

    return buildSummary(executionId, handler, organizationId, 'planning', 0, 0, 0, startTime)
  } catch (error) {
    await updateStatus('failed')
    const message = error instanceof Error ? error.message : 'Unknown error'
    return buildSummary(executionId, handler, organizationId, 'failed', 0, 0, 0, startTime, message)
  }
}

/**
 * Execute the post-LLM portion of the pipeline: validate plan, apply
 * guardrails, assess risk, execute approved actions, and learn.
 *
 * Called by the Convex action after LLM planning completes.
 */
export async function executePlan(
  handler: AgentHandler,
  rawPlan: unknown,
  context: import('./types').AgentContext,
  _convex: ConvexHttpClient,
  callbacks?: RunnerCallbacks
): Promise<{
  results: ActionResult[]
  actionsPlanned: number
  actionsExecuted: number
  actionsSkipped: number
}> {
  const { config } = handler

  const plan = handler.validatePlan(rawPlan)

  const { approved, rejected } = applyGuardrails(plan, config)
  for (const r of rejected) {
    console.warn(`[Agent:Guardrail] Rejected action '${r.action.type}': ${r.reason}`)
  }

  await callbacks?.onStatusChange?.('risk_assessing')
  const riskAssessment = assessPlan({ ...plan, actions: approved }, config.guardrails)

  await callbacks?.onStatusChange?.('executing')
  const results: ActionResult[] = []
  let executed = 0
  let skipped = rejected.length

  for (const assessment of riskAssessment.actionAssessments) {
    if (!assessment.approved) {
      skipped++
      console.warn(`[Agent:Risk] Skipped action '${assessment.action.type}': ${assessment.reason}`)
      continue
    }

    const actionStart = Date.now()
    try {
      const result = await handler.executeAction(assessment.action, context)
      results.push(result)
      executed++
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      results.push({
        action: assessment.action,
        success: false,
        message,
        error: message,
        durationMs: Date.now() - actionStart,
      })
    }
  }

  if (config.memory.writeAgentMemories && results.length > 0) {
    try {
      await handler.learn(context, results)
    } catch (error) {
      console.error('[Agent:Learn] Failed to record learnings:', error)
    }
  }

  return {
    results,
    actionsPlanned: plan.actions.length,
    actionsExecuted: executed,
    actionsSkipped: skipped,
  }
}

function buildSummary(
  executionId: string,
  handler: AgentHandler,
  organizationId: string,
  status: ExecutionStatus,
  planned: number,
  executed: number,
  skipped: number,
  startTime: number,
  error?: string
): ExecutionSummary {
  return {
    executionId,
    agentType: handler.agentType,
    organizationId,
    status,
    actionsPlanned: planned,
    actionsExecuted: executed,
    actionsSkipped: skipped,
    durationMs: Date.now() - startTime,
    error,
  }
}
