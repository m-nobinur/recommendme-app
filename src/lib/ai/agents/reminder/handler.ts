import { validateReminderPlan } from '@convex/agentLogic/reminder'
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
import type { ReminderAgentSettings } from './config'
import { DEFAULT_REMINDER_SETTINGS, REMINDER_CONFIG } from './config'
import { buildReminderUserPrompt, REMINDER_SYSTEM_PROMPT } from './prompt'
import { executeReminderAction } from './tools'

const MS_PER_HOUR = 3_600_000

/**
 * Next.js-side handler for the Reminder Agent.
 *
 * PRODUCTION NOTE: The daily cron executes via the Convex-side path in
 * `agentRunner.ts`, not through this handler. This class exists as a
 * future-ready scaffold for API-route or manual triggers that need to run
 * the agent pipeline outside of Convex (e.g., via `runAgentPipeline`).
 * Both paths share the same prompt builder, plan validator, and config
 * from `@convex/agentLogic/reminder`.
 */
export class ReminderHandler implements AgentHandler {
  readonly agentType: AgentType = 'reminder'
  readonly config: AgentConfig = REMINDER_CONFIG
  private readonly settings: ReminderAgentSettings
  private convex: ConvexHttpClient | null = null

  constructor(settings?: Partial<ReminderAgentSettings>) {
    this.settings = { ...DEFAULT_REMINDER_SETTINGS, ...settings }
  }

  async loadContext(params: LoadContextParams): Promise<AgentContext> {
    const { organizationId, userId, convex, executionId } = params
    this.convex = convex
    const { api } = await getApi()
    const now = Date.now()
    const maxWindowHours = Math.max(...this.settings.reminderWindowHours)
    const windowEnd = now + maxWindowHours * MS_PER_HOUR

    const allAppointments = await convex.query(api.appointments.list, {
      userId: asAppUserId(userId),
      organizationId: asOrganizationId(organizationId),
    })

    const today = new Date(now)
    const todayStr = today.toISOString().split('T')[0]
    const windowEndDate = new Date(windowEnd)
    const windowEndStr = windowEndDate.toISOString().split('T')[0]

    const upcomingAppointments = allAppointments
      .filter((a: Record<string, unknown>) => {
        const status = String(a.status)
        const date = String(a.date)
        const notes = a.notes ? String(a.notes) : ''
        const time = String(a.time)
        const appointmentTime = Date.parse(`${date}T${time}:00Z`)
        return (
          status === 'scheduled' &&
          date >= todayStr &&
          date <= windowEndStr &&
          appointmentTime > now &&
          !notes.includes('[Reminder')
        )
      })
      .slice(0, this.settings.maxAppointmentsPerBatch)
      .map((a: Record<string, unknown>) => {
        const dateStr = String(a.date)
        const timeStr = String(a.time)
        const apptTime = Date.parse(`${dateStr}T${timeStr}:00Z`)
        const rawHours = Math.round((apptTime - now) / MS_PER_HOUR)
        const hoursUntil = Number.isNaN(rawHours) ? 0 : Math.max(0, rawHours)

        return {
          id: String(a._id),
          leadId: String(a.leadId),
          leadName: String(a.leadName),
          date: dateStr,
          time: timeStr,
          title: a.title ? String(a.title) : undefined,
          notes: a.notes ? String(a.notes) : undefined,
          status: String(a.status),
          hoursUntil,
        }
      })

    const leadIds = new Set(upcomingAppointments.map((appointment) => appointment.leadId))

    const allLeads = await convex.query(api.leads.list, {
      userId: asAppUserId(userId),
      organizationId: asOrganizationId(organizationId),
    })

    const relevantLeads = allLeads
      .filter((l: Record<string, unknown>) => leadIds.has(String(l._id)))
      .map((l: Record<string, unknown>) => ({
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
      agentType: 'reminder',
      executionId,
      leads: relevantLeads,
      appointments: upcomingAppointments,
      agentMemories: [],
      businessContext: [],
      timestamp: now,
    }
  }

  buildPlanPrompt(context: AgentContext): PlanPrompt {
    return {
      system: REMINDER_SYSTEM_PROMPT,
      user: buildReminderUserPrompt(context),
    }
  }

  validatePlan(raw: unknown): AgentPlan {
    return validateReminderPlan(raw)
  }

  async executeAction(action: AgentAction, context: AgentContext): Promise<ActionResult> {
    if (!this.convex) {
      throw new Error('ConvexHttpClient not available — loadContext must be called first')
    }
    return executeReminderAction(action, context, this.convex)
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
        'reminder',
        'success',
        `Successfully executed ${successes.length} reminder actions (${types.join(', ')}) for ${context.appointments.length} upcoming appointments.`,
        0.8
      )
    }

    if (failures.length > 0) {
      const errors = failures.map((r) => `${r.action.type}: ${r.error}`).join('; ')
      await recordLearning(
        this.convex,
        context.organizationId,
        'reminder',
        'failure',
        `Failed ${failures.length} reminder actions: ${errors}`,
        0.6
      )
    }
  }
}
