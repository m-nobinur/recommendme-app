import type { AgentContext } from '../core/types'

export type {
  ReminderAppointmentData,
  ReminderLeadData,
  ReminderMemoryData,
} from '@convex/agentLogic/reminder'
export {
  buildReminderUserPromptFromData,
  REMINDER_SYSTEM_PROMPT,
} from '@convex/agentLogic/reminder'

import { buildReminderUserPromptFromData } from '@convex/agentLogic/reminder'

/**
 * Convenience wrapper that adapts the AgentContext interface used by the
 * Next.js-side handler to the plain-data args the shared builder expects.
 */
export function buildReminderUserPrompt(context: AgentContext): string {
  return buildReminderUserPromptFromData(
    context.appointments.map((a) => ({
      id: a.id,
      leadId: '',
      leadName: a.leadName,
      date: a.date,
      time: a.time,
      title: a.title,
      notes: undefined,
      status: a.status,
      hoursUntil: 0,
    })),
    context.leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
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
