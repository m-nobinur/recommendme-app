import type { PromptVersion } from './system'

export interface SuggestionConfig {
  minSuggestions: number
  maxSuggestions: number
  maxWordsPerSuggestion: number
  responseContextLimit: number
}

/**
 * Default configuration for suggestion generation
 * Can be overridden per-version or per-call
 */
export const DEFAULT_SUGGESTION_CONFIG: SuggestionConfig = {
  minSuggestions: 2,
  maxSuggestions: 4,
  maxWordsPerSuggestion: 8,
  responseContextLimit: 500,
}

/**
 * Suggestion prompts with versioning
 * Each version can have different prompt strategies
 */
export const SUGGESTION_PROMPTS: Record<string, PromptVersion> = {
  v1: {
    version: '1.0.0',
    description: 'Initial suggestion prompt - basic follow-up questions',
    content: `You are a helpful business operations assistant. Based on this conversation, generate {{minSuggestions}}-{{maxSuggestions}} relevant follow-up questions.

Context:
User asked: "{{userMessage}}"
AI responded: "{{aiResponse}}"

Generate SHORT follow-up questions (max {{maxWordsPerSuggestion}} words each) that:
1. Are directly related to what was just discussed
2. Focus on business operations: leads, scheduling, invoicing, CRM, appointments
3. Are actionable and specific (avoid generic questions)
4. Help the user accomplish their business goals
5. End with a question mark

Examples of good suggestions:
- "How do I schedule a follow-up?"
- "Can I export my leads?"
- "What's the invoice workflow?"

Generate {{minSuggestions}}-{{maxSuggestions}} suggestions now.`,
  },

  v2: {
    version: '2.0.0',
    description: 'Enhanced suggestion prompt - context-aware with priority hints',
    content: `You are Reme, a business assistant specializing in CRM operations. Generate {{minSuggestions}}-{{maxSuggestions}} intelligent follow-up questions based on the conversation.

## Context
User query: "{{userMessage}}"
Assistant response: "{{aiResponse}}"

## Requirements
Generate concise follow-up questions (≤{{maxWordsPerSuggestion}} words) that:

1. **Contextual**: Build on what was just discussed
2. **Actionable**: Lead to concrete actions (add, update, schedule, invoice)
3. **Domain-specific**: Focus on CRM workflows (leads, appointments, invoicing)
4. **Progressive**: Guide users through natural next steps
5. **Clear**: End with question marks, avoid ambiguity

## Priority Guidelines
- If user added a lead → suggest scheduling or qualification
- If user scheduled appointment → suggest invoice creation or reminders
- If user searched/listed → suggest filtering, updating, or exporting
- If user asked general question → suggest specific actions

## Examples
✓ "Schedule an appointment with John?"
✓ "Update Sarah's lead status to Qualified?"
✓ "Create invoice for this booking?"
✗ "What else can I help you with?" (too generic)
✗ "Do you need anything?" (not actionable)

Generate {{minSuggestions}}-{{maxSuggestions}} contextual suggestions.`,
  },
}

/**
 * Template interpolation cache
 */
const templateCache = new Map<string, (vars: Record<string, string>) => string>()

/**
 * Create optimized template interpolation function
 */
function createTemplateFunction(template: string): (vars: Record<string, string>) => string {
  return (vars: Record<string, string>) => {
    return template.replace(/{{(\w+)}}/g, (_, key) => vars[key] || '')
  }
}

/**
 * Get the active suggestion prompt with interpolated variables
 * Uses caching for better performance
 *
 * @param userMessage - The user's message
 * @param aiResponse - The AI's response (will be truncated to config limit)
 * @param config - Optional config override
 * @param version - Optional version override
 * @returns Interpolated prompt string
 */
export function getSuggestionPrompt(
  userMessage: string,
  aiResponse: string,
  config: SuggestionConfig = DEFAULT_SUGGESTION_CONFIG,
  version?: string
): string {
  const activeVersion = version || process.env.AI_SUGGESTION_PROMPT_VERSION || 'v2'
  const prompt = SUGGESTION_PROMPTS[activeVersion] || SUGGESTION_PROMPTS.v2

  if (!SUGGESTION_PROMPTS[activeVersion]) {
    console.warn(`[Reme:Prompts] Suggestion prompt version '${activeVersion}' not found, using v2`)
  }

  let templateFn = templateCache.get(activeVersion)
  if (!templateFn) {
    templateFn = createTemplateFunction(prompt.content)
    templateCache.set(activeVersion, templateFn)
  }

  const truncatedResponse = aiResponse.slice(0, config.responseContextLimit)
  const responseWithEllipsis =
    aiResponse.length > config.responseContextLimit ? `${truncatedResponse}...` : truncatedResponse

  return templateFn({
    userMessage,
    aiResponse: responseWithEllipsis,
    minSuggestions: String(config.minSuggestions),
    maxSuggestions: String(config.maxSuggestions),
    maxWordsPerSuggestion: String(config.maxWordsPerSuggestion),
  })
}

/**
 * Clear template cache.
 */
export function clearTemplateCache(): void {
  templateCache.clear()
}

/**
 * Get a specific suggestion prompt version
 */
export function getSuggestionPromptVersion(version: string): PromptVersion | undefined {
  return SUGGESTION_PROMPTS[version]
}

/**
 * List all available suggestion prompt versions
 */
export function listSuggestionPromptVersions(): string[] {
  return Object.keys(SUGGESTION_PROMPTS)
}
