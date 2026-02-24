/**
 * Conversation Summary with Sliding Window
 *
 * Manages long conversation context for the LLM by:
 *   1. Keeping the most recent messages in full (sliding window)
 *   2. Summarizing older messages into a compact digest
 *   3. Flagging very long conversations for archival extraction
 *
 * Operates entirely in the Next.js runtime — no Convex dependency.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  CONVERSATION SUMMARY PIPELINE                                   │
 * │                                                                  │
 * │  messages[]                                                      │
 * │    ↓ count <= windowSize?                                        │
 * │    ├ YES → return as-is (no summary needed)                      │
 * │    └ NO  → split into [older | recent]                           │
 * │           ↓ summarize(older) via lightweight LLM                 │
 * │           ↓ return { summary, recent messages }                  │
 * │                                                                  │
 * │  Archive threshold (50+ messages):                               │
 * │    Sets needsArchival flag for memory extraction scheduling      │
 * └──────────────────────────────────────────────────────────────────┘
 */

import { generateText, type UIMessage } from 'ai'
import { createAIProvider } from '@/lib/ai/providers'

const DEFAULT_WINDOW_SIZE = 6
const DEFAULT_SUMMARY_MAX_TOKENS = 200
const ARCHIVE_THRESHOLD = 50

const SUMMARY_SYSTEM_PROMPT = `You are a concise conversation summarizer. Given a conversation excerpt, produce a brief summary that captures:
- Key topics discussed
- Decisions made or actions taken
- Important facts, names, or numbers mentioned
- Any outstanding questions or requests

Rules:
- Maximum 3-4 sentences
- Use present tense for ongoing matters, past tense for completed actions
- Include specific names, dates, and amounts when mentioned
- Do NOT include pleasantries or greetings`

export interface ConversationSummaryResult {
  messages: UIMessage[]
  summary: string
  totalOriginal: number
  wasTrimmed: boolean
  needsArchival: boolean
}

export interface ConversationSummaryOptions {
  windowSize?: number
  summaryMaxTokens?: number
}

function extractTextFromMessage(msg: UIMessage): string {
  if (!msg.parts || msg.parts.length === 0) return ''
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

function formatMessagesForSummary(messages: UIMessage[]): string {
  return messages
    .map((msg) => {
      const text = extractTextFromMessage(msg)
      if (!text) return null
      const role = msg.role === 'user' ? 'User' : 'Assistant'
      return `${role}: ${text.slice(0, 300)}`
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Build a conversation window with optional summary of older messages.
 *
 * When the conversation is short enough, returns all messages unchanged.
 * When it exceeds the window, summarizes the older portion via a
 * lightweight LLM call and returns only the recent messages.
 */
export async function buildConversationWindow(
  messages: UIMessage[],
  options?: ConversationSummaryOptions
): Promise<ConversationSummaryResult> {
  const windowSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE
  const totalOriginal = messages.length
  const needsArchival = totalOriginal >= ARCHIVE_THRESHOLD

  if (messages.length <= windowSize) {
    return {
      messages,
      summary: '',
      totalOriginal,
      wasTrimmed: false,
      needsArchival,
    }
  }

  const splitIndex = messages.length - windowSize
  const olderMessages = messages.slice(0, splitIndex)
  const recentMessages = messages.slice(splitIndex)

  let summary = ''
  try {
    const transcript = formatMessagesForSummary(olderMessages)
    if (transcript.length > 0) {
      const model = createAIProvider('gemini', 'regular')
      const result = await generateText({
        model,
        system: SUMMARY_SYSTEM_PROMPT,
        prompt: `Summarize this conversation excerpt (${olderMessages.length} messages):\n\n${transcript.slice(0, 4000)}`,
        maxOutputTokens: options?.summaryMaxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS,
        temperature: 0.3,
      })
      summary = result.text.trim()
    }
  } catch (error) {
    console.error('[Reme:Summary] Failed to generate conversation summary:', {
      messageCount: olderMessages.length,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    // Graceful degradation: return recent messages without summary
  }

  return {
    messages: recentMessages,
    summary,
    totalOriginal,
    wasTrimmed: true,
    needsArchival,
  }
}

/**
 * Format a conversation summary for injection into the system prompt.
 * Returns empty string when there is no summary.
 */
export function formatSummaryForPrompt(summary: string): string {
  if (!summary) return ''
  return `## Earlier in This Conversation\n\n${summary}\n`
}
