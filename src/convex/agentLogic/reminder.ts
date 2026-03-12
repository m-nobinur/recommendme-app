import type { AgentConfig } from './config'
import {
  DEFAULT_GUARDRAILS_CONFIG,
  DEFAULT_LLM_CONFIG,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_SCHEDULING_CONFIG,
} from './config'
import type { AgentPlan, RiskLevel } from './types'

// ── Settings ────────────────────────────────────────────────────────────

export interface ReminderAgentSettings {
  reminderWindowHours: number[]
  maxAppointmentsPerBatch: number
}

export const DEFAULT_REMINDER_SETTINGS: ReminderAgentSettings = {
  reminderWindowHours: [24, 48],
  maxAppointmentsPerBatch: 20,
}

// ── Config ──────────────────────────────────────────────────────────────

export const REMINDER_CONFIG: AgentConfig = {
  agentType: 'reminder',
  displayName: 'Reminder Agent',
  description:
    'Automatically scans upcoming appointments and generates reminder notes for leads and appointments within configurable time windows.',
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
    allowedActions: [
      'update_appointment_notes',
      'update_lead_notes',
      'log_reminder_recommendation',
    ],
    maxActionsPerRun: 20,
    riskOverrides: {
      update_appointment_notes: 'low',
      update_lead_notes: 'low',
      log_reminder_recommendation: 'low',
    },
    requireApprovalAbove: 'high',
  },

  scheduling: {
    ...DEFAULT_SCHEDULING_CONFIG,
    cronSchedule: 'daily 09:00 UTC',
    batchSize: 20,
    cooldownMinutes: 60,
  },
}

// ── Prompts ─────────────────────────────────────────────────────────────

export const REMINDER_SYSTEM_PROMPT = `You are an appointment reminder assistant for a CRM system.

Your job is to analyze upcoming appointments within the configured reminder windows (default: 24-48 hours) and plan reminder actions so no appointment is missed.

## Rules
1. Only recommend actions from the allowed list: update_appointment_notes, update_lead_notes, log_reminder_recommendation
2. For each upcoming appointment, decide what kind of reminder is appropriate based on lead context
3. Prioritize appointments that are sooner (within 24h before 48h)
4. Skip appointments that already have a [Reminder] marker in their notes
5. Include the lead's preferred contact method or relevant preferences if known from business context
6. Keep notes concise and actionable

## Output Format
Respond with valid JSON matching this schema:
{
  "actions": [
    {
      "type": "update_appointment_notes" | "update_lead_notes" | "log_reminder_recommendation",
      "target": "<appointment_id or lead_id>",
      "params": { ... },
      "riskLevel": "low" | "medium" | "high",
      "reasoning": "<why this action>"
    }
  ],
  "summary": "<1-2 sentence summary of all planned actions>",
  "reasoning": "<overall reasoning for the plan>"
}

## Action Params
- update_appointment_notes: { "notes": "<text to append>" }
- update_lead_notes: { "notes": "<text to append>" }
- log_reminder_recommendation: { "recommendation": "<text>", "priority": "low" | "medium" | "high" }
`

// ── Plain-data prompt builder (no AgentContext dependency) ───────────────

export interface ReminderAppointmentData {
  id: string
  leadId: string
  leadName: string
  date: string
  time: string
  title?: string
  notes?: string
  status: string
  hoursUntil: number
}

export interface ReminderLeadData {
  id: string
  name: string
  phone?: string
  email?: string
  notes?: string
}

export interface ReminderMemoryData {
  category: string
  content: string
  confidence: number
}

export function buildReminderUserPromptFromData(
  appointments: ReminderAppointmentData[],
  leads: ReminderLeadData[],
  agentMemories: ReminderMemoryData[],
  businessContext: Array<{ type: string; content: string; confidence: number }>,
  reminderWindowHours?: number[]
): string {
  const sections: string[] = []

  if (Array.isArray(reminderWindowHours) && reminderWindowHours.length > 0) {
    sections.push(`## Active Reminder Windows\n- ${reminderWindowHours.join('h, ')}h`)
  }

  sections.push(`## Upcoming Appointments (${appointments.length})`)

  for (const appt of appointments) {
    const parts = [
      `- Appointment ID: ${appt.id}`,
      `  Lead: ${appt.leadName} (ID: ${appt.leadId})`,
      `  Date: ${appt.date} at ${appt.time}`,
      `  Hours until appointment: ${appt.hoursUntil}`,
      `  Status: ${appt.status}`,
    ]
    if (appt.title) parts.push(`  Title: ${appt.title}`)
    if (appt.notes) parts.push(`  Existing Notes: ${appt.notes.substring(0, 200)}`)
    sections.push(parts.join('\n'))
  }

  if (leads.length > 0) {
    sections.push(`\n## Lead Contact Info`)
    for (const lead of leads) {
      const parts = [`- ${lead.name} (ID: ${lead.id})`]
      if (lead.phone) parts.push(`  Phone: ${lead.phone}`)
      if (lead.email) parts.push(`  Email: ${lead.email}`)
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
      sections.push(`[${m.type}] ${m.content} (confidence: ${m.confidence.toFixed(2)})`)
    }
  }

  sections.push(
    `\nAnalyze these upcoming appointments and generate a reminder plan. Prioritize appointments that are sooner.`
  )

  return sections.join('\n')
}

// ── Plan validation ─────────────────────────────────────────────────────

export function validateReminderPlan(raw: unknown): AgentPlan {
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
