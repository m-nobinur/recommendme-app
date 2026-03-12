import type { AgentConfig } from './config'
import {
  DEFAULT_GUARDRAILS_CONFIG,
  DEFAULT_LLM_CONFIG,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_SCHEDULING_CONFIG,
} from './config'
import type { AgentPlan, RiskLevel } from './types'

// ── Settings ────────────────────────────────────────────────────────────

export interface SalesAgentSettings {
  staleThresholdDays: number
  maxLeadsPerBatch: number
  highValueThreshold: number
}

export const DEFAULT_SALES_SETTINGS: SalesAgentSettings = {
  staleThresholdDays: 7,
  maxLeadsPerBatch: 50,
  highValueThreshold: 1000,
}

// ── Config ──────────────────────────────────────────────────────────────

export const SALES_CONFIG: AgentConfig = {
  agentType: 'sales',
  displayName: 'Sales Funnel Agent',
  description:
    'Scores leads, detects stale pipelines, recommends stage transitions, and surfaces pipeline insights.',
  defaultRiskLevel: 'low',
  triggerType: 'event',

  llm: {
    ...DEFAULT_LLM_CONFIG,
    temperature: 0.1,
    maxTokens: 3000,
  },

  memory: {
    ...DEFAULT_MEMORY_CONFIG,
    readLayers: ['business', 'agent'],
    maxMemoriesPerQuery: 15,
  },

  guardrails: {
    ...DEFAULT_GUARDRAILS_CONFIG,
    allowedActions: [
      'score_lead',
      'recommend_stage_change',
      'flag_stale_lead',
      'log_pipeline_insight',
    ],
    maxActionsPerRun: 50,
    riskOverrides: {
      score_lead: 'low',
      recommend_stage_change: 'low',
      flag_stale_lead: 'low',
      log_pipeline_insight: 'low',
    },
    requireApprovalAbove: 'high',
  },

  scheduling: {
    ...DEFAULT_SCHEDULING_CONFIG,
    cronSchedule: 'daily 11:00 UTC',
    batchSize: 50,
    cooldownMinutes: 60,
  },
}

// ── Prompts ─────────────────────────────────────────────────────────────

export const SALES_SYSTEM_PROMPT = `You are a sales pipeline analysis assistant for a CRM system.

Your job is to analyze leads, score their engagement level, detect stale leads, and recommend pipeline stage transitions.

## Rules
1. Only recommend actions from the allowed list: score_lead, recommend_stage_change, flag_stale_lead, log_pipeline_insight
2. Score leads from 1 (cold/unengaged) to 10 (hot/ready to close) based on engagement signals
3. Recommend stage changes only when there is clear evidence (e.g., appointment completed → move from Qualified to Proposal)
4. Flag leads as stale when they have had no activity beyond the configured threshold
5. Use log_pipeline_insight for overall observations about the pipeline health
6. Keep notes concise and actionable
7. Never recommend moving a lead backwards in the pipeline without strong justification

## Scoring Guidelines
- **1-3 (Cold)**: No engagement, no appointments, no invoices, stale
- **4-6 (Warm)**: Some engagement — contacted, has appointments, moderate value
- **7-8 (Hot)**: High engagement — qualified, has appointments/invoices, high value, recently active
- **9-10 (Very Hot)**: Ready to close — proposal/booked stage, multiple touchpoints, high value

## Stage Progression
New → Contacted → Qualified → Proposal → Booked → Closed

## Output Format
Respond with valid JSON matching this schema:
{
  "actions": [
    {
      "type": "score_lead" | "recommend_stage_change" | "flag_stale_lead" | "log_pipeline_insight",
      "target": "<lead_id>",
      "params": { ... },
      "riskLevel": "low",
      "reasoning": "<why this action>"
    }
  ],
  "summary": "<1-2 sentence summary of all planned actions>",
  "reasoning": "<overall reasoning for the plan>"
}

## Action Params
- score_lead: { "leadName": "<name>", "score": <1-10>, "reasoning": "<why this score>", "suggestedAction": "<next best action>" }
- recommend_stage_change: { "leadName": "<name>", "currentStage": "<stage>", "recommendedStage": "<stage>", "reasoning": "<evidence>" }
- flag_stale_lead: { "leadName": "<name>", "daysSinceUpdate": <number>, "notes": "<suggested re-engagement action>" }
- log_pipeline_insight: { "insight": "<observation>", "priority": "low" | "medium" | "high" }
`

// ── Plain-data prompt builder (no AgentContext dependency) ───────────────

export interface SalesLeadData {
  id: string
  name: string
  status: string
  phone?: string
  email?: string
  value?: number
  tags: string[]
  notes?: string
  daysSinceUpdate: number
  appointmentCount: number
  completedAppointmentCount: number
  invoiceCount: number
  paidInvoiceCount: number
  totalInvoiceAmount: number
}

export interface SalesPipelineStats {
  total: number
  byStatus: Record<string, number>
  totalValue: number
  staleCount: number
}

export interface SalesMemoryData {
  category: string
  content: string
  confidence: number
}

