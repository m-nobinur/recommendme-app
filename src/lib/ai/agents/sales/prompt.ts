import type { AgentContext } from '../core/types'

export type { SalesLeadData, SalesMemoryData, SalesPipelineStats } from '@convex/agentLogic/sales'
export { buildSalesUserPromptFromData, SALES_SYSTEM_PROMPT } from '@convex/agentLogic/sales'

import { buildSalesUserPromptFromData, DEFAULT_SALES_SETTINGS } from '@convex/agentLogic/sales'

/**
 * Convenience wrapper that adapts the AgentContext interface used by the
 * Next.js-side handler to the plain-data args the shared builder expects.
 */
export function buildSalesUserPrompt(context: AgentContext): string {
  const leadsWithMetrics = context.leads.map((l) => ({
    id: l.id,
    name: l.name,
    status: l.status,
    phone: l.phone,
    email: l.email,
    value: l.value,
    tags: l.tags,
    notes: l.notes,
    daysSinceUpdate: l.daysSinceContact,
    appointmentCount: 0,
    completedAppointmentCount: 0,
    invoiceCount: 0,
    paidInvoiceCount: 0,
    totalInvoiceAmount: 0,
  }))

  const appointmentsByLead = new Map<string, { total: number; completed: number }>()
  for (const appt of context.appointments) {
    const key = appt.leadId ?? appt.leadName
    const existing = appointmentsByLead.get(key) ?? { total: 0, completed: 0 }
    existing.total++
    if (appt.status === 'completed') existing.completed++
    appointmentsByLead.set(key, existing)
  }

  const invoicesByLead = new Map<
    string,
    { count: number; paidCount: number; totalAmount: number }
  >()
  for (const inv of context.invoices ?? []) {
    const key = inv.leadName
    const existing = invoicesByLead.get(key) ?? { count: 0, paidCount: 0, totalAmount: 0 }
    existing.count++
    if (inv.status === 'paid') existing.paidCount++
    existing.totalAmount += inv.amount
    invoicesByLead.set(key, existing)
  }

  for (const lead of leadsWithMetrics) {
    const apptData = appointmentsByLead.get(lead.id) ??
      appointmentsByLead.get(lead.name) ?? { total: 0, completed: 0 }
    lead.appointmentCount = apptData.total
    lead.completedAppointmentCount = apptData.completed

    const invData = invoicesByLead.get(lead.name) ?? { count: 0, paidCount: 0, totalAmount: 0 }
    lead.invoiceCount = invData.count
    lead.paidInvoiceCount = invData.paidCount
    lead.totalInvoiceAmount = invData.totalAmount
  }

  let totalValue = 0
  let staleCount = 0
  const byStatus: Record<string, number> = {}
  for (const lead of leadsWithMetrics) {
    if (lead.value) totalValue += lead.value
    byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1
    if (lead.daysSinceUpdate > DEFAULT_SALES_SETTINGS.staleThresholdDays) staleCount++
  }

  const pipelineStats = {
    total: leadsWithMetrics.length,
    byStatus,
    totalValue,
    staleCount,
  }

  return buildSalesUserPromptFromData(
    leadsWithMetrics,
    pipelineStats,
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
