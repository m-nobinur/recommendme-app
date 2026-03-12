import { validateFollowupPlan } from '@convex/agentLogic/followup'
import type { ConvexHttpClient } from 'convex/browser'
import { asAppUserId, asOrganizationId, getApi } from '../../shared/convex'
import type { AgentConfig } from '../core/config'
import type { AgentHandler } from '../core/handler'
import { recordLearning } from '../core/memory'
import type {
  ActionResult,
  AgentAction,
  AgentContext,
  AgentPlan,
  AgentType,
  LoadContextParams,
  PlanPrompt,
} from '../core/types'
import type { FollowupAgentSettings } from './config'
import { DEFAULT_FOLLOWUP_SETTINGS, FOLLOWUP_CONFIG } from './config'
import { buildFollowupUserPrompt, FOLLOWUP_SYSTEM_PROMPT } from './prompt'
import { executeFollowupAction } from './tools'

const MS_PER_DAY = 86_400_000

export class FollowupHandler implements AgentHandler {
  readonly agentType: AgentType = 'followup'
  readonly config: AgentConfig = FOLLOWUP_CONFIG
  private readonly settings: FollowupAgentSettings
  private convex: ConvexHttpClient | null = null

  constructor(settings?: Partial<FollowupAgentSettings>) {
    this.settings = { ...DEFAULT_FOLLOWUP_SETTINGS, ...settings }
  }

  async loadContext(params: LoadContextParams): Promise<AgentContext> {
    const { organizationId, userId, convex, executionId } = params
    this.convex = convex
    const { api } = await getApi()
    const now = Date.now()
    const staleThreshold = now - this.settings.staleDaysThreshold * MS_PER_DAY

    const allLeads = await convex.query(api.leads.list, {
      userId: asAppUserId(userId),
      organizationId: asOrganizationId(organizationId),
    })

    const staleLeads = allLeads
      .filter((lead: Record<string, unknown>) => {
        const status = String(lead.status)
        const lastContact = (lead.lastContact as number | undefined) ?? (lead.createdAt as number)
        return this.settings.targetStatuses.includes(status) && lastContact < staleThreshold
      })
      .slice(0, this.settings.maxLeadsPerBatch)
      .map((lead: Record<string, unknown>) => {
        const lastContact = (lead.lastContact as number | undefined) ?? (lead.createdAt as number)
        return {
          id: String(lead._id),
          name: String(lead.name),
          status: String(lead.status),
          phone: lead.phone ? String(lead.phone) : undefined,
          email: lead.email ? String(lead.email) : undefined,
          value: lead.value ? Number(lead.value) : undefined,
          tags: (lead.tags as string[]) ?? [],
          notes: lead.notes ? String(lead.notes) : undefined,
          lastContact,
          daysSinceContact: Math.floor((now - lastContact) / MS_PER_DAY),
        }
      })

    const appointments = await convex.query(api.appointments.list, {
      userId: asAppUserId(userId),
      organizationId: asOrganizationId(organizationId),
    })

    const recentAppointments = appointments.slice(0, 10).map((a: Record<string, unknown>) => ({
      id: String(a._id),
      leadName: String(a.leadName),
      date: String(a.date),
      time: String(a.time),
      title: a.title ? String(a.title) : undefined,
      status: String(a.status),
    }))

    return {
      organizationId,
      userId,
      agentType: 'followup',
      executionId,
      leads: staleLeads,
      appointments: recentAppointments,
      agentMemories: [],
      businessContext: [],
      timestamp: now,
    }
  }

  buildPlanPrompt(context: AgentContext): PlanPrompt {
    return {
      system: FOLLOWUP_SYSTEM_PROMPT,
      user: buildFollowupUserPrompt(context),
    }
  }

  validatePlan(raw: unknown): AgentPlan {
    return validateFollowupPlan(raw)
  }

  async executeAction(action: AgentAction, context: AgentContext): Promise<ActionResult> {
    if (!this.convex) {
      throw new Error('ConvexHttpClient not available — loadContext must be called first')
    }
    return executeFollowupAction(action, context, this.convex)
  }

  async learn(context: AgentContext, results: ActionResult[]): Promise<void> {
    if (!this.convex) return

    const successes = results.filter((r) => r.success)
    const failures = results.filter((r) => !r.success)

    if (successes.length > 0) {
      const types = [...new Set(successes.map((r) => r.action.type))]
      await recordLearning(
        this.convex,
        context.organizationId,
        'followup',
        'success',
        `Successfully executed ${successes.length} followup actions (${types.join(', ')}) for ${context.leads.length} stale leads.`,
        0.8
      )
    }

    if (failures.length > 0) {
      const errors = failures.map((r) => `${r.action.type}: ${r.error}`).join('; ')
      await recordLearning(
        this.convex,
        context.organizationId,
        'followup',
        'failure',
        `Failed ${failures.length} followup actions: ${errors}`,
        0.6
      )
    }
  }
}
