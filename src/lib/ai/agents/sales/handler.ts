import { validateSalesPlan } from '@convex/agentLogic/sales'
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
  InvoiceSummary,
  LoadContextParams,
  PlanPrompt,
} from '../core/types'
import type { SalesAgentSettings } from './config'
import { DEFAULT_SALES_SETTINGS, SALES_CONFIG } from './config'
import { buildSalesUserPrompt, SALES_SYSTEM_PROMPT } from './prompt'
import { executeSalesAction } from './tools'

const MS_PER_DAY = 86_400_000

/**
 * Next.js-side handler for the Sales Funnel Agent.
 *
 * PRODUCTION NOTE: The daily cron executes via the Convex-side path in
 * `agentRunner.ts`, not through this handler. This class exists as a
 * future-ready scaffold for API-route or manual triggers that need to run
 * the agent pipeline outside of Convex (e.g., via `runAgentPipeline`).
 * Both paths share the same prompt builder, plan validator, and config
 * from `@convex/agentLogic/sales`.
 */
export class SalesHandler implements AgentHandler {
  readonly agentType: AgentType = 'sales'
  readonly config: AgentConfig = SALES_CONFIG
  private readonly settings: SalesAgentSettings
  private convex: ConvexHttpClient | null = null

  constructor(settings?: Partial<SalesAgentSettings>) {
    this.settings = { ...DEFAULT_SALES_SETTINGS, ...settings }
  }

  async loadContext(params: LoadContextParams): Promise<AgentContext> {
    const { organizationId, userId, convex, executionId } = params
    this.convex = convex
    const { api } = await getApi()
    const now = Date.now()

    const orgId = asOrganizationId(organizationId)
    const uid = asAppUserId(userId)

    const [allLeads, allAppointments, allInvoices] = await Promise.all([
      convex.query(api.leads.list, { userId: uid, organizationId: orgId }),
      convex.query(api.appointments.list, { userId: uid, organizationId: orgId }),
      convex.query(api.invoices.list, { userId: uid, organizationId: orgId }),
    ])

    const leads = (allLeads as Array<Record<string, unknown>>)
      .slice(0, this.settings.maxLeadsPerBatch)
      .map((l) => {
        const updatedAt = Number(l.updatedAt ?? l.createdAt ?? now)
        const lastContact = l.lastContact ? Number(l.lastContact) : undefined
        const daysSinceContact = Math.floor((now - (lastContact ?? updatedAt)) / MS_PER_DAY)

        return {
          id: String(l._id),
          name: String(l.name),
          status: String(l.status),
          phone: l.phone ? String(l.phone) : undefined,
          email: l.email ? String(l.email) : undefined,
          value: l.value ? Number(l.value) : undefined,
          tags: (l.tags as string[]) ?? [],
          notes: l.notes ? String(l.notes) : undefined,
          lastContact,
          daysSinceContact,
        }
      })

    const appointments = (allAppointments as Array<Record<string, unknown>>).map((a) => ({
      id: String(a._id),
      leadId: a.leadId ? String(a.leadId) : undefined,
      leadName: String(a.leadName),
      date: String(a.date),
      time: String(a.time),
      title: a.title ? String(a.title) : undefined,
      status: String(a.status),
      hoursUntil: 0,
    }))

    const invoices: InvoiceSummary[] = (allInvoices as Array<Record<string, unknown>>).map((i) => ({
      id: String(i._id),
      leadName: String(i.leadName),
      amount: Number(i.amount ?? 0),
      status: String(i.status) as 'draft' | 'sent' | 'paid',
      dueDate: i.dueDate ? String(i.dueDate) : undefined,
      createdAt: Number(i.createdAt ?? now),
    }))

    return {
      organizationId,
      userId,
      agentType: 'sales',
      executionId,
      leads,
      appointments,
      invoices,
      agentMemories: [],
      businessContext: [],
      timestamp: now,
    }
  }

  buildPlanPrompt(context: AgentContext): PlanPrompt {
    return {
      system: SALES_SYSTEM_PROMPT,
      user: buildSalesUserPrompt(context),
    }
  }

  validatePlan(raw: unknown): AgentPlan {
    return validateSalesPlan(raw)
  }

  async executeAction(action: AgentAction, context: AgentContext): Promise<ActionResult> {
    if (!this.convex) {
      throw new Error('ConvexHttpClient not available — loadContext must be called first')
    }
    return executeSalesAction(action, context, this.convex)
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
        'sales',
        'success',
        `Successfully executed ${successes.length} sales actions (${types.join(', ')}).`,
        0.8
      )
    }

    if (failures.length > 0) {
      const errors = failures.map((r) => `${r.action.type}: ${r.error}`).join('; ')
      await recordLearning(
        this.convex,
        context.organizationId,
        'sales',
        'failure',
        `Failed ${failures.length} sales actions: ${errors}`,
        0.6
      )
    }
  }
}
