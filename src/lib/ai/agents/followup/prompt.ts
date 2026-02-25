import type { AgentContext } from '../core/types'

export type {
  FollowupAppointmentData,
  FollowupLeadData,
  FollowupMemoryData,
} from '@convex/agentLogic/followup'
export {
  buildFollowupUserPromptFromData,
  FOLLOWUP_SYSTEM_PROMPT,
} from '@convex/agentLogic/followup'

import { buildFollowupUserPromptFromData } from '@convex/agentLogic/followup'

/**
 * Convenience wrapper that adapts the AgentContext interface used by the
 * Next.js-side handler to the plain-data args the shared builder expects.
 */
export function buildFollowupUserPrompt(context: AgentContext): string {
  return buildFollowupUserPromptFromData(
    context.leads,
    context.appointments.map((a) => ({
      leadName: a.leadName,
      date: a.date,
      time: a.time,
      status: a.status,
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
