import { validateInvoicePlan } from '@convex/agentLogic/invoice'
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
import type { InvoiceAgentSettings } from './config'
import { DEFAULT_INVOICE_SETTINGS, INVOICE_CONFIG } from './config'
import { buildInvoiceUserPrompt, INVOICE_SYSTEM_PROMPT } from './prompt'
import { executeInvoiceAction } from './tools'

const MS_PER_DAY = 86_400_000

/**
 * Next.js-side handler for the Invoice Agent.
 *
 * PRODUCTION NOTE: The daily cron executes via the Convex-side path in
 * `agentRunner.ts`, not through this handler. This class exists as a
 * future-ready scaffold for API-route or manual triggers that need to run
 * the agent pipeline outside of Convex (e.g., via `runAgentPipeline`).
 * Both paths share the same prompt builder, plan validator, and config
 * from `@convex/agentLogic/invoice`.
 */
export class InvoiceHandler implements AgentHandler {
  readonly agentType: AgentType = 'invoice'
  readonly config: AgentConfig = INVOICE_CONFIG
  private readonly settings: InvoiceAgentSettings
  private convex: ConvexHttpClient | null = null

  constructor(settings?: Partial<InvoiceAgentSettings>) {
    this.settings = { ...DEFAULT_INVOICE_SETTINGS, ...settings }
  }

  async loadContext(params: LoadContextParams): Promise<AgentContext> {
    const { organizationId, userId, convex, executionId } = params
    this.convex = convex
    const { api } = await getApi()
    const now = Date.now()

    const orgId = asOrganizationId(organizationId)
    const uid = asAppUserId(userId)

    const [allAppointments, allInvoices, allLeads] = await Promise.all([
      convex.query(api.appointments.list, { userId: uid, organizationId: orgId }),
      convex.query(api.invoices.list, { userId: uid, organizationId: orgId }),
      convex.query(api.leads.list, { userId: uid, organizationId: orgId }),
    ])

    const existingInvoiceLeadIds = new Set(
      (allInvoices as Array<{ leadId: string }>).map((i) => String(i.leadId))
    )

    const completedAppointments = (allAppointments as Array<Record<string, unknown>>)
      .filter((a) => String(a.status) === 'completed')
      .filter((a) => !existingInvoiceLeadIds.has(String(a.leadId)))
      .slice(0, this.settings.maxInvoicesPerBatch)
      .map((a) => ({
        id: String(a._id),
        leadId: String(a.leadId),
        leadName: String(a.leadName),
        date: String(a.date),
        time: String(a.time),
        title: a.title ? String(a.title) : undefined,
        status: String(a.status),
        hoursUntil: 0,
      }))

    const overdueInvoices: InvoiceSummary[] = (allInvoices as Array<Record<string, unknown>>)
      .filter((i) => {
        if (String(i.status) !== 'sent') return false
        const dueDate = i.dueDate ? String(i.dueDate) : undefined
        if (!dueDate) return false
        const dueMs = Date.parse(dueDate)
        return !Number.isNaN(dueMs) && dueMs < now - this.settings.overdueThresholdDays * MS_PER_DAY
      })
      .slice(0, this.settings.maxInvoicesPerBatch)
      .map((i) => {
        const dueDate = i.dueDate ? String(i.dueDate) : undefined
        const dueMs = dueDate ? Date.parse(dueDate) : now
        return {
          id: String(i._id),
          leadName: String(i.leadName),
          amount: Number(i.amount ?? 0),
          status: String(i.status) as 'draft' | 'sent' | 'paid',
          dueDate,
          daysSinceDue: Math.floor((now - dueMs) / MS_PER_DAY),
          createdAt: Number(i.createdAt ?? now),
        }
      })

    const relevantLeadIds = new Set([
      ...completedAppointments.map((a) => a.leadId),
      ...(allInvoices as Array<Record<string, unknown>>)
        .filter((i) => overdueInvoices.some((o) => o.id === String(i._id)))
        .map((i) => String(i.leadId)),
    ])

    const relevantLeads = (allLeads as Array<Record<string, unknown>>)
      .filter((l) => relevantLeadIds.has(String(l._id)))
      .map((l) => ({
        id: String(l._id),
        name: String(l.name),
        status: String(l.status),
        phone: l.phone ? String(l.phone) : undefined,
        email: l.email ? String(l.email) : undefined,
        value: l.value ? Number(l.value) : undefined,
        tags: (l.tags as string[]) ?? [],
        notes: l.notes ? String(l.notes) : undefined,
        daysSinceContact: 0,
      }))

    return {
      organizationId,
      userId,
      agentType: 'invoice',
      executionId,
      leads: relevantLeads,
      appointments: completedAppointments,
      invoices: overdueInvoices,
      agentMemories: [],
      businessContext: [],
      timestamp: now,
    }
  }

  buildPlanPrompt(context: AgentContext): PlanPrompt {
    return {
      system: INVOICE_SYSTEM_PROMPT,
      user: buildInvoiceUserPrompt(context),
    }
  }

  validatePlan(raw: unknown): AgentPlan {
    return validateInvoicePlan(raw)
  }

  async executeAction(action: AgentAction, context: AgentContext): Promise<ActionResult> {
    if (!this.convex) {
      throw new Error('ConvexHttpClient not available — loadContext must be called first')
    }
    return executeInvoiceAction(action, context, this.convex)
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
        'invoice',
        'success',
        `Successfully executed ${successes.length} invoice actions (${types.join(', ')}).`,
        0.8
      )
    }

    if (failures.length > 0) {
      const errors = failures.map((r) => `${r.action.type}: ${r.error}`).join('; ')
      await recordLearning(
        this.convex,
        context.organizationId,
        'invoice',
        'failure',
        `Failed ${failures.length} invoice actions: ${errors}`,
        0.6
      )
    }
  }
}