export function buildSalesUserPromptFromData(
  leads: SalesLeadData[],
  pipelineStats: SalesPipelineStats,
  agentMemories: SalesMemoryData[],
  businessContext: Array<{ type: string; content: string; confidence: number }>,
  settings?: Partial<SalesAgentSettings>
): string {
  const sections: string[] = []
  const staleThreshold = settings?.staleThresholdDays ?? DEFAULT_SALES_SETTINGS.staleThresholdDays
  const highValueThreshold =
    settings?.highValueThreshold ?? DEFAULT_SALES_SETTINGS.highValueThreshold

  sections.push(
    `## Sales Settings\n- Stale threshold: ${staleThreshold} days\n- High value threshold: $${highValueThreshold}`
  )

  sections.push(
    `\n## Pipeline Summary\n- Total leads: ${pipelineStats.total}\n- Total pipeline value: $${pipelineStats.totalValue.toFixed(2)}\n- Stale leads (>${staleThreshold} days inactive): ${pipelineStats.staleCount}`
  )

  if (Object.keys(pipelineStats.byStatus).length > 0) {
    sections.push(`\n### By Stage`)
    const stageOrder = ['New', 'Contacted', 'Qualified', 'Proposal', 'Booked', 'Closed']
    for (const stage of stageOrder) {
      const count = pipelineStats.byStatus[stage] ?? 0
      if (count > 0) sections.push(`- ${stage}: ${count}`)
    }
  }

  if (leads.length > 0) {
    sections.push(`\n## Leads to Analyze (${leads.length})`)
    for (const lead of leads) {
      const parts = [
        `- **${lead.name}** (ID: ${lead.id})`,
        `  Stage: ${lead.status} | Value: ${lead.value ? `$${lead.value.toFixed(2)}` : 'N/A'}`,
        `  Days since update: ${lead.daysSinceUpdate}${lead.daysSinceUpdate > staleThreshold ? ' ⚠️ STALE' : ''}`,
        `  Appointments: ${lead.appointmentCount} (${lead.completedAppointmentCount} completed)`,
        `  Invoices: ${lead.invoiceCount} ($${lead.totalInvoiceAmount.toFixed(2)} total, ${lead.paidInvoiceCount} paid)`,
      ]
      if (lead.email) parts.push(`  Email: ${lead.email}`)
      if (lead.tags.length > 0) parts.push(`  Tags: ${lead.tags.join(', ')}`)
      if (lead.notes) parts.push(`  Notes: ${lead.notes.substring(0, 200)}`)
      sections.push(parts.join('\n'))
    }
  }

  if (agentMemories.length > 0) {
    sections.push(`\n## Past Learnings`)
    for (const m of agentMemories) {
      sections.push(`- [${m.category}] ${m.content} (confidence: ${m.confidence.toFixed(2)})`)
    }
  }

  if (businessContext.length > 0) {
    sections.push(`\n## Business Context`)
    for (const m of businessContext) {
      sections.push(`- [${m.type}] ${m.content} (confidence: ${m.confidence.toFixed(2)})`)
    }
  }

  if (leads.length === 0) {
    sections.push(`\nNo leads found to analyze.`)
  } else {
    sections.push(
      `\nAnalyze each lead above. Score their engagement, flag stale leads, recommend stage changes where evidence supports it, and provide pipeline insights.`
    )
  }

  return sections.join('\n')
}

// ── Plan validation ─────────────────────────────────────────────────────

const VALID_SALES_ACTIONS = [
  'score_lead',
  'recommend_stage_change',
  'flag_stale_lead',
  'log_pipeline_insight',
]

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function validateSalesPlan(raw: unknown): AgentPlan {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid plan: expected an object')
  }

  const plan = raw as Record<string, unknown>

  if (!Array.isArray(plan.actions)) {
    throw new Error('Invalid plan: missing or invalid "actions" array')
  }

  const actions = plan.actions.map((action: unknown) => {
    if (!action || typeof action !== 'object') {
      throw new Error('Invalid action: expected an object')
    }
    const a = action as Record<string, unknown>
    const actionType = String(a.type ?? '')

    if (!VALID_SALES_ACTIONS.includes(actionType)) {
      throw new Error(`Invalid action type: ${actionType}`)
    }

    const rawParams =
      a.params && typeof a.params === 'object' ? (a.params as Record<string, unknown>) : {}
    let params: Record<string, unknown> = { ...rawParams }

    if (actionType === 'score_lead') {
      params = {
        ...rawParams,
        leadName: normalizeString(rawParams.leadName),
        score: normalizeNumber(rawParams.score),
        reasoning: normalizeString(rawParams.reasoning),
        suggestedAction: normalizeString(rawParams.suggestedAction),
      }
    } else if (actionType === 'recommend_stage_change') {
      params = {
        ...rawParams,
        leadName: normalizeString(rawParams.leadName),
        currentStage: normalizeString(rawParams.currentStage),
        // Support both older toStage and canonical recommendedStage.
        recommendedStage: normalizeString(rawParams.recommendedStage ?? rawParams.toStage),
        reasoning: normalizeString(rawParams.reasoning),
      }
    } else if (actionType === 'flag_stale_lead') {
      params = {
        ...rawParams,
        leadName: normalizeString(rawParams.leadName),
        // Support both older daysSinceContact and canonical daysSinceUpdate.
        daysSinceUpdate: normalizeNumber(rawParams.daysSinceUpdate ?? rawParams.daysSinceContact),
        // Support both older suggestion and canonical notes.
        notes: normalizeString(rawParams.notes ?? rawParams.suggestion),
      }
    } else if (actionType === 'log_pipeline_insight') {
      const rawPriority = normalizeString(rawParams.priority)
      params = {
        ...rawParams,
        insight: normalizeString(rawParams.insight),
        priority: ['low', 'medium', 'high'].includes(rawPriority) ? rawPriority : 'medium',
      }
    }

    return {
      type: actionType,
      target: String(a.target ?? ''),
      params,
      riskLevel: (['low', 'medium', 'high'].includes(String(a.riskLevel))
        ? String(a.riskLevel)
        : 'low') as RiskLevel,
      reasoning: String(a.reasoning ?? ''),
    }
  })

  return {
    actions,
    summary: String(plan.summary ?? ''),
    reasoning: String(plan.reasoning ?? ''),
  }
}
