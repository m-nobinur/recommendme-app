import type { Id } from '@convex/_generated/dataModel'
import { tool } from 'ai'
import { ConvexHttpClient } from 'convex/browser'
import { z } from 'zod'
import { DEFAULT_SALES_SETTINGS } from '../agents/sales/config'
import { asAppUserId, asOrganizationId, getApi } from '../shared/convex'
import type { ToolContext, ToolResult } from './index'

interface LeadScoreResult {
  leadName: string
  status: string
  score: number
  reasoning: string
  daysSinceContact: number
  appointmentCount: number
  invoiceTotal: number
}

interface PipelineOverviewResult {
  total: number
  byStatus: Record<string, number>
  totalValue: number
  staleCount: number
  sampled: boolean
  sampledStatuses: string[]
  topLeads: Array<{
    name: string
    status: string
    value?: number
    daysSinceContact: number
  }>
}

interface LeadRecommendationResult {
  leadName: string
  currentStage: string
  recommendation: string
  suggestedActions: string[]
}

const MS_PER_DAY = 86_400_000
const STALE_THRESHOLD_DAYS = DEFAULT_SALES_SETTINGS.staleThresholdDays
const MAX_TOOL_LEAD_SCAN = 500
const SALES_PIPELINE_STATUSES = [
  'New',
  'Contacted',
  'Qualified',
  'Proposal',
  'Booked',
  'Closed',
] as const

function findLeadByName<T extends { name: string }>(
  leads: T[],
  leadName: string
): { lead?: T; error?: string } {
  const query = leadName.trim().toLowerCase()
  if (!query) return { error: 'Lead name is required.' }

  const exactMatches = leads.filter((lead) => lead.name.toLowerCase() === query)
  if (exactMatches.length === 1) return { lead: exactMatches[0] }
  if (exactMatches.length > 1) {
    return { error: `Multiple leads matched "${leadName}". Please be more specific.` }
  }

  const prefixMatches = leads.filter((lead) => lead.name.toLowerCase().startsWith(query))
  if (prefixMatches.length === 1) return { lead: prefixMatches[0] }
  if (prefixMatches.length > 1) {
    const options = prefixMatches
      .slice(0, 5)
      .map((lead) => lead.name)
      .join(', ')
    return { error: `Multiple leads matched "${leadName}": ${options}.` }
  }

  const containsMatches = leads.filter((lead) => lead.name.toLowerCase().includes(query))
  if (containsMatches.length === 1) return { lead: containsMatches[0] }
  if (containsMatches.length > 1) {
    const options = containsMatches
      .slice(0, 5)
      .map((lead) => lead.name)
      .join(', ')
    return { error: `Multiple leads matched "${leadName}": ${options}.` }
  }

  return { error: `Lead "${leadName}" not found. Try a different name.` }
}

export function computeEngagementScore(lead: {
  status: string
  value?: number
  daysSinceContact: number
  appointmentCount: number
  invoiceTotal: number
}): { score: number; reasoning: string } {
  let score = 5
  const factors: string[] = []

  const stageBonus: Record<string, number> = {
    New: 0,
    Contacted: 1,
    Qualified: 2,
    Proposal: 3,
    Booked: 4,
  }
  score += stageBonus[lead.status] ?? 0
  if (stageBonus[lead.status]) {
    factors.push(`${lead.status} stage (+${stageBonus[lead.status]})`)
  }

  if (lead.appointmentCount > 0) {
    const apptBonus = Math.min(lead.appointmentCount, 3)
    score += apptBonus
    factors.push(`${lead.appointmentCount} appointment(s) (+${apptBonus})`)
  }

  if (lead.invoiceTotal > 0) {
    score += 1
    factors.push(`$${lead.invoiceTotal.toFixed(0)} invoiced (+1)`)
  }

  if (lead.value && lead.value > 1000) {
    score += 1
    factors.push(`High value: $${lead.value} (+1)`)
  }

  if (lead.daysSinceContact > STALE_THRESHOLD_DAYS) {
    const stalePenalty = Math.min(Math.floor(lead.daysSinceContact / 7), 3)
    score -= stalePenalty
    factors.push(`${lead.daysSinceContact}d inactive (-${stalePenalty})`)
  } else if (lead.daysSinceContact <= 2) {
    score += 1
    factors.push('Recently active (+1)')
  }

  score = Math.max(1, Math.min(10, score))

  return {
    score,
    reasoning: factors.length > 0 ? factors.join('; ') : 'Baseline score',
  }
}

