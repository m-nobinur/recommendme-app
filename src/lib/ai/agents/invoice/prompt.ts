import type { AgentContext } from '../core/types'

export type {
  InvoiceAppointmentData,
  InvoiceData,
  InvoiceLeadData,
  InvoiceMemoryData,
} from '@convex/agentLogic/invoice'
export {
  buildInvoiceUserPromptFromData,
  INVOICE_SYSTEM_PROMPT,
} from '@convex/agentLogic/invoice'

import { buildInvoiceUserPromptFromData } from '@convex/agentLogic/invoice'

/**
 * Convenience wrapper that adapts the AgentContext interface used by the
 * Next.js-side handler to the plain-data args the shared builder expects.
 */
export function buildInvoiceUserPrompt(context: AgentContext): string {
  return buildInvoiceUserPromptFromData(
    context.appointments.map((a) => ({
      id: a.id,
      leadId: a.leadId ?? '',
      leadName: a.leadName,
      date: a.date,
      time: a.time,
      title: a.title,
      status: a.status,
    })),
    (context.invoices ?? []).map((inv) => ({
      id: inv.id,
      leadName: inv.leadName,
      amount: inv.amount,
      status: inv.status,
      dueDate: inv.dueDate,
      daysSinceDue: inv.daysSinceDue,
      createdAt: inv.createdAt,
    })),
    context.leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      value: l.value,
      notes: l.notes,
    })),
    context.agentMemories.map((m) => ({
      category: m.category,
      content: m.content,
      confidence: m.confidence,
    })),
    context.businessContext.map((line) => {
      const match = line.match(/^\[([^\]]+)\]\s*(.*?)\s*\(confidence:\s*([\d.]+)\)$/)
      if (match) {
        return { type: match[1], content: match[2], confidence: Number.parseFloat(match[3]) }
      }
      return { type: 'general', content: line, confidence: 0.5 }
    })
  )
}
