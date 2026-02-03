'use server'

import { google } from '@ai-sdk/google'
import { generateText } from 'ai'

/**
 * Generate follow-up suggestions using Gemini Flash Lite for speed
 * This runs in parallel with the main response
 */
export async function generateSuggestions(
  userMessage: string,
  aiResponse: string
): Promise<string[]> {
  try {
    const result = await generateText({
      model: google('gemini-2.5-flash-lite'),
      prompt: `Given this conversation about business operations:

User asked: "${userMessage}"
AI responded: "${aiResponse.slice(0, 500)}..."

Generate 2 to 4 SHORT follow-up questions (max 8 words each) the user might want to ask next. 
Focus on business operations: leads, scheduling, invoicing, CRM, appointments.
Make them actionable and specific to what was discussed.

Return ONLY a JSON array like: ["Question 1?", "Question 2?", "Question 3?"]
No other text, just the JSON array.`,
      temperature: 0.7,
    })

    const text = result.text || '[]'

    // Extract JSON array from response
    const jsonMatch = text.match(/\[.*?\]/s)
    if (jsonMatch) {
      const suggestions = JSON.parse(jsonMatch[0]) as string[]
      return suggestions.slice(0, 4)
    }

    return []
  } catch (error) {
    console.error('[Reme] Suggestion generation failed:', error)
    return []
  }
}
