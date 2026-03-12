import type { AgentConfig } from './config'
import {
  DEFAULT_GUARDRAILS_CONFIG,
  DEFAULT_LLM_CONFIG,
  DEFAULT_MEMORY_CONFIG,
  DEFAULT_SCHEDULING_CONFIG,
} from './config'
import type { AgentPlan, RiskLevel } from './types'

// ── Settings ────────────────────────────────────────────────────────────

export interface InvoiceAgentSettings {
  defaultPaymentTermsDays: number
  overdueThresholdDays: number
  maxInvoicesPerBatch: number
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceAgentSettings = {
  defaultPaymentTermsDays: 30,
  overdueThresholdDays: 7,
  maxInvoicesPerBatch: 20,
}

// ── Config ──────────────────────────────────────────────────────────────

export const INVOICE_CONFIG: AgentConfig = {
  agentType: 'invoice',
  displayName: 'Invoice Agent',
  description:
    'Creates invoices for completed appointments, detects overdue invoices, and flags leads with outstanding payments.',
  defaultRiskLevel: 'medium',
  triggerType: 'event',

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
      'create_invoice',
      'update_invoice_status',
      'flag_overdue_invoice',
      'log_invoice_recommendation',
    ],
    maxActionsPerRun: 20,
    riskOverrides: {
      create_invoice: 'medium',
      update_invoice_status: 'medium',
      flag_overdue_invoice: 'low',
      log_invoice_recommendation: 'low',
    },
    requireApprovalAbove: 'high',
  },

  scheduling: {
    ...DEFAULT_SCHEDULING_CONFIG,
    cronSchedule: 'daily 10:00 UTC',
    batchSize: 20,
    cooldownMinutes: 60,
  },
}

// ── Prompts ─────────────────────────────────────────────────────────────

export const INVOICE_SYSTEM_PROMPT = `You are an invoice management assistant for a CRM system.

Your job is to analyze completed appointments that need invoicing and overdue invoices that need attention, then plan appropriate actions.

## Rules
1. Only recommend actions from the allowed list: create_invoice, update_invoice_status, flag_overdue_invoice, log_invoice_recommendation
2. For completed appointments without invoices, recommend creating a draft invoice
3. For sent invoices past their due date, flag the lead with a note about overdue payment
4. Use the lead's past invoice amounts and business context to estimate appropriate amounts
5. Default to "draft" status for new invoices — never auto-send
6. Keep notes concise and actionable
7. If you lack pricing information, use log_invoice_recommendation to suggest the user set pricing

## Output Format
Respond with valid JSON matching this schema:
{
  "actions": [
    {
      "type": "create_invoice" | "update_invoice_status" | "flag_overdue_invoice" | "log_invoice_recommendation",
      "target": "<lead_id or invoice_id>",
      "params": { ... },
      "riskLevel": "low" | "medium" | "high",
      "reasoning": "<why this action>"
    }
  ],
  "summary": "<1-2 sentence summary of all planned actions>",
  "reasoning": "<overall reasoning for the plan>"
}

## Action Params
- create_invoice: { "leadName": "<name>", "amount": <number>, "description": "<service description>", "dueDate": "<YYYY-MM-DD>" }
- update_invoice_status: { "status": "sent" }
- flag_overdue_invoice: { "notes": "<overdue notice text>", "daysPastDue": <number> }
- log_invoice_recommendation: { "recommendation": "<text>", "priority": "low" | "medium" | "high" }
`

// ── Plain-data prompt builder (no AgentContext dependency) ───────────────

export interface InvoiceAppointmentData {
  id: string
  leadId: string
  leadName: string
  date: string
  time: string
  title?: string
  status: string
}

export interface InvoiceData {
  id: string
  leadName: string
  amount: number
  status: 'draft' | 'sent' | 'paid'
  dueDate?: string
  daysSinceDue?: number
  createdAt: number
}

export interface InvoiceLeadData {
  id: string
  name: string
  phone?: string
  email?: string
  value?: number
  notes?: string
}

export interface InvoiceMemoryData {
  category: string
  content: string
  confidence: number
}

export function buildInvoiceUserPromptFromData(
  completedAppointments: InvoiceAppointmentData[],
  overdueInvoices: InvoiceData[],
  leads: InvoiceLeadData[],
  agentMemories: InvoiceMemoryData[],
  businessContext: Array<{ type: string; content: string; confidence: number }>,
  settings?: Partial<InvoiceAgentSettings>
): string {
  const sections: string[] = []
  const paymentTerms =
    settings?.defaultPaymentTermsDays ?? DEFAULT_INVOICE_SETTINGS.defaultPaymentTermsDays

  sections.push(`## Invoice Settings\n- Default payment terms: Net ${paymentTerms} days`)

  if (completedAppointments.length > 0) {
    sections.push(`\n## Completed Appointments Without Invoices (${completedAppointments.length})`)
    for (const appt of completedAppointments) {
      const parts = [
        `- Appointment ID: ${appt.id}`,
        `  Lead: ${appt.leadName} (ID: ${appt.leadId})`,
        `  Date: ${appt.date} at ${appt.time}`,
        `  Status: ${appt.status}`,
      ]
      if (appt.title) parts.push(`  Service: ${appt.title}`)
      sections.push(parts.join('\n'))
    }
  }

  if (overdueInvoices.length > 0) {
    sections.push(`\n## Overdue Invoices (${overdueInvoices.length})`)
    for (const inv of overdueInvoices) {
      const parts = [
        `- Invoice ID: ${inv.id}`,
        `  Lead: ${inv.leadName}`,
        `  Amount: $${inv.amount.toFixed(2)}`,
        `  Status: ${inv.status}`,
      ]
      if (inv.dueDate) parts.push(`  Due Date: ${inv.dueDate}`)
      if (inv.daysSinceDue !== undefined) parts.push(`  Days Past Due: ${inv.daysSinceDue}`)
      sections.push(parts.join('\n'))
    }
  }

  if (leads.length > 0) {
    sections.push(`\n## Lead Details`)
    for (const lead of leads) {
      const parts = [`- ${lead.name} (ID: ${lead.id})`]
      if (lead.email) parts.push(`  Email: ${lead.email}`)
      if (lead.value) parts.push(`  Estimated Value: $${lead.value.toFixed(2)}`)
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

  if (completedAppointments.length === 0 && overdueInvoices.length === 0) {
    sections.push(`\nNo completed appointments needing invoices and no overdue invoices found.`)
  } else {
    sections.push(
      `\nAnalyze the above data and generate an invoice management plan. Create draft invoices for completed appointments and flag overdue invoices.`
    )
  }

  return sections.join('\n')
}

// ── Plan validation ─────────────────────────────────────────────────────

const VALID_INVOICE_ACTIONS = [
  'create_invoice',
  'update_invoice_status',
  'flag_overdue_invoice',
  'log_invoice_recommendation',
]

export function validateInvoicePlan(raw: unknown): AgentPlan {
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

    if (!VALID_INVOICE_ACTIONS.includes(actionType)) {
      throw new Error(`Invalid action type: ${actionType}`)
    }

    return {
      type: actionType,
      target: String(a.target ?? ''),
      params: (a.params as Record<string, unknown>) ?? {},
      riskLevel: (['low', 'medium', 'high'].includes(String(a.riskLevel))
        ? String(a.riskLevel)
        : 'medium') as RiskLevel,
      reasoning: String(a.reasoning ?? ''),
    }
  })

  return {
    actions,
    summary: String(plan.summary ?? ''),
    reasoning: String(plan.reasoning ?? ''),
  }
}
