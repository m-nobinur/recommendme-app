import type { AgentConfig } from './config'
import {
  DEFAULT_GUARDRAILS_CONFIG,
  DEFAULT_LLM_CONFIG,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_SCHEDULING_CONFIG,
} from './config'
import type { AgentPlan, RiskLevel } from './types'

// ── Settings ────────────────────────────────────────────────────────────

export interface FollowupAgentSettings {
  staleDaysThreshold: number
  maxLeadsPerBatch: number
  targetStatuses: string[]
}

export const DEFAULT_FOLLOWUP_SETTINGS: FollowupAgentSettings = {
  staleDaysThreshold: 3,
  maxLeadsPerBatch: 20,
  targetStatuses: ['Contacted', 'Qualified', 'Proposal'],
}

// ── Config ──────────────────────────────────────────────────────────────

export const FOLLOWUP_CONFIG: AgentConfig = {
  agentType: 'followup',
  displayName: 'Followup Agent',
  description:
    'Automatically identifies stale leads and generates follow-up recommendations based on lead history and business context.',
  defaultRiskLevel: 'low',
  triggerType: 'cron',

  llm: {
    ...DEFAULT_LLM_CONFIG,
    temperature: 0.1,
    maxTokens: 2500,
  },

  memory: {
    ...DEFAULT_MEMORY_CONFIG,
    readLayers: ['business', 'agent'],
    maxMemoriesPerQuery: 15,
  },

  guardrails: {
    ...DEFAULT_GUARDRAILS_CONFIG,
    allowedActions: ['update_lead_notes', 'update_lead_status', 'log_recommendation'],
    maxActionsPerRun: 20,
    riskOverrides: {
      update_lead_notes: 'low',
      update_lead_status: 'medium',
      log_recommendation: 'low',
    },
    requireApprovalAbove: 'high',
  },

  scheduling: {
    ...DEFAULT_SCHEDULING_CONFIG,
    cronSchedule: 'daily 14:00 UTC',
    batchSize: 20,
    cooldownMinutes: 60,
  },
}

// ── Prompts ─────────────────────────────────────────────────────────────

export const FOLLOWUP_SYSTEM_PROMPT = `You are a follow-up scheduling assistant for a CRM system.

Your job is to analyze stale leads (leads that haven't been contacted recently) and recommend specific follow-up actions.

## Rules
1. Only recommend actions from the allowed list: update_lead_notes, update_lead_status, log_recommendation
2. Be specific in your reasoning — reference the lead's status, days since contact, and any relevant business context
3. Prioritize leads with higher value and longer time since contact
4. For status changes, only advance leads forward (e.g., Contacted -> Qualified), never backward
5. Keep notes concise and actionable

## Output Format
Respond with valid JSON matching this schema:
{
  "actions": [
    {
      "type": "update_lead_notes" | "update_lead_status" | "log_recommendation",
      "target": "<lead_id>",
      "params": { ... },
      "riskLevel": "low" | "medium" | "high",
      "reasoning": "<why this action>"
    }
  ],
  "summary": "<1-2 sentence summary of all planned actions>",
  "reasoning": "<overall reasoning for the plan>"
}

## Action Params
- update_lead_notes: { "notes": "<text to append>" }
- update_lead_status: { "status": "<new status>" }
- log_recommendation: { "recommendation": "<text>", "priority": "low" | "medium" | "high" }
`

// ── Plain-data prompt builder (no AgentContext dependency) ───────────────

export interface FollowupLeadData {
  id: string
  name: string
  status: string
  daysSinceContact: number
  value?: number
  email?: string
  phone?: string
  tags: string[]
  notes?: string
}

export interface FollowupAppointmentData {
  leadName: string
  date: string
  time: string
  status: string
}

export interface FollowupMemoryData {
  category: string
  content: string
  confidence: number
}

export function buildFollowupUserPromptFromData(
  leads: FollowupLeadData[],
  appointments: FollowupAppointmentData[],
  agentMemories: FollowupMemoryData[],
  businessContext: Array<{ type: string; content: string; confidence: number }>
): string {
  const sections: string[] = [`## Stale Leads (${leads.length})`]

  for (const lead of leads) {
    const parts = [
      `- ID: ${lead.id}`,
      `  Name: ${lead.name}`,
      `  Status: ${lead.status}`,
      `  Days since contact: ${lead.daysSinceContact}`,
    ]
    if (lead.value) parts.push(`  Value: $${lead.value}`)
    if (lead.email) parts.push(`  Email: ${lead.email}`)
    if (lead.phone) parts.push(`  Phone: ${lead.phone}`)
    if (lead.tags.length > 0) parts.push(`  Tags: ${lead.tags.join(', ')}`)
    if (lead.notes) parts.push(`  Notes: ${lead.notes.substring(0, 200)}`)
    sections.push(parts.join('\n'))
  }

  if (appointments.length > 0) {
    sections.push(`\n## Recent Appointments`)
    for (const a of appointments) {
      sections.push(`- ${a.leadName}: ${a.date} ${a.time} (${a.status})`)
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
      sections.push(`[${m.type}] ${m.content} (confidence: ${m.confidence.toFixed(2)})`)
    }
  }

  sections.push(
    `\nAnalyze these leads and generate a follow-up plan. Prioritize by value and staleness.`
  )

  return sections.join('\n')
}

// ── Plan validation ─────────────────────────────────────────────────────

export function validateFollowupPlan(raw: unknown): AgentPlan {
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
    return {
      type: String(a.type ?? ''),
      target: String(a.target ?? ''),
      params: (a.params as Record<string, unknown>) ?? {},
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
