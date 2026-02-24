import type { Id } from '@convex/_generated/dataModel'
import { tool } from 'ai'
import { ConvexHttpClient } from 'convex/browser'
import { z } from 'zod'
import type { ToolContext } from './index'

const BUSINESS_MEMORY_TYPES = [
  'fact',
  'preference',
  'instruction',
  'context',
  'relationship',
  'episodic',
] as const

const memoryTypeSchema = z.enum(BUSINESS_MEMORY_TYPES)

interface ToolSuccess<T = unknown> {
  success: true
  data?: T
  message?: string
}

interface ToolError {
  success: false
  error: string
}

type ToolResult<T = unknown> = ToolSuccess<T> | ToolError

function asOrganizationId(id: string): Id<'organizations'> {
  return id as Id<'organizations'>
}

function asBusinessMemoryId(id: string): Id<'businessMemories'> {
  return id as Id<'businessMemories'>
}

let cachedApiPromise: Promise<typeof import('@convex/_generated/api')> | null = null

function getApi() {
  if (!cachedApiPromise) {
    cachedApiPromise = import('@convex/_generated/api')
  }
  return cachedApiPromise
}

/**
 * Create memory management tools for the chat AI.
 *
 * These let the AI explicitly store, search, update, and remove
 * business knowledge on behalf of the user.
 */
