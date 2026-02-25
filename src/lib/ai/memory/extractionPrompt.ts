/**
 * Memory Extraction Prompt & Schema
 *
 * Defines the LLM prompt and structured output schema for extracting
 * memories from conversations. Used by the extraction worker
 * (src/convex/memoryExtraction.ts) to process memoryEvents.
 */

import { z } from 'zod'

// ============================================
// EXTRACTION OUTPUT SCHEMA
// ============================================

export const extractedBusinessMemorySchema = z.object({
  type: z
    .enum(['fact', 'preference', 'instruction', 'context', 'relationship', 'episodic'])
    .describe('The category of knowledge'),
  content: z
    .string()
    .min(10)
    .max(500)
    .describe('Concise, self-contained statement of the knowledge'),
  importance: z
    .number()
    .min(0)
    .max(1)
    .describe('How important this is for future interactions (0=trivial, 1=critical)'),
  confidence: z
    .number()
    .min(0.5)
    .max(1)
    .describe('How confident we are this is accurate (0.5=inferred, 1=explicitly stated)'),
  subjectType: z
    .enum(['lead', 'service', 'appointment', 'invoice', 'general'])
    .optional()
    .describe('The entity type this knowledge relates to'),
  subjectName: z
    .string()
    .optional()
    .describe('Name of the entity (e.g., customer name, service name)'),
})

export const extractedAgentMemorySchema = z.object({
  agentType: z
    .enum(['chat', 'crm', 'followup', 'invoice', 'sales', 'reminder'])
    .describe('Which agent type this pattern applies to'),
  category: z
    .enum(['pattern', 'preference', 'success', 'failure'])
    .describe('Type of agent learning'),
  content: z.string().min(10).max(500).describe('Description of the pattern or outcome'),
  confidence: z.number().min(0.5).max(1).describe('Confidence in this observation'),
})

export const extractedRelationSchema = z.object({
  sourceType: z.string().describe('Entity type of the source node (e.g., lead, service, memory)'),
  sourceName: z.string().describe('Name or identifier of the source entity'),
  targetType: z.string().describe('Entity type of the target node'),
  targetName: z.string().describe('Name or identifier of the target entity'),
  relationType: z
    .enum(['prefers', 'related_to', 'leads_to', 'requires', 'conflicts_with'])
    .describe('Nature of the relationship'),
  strength: z.number().min(0).max(1).describe('How strong this relationship is'),
  evidence: z.string().max(200).describe('Brief quote or reasoning from the conversation'),
})

export const extractionOutputSchema = z.object({
  businessMemories: z
    .array(extractedBusinessMemorySchema)
    .max(10)
    .describe('Facts, preferences, instructions, and context extracted from the conversation'),
  agentMemories: z
    .array(extractedAgentMemorySchema)
    .max(5)
    .describe('Patterns learned from tool usage and agent execution outcomes'),
  relations: z
    .array(extractedRelationSchema)
    .max(5)
    .describe('Relationships between entities discovered in the conversation'),
})

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>
export type ExtractedBusinessMemory = z.infer<typeof extractedBusinessMemorySchema>
export type ExtractedAgentMemory = z.infer<typeof extractedAgentMemorySchema>
export type ExtractedRelation = z.infer<typeof extractedRelationSchema>

// ============================================
// EXTRACTION SYSTEM PROMPT
// ============================================

export const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction engine for a CRM assistant called "Reme".
Your job is to analyze conversations between a business owner and the AI assistant, then extract structured knowledge that should be remembered for future interactions.

## What to Extract

### Business Memories (facts, preferences, instructions)
Extract ONLY information that would be useful in FUTURE conversations. Focus on:

- **Facts**: Client details, business information, pricing, services offered
  - "Sarah Johnson's email is sarah@example.com"
  - "Standard portrait session costs $250"
  - "Business hours are Mon-Fri 9am-5pm"

- **Preferences**: How clients or the business owner prefer things done
  - "Sarah prefers outdoor shoots at parks"
  - "Owner prefers to send invoices within 24 hours of a session"
  - "Mike likes morning appointments before 10am"

- **Instructions**: Explicit rules the business owner has stated
  - "Always offer a 10% discount for referrals"
  - "Never schedule two shoots on the same day"
  - "Follow up with new leads within 48 hours"

- **Relationships**: Connections between people, services, or concepts
  - "Mike was referred by Sarah"
  - "Wedding packages include both photography and videography"

- **Context/Episodic**: Situational information that provides useful background
  - "Sarah is planning a family reunion in March"
  - "The business is running a spring promotion"

### Agent Memories (from tool usage)
When the conversation includes tool calls (adding leads, scheduling, invoicing):

- **Success patterns**: What worked well
  - "Scheduling follow-ups in the morning gets better responses"

- **Failure patterns**: What went wrong and should be avoided
  - "Trying to schedule on weekends fails because business is closed"

### Relations
Connections between entities:
- Client preferences for services
- Referral chains between clients
- Service dependencies

## Rules

1. Extract ONLY information explicitly stated or strongly implied in the conversation
2. Each memory must be a self-contained statement — understandable without the conversation
3. Do NOT extract generic knowledge (e.g., "follow up with leads" without specific context)
4. Do NOT extract the AI's responses as memories — only extract what the USER reveals
5. Prefer specific, named entities over generic descriptions
6. Set importance based on reusability: client preferences (0.8+), business rules (0.9+), one-time context (0.3-0.5)
7. Set confidence to 1.0 for explicitly stated facts, 0.7-0.9 for inferred information
8. If the conversation contains no extractable knowledge, return empty arrays
9. Avoid redundancy — do not extract the same fact in multiple forms
10. For tool outcomes, focus on PATTERNS not individual results`

// ============================================
// PROMPT BUILDER
// ============================================

interface ConversationMessage {
  role: string
  content: string
  toolCalls?: Array<{ name: string; args: string; result?: string }>
}

interface ExtractionPromptParams {
  messages: ConversationMessage[]
  existingMemories?: string[]
  toolOutcomes?: Array<{ toolName: string; success: boolean; args?: string; result?: string }>
}

/**
 * Build the user prompt for the extraction LLM call.
 * Includes conversation transcript and optionally existing memories for dedup context.
 */
export function buildExtractionPrompt(params: ExtractionPromptParams): string {
  const parts: string[] = []

  parts.push('## Conversation Transcript\n')
  for (const msg of params.messages) {
    const role = msg.role === 'user' ? 'USER' : 'ASSISTANT'
    parts.push(`**${role}:** ${msg.content}`)

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        parts.push(`  [Tool: ${tc.name}] Args: ${tc.args}`)
        if (tc.result) {
          parts.push(`  [Result] ${tc.result.slice(0, 300)}`)
        }
      }
    }
  }

  if (params.existingMemories && params.existingMemories.length > 0) {
    parts.push('\n## Already Known (do NOT re-extract these)\n')
    for (const mem of params.existingMemories) {
      parts.push(`- ${mem}`)
    }
  }

  if (params.toolOutcomes && params.toolOutcomes.length > 0) {
    parts.push('\n## Tool Outcomes to Learn From\n')
    for (const outcome of params.toolOutcomes) {
      const status = outcome.success ? 'SUCCESS' : 'FAILURE'
      parts.push(`- [${status}] ${outcome.toolName}: ${outcome.args ?? '(no args)'}`)
      if (outcome.result) {
        parts.push(`  Result: ${outcome.result.slice(0, 200)}`)
      }
    }
  }

  parts.push('\nExtract all relevant memories from the conversation above.')

  return parts.join('\n')
}
