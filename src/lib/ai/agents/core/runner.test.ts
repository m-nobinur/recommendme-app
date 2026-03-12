import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentConfig } from './config'
import type { AgentHandler } from './handler'
import { executePlan } from './runner'
import type {
  ActionResult,
  AgentAction,
  AgentContext,
  AgentPlan,
  LoadContextParams,
  PlanPrompt,
} from './types'

function makeConfig(overrides?: Partial<AgentConfig['guardrails']>): AgentConfig {
  return {
    agentType: 'followup',
    displayName: 'Test Agent',
    description: 'Runner test agent',
    defaultRiskLevel: 'low',
    triggerType: 'cron',
    llm: { model: 'test', temperature: 0, maxTokens: 100 },
    memory: {
      readLayers: ['business'],
      writeAgentMemories: false,
      maxMemoriesPerQuery: 5,
    },
    guardrails: {
      allowedActions: ['update_lead_notes', 'update_lead_status'],
      maxActionsPerRun: 3,
      riskOverrides: {},
      requireApprovalAbove: 'high',
      ...overrides,
    },
    scheduling: { batchSize: 10, cooldownMinutes: 30 },
  }
}

function makeContext(): AgentContext {
  return {
    organizationId: 'org_1',
    userId: 'user_1',
    agentType: 'followup',
    executionId: 'exec_1',
    leads: [
      { id: 'lead_1', name: 'Test Lead', status: 'Contacted', tags: [], daysSinceContact: 5 },
    ],
    appointments: [],
    agentMemories: [],
    businessContext: [],
    timestamp: Date.now(),
  }
}

function makeAction(type: string, riskLevel: 'low' | 'medium' | 'high' = 'low'): AgentAction {
  return {
    type,
    target: 'lead_1',
    params: { notes: 'test', status: 'Qualified' },
    riskLevel,
    reasoning: 'test',
  }
}

class FakeHandler implements AgentHandler {
  readonly agentType = 'followup' as const
  readonly config: AgentConfig
  public executed: AgentAction[] = []

  constructor(config: AgentConfig) {
    this.config = config
  }

  async loadContext(_params: LoadContextParams): Promise<AgentContext> {
    return makeContext()
  }

  buildPlanPrompt(_context: AgentContext): PlanPrompt {
    return { system: 'system', user: 'user' }
  }

  validatePlan(raw: unknown): AgentPlan {
    return raw as AgentPlan
  }

  async executeAction(action: AgentAction, _context: AgentContext): Promise<ActionResult> {
    this.executed.push(action)
    return {
      action,
      success: true,
      message: 'ok',
      durationMs: 1,
    }
  }

  async learn(_context: AgentContext, _results: ActionResult[]): Promise<void> {
    return
  }
}

describe('executePlan', () => {
  it('filters actions not in allowlist before execution', async () => {
    const handler = new FakeHandler(makeConfig())
    const context = makeContext()

    const rawPlan: AgentPlan = {
      actions: [makeAction('update_lead_notes'), makeAction('delete_lead')],
      summary: 'mixed',
      reasoning: 'mixed',
    }

    const result = await executePlan(handler, rawPlan, context, {} as never)

    assert.equal(result.actionsPlanned, 2)
    assert.equal(result.actionsExecuted, 1)
    assert.equal(result.actionsSkipped, 1)
    assert.equal(handler.executed.length, 1)
    assert.equal(handler.executed[0].type, 'update_lead_notes')
  })

  it('skips actions that require approval after risk assessment', async () => {
    const handler = new FakeHandler(
      makeConfig({
        requireApprovalAbove: 'high',
        riskOverrides: { update_lead_status: 'high' },
      })
    )
    const context = makeContext()

    const rawPlan: AgentPlan = {
      actions: [makeAction('update_lead_status', 'low'), makeAction('update_lead_notes', 'low')],
      summary: 'risk test',
      reasoning: 'risk test',
    }

    const result = await executePlan(handler, rawPlan, context, {} as never)

    assert.equal(result.actionsPlanned, 2)
    assert.equal(result.actionsExecuted, 1)
    assert.equal(result.actionsSkipped, 1)
    assert.equal(handler.executed.length, 1)
    assert.equal(handler.executed[0].type, 'update_lead_notes')
  })
})
