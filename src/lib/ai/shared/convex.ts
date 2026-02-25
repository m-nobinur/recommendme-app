import type { Id } from '@convex/_generated/dataModel'

let cachedApiPromise: Promise<typeof import('@convex/_generated/api')> | null = null

export function getApi() {
  if (!cachedApiPromise) {
    cachedApiPromise = import('@convex/_generated/api')
  }
  return cachedApiPromise
}

export function asOrganizationId(id: string): Id<'organizations'> {
  return id as Id<'organizations'>
}

export function asAppUserId(id: string): Id<'appUsers'> {
  return id as Id<'appUsers'>
}

export function asLeadId(id: string): Id<'leads'> {
  return id as Id<'leads'>
}

export function asBusinessMemoryId(id: string): Id<'businessMemories'> {
  return id as Id<'businessMemories'>
}