export function createSalesFunnelTools(ctx: ToolContext) {
  const convex = ctx.convexClient ?? new ConvexHttpClient(ctx.convexUrl)
  const orgId = asOrganizationId(ctx.organizationId)
  const userId = asAppUserId(ctx.userId)

  return {
    getLeadScore: tool({
      description:
        'Get an engagement score (1-10) for a specific lead based on their pipeline stage, activity, appointments, and invoices. Use when the user asks "how hot is this lead?", "score Sarah", or "what\'s the engagement level?".',
      inputSchema: z.object({
        leadName: z.string().describe('Name of the lead to score (will fuzzy match)'),
      }),
      execute: async (args): Promise<ToolResult<LeadScoreResult>> => {
        try {
          const { api } = await getApi()
          const leads = (await convex.query(api.leads.list, {
            userId,
            organizationId: orgId,
            limit: MAX_TOOL_LEAD_SCAN,
          })) as Array<{
            _id: Id<'leads'>
            name: string
            status: string
            value?: number
            lastContact?: number
            createdAt: number
          }>

          const { lead, error } = findLeadByName(leads, args.leadName)
          if (!lead) {
            return {
              success: false,
              error: error ?? `Lead "${args.leadName}" not found. Try a different name.`,
            }
          }

          const now = Date.now()
          const daysSinceContact = Math.floor(
            (now - (lead.lastContact ?? lead.createdAt)) / MS_PER_DAY
          )

          const [appointments, invoices] = await Promise.all([
            convex.query(api.appointments.listByLead, {
              userId,
              organizationId: orgId,
              leadId: lead._id,
            }) as Promise<Array<{ status: string }>>,
            convex.query(api.invoices.listByLead, {
              userId,
              organizationId: orgId,
              leadId: lead._id,
            }) as Promise<Array<{ amount: number; status: string }>>,
          ])

          const invoiceTotal = invoices.reduce((sum, i) => sum + i.amount, 0)

          const { score, reasoning } = computeEngagementScore({
            status: lead.status,
            value: lead.value,
            daysSinceContact,
            appointmentCount: appointments.length,
            invoiceTotal,
          })

          return {
            success: true,
            data: {
              leadName: lead.name,
              status: lead.status,
              score,
              reasoning,
              daysSinceContact,
              appointmentCount: appointments.length,
              invoiceTotal,
            },
            message: `${lead.name}: ${score}/10 engagement score. ${reasoning}`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to score lead: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    getPipelineOverview: tool({
      description:
        'Get an overview of the sales pipeline including lead counts by stage, total value, stale leads, and top leads. Use when the user asks "how\'s my pipeline?", "pipeline overview", "sales summary", or "funnel stats".',
      inputSchema: z.object({}),
      execute: async (): Promise<ToolResult<PipelineOverviewResult>> => {
        try {
          const { api } = await getApi()
          const statuses = [...SALES_PIPELINE_STATUSES]
          const leadsByStatus = await Promise.all(
            statuses.map(async (status) => ({
              status,
              leads: (await convex.query(api.leads.list, {
                userId,
                organizationId: orgId,
                status,
                limit: MAX_TOOL_LEAD_SCAN,
              })) as Array<{
                name: string
                status: string
                value?: number
                lastContact?: number
                createdAt: number
              }>,
            }))
          )

          const sampledStatuses = leadsByStatus
            .filter((bucket) => bucket.leads.length === MAX_TOOL_LEAD_SCAN)
            .map((bucket) => bucket.status)
          const sampled = sampledStatuses.length > 0

          const byStatus: Record<string, number> = {}
          let total = 0
          let totalValue = 0
          for (const bucket of leadsByStatus) {
            byStatus[bucket.status] = bucket.leads.length
            total += bucket.leads.length
            totalValue += bucket.leads.reduce((sum, lead) => sum + (lead.value ?? 0), 0)
          }

          const now = Date.now()
          let staleCount = 0
          const leadsWithAge = leadsByStatus
            .filter((bucket) => bucket.status !== 'Closed')
            .flatMap((bucket) => bucket.leads)
            .map((l) => {
              const dsc = Math.floor((now - (l.lastContact ?? l.createdAt)) / MS_PER_DAY)
              if (dsc > STALE_THRESHOLD_DAYS) staleCount++
              return { ...l, daysSinceContact: dsc }
            })

          const topLeads = leadsWithAge
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
            .slice(0, 5)
            .map((l) => ({
              name: l.name,
              status: l.status,
              value: l.value,
              daysSinceContact: l.daysSinceContact,
            }))

          return {
            success: true,
            data: {
              total,
              byStatus,
              totalValue,
              staleCount,
              sampled,
              sampledStatuses,
              topLeads,
            },
            message: `Pipeline: ${total} leads, $${totalValue.toFixed(0)} total value, ${staleCount} stale.${sampled ? ` Sampled: ${sampledStatuses.join(', ')}.` : ''}`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to get pipeline overview: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    getLeadRecommendation: tool({
      description:
        'Get an actionable recommendation for a specific lead — what to do next, whether to advance their stage, or how to re-engage. Use when the user asks "what should I do with this lead?", "next steps for Sarah", or "how do I move this deal forward?".',
      inputSchema: z.object({
        leadName: z
          .string()
          .describe('Name of the lead to get recommendations for (will fuzzy match)'),
      }),
      execute: async (args): Promise<ToolResult<LeadRecommendationResult>> => {
        try {
          const { api } = await getApi()
          const leads = (await convex.query(api.leads.list, {
            userId,
            organizationId: orgId,
            limit: MAX_TOOL_LEAD_SCAN,
          })) as Array<{
            name: string
            status: string
            value?: number
            lastContact?: number
            createdAt: number
            notes?: string
            tags?: string[]
          }>

          const { lead, error } = findLeadByName(leads, args.leadName)
          if (!lead) {
            return {
              success: false,
              error: error ?? `Lead "${args.leadName}" not found. Try a different name.`,
            }
          }

          const now = Date.now()
          const daysSinceContact = Math.floor(
            (now - (lead.lastContact ?? lead.createdAt)) / MS_PER_DAY
          )
          const isStale = daysSinceContact > STALE_THRESHOLD_DAYS

          const stageOrder = ['New', 'Contacted', 'Qualified', 'Proposal', 'Booked', 'Closed']
          const currentIdx = stageOrder.indexOf(lead.status)
          const nextStage =
            currentIdx >= 0 && currentIdx < stageOrder.length - 1
              ? stageOrder[currentIdx + 1]
              : null

          const suggestedActions: string[] = []
          let recommendation: string

          if (isStale) {
            recommendation = `This lead has been inactive for ${daysSinceContact} days. Re-engage immediately.`
            suggestedActions.push(
              'Send a follow-up message or call',
              'Check if their needs have changed',
              'Offer a time-limited incentive or discount'
            )
          } else if (lead.status === 'New') {
            recommendation = 'New lead — make initial contact to qualify.'
            suggestedActions.push(
              'Call or message to introduce yourself',
              'Ask about their needs and budget',
              `Move to "${nextStage}" after first contact`
            )
          } else if (lead.status === 'Contacted') {
            recommendation = 'Lead contacted — qualify their interest and needs.'
            suggestedActions.push(
              'Schedule a consultation or discovery call',
              'Gather requirements and timeline',
              `Move to "${nextStage}" once qualified`
            )
          } else if (lead.status === 'Qualified') {
            recommendation = 'Qualified lead — prepare and send a proposal.'
            suggestedActions.push(
              'Prepare a custom proposal or quote',
              'Schedule a presentation meeting',
              `Move to "${nextStage}" once proposal is sent`
            )
          } else if (lead.status === 'Proposal') {
            recommendation = 'Proposal sent — follow up for decision.'
            suggestedActions.push(
              'Follow up on the proposal within 2-3 days',
              'Address any concerns or questions',
              `Move to "${nextStage}" once they commit`
            )
          } else if (lead.status === 'Booked') {
            recommendation = 'Lead is booked — deliver and close.'
            suggestedActions.push(
              'Confirm appointment details',
              'Prepare for the session/delivery',
              'Move to "Closed" after completion and payment'
            )
          } else {
            recommendation = 'Lead is closed. Consider for future upsell.'
            suggestedActions.push('Ask for referrals or testimonials', 'Add to nurture/upsell list')
          }

          return {
            success: true,
            data: {
              leadName: lead.name,
              currentStage: lead.status,
              recommendation,
              suggestedActions,
            },
            message: `${lead.name} (${lead.status}): ${recommendation}`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to get recommendation: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),
  }
}

export type SalesFunnelTools = ReturnType<typeof createSalesFunnelTools>