export function createMemoryTools(ctx: ToolContext) {
  const convex = ctx.convexClient ?? new ConvexHttpClient(ctx.convexUrl)
  const orgId = asOrganizationId(ctx.organizationId)

  return {
    rememberFact: tool({
      description:
        'Remember a specific fact, preference, instruction, or piece of information about a customer, service, or business rule. Use when the user explicitly asks you to remember something, or when clearly important information is shared.',
      inputSchema: z.object({
        content: z
          .string()
          .min(10)
          .max(500)
          .describe('The information to remember (10-500 characters)'),
        type: memoryTypeSchema.describe(
          'Memory type: fact (concrete data), preference (likes/dislikes), instruction (business rules), context (temporary info), relationship (connections between entities), episodic (event/interaction details)'
        ),
        importance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            'How important this is (0-1). Business rules: 0.9+, client preferences: 0.7-0.9, general context: 0.3-0.6. Defaults to 0.7'
          ),
        subjectType: z
          .string()
          .optional()
          .describe('What this is about: lead, appointment, service, business, etc.'),
        subjectName: z
          .string()
          .optional()
          .describe('Name of the subject (e.g. "John Smith", "Portrait Session")'),
      }),
      execute: async (args): Promise<ToolResult<{ memoryId: string; type: string }>> => {
        try {
          const { api } = await getApi()
          const normalizedSubject = args.subjectName?.trim().toLowerCase()
          const memoryId = await convex.mutation(api.businessMemories.create, {
            organizationId: orgId,
            type: args.type,
            content: args.content,
            importance: args.importance ?? 0.7,
            confidence: 0.95,
            source: 'tool' as const,
            subjectType: args.subjectType,
            subjectId: normalizedSubject,
          })

          return {
            success: true,
            data: { memoryId: memoryId as string, type: args.type },
            message: `Remembered: "${args.content.slice(0, 80)}${args.content.length > 80 ? '...' : ''}"`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to store memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    forgetMemory: tool({
      description:
        'Forget or remove a stored memory. Searches for the closest matching memory and removes it. Use when the user explicitly asks to forget or remove stored information.',
      inputSchema: z.object({
        description: z
          .string()
          .describe('Description of what to forget — will be matched against stored memories'),
        type: memoryTypeSchema.optional().describe('Optional type filter to narrow the search'),
      }),
      execute: async (args): Promise<ToolResult<{ forgottenContent: string }>> => {
        try {
          const { api } = await getApi()

          const searchResults = await convex.action(api.memoryRetrieval.searchMemories, {
            query: args.description,
            organizationId: orgId,
            type: args.type,
            limit: 1,
          })

          if (searchResults.results.length === 0) {
            return {
              success: false,
              error: 'No matching memory found to forget.',
            }
          }

          const match = searchResults.results[0]

          await convex.mutation(api.businessMemories.softDelete, {
            id: asBusinessMemoryId(match.id),
            organizationId: orgId,
          })

          return {
            success: true,
            data: { forgottenContent: match.content },
            message: `Forgotten: "${match.content.slice(0, 80)}${match.content.length > 80 ? '...' : ''}"`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to forget memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    searchMemories: tool({
      description:
        'Search through stored business knowledge and memories. Use when you need to look up specific facts, preferences, or information that may have been stored previously.',
      inputSchema: z.object({
        query: z.string().describe('What to search for in stored memories'),
        type: memoryTypeSchema
          .optional()
          .describe(
            'Optional type filter: fact, preference, instruction, context, relationship, episodic'
          ),
        limit: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .describe('Maximum results to return (default 5)'),
      }),
      execute: async (
        args
      ): Promise<
        ToolResult<{
          memories: Array<{
            content: string
            type: string
            confidence: number
            importance: number
            subject?: string
          }>
          count: number
        }>
      > => {
        try {
          const { api } = await getApi()

          const searchResults = await convex.action(api.memoryRetrieval.searchMemories, {
            query: args.query,
            organizationId: orgId,
            type: args.type,
            limit: args.limit ?? 5,
          })

          const memories = searchResults.results.map((r) => ({
            content: r.content,
            type: r.type,
            confidence: r.confidence,
            importance: r.importance,
            subject: r.subjectName ?? r.subjectType,
          }))

          return {
            success: true,
            data: { memories, count: memories.length },
            message:
              memories.length > 0
                ? `Found ${memories.length} matching ${memories.length === 1 ? 'memory' : 'memories'}.`
                : 'No matching memories found.',
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to search memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),

    updatePreference: tool({
      description:
        'Update or create a preference for a customer or the business. Searches for an existing preference to update; creates a new one if none exists.',
      inputSchema: z.object({
        content: z.string().min(10).max(500).describe('The preference content (10-500 characters)'),
        subjectType: z
          .string()
          .optional()
          .describe('What this preference is about: lead, service, business, etc.'),
        subjectName: z.string().optional().describe('Name of the subject (e.g. "John Smith")'),
      }),
      execute: async (
        args
      ): Promise<ToolResult<{ memoryId: string; action: 'created' | 'updated' }>> => {
        try {
          const { api } = await getApi()

          const searchResults = await convex.action(api.memoryRetrieval.searchMemories, {
            query: args.content,
            organizationId: orgId,
            type: 'preference',
            limit: 3,
          })

          const SIMILARITY_UPDATE_THRESHOLD = 0.6
          const normalizedSubject = args.subjectName?.trim().toLowerCase()
          const existingMatch = searchResults.results.find(
            (r) => r.score >= SIMILARITY_UPDATE_THRESHOLD
          )

          if (existingMatch) {
            await convex.mutation(api.businessMemories.update, {
              id: asBusinessMemoryId(existingMatch.id),
              organizationId: orgId,
              content: args.content,
              confidence: 0.95,
              subjectType: args.subjectType,
              subjectId: normalizedSubject,
            })

            return {
              success: true,
              data: { memoryId: existingMatch.id, action: 'updated' },
              message: `Updated preference: "${args.content.slice(0, 80)}${args.content.length > 80 ? '...' : ''}"`,
            }
          }

          const memoryId = await convex.mutation(api.businessMemories.create, {
            organizationId: orgId,
            type: 'preference' as const,
            content: args.content,
            importance: 0.8,
            confidence: 0.95,
            source: 'tool' as const,
            subjectType: args.subjectType,
            subjectId: normalizedSubject,
          })

          return {
            success: true,
            data: { memoryId: memoryId as string, action: 'created' },
            message: `Stored new preference: "${args.content.slice(0, 80)}${args.content.length > 80 ? '...' : ''}"`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to update preference: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }
        }
      },
    }),
  }
}

export type MemoryTools = ReturnType<typeof createMemoryTools>
