import type { ConvexHttpClient } from 'convex/browser'
import { asOrganizationId, getApi } from '../../shared/convex'
import type { AgentMemorySummary, AgentType } from './types'

/**
 * Load active agent memories for a specific agent type within an organization.
 */
export async function loadAgentMemories(
  convex: ConvexHttpClient,
  organizationId: string,
  agentType: AgentType,
  limit: number = 10
): Promise<AgentMemorySummary[]> {
  try {
    const { api } = await getApi()
    const memories = await convex.query(api.agentMemories.list, {
      organizationId: asOrganizationId(organizationId),
      agentType,
      activeOnly: true,
      limit,
    })

    return memories.map((m: Record<string, unknown>) => ({
      id: String(m._id),
      category: String(m.category),
      content: String(m.content),
      confidence: Number(m.confidence),
      successRate: Number(m.successRate),
      useCount: Number(m.useCount),
    }))
  } catch (error) {
    console.error(`[Agent:Memory] Failed to load memories for ${agentType}:`, error)
    return []
  }
}

/**
 * Load relevant business memory content for an organization.
 * Returns plain text summaries suitable for including in agent context.
 */
export async function loadBusinessContext(
  convex: ConvexHttpClient,
  organizationId: string,
  limit: number = 20
): Promise<string[]> {
  try {
    const { api } = await getApi()
    const memories = await convex.query(api.businessMemories.list, {
      organizationId: asOrganizationId(organizationId),
      activeOnly: true,
      limit,
    })

    return memories.map(
      (m: Record<string, unknown>) =>
        `[${String(m.type)}] ${String(m.content)} (confidence: ${Number(m.confidence).toFixed(2)})`
    )
  } catch (error) {
    console.error('[Agent:Memory] Failed to load business context:', error)
    return []
  }
}

/**
 * Record a learning (success or failure pattern) in agent memory.
 */
export async function recordLearning(
  convex: ConvexHttpClient,
  organizationId: string,
  agentType: AgentType,
  category: 'pattern' | 'preference' | 'success' | 'failure',
  content: string,
  confidence: number = 0.7
): Promise<void> {
  try {
    const { api } = await getApi()
    await convex.mutation(api.agentMemories.create, {
      organizationId: asOrganizationId(organizationId),
      agentType,
      category,
      content,
      confidence,
    })
  } catch (error) {
    console.error(`[Agent:Memory] Failed to record learning for ${agentType}:`, error)
  }
}
